// clerk-access-notify
//
// Sends the two clerk-access-system email notifications:
//   - "request_created": to the magistrate(s) authorized to review a
//     newly-submitted, verified clerk access request.
//   - "decision_made": to the clerk, once their request has been
//     approved or rejected.
//
// SECURITY MODEL: this function is invoked by an authenticated client
// (supabase.functions.invoke(), which attaches the caller's own JWT).
// The platform's verify_jwt gate accepts ANY valid JWT -- including the
// public anon key -- so this code verifies the caller itself:
//   1. `admin.auth.getUser(jwt)` must resolve to a real user (401 if not).
//   2. That user must be the request's clerk (profile_id) or someone who
//      may review requests for the request's court -- exactly the
//      can_manage_clerk_access() predicate (0144/0151: sole sitting,
//      unique primary, can_manage_clerks flag, or Court Assignment
//      Administrator), evaluated as the caller via an RLS-scoped client so
//      Postgres, not this file, owns that rule. Anyone else gets 403.
// The caller only ever supplies a request_id; every fact this function
// acts on (clerk identity, court, magistrate identity, current decision
// state, email-verification status) is re-derived HERE, from the
// database, using the service-role key -- never trusted from the
// invocation payload. A malicious or buggy client cannot forge a
// notification about a decision that didn't actually happen, or about a
// request that isn't actually verified/pending, because this function
// simply looks up the real row and computes recipients itself.
//
// Every database value interpolated into an email body is HTML-escaped
// (full_name, email, staff_id, note, rejection_reason, court name) so a
// crafted profile or request cannot inject markup into a reviewer's inbox.
//
// Never sends anything if the request's clerk has not verified their
// email (mirrors clerk_access_request_email_confirmed() in Postgres).
//
// EMAIL PROVIDER: not yet configured for this project. If RESEND_API_KEY
// is unset, this function logs what it WOULD have sent and returns 200
// without making any external call -- so the in-app request/decision
// flow (which is what actually invokes this function) never breaks or
// blocks on email being configured. To enable real delivery, set the
// environment variables documented below via `supabase secrets set`
// (or the linked project's Dashboard → Edge Functions → Secrets) and
// deploy: `supabase functions deploy clerk-access-notify`.
//
// Required secrets to enable real email delivery (none hard-coded here):
//   RESEND_API_KEY        - API key for https://resend.com (or swap the
//                            fetch call below for another provider)
//   NOTIFY_FROM_EMAIL     - the verified "from" address to send as
//   APP_BASE_URL           - e.g. https://benchbook.example.gov, used to
//                            build the "Review access request" link
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// provided automatically by the Supabase platform to every Edge Function
// and need no manual configuration.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const NOTIFY_FROM_EMAIL = Deno.env.get("NOTIFY_FROM_EMAIL");
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  event: "request_created" | "decision_made";
  request_id: string;
}

/** Minimal HTML escaping for text interpolated into email bodies. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only an http(s) base URL may become a clickable link in an email. */
const safeAppUrl = (path: string) => {
  if (!/^https?:\/\//i.test(APP_BASE_URL)) return null;
  return escapeHtml(`${APP_BASE_URL.replace(/\/+$/, "")}${path}`);
};

const bearerToken = (req: Request) => {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY || !NOTIFY_FROM_EMAIL) {
    console.log(`[clerk-access-notify] Email provider not configured — would have sent to ${to}: ${subject}`);
    return { sent: false as const };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: NOTIFY_FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    console.error("[clerk-access-notify] Email provider error:", await res.text());
    return { sent: false as const };
  }
  return { sent: true as const };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // --- Caller verification (a valid anon-key JWT is NOT a user) ---------
  const jwt = bearerToken(req);
  if (!jwt) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { data: callerData, error: callerErr } = await admin.auth.getUser(jwt);
  const caller = callerData?.user;
  if (callerErr || !caller?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (!body.request_id || !body.event) {
    return new Response("request_id and event are required", { status: 400 });
  }
  if (body.event !== "request_created" && body.event !== "decision_made") {
    return new Response("Unknown event", { status: 400 });
  }

  const { data: request, error: requestErr } = await admin
    .from("clerk_access_requests")
    .select(
      "id, status, staff_id, note, requested_at, reviewed_at, rejection_reason, profile_id, court_id, notified_magistrate_at, notified_clerk_at",
    )
    .eq("id", body.request_id)
    .single();
  if (requestErr || !request) {
    // Same status for "no such row" and "not yours" so request ids cannot
    // be enumerated by an unrelated user.
    return new Response("Request not found", { status: 404 });
  }

  // --- Caller authorization: the request's clerk, or a reviewer for its
  // court (can_manage_clerk_access, evaluated AS the caller). -------------
  if (caller.id !== request.profile_id) {
    const asCaller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: mayReview, error: reviewErr } = await asCaller.rpc("can_manage_clerk_access", {
      p_court_id: request.court_id,
    });
    if (reviewErr || mayReview !== true) {
      return new Response("Request not found", { status: 404 });
    }
  }

  const { data: clerkUser } = await admin.auth.admin.getUserById(request.profile_id);
  if (!clerkUser?.user?.email_confirmed_at) {
    // Never notify anyone about an unverified clerk's request.
    return new Response(JSON.stringify({ skipped: "clerk email not verified" }), { status: 200 });
  }

  const [{ data: clerkProfile }, { data: court }] = await Promise.all([
    admin.from("profiles").select("full_name, email").eq("id", request.profile_id).single(),
    admin.from("courts").select("name").eq("id", request.court_id).single(),
  ]);

  const courtName = escapeHtml(court?.name ?? "a court");
  const reviewUrl = safeAppUrl("/clerk-access-requests");

  if (body.event === "request_created") {
    if (request.status !== "pending") {
      return new Response(JSON.stringify({ skipped: "request is not pending" }), { status: 200 });
    }
    if (request.notified_magistrate_at) {
      // Idempotent: a duplicate/retried invocation for the same request
      // must not send a second email — "no unnecessary notification noise."
      return new Response(JSON.stringify({ skipped: "already notified" }), { status: 200 });
    }

    // Resolve the authorized magistrate(s) exactly like
    // can_manage_clerk_access() does in Postgres (0144): sole sitting,
    // unique current primary, or can_manage_clerks. Service role, not
    // the caller's JWT.
    const { data: assignments } = await admin
      .from("magistrate_courts")
      .select("profile_id, can_manage_clerks, assignment_type")
      .eq("court_id", request.court_id)
      .is("ended_at", null);

    const current = assignments ?? [];
    const regularCount = current.filter((a) => a.assignment_type === "regular").length;
    const authorizedProfileIds = [
      ...new Set(
        current
          .filter(
            (a) =>
              a.can_manage_clerks ||
              current.length === 1 ||
              (a.assignment_type === "regular" && regularCount === 1),
          )
          .map((a) => a.profile_id),
      ),
    ];

    if (authorizedProfileIds.length === 0) {
      // Orphaned — surfaced to admins via list_clerk_access_requests_needing_admin_attention()
      // in the app itself, not by email (per spec: never auto-approve, never
      // treat "no approver" as a reason to silently drop the request).
      return new Response(JSON.stringify({ skipped: "no authorized magistrate" }), { status: 200 });
    }

    const { data: magistrates } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .in("id", authorizedProfileIds);

    const clerkName = escapeHtml(clerkProfile?.full_name ?? "A clerk");
    const clerkEmail = escapeHtml(clerkProfile?.email ?? "");
    const html =
      `<p>${clerkName} (${clerkEmail}) has requested access to <strong>${courtName}</strong>.</p>` +
      (request.staff_id ? `<p>Staff ID: ${escapeHtml(request.staff_id)}</p>` : "") +
      (request.note ? `<p>Note: ${escapeHtml(request.note)}</p>` : "") +
      `<p>Requested: ${escapeHtml(request.requested_at)}</p>` +
      (reviewUrl ? `<p><a href="${reviewUrl}">Review access request</a></p>` : "");

    const results = await Promise.all(
      (magistrates ?? [])
        .filter((m) => Boolean(m.email))
        .map((m) => sendEmail(m.email, `Clerk access request: ${court?.name ?? "a court"}`, html)),
    );

    await admin
      .from("clerk_access_requests")
      .update({ notified_magistrate_at: new Date().toISOString() })
      .eq("id", request.id);

    return new Response(JSON.stringify({ notified: results.filter((r) => r.sent).length }), { status: 200 });
  }

  // decision_made
  if (request.status !== "approved" && request.status !== "rejected") {
    return new Response(JSON.stringify({ skipped: "request has no decision yet" }), { status: 200 });
  }
  if (request.notified_clerk_at) {
    return new Response(JSON.stringify({ skipped: "already notified" }), { status: 200 });
  }
  if (!clerkProfile?.email) {
    return new Response(JSON.stringify({ skipped: "clerk has no email on file" }), { status: 200 });
  }

  const docketUrl = safeAppUrl("/docket");
  const result = await sendEmail(
    clerkProfile.email,
    request.status === "approved"
      ? `Your access to ${court?.name ?? "the court"} has been approved`
      : `Your request for ${court?.name ?? "the court"} was not approved`,
    request.status === "approved"
      ? `<p>Your request for access to <strong>${courtName}</strong> has been approved. You can now open its docket in ${docketUrl ? `<a href="${docketUrl}">BenchBook</a>` : "BenchBook"}.</p>`
      : `<p>Your request for access to <strong>${courtName}</strong> was not approved.</p>` +
        (request.rejection_reason ? `<p>Reason: ${escapeHtml(request.rejection_reason)}</p>` : ""),
  );

  await admin
    .from("clerk_access_requests")
    .update({ notified_clerk_at: new Date().toISOString() })
    .eq("id", request.id);

  return new Response(JSON.stringify({ notified: result.sent }), { status: 200 });
});
