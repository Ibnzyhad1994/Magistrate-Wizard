/**
 * Keyset (cursor) paging for PostgREST list queries (BE-15).
 *
 * A list is ordered by a total sort key: one or more columns ending in a
 * unique column (`id`). A page is the next `pageSize` rows strictly after
 * the cursor, which is the sort-key values of the last row already shown.
 * Unlike OFFSET, the database never reads the skipped rows, and a row
 * added or edited while someone is paging cannot shift the rest of the
 * list into a duplicate or a gap.
 *
 * PostgREST has no row-value comparison, so "after the cursor" is sent as
 * two filters: a plain range bound on the leading column, which lets the
 * index scan start at the cursor, and the exact lexicographic condition as
 * an `or` tree that only has to discard the few rows tied on that column.
 */

export interface KeysetColumn {
  column: string;
  ascending: boolean;
  /**
   * The column may be null and sorts nulls first. Only supported on an
   * ascending column that is neither the first nor the last of the key:
   * the first column carries the range bound and the last is the unique
   * tiebreak, so both must be NOT NULL.
   */
  nullsFirst?: boolean;
}

export interface KeysetSpec {
  /** Sort key, most significant first, ending in a unique NOT NULL column. */
  columns: readonly KeysetColumn[];
  pageSize: number;
}

/** The sort-key values of a list's last loaded row, in `columns` order. */
export type KeysetCursor = readonly (string | null)[];

export interface KeysetPage<T> {
  rows: T[];
  /** Every row the list holds for this caller (first page only; later pages carry null). */
  totalCount: number | null;
  /** Cursor for the next page, or null when this page came back short. */
  nextCursor: KeysetCursor | null;
}

/** The PostgREST builder methods a keyset page needs, so this module stays client-free. */
export interface KeysetQuery<Q> {
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): Q;
  gte(column: string, value: string): Q;
  lte(column: string, value: string): Q;
  or(filters: string): Q;
  limit(count: number): Q;
}

/**
 * Double-quotes a value for a PostgREST logical-tree filter, where commas,
 * dots, colons and parentheses would otherwise be read as syntax.
 */
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The comma-separated terms of an `or` filter that is true exactly for the
 * rows after `cursor` in the spec's order.
 */
export function keysetAfterFilter(spec: KeysetSpec, cursor: KeysetCursor): string {
  const { columns } = spec;
  if (cursor.length !== columns.length) {
    throw new Error(`Keyset cursor has ${cursor.length} values for ${columns.length} columns.`);
  }
  // Each level is a list of alternatives; a nested list of more than one
  // goes inside its own `or(...)`.
  const terms = (index: number): string[] => {
    const { column, ascending, nullsFirst } = columns[index];
    const value = cursor[index];
    const isLast = index === columns.length - 1;
    if (value === null) {
      if (!nullsFirst || !ascending || index === 0 || isLast) {
        throw new Error(`Keyset column ${column} cannot be null in a cursor.`);
      }
      // Nulls sort first: after a null come the remaining nulls (by the
      // rest of the key), then every non-null value.
      return [`${column}.not.is.null`, `and(${column}.is.null,${rest(index + 1)})`];
    }
    const strict = `${column}.${ascending ? "gt" : "lt"}.${quotePostgrestValue(value)}`;
    if (isLast) return [strict];
    return [strict, `and(${column}.eq.${quotePostgrestValue(value)},${rest(index + 1)})`];
  };
  const rest = (index: number): string => {
    const alternatives = terms(index);
    return alternatives.length === 1 ? alternatives[0] : `or(${alternatives.join(",")})`;
  };
  return terms(0).join(",");
}

/**
 * Orders the query by the spec, limits it to one page and, given a cursor,
 * keeps only the rows after it.
 */
export function applyKeyset<Q extends KeysetQuery<Q>>(
  query: Q,
  spec: KeysetSpec,
  cursor: KeysetCursor | null,
): Q {
  let paged = query;
  if (cursor) {
    const lead = spec.columns[0];
    const leadValue = cursor[0];
    if (leadValue === null) throw new Error(`Keyset column ${lead.column} cannot be null.`);
    paged = lead.ascending ? paged.gte(lead.column, leadValue) : paged.lte(lead.column, leadValue);
    paged = paged.or(keysetAfterFilter(spec, cursor));
  }
  for (const { column, ascending, nullsFirst } of spec.columns) {
    paged = paged.order(column, nullsFirst ? { ascending, nullsFirst } : { ascending });
  }
  return paged.limit(spec.pageSize);
}

/** Reads a row's sort-key values as a cursor. */
export function cursorFromRow(spec: KeysetSpec, row: object): KeysetCursor {
  return spec.columns.map(({ column }) => {
    const value = (row as Record<string, unknown>)[column];
    return value === null || value === undefined ? null : String(value);
  });
}

/** Wraps one fetched page, with the cursor for the next one when this page was full. */
export function toKeysetPage<T extends object>(
  rows: T[],
  spec: KeysetSpec,
  totalCount: number | null,
): KeysetPage<T> {
  const last = rows[rows.length - 1];
  return {
    rows,
    totalCount,
    nextCursor: last && rows.length >= spec.pageSize ? cursorFromRow(spec, last) : null,
  };
}

/**
 * The cursor for the page after `pages`, or undefined when the list is
 * complete: the last page came back short, or the loaded rows already
 * reach the first page's total (which saves one empty round trip when
 * the list is an exact multiple of the page size).
 */
export function nextKeysetCursor(pages: readonly KeysetPage<unknown>[]): KeysetCursor | undefined {
  const last = pages[pages.length - 1];
  if (!last?.nextCursor) return undefined;
  const total = pages[0]?.totalCount;
  const loaded = pages.reduce((sum, page) => sum + page.rows.length, 0);
  if (total !== null && total !== undefined && loaded >= total) return undefined;
  return last.nextCursor;
}
