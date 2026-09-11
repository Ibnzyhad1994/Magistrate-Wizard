import { useState } from "react"
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
  NOTIFICATIONS_PAGE_SIZE,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/use-notifications"
import { notificationTone, notificationTypeLabel, type NotificationTone } from "@/lib/notifications"
import { formatDateTime, formatRelativeTime } from "@/lib/utils"

/**
 * Unread carries the tone colour; read is deliberately drained of it.
 * The colour is doing two jobs at once — what kind of notice this is, and
 * whether it still wants attention — so a read item keeps its shape but
 * loses its urgency.
 */
const TONE_ACCENT: Record<NotificationTone, string> = {
  action: "bg-[hsl(var(--notice-action))]",
  granted: "bg-[hsl(var(--notice-granted))]",
  revoked: "bg-[hsl(var(--notice-revoked))]",
  outcome: "bg-[hsl(var(--notice-outcome))]",
}

const TONE_BADGE: Record<NotificationTone, string> = {
  action:
    "border-[hsl(var(--notice-action))]/40 bg-[hsl(var(--notice-action))]/15 text-[hsl(var(--notice-action))]",
  granted:
    "border-[hsl(var(--notice-granted))]/40 bg-[hsl(var(--notice-granted))]/15 text-[hsl(var(--notice-granted))]",
  revoked:
    "border-[hsl(var(--notice-revoked))]/40 bg-[hsl(var(--notice-revoked))]/15 text-[hsl(var(--notice-revoked))]",
  outcome:
    "border-[hsl(var(--notice-outcome))]/40 bg-[hsl(var(--notice-outcome))]/15 text-[hsl(var(--notice-outcome))]",
}

export default function NotificationsPage() {
  const [limit, setLimit] = useState(NOTIFICATIONS_PAGE_SIZE)
  const { data, isPending, isFetching, isError, error, refetch } = useNotifications(limit)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const rows = data?.rows ?? []
  const unread = rows.filter((row) => !row.read_at).length

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
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No notices yet"
          description="Nothing waiting right now."
        />
      ) : (
        <div
          className={`mx-auto max-w-3xl space-y-3 transition-opacity duration-150 ${
            isFetching ? "opacity-60" : ""
          }`}
          aria-busy={isFetching}
        >
          {rows.map((row) => {
            const unreadRow = !row.read_at
            const tone = notificationTone(row.type)
            const body = (
              <Card
                className={`relative overflow-hidden transition-colors ${
                  unreadRow
                    ? "border-white/15 bg-card"
                    : "border-white/5 bg-card/40"
                }`}
              >
                {/* Unread gets a tone-coloured spine; read gets nothing, so
                    the two are distinguishable at a glance down the list
                    rather than by reading each row. */}
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-1 ${
                    unreadRow ? TONE_ACCENT[tone] : "bg-transparent"
                  }`}
                />
                <CardContent className="flex flex-col gap-2 py-4 pl-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p
                        className={`text-sm ${
                          unreadRow
                            ? "font-semibold text-foreground"
                            : "font-normal text-muted-foreground"
                        }`}
                      >
                        {row.title}
                      </p>
                      <Badge
                        variant="outline"
                        className={unreadRow ? TONE_BADGE[tone] : "border-white/10 text-white/40"}
                      >
                        {notificationTypeLabel(row.type)}
                      </Badge>
                      {unreadRow && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                          New
                        </span>
                      )}
                    </div>
                    {row.body && (
                      <p className={`mt-1 text-sm ${unreadRow ? "text-white/70" : "text-white/40"}`}>
                        {row.body}
                      </p>
                    )}
                    {/* Relative for recency at a glance; the exact
                        timestamp stays one hover away rather than being
                        lost. */}
                    <p
                      className={`mt-2 text-[11px] ${unreadRow ? "text-white/50" : "text-white/35"}`}
                      title={formatDateTime(row.created_at)}
                    >
                      {formatRelativeTime(row.created_at)}
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
                      disabled={markRead.isPending}
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

          {/* The list was previously hard-capped with nothing indicating
              older notices existed — they simply vanished past the limit. */}
          {data?.hasMore && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-xs text-white/45">
                Showing {rows.length} of {data.totalCount} notices.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLimit((current) => current + NOTIFICATIONS_PAGE_SIZE)}
                disabled={isFetching}
              >
                {isFetching ? "Loading…" : "Load older notices"}
              </Button>
            </div>
          )}
        </div>
      )}
    </BrowsePage>
  )
}
