import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUnreadNotificationCount } from "@/hooks/use-notifications";
import { ROUTES } from "@/routes/paths";

/**
 * Unread indicator for the in-app notification system (0123).
 *
 * Without this the whole feature was invisible: notices were written by
 * database triggers and rendered on /notifications, but nothing anywhere
 * in the chrome told a magistrate one had arrived, so the page was only
 * ever found by deliberately navigating to it.
 *
 * The count comes from its own `head`-style count query rather than the
 * paginated list, so it stays accurate past the first page. That query is
 * marked `meta.silent` — a transient failure to count must never throw a
 * toast over whatever the user is actually doing.
 */
export function NotificationBell() {
  const { data: unread = 0 } = useUnreadNotificationCount();
  const hasUnread = unread > 0;
  // Past 99 the exact figure stops being useful and starts breaking the
  // pill's width.
  const display = unread > 99 ? "99+" : String(unread);

  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative min-h-11 min-w-11 shrink-0 touch-manipulation text-foreground hover:bg-foreground/10"
    >
      <Link
        to={ROUTES.notifications}
        aria-label={
          hasUnread
            ? `Notifications, ${unread} unread`
            : "Notifications, none unread"
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
      </Link>
    </Button>
  );
}
