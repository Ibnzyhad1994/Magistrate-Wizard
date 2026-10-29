/**
 * Asking the clerk-access-notify Edge Function to email a clerk-access
 * request or decision.
 *
 * Best-effort: the function re-derives every fact from the database and
 * skips anything already notified, so a missed call never breaks the
 * request or decision the person made. A failed call is still reported
 * (to Sentry when it is on): supabase.functions.invoke() returns HTTP and
 * network failures instead of throwing, so without this a function the
 * browser cannot reach fails without anyone knowing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/sentry";

type FunctionsClient = Pick<SupabaseClient, "functions">;

export const CLERK_ACCESS_NOTIFY_FUNCTION = "clerk-access-notify";

export type ClerkAccessNoticeEvent = "request_created" | "decision_made";

/** Asks for the email about one request. Never throws. */
export async function sendClerkAccessNotice(
  client: FunctionsClient,
  event: ClerkAccessNoticeEvent,
  requestId: string,
): Promise<void> {
  const context = { source: "edge-function", key: CLERK_ACCESS_NOTIFY_FUNCTION, event };
  try {
    const { error } = await client.functions.invoke(CLERK_ACCESS_NOTIFY_FUNCTION, {
      method: "POST",
      body: { event, request_id: requestId },
    });
    if (error) reportError(error, context);
  } catch (err) {
    reportError(err, context);
  }
}
