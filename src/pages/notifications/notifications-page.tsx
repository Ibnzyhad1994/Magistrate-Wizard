import { useMemo, useState } from "react"
import { Inbox, RotateCcw, X } from "lucide-react"
import { Link } from "react-router-dom"
import { BrowseHeader, BrowsePage } from "@/components/browse"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/common/empty-state"
import { InlineError } from "@/components/common/inline-error"
import { HintTooltip } from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import {
  NOTIFICATIONS_PAGE_SIZE,
  useDismissNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useNotifications,
  useUnreadNotificationCount,
} from "@/hooks/use-notifications"
import { notificationTone, notificationTypeLabel } from "@/lib/notifications"
import {
  NOTIFICATION_TONE_ACCENT,
  NOTIFICATION_TONE_BADGE,
} from "@/lib/notification-tone-classes"
import { cn, formatDateTime, formatRelativeTime } from "@/lib/utils"

export default function NotificationsPage() {
  const [limit, setLimit] = useState(NOTIFICATIONS_PAGE_SIZE)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])

  const filter = useMemo(
    () => ({ unreadOnly, types: selectedTypes }),
    [unreadOnly, selectedTypes],
  )
  const { data, isPending, isFetching, isError, error, refetch } = useNotifications(limit, filter)
  // Independent of the filter, so the Unread tab still shows the real total
  // while the filtered list is narrowed to one type.
  const { data: unreadTotal = 0 } = useUnreadNotificationCount()

  const markRead = useMarkNotificationRead()
  const markUnread = useMarkNotificationUnread()
  const dismiss = useDismissNotification()
  const markAll = useMarkAllNotificationsRead()

  // Memoized so the `availableTypes` memo below has a stable dependency —
  // a fresh `[]` fallback on every render would defeat it.
  const rows = useMemo(() => data?.rows ?? [], [data?.rows])

  // Chips are built from what this user has actually received, not from all
  // eleven possible types — a magistrate who has never been sent a stale-draft
  // notice should not be offered a filter that can only ever return nothing.
  const availableTypes = useMemo(() => {
    const seen = new Map<string, number>()
    for (const row of rows) seen.set(row.type, (seen.get(row.type) ?? 0) + 1)
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type)
  }, [rows])

  const toggleType = (type: string) =>
    setSelectedTypes((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    )

  const filtersActive = unreadOnly || selectedTypes.length > 0
  const clearFilters = () => {
    setUnreadOnly(false)
    setSelectedTypes([])
  }

  return (
    <BrowsePage>
      <BrowseHeader
        title="Notifications"
        description="In-app notices for shares, court assignments, clerk requests, and hearing reminders. Email is not sent from this list."
        action={
          unreadTotal > 0 ? (
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

      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Filter by read state"
          className="inline-flex rounded-sm border border-border p-0.5"
        >
          {[
            { label: "All", value: false },
            { label: unreadTotal > 0 ? `Unread (${unreadTotal})` : "Unread", value: true },
          ].map((tab) => (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={unreadOnly === tab.value}
              onClick={() => setUnreadOnly(tab.value)}
              className={cn(
                "rounded-[2px] px-3 py-1 text-xs font-medium transition-colors",
                unreadOnly === tab.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {availableTypes.map((type) => {
          const active = selectedTypes.includes(type)
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => toggleType(type)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                active
                  ? NOTIFICATION_TONE_BADGE[notificationTone(type)]
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {notificationTypeLabel(type)}
            </button>
          )
        })}

        {filtersActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        )}
      </div>

      {isPending ? (
        <Skeleton className="mx-auto h-48 w-full max-w-3xl" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        // A filtered empty result is a different situation from an empty
        // inbox, and offering "clear filters" is the only useful action.
        <EmptyState
          icon={Inbox}
          title={filtersActive ? "Nothing matches these filters" : "No notices yet"}
          description={
            filtersActive
              ? "Try clearing the filters to see everything."
              : "Nothing waiting right now."
          }
          action={
            filtersActive ? (
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
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
                  unreadRow ? "border-border bg-card" : "border-border/40 bg-card/40"
                }`}
              >
                {/* Unread gets a tone-coloured spine; read gets nothing, so
                    the two are distinguishable at a glance down the list
                    rather than by reading each row. */}
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-1 ${
                    unreadRow ? NOTIFICATION_TONE_ACCENT[tone] : "bg-transparent"
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
                        className={
                          unreadRow
                            ? NOTIFICATION_TONE_BADGE[tone]
                            : "border-border/50 text-muted-foreground"
                        }
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
                      <p
                        className={`mt-1 text-sm ${
                          unreadRow ? "text-foreground/70" : "text-muted-foreground"
                        }`}
                      >
                        {row.body}
                      </p>
                    )}
                    {/* Relative for recency at a glance; the exact
                        timestamp stays one hover away rather than being
                        lost. */}
                    <p
                      className="mt-2 text-[11px] text-muted-foreground"
                      title={formatDateTime(row.created_at)}
                    >
                      {formatRelativeTime(row.created_at)}
                    </p>
                  </div>

                  {/* Row actions. These sit inside the card, which may be
                      wrapped in a Link — so each one stops the click from
                      also navigating. */}
                  <div className="flex shrink-0 items-center gap-1">
                    {unreadRow ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          markRead.mutate(row.id)
                        }}
                        aria-label={`Mark "${row.title}" as read`}
                      >
                        Mark read
                      </Button>
                    ) : (
                      <HintTooltip label="Mark as unread">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            markUnread.mutate(row.id)
                          }}
                          aria-label={`Mark "${row.title}" as unread`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </HintTooltip>
                    )}
                    <HintTooltip label="Dismiss">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          dismiss.mutate(row.id)
                        }}
                        aria-label={`Dismiss "${row.title}"`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </HintTooltip>
                  </div>
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
              <p className="text-xs text-muted-foreground">
                Showing {rows.length} of {data.totalCount}
                {filtersActive ? " matching" : ""} notices.
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
