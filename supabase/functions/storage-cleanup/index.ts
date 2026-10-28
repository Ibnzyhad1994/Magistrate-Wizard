// storage-cleanup
//
// Removes Storage files whose `documents` row has been deleted. Deleting a
// judgment, bench note, quick code, Case Law entry or docket matter removes
// its `documents` rows in SQL, and documents_queue_storage_cleanup() (0165)
// records each file still stored in storage_cleanup_queue. SQL cannot
// delete a Storage object, so this function removes queued files through
// the Storage API with the service role, then drops their queue rows.
// A file that a `documents` row references again is kept and dequeued.
// A failed removal stays queued (attempts, last_error) and is retried with
// a growing delay (next_attempt_at); after MAX_ATTEMPTS it is dead-lettered
// (dead_lettered_at) for an operator, so failing rows never starve the rest.
//
// Callers: the app after every delete, and pg_cron every minute through
// request_storage_cleanup_run() (0167), which covers deletes the database
// makes on its own, such as the hourly bin purge.
//
// Auth: a signed-in user's JWT (the app), or the service-role key (the
// scheduled run, or an operator). The platform's verify_jwt gate
// accepts the public anon key, so the caller is checked here. A caller
// chooses nothing: the queue is written only by the database trigger, so
// a run can only remove files that no `documents` row references.
// No email, no outbound call beyond Storage.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// The app invokes this from the browser, so the preflight must pass.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

const constantTimeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const isAuthorised = async (req: Request) => {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!bearer) return false;
  if (constantTimeEqual(bearer, SERVICE_ROLE_KEY)) return true;
  const { data, error } = await admin.auth.getUser(bearer);
  return !error && !!data?.user?.id;
};

type QueueRow = { bucket_id: string; object_name: string; attempts: number };

// One minute after the first failure, doubling, capped at a day.
const retryAt = (attempts: number) =>
  new Date(Date.now() + Math.min(60_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS)).toISOString();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!(await isAuthorised(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: rows, error } = await admin
    .from("storage_cleanup_queue")
    .select("bucket_id, object_name, attempts")
    .is("dead_lettered_at", null)
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) {
    return json({ error: error.message }, 500);
  }

  let removed = 0;
  let kept = 0;
  let failed = 0;
  let deadLettered = 0;
  const byBucket = new Map<string, QueueRow[]>();
  for (const row of (rows ?? []) as QueueRow[]) {
    byBucket.set(row.bucket_id, [...(byBucket.get(row.bucket_id) ?? []), row]);
  }

  for (const [bucket, queued] of byBucket) {
    const names = queued.map((row) => row.object_name);
    const dequeue = (objectNames: string[]) =>
      objectNames.length === 0
        ? Promise.resolve()
        : admin
            .from("storage_cleanup_queue")
            .delete()
            .eq("bucket_id", bucket)
            .in("object_name", objectNames);

    const { data: linked, error: linkedError } = await admin
      .from("documents")
      .select("file_path")
      .in("file_path", names);
    if (linkedError) {
      return json({ error: linkedError.message }, 500);
    }
    const stillLinked = new Set((linked ?? []).map((row) => row.file_path));
    await dequeue(names.filter((name) => stillLinked.has(name)));
    kept += stillLinked.size;

    const orphans = queued.filter((row) => !stillLinked.has(row.object_name));
    if (orphans.length === 0) continue;

    const { error: removeError } = await admin.storage
      .from(bucket)
      .remove(orphans.map((row) => row.object_name));
    if (removeError) {
      failed += orphans.length;
      for (const row of orphans) {
        const attempts = row.attempts + 1;
        const dead = attempts >= MAX_ATTEMPTS;
        if (dead) deadLettered += 1;
        await admin
          .from("storage_cleanup_queue")
          .update({
            attempts,
            last_error: removeError.message,
            next_attempt_at: retryAt(attempts),
            dead_lettered_at: dead ? new Date().toISOString() : null,
          })
          .eq("bucket_id", bucket)
          .eq("object_name", row.object_name);
      }
      continue;
    }
    await dequeue(orphans.map((row) => row.object_name));
    removed += orphans.length;
  }

  return json({ removed, kept, failed, dead_lettered: deadLettered });
});
