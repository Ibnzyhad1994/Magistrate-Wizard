import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { usePendingHearings } from "@/hooks/offline/use-pending-hearings"
import { flushPendingHearings, startOfflineFlushListeners } from "@/lib/offline/runtime"

export function OfflineSyncBanner() {
  const { count } = usePendingHearings()
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    startOfflineFlushListeners()
  }, [])

  if (count === 0) return null

  const handleSync = async () => {
    setSyncing(true)
    try {
      await flushPendingHearings()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div
      className="fixed inset-x-0 top-[calc(68px+env(safe-area-inset-top,0px))] z-40 flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-950/80 px-4 py-2 text-sm text-amber-50 backdrop-blur-sm max-md:text-xs"
      role="status"
    >
      <p>
        Saved on this device. Will sync when online.
        {count > 1 ? ` ${count} pending.` : " 1 pending."}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void handleSync()}
        disabled={syncing}
        aria-label="Sync pending hearings"
      >
        {syncing ? "Syncing…" : "Sync pending"}
      </Button>
    </div>
  )
}
