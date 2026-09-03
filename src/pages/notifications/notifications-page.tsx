import { Inbox } from "lucide-react"
import { Link } from "react-router-dom"
import { BrowseHeader, BrowsePage } from "@/components/browse"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/common/empty-state"
import { InlineError } from "@/components/common/inline-error"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/use-notifications"
import { notificationTypeLabel } from "@/lib/notifications"
import { formatDateTime } from "@/lib/utils"

export default function NotificationsPage() {
  const { data, isPending, isError, error, refetch } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const unread = (data ?? []).filter((row) => !row.read_at).length

  return (
    <BrowsePage>
      <BrowseHeader
        title="Notifications"
        description="In-app notices for shares, court assignments, clerk requests, and hearing reminders. Email is not sent from this list."
        action={
          unread > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              aria-label="Mark all notifications as read"
            >
              Mark all read
            </Button>
          ) : null
        }
      />

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No notices yet"
          description="When a matter is shared with you, a hearing is listed tomorrow, or a request needs attention, it will appear here."
        />
      ) : (
        <div className="mx-auto max-w-3xl space-y-3">
          {data.map((row) => {
            const unreadRow = !row.read_at
            const body = (
              <Card className={unreadRow ? "border-primary/40" : undefined}>
                <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-white">{row.title}</p>
                      <Badge variant={unreadRow ? "default" : "outline"}>
                        {notificationTypeLabel(row.type)}
                      </Badge>
                    </div>
                    {row.body && (
                      <p className="mt-1 text-sm text-white/65">{row.body}</p>
                    )}
                    <p className="mt-2 text-[11px] text-white/45">
                      {formatDateTime(row.created_at)}
                    </p>
                  </div>
                  {unreadRow && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        markRead.mutate(row.id)
                      }}
                      aria-label={`Mark ${row.title} as read`}
                    >
                      Mark read
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
            if (!row.link) return <div key={row.id}>{body}</div>
            return (
              <Link
                key={row.id}
                to={row.link}
                className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  if (unreadRow) markRead.mutate(row.id)
                }}
              >
                {body}
              </Link>
            )
          })}
        </div>
      )}
    </BrowsePage>
  )
}
