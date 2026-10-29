/**
 * The app half of the server-side audit export (0181, BE-18), without a
 * database: collectAuditLedgerExport() starts one export, follows
 * next_after_id with the export id to the last page, checks every page
 * against the typed result, and refuses a ledger whose rows do not add up
 * to the export's total; auditLedgerExportToCsv() puts the range and the
 * chain result above the rows. The live half is test-audit-log-export.mjs.
 *
 *   npm run test:audit-ledger-export
 */
import {
  AuditExportIncompleteError,
  auditLedgerExportToCsv,
  collectAuditLedgerExport,
} from "../../src/lib/audit-ledger-export.ts";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}
const rejects = async (promise) => {
  try {
    await promise;
    return null;
  } catch (err) {
    return err;
  }
};

const row = (id) => ({
  id,
  created_at: `2026-10-01T00:00:0${id}+00:00`,
  action: "update",
  table_name: "profiles",
  record_id: "11111111-1111-4111-8111-111111111111",
  actor_id: null,
  actor_name: null,
  actor_email: null,
  old_data: { role: "clerk" },
  new_data: { role: "=magistrate" },
  prev_hash: id === 1 ? "genesis" : `h${id - 1}`,
  row_hash: `h${id}`,
});
const meta = {
  export_id: 42,
  from: "2026-10-01T00:00:00+00:00",
  to: "2026-11-01T00:00:00+00:00",
  tables: null,
  as_of_id: 5,
  total: 5,
  chain: { ok: true, broken_id: null },
};

// A fake RPC over five rows, two per page.
const fakeRpc = (rows, overrides = {}) => {
  const calls = [];
  const call = async (args) => {
    calls.push(args);
    const after = args.p_after_id ?? 0;
    const page = rows.filter((r) => r.id > after).slice(0, args.p_limit);
    const last = page.at(-1)?.id ?? null;
    const more = last !== null && rows.some((r) => r.id > last);
    return {
      data: { ...meta, ...overrides, rows: page, next_after_id: more ? last : null },
      error: null,
    };
  };
  return { call, calls };
};

{
  const rows = [1, 2, 3, 4, 5].map(row);
  const { call, calls } = fakeRpc(rows);
  const ledger = await collectAuditLedgerExport(call, {
    from: meta.from,
    to: meta.to,
    pageSize: 2,
  });
  check(
    "every row is collected, in order",
    ledger.rows.map((r) => r.id),
    [1, 2, 3, 4, 5],
  );
  check("three pages were read", calls.length, 3);
  check("the first call starts the export with its range", calls[0], {
    p_from: meta.from,
    p_to: meta.to,
    p_tables: null,
    p_limit: 2,
  });
  check("later calls continue the export by id and cursor only", calls.slice(1), [
    { p_export_id: 42, p_after_id: 2, p_limit: 2 },
    { p_export_id: 42, p_after_id: 4, p_limit: 2 },
  ]);
  check(
    "the export keeps its id, total and chain result",
    [ledger.export_id, ledger.total, ledger.chain.ok],
    [42, 5, true],
  );

  const csv = auditLedgerExportToCsv(ledger);
  const lines = csv.split("\r\n");
  check("the CSV opens with the export id", lines[0], '"Audit export","42"');
  check("and states the chain result", lines[6], '"Hash chain","Verified intact"');
  check("then a blank line and the column header", lines[7], "");
  check("the header names the hashes", lines[8].endsWith('"prev_hash","row_hash"'), true);
  check("one line per row", lines.length, 9 + 5);
  check(
    "old and new data are each one quoted JSON cell",
    lines[9].includes('"{""role"":""=magistrate""}"'),
    true,
  );
}
{
  const broken = auditLedgerExportToCsv({
    ...meta,
    chain: { ok: false, broken_id: 3 },
    rows: [],
  });
  check(
    "a broken chain names the first broken id",
    broken.split("\r\n")[6],
    '"Hash chain","Broken at audit_log id 3"',
  );
}
{
  const { call } = fakeRpc([1, 2, 3].map(row));
  const err = await rejects(collectAuditLedgerExport(call, { from: meta.from, to: meta.to }));
  check(
    "rows that do not add up to the total are refused",
    err instanceof AuditExportIncompleteError,
    true,
  );
}
{
  const { call } = fakeRpc([1].map(row), { total: 1, chain: { ok: "yes" } });
  const err = await rejects(collectAuditLedgerExport(call, { from: meta.from, to: meta.to }));
  check("a page of the wrong shape is refused", err?.name, "RpcResultError");
}
{
  const call = async () => ({
    data: null,
    error: { message: "Only administrators can export the audit log" },
  });
  const err = await rejects(collectAuditLedgerExport(call, { from: meta.from, to: meta.to }));
  check("an RPC error is passed on", err?.message, "Only administrators can export the audit log");
}

console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll audit ledger export tests passed.");
process.exit(failures > 0 ? 1 : 0);
