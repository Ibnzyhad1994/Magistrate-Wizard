import { supabase } from "@/lib/supabase"
import { useAuthStore } from "@/store/auth-store"
import { toast } from "sonner"

let lockInFlight: Promise<void> | null = null
let lastAuthToastAt = 0

export function notifyAuthExpiredSave(): void {
  const now = Date.now()
  if (now - lastAuthToastAt < 4_000) return
  lastAuthToastAt = now
  toast.error("Sign in to save — your work is still on this page.")
}

const LOCAL_SIGNOUT_ATTEMPTS = 3

async function dropLocalTokens(): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < LOCAL_SIGNOUT_ATTEMPTS; attempt += 1) {
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" })
      if (!error) return
      lastError = error
    } catch (err) {
      lastError = err
    }
  }
  if (lastError) throw lastError
}

/**
 * Drop the JWT locally so APIs 401, but keep React auth as `locked` so
 * ProtectedRoute does not unmount the workspace.
 *
 * If local sign-out fails, stay `locked` (do not bounce back to
 * authenticated while tokens may still be in storage) so a later call
 * retries. Concurrent callers share one in-flight attempt.
 */
export async function lockCurrentSession(): Promise<void> {
  const state = useAuthStore.getState()
  if (state.status !== "authenticated" && state.status !== "locked") return
  if (state.status === "authenticated") {
    state.lockSession()
  }
  if (lockInFlight) return lockInFlight
  lockInFlight = dropLocalTokens()
    .catch(() => undefined)
    .finally(() => {
      lockInFlight = null
    })
  return lockInFlight
}
