import { queryClient } from "@/lib/query-client"
import { isAuthExpiredError } from "@/lib/offline/is-queueable-error"
import { flushPendingHearings } from "@/lib/offline/runtime"
import { bumpRememberUntil } from "@/lib/auth/session-storage"

type ExecutableMutation = {
  execute: () => Promise<unknown>
  state: { status: string; error: unknown }
  options: { mutationKey?: readonly unknown[] }
}

/**
 * After password unlock: replay the save that 401'd, flush the hearing
 * outbox, and refetch. Query cache is not cleared — only explicit Sign
 * out does that.
 */
export async function recoverSessionWork(): Promise<void> {
  bumpRememberUntil()
  const mutations = queryClient.getMutationCache().getAll() as unknown as ExecutableMutation[]
  for (const mutation of mutations) {
    if (mutation.options.mutationKey?.[0] === "auth") continue
    if (mutation.state.status !== "error") continue
    if (!isAuthExpiredError(mutation.state.error)) continue
    if (typeof mutation.execute !== "function") continue
    void mutation.execute().catch(() => undefined)
  }
  await flushPendingHearings()
  await queryClient.invalidateQueries()
}
