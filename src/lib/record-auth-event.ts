import { supabase } from "@/lib/supabase"
import type { AuthEventType } from "@/lib/audit-activity"

/**
 * Best-effort write to auth_event_log. Never throws: a failed audit
 * write must not block sign-in, sign-out, or password reset.
 */
export const recordAuthEvent = async (
  event: AuthEventType,
  email?: string | null,
): Promise<void> => {
  try {
    const userAgent = typeof navigator === "undefined" ? null : navigator.userAgent
    const { error } = await supabase.rpc("record_auth_event", {
      p_event: event,
      p_email: email ?? null,
      p_user_agent: userAgent,
    })
    if (error) {
      console.warn("auth event was not recorded", error.message)
    }
  } catch {
    // Swallow — this is a sidecar, not part of the auth contract.
  }
}
