/**
 * Serialises the Docket board's own controls — search text, procedure
 * filters, and the selected calendar date — to and from the URL, so that
 * opening a matter and pressing Back returns to the exact view the
 * magistrate left, a refresh survives, and a filtered day-list can be
 * bookmarked or handed to a clerk as a link.
 *
 * Framework-free and side-effect-free for the same reason `docket-scope.ts`
 * is: `docket-list-page.tsx` is the only caller and owns turning these
 * values into an actual navigation. That keeps the round-trip unit
 * testable without a router or a live query.
 *
 * Every parsed value is re-validated against the canonical const arrays in
 * `docket-procedure.ts` and anything unrecognised is dropped, mirroring how
 * `resolveDocketScope` refuses to trust a `?court=` it can't verify. A
 * hand-edited or stale URL therefore degrades to a narrower, valid view —
 * never to an invalid filter reaching the RPC.
 *
 * `?court=` is NOT handled here. It is owned by `docket-scope.ts`, has its
 * own re-validation against the caller's real assignments, and must stay
 * that way — this module only ever preserves the params it knows about.
 */

import {
  CUSTODY_STATUSES,
  DISCLOSURE_STATUSES,
  EMPTY_PROCEDURE_FILTERS,
  NEXT_DATE_FILTERS,
  PROCEDURE_STAGES,
  TRIAL_STATUSES,
  type NextDateFilter,
  type ProcedureFilters,
  type ProcedureStage,
} from "@/lib/docket-procedure";

/** Board-owned params. `court` is deliberately absent — see module header. */
export const BOARD_PARAM_KEYS = ["q", "stage", "custody", "disclosure", "trial", "next", "date"] as const;

export type DocketBoardParams = {
  query: string;
  filters: ProcedureFilters;
  exactDate: string | null;
};

export const EMPTY_BOARD_PARAMS: DocketBoardParams = {
  query: "",
  filters: EMPTY_PROCEDURE_FILTERS,
  exactDate: null,
};

/**
 * Custody filtering is deliberately narrower than the custody column
 * itself: 'unset' is a real stored status but not a thing anyone filters
 * *for*, so `ProcedureFilters['custody']` excludes it. Parse against that
 * narrower set rather than CUSTODY_STATUSES wholesale.
 */
const CUSTODY_FILTER_VALUES = CUSTODY_STATUSES.filter(
  (value): value is Extract<(typeof CUSTODY_STATUSES)[number], "on_bail" | "remanded"> =>
    value === "on_bail" || value === "remanded",
);

/** ISO calendar date, exactly what `<input type="date">` and the RPC's `p_exact_date` both expect. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  // Rejects 2026-02-31 and friends: Date normalises them to a different
  // calendar day, so a lossless round-trip proves the date genuinely exists.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Comma-separated list → validated, de-duplicated members of `allowed`,
 * preserving `allowed`'s own order so two URLs describing the same filter
 * set always produce an identical query key (and therefore share a cache
 * entry) regardless of the order they were typed in.
 */
function parseList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const requested = new Set(raw.split(",").map((part) => part.trim()).filter(Boolean));
  return allowed.filter((value) => requested.has(value));
}

function serialiseList(values: readonly string[]): string | null {
  return values.length > 0 ? values.join(",") : null;
}

/** Reads the board's controls out of the current URL. Unknown values are dropped, never trusted. */
export function boardParamsFromSearchParams(params: URLSearchParams): DocketBoardParams {
  const rawDate = params.get("date");
  return {
    query: params.get("q")?.trim() ?? "",
    filters: {
      stages: parseList<ProcedureStage>(params.get("stage"), PROCEDURE_STAGES),
      custody: parseList(params.get("custody"), CUSTODY_FILTER_VALUES),
      disclosure: parseList(params.get("disclosure"), DISCLOSURE_STATUSES),
      trial: parseList(params.get("trial"), TRIAL_STATUSES),
      nextDate: parseList<NextDateFilter>(params.get("next"), NEXT_DATE_FILTERS),
    },
    exactDate: rawDate && isRealDate(rawDate) ? rawDate : null,
  };
}

/**
 * Writes the board's controls into a copy of `base`, preserving every
 * param this module doesn't own (notably `court`). Empty values are
 * removed rather than written blank, so the default view stays a clean
 * `/docket` URL and no two URLs describe the same view.
 */
export function boardParamsToSearchParams(
  state: DocketBoardParams,
  base: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(base);
  const trimmed = state.query.trim();

  const entries: Array<[(typeof BOARD_PARAM_KEYS)[number], string | null]> = [
    ["q", trimmed || null],
    ["stage", serialiseList(state.filters.stages)],
    ["custody", serialiseList(state.filters.custody)],
    ["disclosure", serialiseList(state.filters.disclosure)],
    ["trial", serialiseList(state.filters.trial)],
    ["next", serialiseList(state.filters.nextDate)],
    ["date", state.exactDate],
  ];

  for (const [key, value] of entries) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }

  return next;
}

/**
 * Strips every board-owned param, leaving `court` (and anything else) in
 * place. Used when switching Docket scope: carrying one court's search and
 * stage filters into another court's board would silently misrepresent the
 * new court's list as empty or narrow.
 */
export function clearBoardParams(base: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const key of BOARD_PARAM_KEYS) next.delete(key);
  return next;
}

/** True when any board param is set — i.e. the URL describes something narrower than the default board. */
export function hasBoardParams(params: URLSearchParams): boolean {
  return BOARD_PARAM_KEYS.some((key) => {
    const value = params.get(key);
    return value !== null && value.trim() !== "";
  });
}
