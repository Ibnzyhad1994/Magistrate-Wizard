/**
 * Pure helpers behind the Case Law Browse filters' dependent-facet
 * behavior (0084) — kept separate from case-law-list-page.tsx so the
 * option-visibility/selection-validity rules can be unit tested without a
 * live Supabase instance or a rendered component.
 */

/** An option only ever appears once its id has a matching accessible-record count (0084's RPCs never return a zero/absent id — group by omits it entirely). While `counts` hasn't loaded yet, no option is shown rather than briefly showing the full, unfiltered reference list. */
export function visibleFacetOptions<T extends { id: string }>(
  options: T[] | undefined,
  counts: Map<string, number> | undefined,
): T[] {
  if (!options || !counts) return [];
  return options.filter((option) => counts.has(option.id));
}

/** `Robbery (4)` when a count exists, otherwise the bare name — matches the existing label convention. */
export function facetOptionLabel(name: string, count: number | undefined): string {
  return count ? `${name} (${count})` : name;
}

/**
 * Whether a currently-selected facet value is still among the accessible
 * options once the OTHER active filters/search text changed. Returns true
 * while `counts` hasn't (re)loaded yet, so a valid selection is never
 * flashed as invalid during a refetch — only a confirmed absence clears it.
 */
export function isFacetSelectionValid(
  selectedId: string | null,
  counts: Map<string, number> | undefined,
): boolean {
  if (!selectedId) return true;
  if (!counts) return true;
  return counts.has(selectedId);
}
