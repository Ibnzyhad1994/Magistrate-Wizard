/**
 * Last machine-written field values stored on import_jobs.extracted_metadata
 * so Review Queue reprocess can overwrite proposals without wiping curator
 * edits. Compare against this snapshot, not "is the field non-empty."
 */

export interface MachineProposal {
  case_name: string
  citation: string
  court_id: string | null
  jurisdiction_id: string | null
  decided_date: string
  full_text: string
}

const PLACEHOLDERS = new Set([
  "",
  "untitled",
  "untitled (pending review)",
  "unknown",
  "tbd",
  "n/a",
  "na",
  "none",
  "pending",
  "pending review",
  "court",
  "jurisdiction",
])

export function isMachineProposalPlaceholder(value: string | null | undefined): boolean {
  return PLACEHOLDERS.has((value ?? "").trim().toLowerCase())
}

export function readLastMachineProposal(extractedMetadata: unknown): MachineProposal | null {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return null
  const raw = (extractedMetadata as Record<string, unknown>)._lastMachineProposal
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  return {
    case_name: typeof row.case_name === "string" ? row.case_name : "",
    citation: typeof row.citation === "string" ? row.citation : "",
    court_id: typeof row.court_id === "string" ? row.court_id : null,
    jurisdiction_id: typeof row.jurisdiction_id === "string" ? row.jurisdiction_id : null,
    decided_date: typeof row.decided_date === "string" ? row.decided_date : "",
    full_text: typeof row.full_text === "string" ? row.full_text : "",
  }
}

export function shouldOverwriteMachineField(
  current: string | null | undefined,
  lastProposal: string | null | undefined,
): boolean {
  const cur = (current ?? "").trim()
  const last = (lastProposal ?? "").trim()
  if (isMachineProposalPlaceholder(cur)) return true
  if (!last) return false
  return cur === last
}

export function mergeReprocessFields<T extends MachineProposal>(current: T, next: T, last: T | null): T {
  const baseline: T = last ?? ({
    case_name: "",
    citation: "",
    court_id: null,
    jurisdiction_id: null,
    decided_date: "",
    full_text: "",
  } as T)
  return {
    ...current,
    case_name: shouldOverwriteMachineField(current.case_name, baseline.case_name) ? next.case_name : current.case_name,
    citation: shouldOverwriteMachineField(current.citation, baseline.citation) ? next.citation : current.citation,
    court_id: shouldOverwriteMachineField(current.court_id, baseline.court_id)
      ? next.court_id
      : current.court_id,
    jurisdiction_id: shouldOverwriteMachineField(current.jurisdiction_id, baseline.jurisdiction_id)
      ? next.jurisdiction_id
      : current.jurisdiction_id,
    decided_date: shouldOverwriteMachineField(current.decided_date, baseline.decided_date)
      ? next.decided_date
      : current.decided_date,
    full_text: shouldOverwriteMachineField(current.full_text, baseline.full_text) ? next.full_text : current.full_text,
  }
}
