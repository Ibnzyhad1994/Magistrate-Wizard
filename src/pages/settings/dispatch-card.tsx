import { PortablePackPanel } from "@/components/dashboard/portable-pack-panel"
import { useAuth } from "@/hooks/use-auth"
import { useDocketMatterBoard } from "@/hooks/docket/use-docket-matters"
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups"
import { useMyRetainedMatterIds } from "@/hooks/use-dashboard"
import { EMPTY_PROCEDURE_FILTERS } from "@/lib/docket-procedure"

/**
 * Matter pack export/import. Lives on Settings (account), not the briefing.
 * Same board cap and court-authority rules as the working sheet.
 */
export function DispatchCard() {
  const { profile } = useAuth()
  const isClerk = profile?.role === "clerk"
  const { data: myCourts } = useMyCurrentCourts()
  const boardQuery = useDocketMatterBoard("", EMPTY_PROCEDURE_FILTERS, null, null)
  const retainedIdsQuery = useMyRetainedMatterIds({ enabled: !isClerk })
  const board = boardQuery.data ?? []

  return (
    <PortablePackPanel
      candidates={board.map((row) => ({
        id: row.id,
        court_id: row.court_id,
        case_number: row.case_number,
        matter_title: row.matter_title,
      }))}
      sittingCourts={(myCourts ?? []).map((court) => ({
        court_id: court.court_id,
        court_name: court.court_name,
        district_id: court.district_id,
      }))}
      retainedMatterIds={retainedIdsQuery.data ?? []}
      existingCaseNumbers={board.map((row) => ({
        case_number: row.case_number,
        court_id: row.court_id,
      }))}
      isPending={boardQuery.isPending}
    />
  )
}
