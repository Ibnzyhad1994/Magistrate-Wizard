import type { ActivityRow } from "@/hooks/admin/use-audit-activity"
import { actorDisplayName, summarizeAuthEvent, summarizeChange } from "@/lib/audit-activity"

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`

export const rowsToCsv = (rows: string[][]) =>
  rows.map((row) => row.map((cell) => csvCell(cell ?? "")).join(",")).join("\r\n")

export const activityRowsToCsv = (rows: ActivityRow[]) => {
  const header = ["When", "Kind", "Actor", "Title", "Subject", "Table / event"]
  const body = rows.map((row) => {
    const actor = actorDisplayName(
      row.actor,
      row.kind === "auth" ? row.email : null,
    )
    if (row.kind === "auth") {
      const summary = summarizeAuthEvent(row.eventType, row.email)
      return [row.createdAt, "signin", actor, summary.title, summary.subject ?? "", row.eventType]
    }
    const summary = summarizeChange(row.tableName, row.action, row.oldData, row.newData)
    return [row.createdAt, row.action, actor, summary.title, summary.subject ?? "", row.tableName]
  })
  return rowsToCsv([header, ...body])
}

export const auditHashPayload = (input: {
  prevHash: string
  id: number
  action: string
  tableName: string
  recordId: string | null
  actorId: string | null
  createdAt: string
  oldData: string
  newData: string
}) =>
  [
    input.prevHash,
    String(input.id),
    input.action,
    input.tableName,
    input.recordId ?? "",
    input.actorId ?? "",
    input.createdAt,
    input.oldData,
    input.newData,
  ].join("|")
