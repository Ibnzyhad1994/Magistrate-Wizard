export type DocketTourExampleInput = {
  tourActive: boolean
  matterCount: number
  emptyBecauseFilters: boolean
  emptyBecauseDate: boolean
}

/**
 * Show a labelled sample sheet only while the walkthrough is on
 * and the docket has no files at all — not because search, stage
 * filters, or a selected calendar date hid every row.
 */
export function shouldShowDocketTourExample({
  tourActive,
  matterCount,
  emptyBecauseFilters,
  emptyBecauseDate,
}: DocketTourExampleInput): boolean {
  return (
    tourActive &&
    matterCount === 0 &&
    !emptyBecauseFilters &&
    !emptyBecauseDate
  )
}
