/**
 * Selecting several files on the working sheet in order to adjourn them
 * together.
 *
 * The one rule that matters more than the rest:
 * `set_docket_matter_next_date` supersedes the earliest appearance ON OR
 * AFTER today (0119:454-461). It takes no "context date", so run from
 * YESTERDAY's list it would cancel TOMORROW's appearance and file a
 * scheduled row in the past. Bulk adjourn is therefore offered only when
 * the list is showing today or a future date -- `canBulkAdjourn` below is
 * that guard, and it is asserted in the tests.
 */

export type SelectableRow = {
  id: string;
  can_edit: boolean;
  category_id?: string | null;
};

/**
 * Bulk adjourn is meaningful only for a specific day at or after today.
 *
 * - No date: "all matters" spans many days; adjourning them together has
 *   no shared meaning.
 * - A past date: see the header. This is the guard, not a nicety.
 */
export function canBulkAdjourn(selectedDate: string | null, today: string): boolean {
  if (!selectedDate) return false;
  return selectedDate >= today;
}

/** Only rows the caller may actually write are selectable. */
export function selectableIds(rows: SelectableRow[]): string[] {
  return rows.filter((row) => row.can_edit).map((row) => row.id);
}

export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Select-all takes every editable row, never the read-only ones. */
export function selectAll(rows: SelectableRow[]): Set<string> {
  return new Set(selectableIds(rows));
}

/**
 * Drops anything no longer on screen. The list re-queries on every change
 * of date, court, search or filter, and adjourning a file the magistrate
 * can no longer see would be acting on a list they are not looking at.
 */
export function pruneSelection(selected: ReadonlySet<string>, rows: SelectableRow[]): Set<string> {
  const visible = new Set(selectableIds(rows));
  const next = new Set<string>();
  for (const id of selected) if (visible.has(id)) next.add(id);
  return next;
}

export type CapacityBucket = {
  categoryId: string | null;
  count: number;
};

/**
 * Groups the selection by the category each file will be counted under,
 * so the confirmation can say what will fit and what will not.
 */
export function bucketByCategory(
  rows: SelectableRow[],
  selected: ReadonlySet<string>,
): CapacityBucket[] {
  const counts = new Map<string | null, number>();
  for (const row of rows) {
    if (!selected.has(row.id)) continue;
    const key = row.category_id ?? null;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([categoryId, count]) => ({ categoryId, count }));
}

export type CapacityForecast = {
  categoryId: string | null;
  categoryName: string;
  selected: number;
  /** Null when this category has no configured limit. */
  limit: number | null;
  alreadyScheduled: number;
  /** How many of the selection would exceed the limit. */
  over: number;
};

/**
 * What would happen on the target date, per category.
 *
 * The counts come from `get_docket_capacity_snapshot`, which counts the
 * CALLING magistrate's own sittings -- so the copy must say "your limit".
 * The day list below it is not personal, and presenting the two as
 * comparable is the mistake 0147 to 0148 had to correct.
 */
export function forecastCapacity(
  buckets: CapacityBucket[],
  snapshot: Array<{
    category_id: string | null;
    category_name: string | null;
    daily_capacity: number | null;
    scheduled_count: number | null;
  }>,
): CapacityForecast[] {
  return buckets.map((bucket) => {
    const row = snapshot.find((entry) => entry.category_id === bucket.categoryId);
    const limit = row?.daily_capacity ?? null;
    const already = row?.scheduled_count ?? 0;
    const over = limit == null ? 0 : Math.max(0, already + bucket.count - limit);
    return {
      categoryId: bucket.categoryId,
      categoryName: row?.category_name ?? "No category",
      selected: bucket.count,
      limit,
      alreadyScheduled: already,
      over,
    };
  });
}

export type BulkOutcome = {
  matterId: string;
  status: string;
  message?: string | null;
};

/**
 * Partial success is the intended semantic, not a failure to handle.
 * Rolling back eight adjournments because the ninth was refused is worse
 * in a courtroom where the magistrate has already said "all of these to
 * 3 November" aloud. Each call is atomic per matter inside the RPC.
 */
export function summariseBulk(
  outcomes: BulkOutcome[],
  targetDateLabel: string,
): { done: number; failed: BulkOutcome[]; sentence: string } {
  const failed = outcomes.filter((o) => o.status !== "created");
  const done = outcomes.length - failed.length;
  const donePart =
    done === 0
      ? ""
      : `${done === 1 ? "1 matter" : `${done} matters`} adjourned to ${targetDateLabel}.`;
  const failedPart =
    failed.length === 0
      ? ""
      : `${failed.length === 1 ? "1 needs" : `${failed.length} need`} attention.`;
  return {
    done,
    failed,
    sentence: [donePart, failedPart].filter(Boolean).join(" "),
  };
}
