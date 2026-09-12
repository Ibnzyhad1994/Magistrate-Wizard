-- ============================================================================
-- 0143_notifications_realtime_and_dismiss.sql
--
-- Two capabilities the notification system was missing.
--
-- 1. REALTIME. The table was never added to the supabase_realtime
--    publication, so the client had no way to learn about a new notice
--    except polling -- useNotifications/useUnreadNotificationCount both sit
--    on refetchInterval: 60_000. A clerk-access request or a
--    tomorrow's-hearing notice could therefore sit unseen for a full
--    minute. Adding the table lets the client subscribe instead.
--
--    RLS still governs what each subscriber receives: Supabase evaluates
--    the existing "Users can view their own notifications" SELECT policy
--    per subscriber, so adding the table to the publication does NOT let
--    anyone observe another user's notices. The client also filters on
--    user_id, but that is belt-and-braces, not the boundary.
--
-- 2. DISMISS. There was no DELETE policy at all, so a notice could never
--    be cleared -- the list only ever grew until apply_data_retention()
--    (0127) purged it at 90 days. "Mark read" dims a row; it does not get
--    it out of the way. The new policy is scoped exactly like the two
--    existing ones: your own rows only.
--
-- Deliberately NOT a soft-delete/archive column: notifications are
-- operational, not judicial, and 0127 already hard-deletes them on a
-- schedule. A dismissed notice is a notice the user is finished with; the
-- underlying thing it points at (the request, the hearing, the share) is
-- unaffected and still reachable from its own page.
--
-- Mark-as-UNREAD needed no migration: the existing UPDATE policy already
-- permits it and notifications_protect() (0123) deliberately allows
-- read_at to change while pinning every other column. It was simply never
-- exposed in the UI.
-- ============================================================================

-- Idempotent: re-running (or a project where realtime was enabled by hand
-- through the dashboard) must not error.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

drop policy if exists "Users can dismiss their own notifications" on public.notifications;

create policy "Users can dismiss their own notifications"
  on public.notifications for delete
  using (user_id = (select auth.uid()));

comment on table public.notifications is
  'Per-user in-app notices. Inserts are DEFINER-only; users may mark their own rows read/unread (0123) and dismiss them (0143). Published to supabase_realtime, RLS-filtered per subscriber.';
