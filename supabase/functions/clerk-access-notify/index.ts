// clerk-access-notify
//
// Sends the two clerk-access-system email notifications:
//   - "request_created": to the magistrate(s) authorized to review a
//     newly-submitted, verified clerk access request.
//   - "decision_made": to the clerk, once their request has been
//     approved or rejected.
//
// SECURITY MODEL: this function is invoked by an authenticated client
// (supabase.functions.invoke(), which attaches the caller's own JWT --
// Supabase's platform verifies that JWT before this code even runs,
// unless verify_jwt is explicitly disabled for this function, which it
// is not). The caller only ever supplies a request_id; every fact this
// function acts on (clerk identity, court, magistrate identity, current
// decision state, email-verification status) is re-derived HERE, from
// the database, using the service-role key -- never trusted from the
// invocation payload. A malicious or buggy client cannot forge a
// notification about a decision that didn't actually happen, or about a
// request that isn't actually verified/pending, because this function
// simply looks up the real row and computes recipients itself.
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
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
// by the Supabase platform to every Edge Function and need no manual
// configuration.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const NOTIFY_FROM_EMAIL = Deno.env.get("NOTIFY_FROM_EMAIL");
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  event: "request_created" | "decision_made";
  request_id: string;
}

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

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (!body.request_id || !body.event) {
    return new Response("request_id and event are required", { status: 400 });
  }

  const { data: request, error: requestErr } = await admin
    .from("clerk_access_requests")
    .select(
      "id, status, staff_id, note, requested_at, reviewed_at, rejection_reason, profile_id, court_id, notified_magistrate_at, notified_clerk_at",
    )
    .eq("id", body.request_id)
    .single();
  if (requestErr || !request) {
    return new Response("Request not found", { status: 404 });
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

  const reviewUrl = `${APP_BASE_URL}/clerk-access-requests`;

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
    // can_manage_clerk_access() does in Postgres, using the service role
    // (this function's own privileged context, not the caller's).
    const { data: assignments } = await admin
      .from("magistrate_courts")
      .select("profile_id, can_manage_clerks")
      .eq("court_id", request.court_id)
      .is("ended_at", null);

    const authorizedProfileIds =
      !assignments || assignments.length === 0
        ? []
        : assignments.length === 1
          ? [assignments[0].profile_id]
          : assignments.filter((a) => a.can_manage_clerks).map((a) => a.profile_id);

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

    const results = await Promise.all(
      (magistrates ?? []).map((m) =>
        sendEmail(
          m.email,
          `Clerk access request: ${court?.name ?? "a court"}`,
          `<p>${clerkProfile?.full_name ?? "A clerk"} (${clerkProfile?.email}) has requested access to <strong>${court?.name ?? "a court"}</strong>.</p>` +
            (request.staff_id ? `<p>Staff ID: ${request.staff_id}</p>` : "") +
            (request.note ? `<p>Note: ${request.note}</p>` : "") +
            `<p>Requested: ${request.requested_at}</p>` +
            `<p><a href="${reviewUrl}">Review access request</a></p>`,
        ),
      ),
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

  const result = await sendEmail(
    clerkProfile.email,
    request.status === "approved"
      ? `Your access to ${court?.name ?? "the court"} has been approved`
      : `Your request for ${court?.name ?? "the court"} was not approved`,
    request.status === "approved"
      ? `<p>Your request for access to <strong>${court?.name ?? "the court"}</strong> has been approved. You can now open its docket in ${APP_BASE_URL ? `<a href="${APP_BASE_URL}/docket">BenchBook</a>` : "BenchBook"}.</p>`
      : `<p>Your request for access to <strong>${court?.name ?? "the court"}</strong> was not approved.</p>` +
        (request.rejection_reason ? `<p>Reason: ${request.rejection_reason}</p>` : ""),
  );

  await admin
    .from("clerk_access_requests")
    .update({ notified_clerk_at: new Date().toISOString() })
    .eq("id", request.id);

  return new Response(JSON.stringify({ notified: result.sent }), { status: 200 });
});
