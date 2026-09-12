export type NotificationFilter = {
  unreadOnly?: boolean
  /** Empty or omitted means every type. */
  types?: string[]
}

/**
 * Normalized, order-insensitive representation of a filter, used as part of
 * the React Query key.
 *
 * Sorting matters: `["clerk_request", "court_request"]` and
 * `["court_request", "clerk_request"]` select exactly the same notices, so
 * they must share one cache entry. Without normalizing, toggling two chips
 * off and on in a different order would key a separate query and refetch
 * rows already in hand.
 *
 * Kept in its own module (rather than inside use-notifications) because a
 * hook file imports React and the Supabase client, which a Node test cannot
 * load — and this is the part with logic worth pinning.
 */
export const notificationFilterKey = (filter: NotificationFilter | undefined) => ({
  unreadOnly: filter?.unreadOnly ?? false,
  types: [...(filter?.types ?? [])].sort(),
})

/** True when a filter would narrow the list at all. */
export const isNotificationFilterActive = (filter: NotificationFilter | undefined): boolean =>
  Boolean(filter?.unreadOnly) || (filter?.types?.length ?? 0) > 0
