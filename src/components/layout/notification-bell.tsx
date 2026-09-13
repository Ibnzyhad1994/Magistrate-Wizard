import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NOTIFICATION_PEEK_SIZE,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useNotificationsRealtime,
  useUnreadNotificationCount,
} from "@/hooks/use-notifications";
import { notificationTone, notificationTypeLabel } from "@/lib/notifications";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import { NOTIFICATION_TONE_ACCENT } from "@/lib/notification-tone-classes";
import { ROUTES } from "@/routes/paths";

/**
 * Unread indicator and triage peek for the in-app notification system
 * (0123).
 *
 * Without this the whole feature was invisible: notices were written by
 * database triggers and rendered on /notifications, but nothing anywhere
 * in the chrome told a magistrate one had arrived, so the page was only
 * ever found by deliberately navigating to it.
 *
 * The badge count comes from its own `head`-style count query rather than
 * the paginated list, so it stays accurate past the first page. That query
 * is marked `meta.silent` — a transient failure to count must never throw a
 * toast over whatever the user is actually doing.
 *
 * The dropdown exists because the badge alone was a dead end: seeing "3"
 * told a magistrate something had happened but forced them off whatever
 * page they were on to find out what. Mid-sitting, that is the difference
 * between glancing and losing your place. The peek shows the newest few and
 * nothing else — it is for deciding whether to care, not for working
 * through a backlog, which is what the full page is for.
 *
 * This is also where the realtime subscription is mounted: the bell renders
 * on every authenticated page, so subscribing here covers the whole app
 * without the notifications page having to be open.
 */
export function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  useNotificationsRealtime();

  const { data: unread = 0 } = useUnreadNotificationCount();
  // Only fetched while the menu is open — the bell is on every page, and
  // the badge count alone does not need any rows.
  const { data, isPending } = useNotifications(
    NOTIFICATION_PEEK_SIZE,
    undefined,
    { enabled: open },
  );
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const rows = data?.rows ?? [];
  const hasUnread = unread > 0;
  // Past 99 the exact figure stops being useful and starts breaking the
  // pill's width.
  const display = unread > 99 ? "99+" : String(unread);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative min-h-11 min-w-11 shrink-0 touch-manipulation text-current hover:bg-foreground/10 hover:text-current",
            className,
          )}
          aria-label={
            hasUnread ? `Notifications, ${unread} unread` : "Notifications, none unread"
          }
        >
          <Bell className="h-5 w-5" />
          {hasUnread && (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
            >
              {display}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <p className="text-sm font-semibold">
            Notifications
            {hasUnread && (
              <span className="ml-1.5 font-normal text-muted-foreground">{unread} unread</span>
            )}
          </p>
          {hasUnread && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />

        {isPending ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
            <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Nothing waiting right now.</p>
          </div>
        ) : (
          <ul className="max-h-[22rem] overflow-y-auto py-1">
            {rows.map((row) => {
              const unreadRow = !row.read_at;
              const tone = notificationTone(row.type);
              return (
                <li key={row.id}>
                  {/* A button, not a DropdownMenuItem: these navigate and
                      mark read together, and menu-item keyboard semantics
                      would fight the anchor behaviour. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (unreadRow) markRead.mutate(row.id);
                      setOpen(false);
                      if (row.link) navigate(row.link);
                    }}
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        unreadRow ? NOTIFICATION_TONE_ACCENT[tone] : "bg-transparent"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm ${
                          unreadRow ? "font-semibold text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {row.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {notificationTypeLabel(row.type)}
                        <span className="px-1" aria-hidden="true">
                          ·
                        </span>
                        <span title={formatDateTime(row.created_at)}>
                          {formatRelativeTime(row.created_at)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          <Button asChild variant="ghost" size="sm" className="w-full justify-center text-xs">
            <Link to={ROUTES.notifications} onClick={() => setOpen(false)}>
              See all notifications
            </Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
