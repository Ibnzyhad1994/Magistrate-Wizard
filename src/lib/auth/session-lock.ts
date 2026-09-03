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

/**
 * Drop the JWT locally so APIs 401, but keep React auth as `locked` so
 * ProtectedRoute does not unmount the workspace.
 */
export async function lockCurrentSession(): Promise<void> {
  const state = useAuthStore.getState()
  if (state.status === "locked") return
  if (state.status !== "authenticated") return
  state.lockSession()
  if (lockInFlight) return lockInFlight
  lockInFlight = supabase.auth
    .signOut({ scope: "local" })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      lockInFlight = null
    })
  return lockInFlight
}
