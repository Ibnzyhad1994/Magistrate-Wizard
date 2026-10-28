import { z } from "zod";
import { rowsToCsv } from "@/lib/audit-export";
import { checkRpcResult } from "@/lib/rpc-results";

/**
 * The server-side audit-log export, export_audit_log() (0181): the whole
 * ledger of a period, oldest first, a page at a time, for an admin only.
 * The first call verifies the hash chain, pins the export to the ledger as
 * it stands and writes an `audit_export` audit row; every later page names
 * that export, so no page is read without a trace.
 *
 * `collectAuditLedgerExport` pages through one export with any caller of
 * the RPC, and `auditLedgerExportToCsv` writes it out with the export's
 * range and chain result above the rows.
 */

export const EXPORT_AUDIT_LOG_RPC = "export_audit_log";

/** Rows per page the RPC allows (it clamps anything else into range). */
export const AUDIT_EXPORT_PAGE_SIZE = { default: 500, max: 1000 } as const;

export type StartAuditExportArgs = {
  p_from: string;
  p_to: string;
  p_tables?: string[] | null;
  p_limit?: number;
};

export type ContinueAuditExportArgs = {
  p_export_id: number;
  p_after_id: number;
  p_limit?: number;
};

export type ExportAuditLogArgs = StartAuditExportArgs | ContinueAuditExportArgs;

const id = z.number().int().positive();
const json = z.unknown();

export const auditLedgerRowSchema = z.object({
  id,
  created_at: z.string().min(1),
  action: z.enum(["insert", "update", "delete"]),
  table_name: z.string(),
  record_id: z.string().uuid().nullable(),
  actor_id: z.string().uuid().nullable(),
  actor_name: z.string().nullable(),
  actor_email: z.string().nullable(),
  old_data: json,
  new_data: json,
  prev_hash: z.string().nullable(),
  row_hash: z.string().nullable(),
});

export const auditLedgerExportPageSchema = z.object({
  export_id: id,
  from: z.string().min(1),
  to: z.string().min(1),
  tables: z.array(z.string()).nullable(),
  /** The newest audit_log id the export covers; later rows are not in it. */
  as_of_id: z.number().int().nonnegative(),
  /** Rows in the whole export, not this page. */
  total: z.number().int().nonnegative(),
  /** verify_audit_hash_chain() over the whole ledger when the export started. */
  chain: z.object({ ok: z.boolean(), broken_id: id.nullable() }),
  rows: z.array(auditLedgerRowSchema),
  /** Pass as p_after_id for the next page; null on the last page. */
  next_after_id: id.nullable(),
});

export type AuditLedgerRow = z.infer<typeof auditLedgerRowSchema>;
export type AuditLedgerExportPage = z.infer<typeof auditLedgerExportPageSchema>;

export type AuditLedgerExport = Omit<AuditLedgerExportPage, "rows" | "next_after_id"> & {
  rows: AuditLedgerRow[];
};

/** What a Supabase `rpc()` call resolves to, so any client can be passed in. */
export type RpcResponse = { data: unknown; error: { message: string } | null };

export class AuditExportIncompleteError extends Error {
  constructor(expected: number, received: number) {
    super(`The audit export returned ${received} of ${expected} rows; start a new export.`);
    this.name = "AuditExportIncompleteError";
  }
}

/**
 * Runs one export to the end: starts it with `range`, then follows
 * next_after_id until the last page. Every page is checked against the
 * schema (strictly: a partial ledger is worse than none), and the rows
 * received must add up to the export's total.
 */
export async function collectAuditLedgerExport(
  call: (args: ExportAuditLogArgs) => PromiseLike<RpcResponse>,
  range: { from: string; to: string; tables?: string[] | null; pageSize?: number },
): Promise<AuditLedgerExport> {
  const page = async (args: ExportAuditLogArgs) => {
    const { data, error } = await call(args);
    if (error) throw new Error(error.message);
    checkRpcResult(EXPORT_AUDIT_LOG_RPC, auditLedgerExportPageSchema, data, { strict: true });
    return data as AuditLedgerExportPage;
  };

  const limit = range.pageSize ?? AUDIT_EXPORT_PAGE_SIZE.default;
  const first = await page({
    p_from: range.from,
    p_to: range.to,
    p_tables: range.tables ?? null,
    p_limit: limit,
  });
  const rows = [...first.rows];
  let next = first.next_after_id;
  while (next !== null) {
    const more = await page({ p_export_id: first.export_id, p_after_id: next, p_limit: limit });
    rows.push(...more.rows);
    next = more.next_after_id;
  }
  if (rows.length !== first.total) throw new AuditExportIncompleteError(first.total, rows.length);

  return {
    export_id: first.export_id,
    from: first.from,
    to: first.to,
    tables: first.tables,
    as_of_id: first.as_of_id,
    total: first.total,
    chain: first.chain,
    rows,
  };
}

const jsonCell = (value: unknown) =>
  value === null || value === undefined ? "" : JSON.stringify(value);

/**
 * The export as CSV: a short block naming the export, its range and the
 * chain result, a blank line, then one line per audit_log row with its
 * hashes, so the file can be checked against the chain on its own.
 */
export const auditLedgerExportToCsv = (ledger: AuditLedgerExport) => {
  const chain = ledger.chain.ok
    ? "Verified intact"
    : `Broken at audit_log id ${ledger.chain.broken_id ?? "unknown"}`;
  const summary = [
    ["Audit export", String(ledger.export_id)],
    ["From (inclusive)", ledger.from],
    ["To (exclusive)", ledger.to],
    ["Tables", ledger.tables?.join(" ") ?? "All"],
    ["Rows", String(ledger.total)],
    ["Ledger as of audit_log id", String(ledger.as_of_id)],
    ["Hash chain", chain],
  ];
  const header = [
    "id",
    "created_at",
    "action",
    "table_name",
    "record_id",
    "actor_id",
    "actor_name",
    "actor_email",
    "old_data",
    "new_data",
    "prev_hash",
    "row_hash",
  ];
  const body = ledger.rows.map((row) => [
    String(row.id),
    row.created_at,
    row.action,
    row.table_name,
    row.record_id ?? "",
    row.actor_id ?? "",
    row.actor_name ?? "",
    row.actor_email ?? "",
    jsonCell(row.old_data),
    jsonCell(row.new_data),
    row.prev_hash ?? "",
    row.row_hash ?? "",
  ]);
  return `${rowsToCsv(summary)}\r\n\r\n${rowsToCsv([header, ...body])}`;
};
