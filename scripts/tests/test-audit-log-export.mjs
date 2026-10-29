// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * The server-side audit-log export (0181), on a real database.
 *
 *   BE-18  only an admin can export; anon and a magistrate are refused;
 *          a 1,000-row period comes back whole, oldest first, a page at a
 *          time, filtered by table and range, with nothing outside it;
 *          rows written while the export is paged do not shift it;
 *          the export leaves one audit_export audit row naming the admin,
 *          the range and the chain result, and a page cannot be read
 *          without naming that export;
 *          a tampered row shows in the chain result;
 *          the app's paging helper (src/lib/audit-ledger-export.ts) runs a
 *          real export through the Data API to the end.
 *
 * The 1,000-row and tamper checks run as the seeded admin inside one psql
 * transaction that is rolled back (audit_log is append-only, so committed
 * fixture rows could never be removed). The Data API checks leave only the
 * audit_export rows an export is meant to leave.
 *
 *   npm run db:start && npm run test:audit-log-export
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";
import { runSql, sections } from "../test-support/psql.mjs";
import { collectAuditLedgerExport } from "../../src/lib/audit-ledger-export.ts";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-audit-log-export");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

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

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const anon = createClient(URL, ANON, noSession);
const signIn = async (email) => {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Could not sign in ${email}: ${error.message}. Run npm run db:reset.`);
  return {
    id: data.user.id,
    client: createClient(URL, ANON, {
      ...noSession,
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    }),
  };
};

const ADMIN_EMAIL = "admin@magistrate-wizard.local";
const FROM = "2001-01-01T00:00:00Z";
const TO = "2001-01-01T01:00:00Z";

async function main() {
  const admin = await signIn(ADMIN_EMAIL);
  const magistrate = await signIn("magistrate@magistrate-wizard.local");
  const recent = {
    p_from: new Date(Date.now() - 10 * 60_000).toISOString(),
    p_to: new Date(Date.now() + 60_000).toISOString(),
  };

  // ---------- who may export ----------
  for (const [who, client] of [
    ["anon", createClient(URL, ANON, noSession)],
    ["a magistrate", magistrate.client],
  ]) {
    const { data, error } = await client.rpc("export_audit_log", recent);
    check(`BE-18 ${who} cannot export the audit log`, [!!error, data ?? null], [true, null]);
  }
  {
    const { error } = await admin.client.rpc("export_audit_log", {
      p_from: recent.p_to,
      p_to: recent.p_from,
    });
    check("BE-18 a range that ends before it starts is refused", !!error, true);
  }
  {
    const { error } = await admin.client.rpc("export_audit_log", {
      p_export_id: 1,
      p_after_id: 0,
    });
    check("BE-18 a page cannot be read without a real export", !!error, true);
  }

  // ---------- the app's helper, through the Data API ----------
  {
    const ledger = await collectAuditLedgerExport(
      (args) => admin.client.rpc("export_audit_log", args),
      { from: recent.p_from, to: recent.p_to, pageSize: 3 },
    );
    const ids = ledger.rows.map((row) => row.id);
    check("BE-18 the helper collects the whole export", ids.length, ledger.total);
    check(
      "BE-18 oldest first, each row once",
      ids.every((id, i) => i === 0 || id > ids[i - 1]),
      true,
    );
    check("BE-18 the chain is intact", ledger.chain, { ok: true, broken_id: null });

    const { data: exportRow, error } = await admin.client
      .from("audit_log")
      .select("actor_id, table_name, new_data")
      .eq("id", ledger.export_id)
      .single();
    check("BE-18 the export left its audit row", error, null);
    check("BE-18 naming the admin", exportRow?.actor_id, admin.id);
    check("BE-18 as an audit_export", exportRow?.new_data?.event, "audit_export");
    check("BE-18 with its total", exportRow?.new_data?.total, ledger.total);

    const { error: otherRange } = await admin.client.rpc("export_audit_log", {
      p_export_id: ledger.export_id,
      p_after_id: 0,
      p_from: FROM,
    });
    check("BE-18 a continued export cannot change its range", !!otherRange, true);
    const { error: notAdmin } = await magistrate.client.rpc("export_audit_log", {
      p_export_id: ledger.export_id,
      p_after_id: 0,
    });
    check("BE-18 a magistrate cannot read a page of it", !!notAdmin, true);
  }

  // ---------- 1,000 rows, as the admin, rolled back ----------
  const sql = `
    begin;
    insert into public.audit_log (action, table_name, new_data, created_at)
    select 'insert', 'be18_fixture', jsonb_build_object('n', g),
           timestamptz '${FROM}' + g * interval '3 seconds'
    from generate_series(1, 1000) g;
    insert into public.audit_log (action, table_name, new_data, created_at)
    select 'insert', 'be18_other', jsonb_build_object('n', g),
           timestamptz '${FROM}' + g * interval '1 minute'
    from generate_series(1, 5) g;
    insert into public.audit_log (action, table_name, new_data, created_at)
    select 'insert', 'be18_fixture', jsonb_build_object('outside', g),
           timestamptz '${FROM}' - g * interval '1 minute'
    from generate_series(1, 5) g;

    create temp table be18_pages (page_no integer, page jsonb);
    grant all on be18_pages to authenticated;
    select set_config(
      'request.jwt.claims',
      json_build_object(
        'sub', (select id from auth.users where email = '${ADMIN_EMAIL}'),
        'role', 'authenticated'
      )::text,
      true
    );
    set local role authenticated;

    insert into be18_pages
    select 0, public.export_audit_log(
      p_from => '${FROM}', p_to => '${TO}', p_tables => array['be18_fixture'], p_limit => 300
    );

    -- A row of the same period and table written while the export is paged.
    reset role;
    insert into public.audit_log (action, table_name, new_data, created_at)
    values ('insert', 'be18_fixture', '{"late": true}', timestamptz '${FROM}' + interval '30 minutes');
    set local role authenticated;

    do $$
    declare
      p jsonb;
      n integer := 0;
    begin
      select b.page into p from be18_pages b where b.page_no = 0;
      while p ->> 'next_after_id' is not null loop
        n := n + 1;
        p := public.export_audit_log(
          p_export_id => (p ->> 'export_id')::bigint,
          p_after_id => (p ->> 'next_after_id')::bigint,
          p_limit => 300
        );
        insert into be18_pages values (n, p);
      end loop;
    end;
    $$;

    \\echo @@pages
    select jsonb_agg(b.page - 'rows' order by b.page_no) from be18_pages b;
    \\echo @@rows
    select jsonb_agg(r order by b.page_no, ord)
    from be18_pages b,
         jsonb_array_elements(b.page -> 'rows') with ordinality as e(r, ord);
    \\echo @@export_row
    select jsonb_build_object('actor_id', a.actor_id, 'new_data', a.new_data)
    from public.audit_log a
    where a.id = (select (b.page ->> 'export_id')::bigint from be18_pages b where b.page_no = 0);
    \\echo @@all_tables_total
    select public.export_audit_log(p_from => '${FROM}', p_to => '${TO}', p_limit => 1) ->> 'total';

    reset role;
    alter table public.audit_log disable trigger audit_log_immutable_trigger;
    update public.audit_log
       set row_hash = 'tampered'
     where id = (select min(id) from public.audit_log where table_name = 'be18_fixture');
    alter table public.audit_log enable trigger audit_log_immutable_trigger;
    \\echo @@tampered_id
    select min(id) from public.audit_log where table_name = 'be18_fixture';
    set local role authenticated;
    \\echo @@tampered_chain
    select public.export_audit_log(
      p_from => '${FROM}', p_to => '${TO}', p_tables => array['be18_fixture'], p_limit => 1
    ) -> 'chain';
    rollback;
  `;
  const out = sections(runSql(sql, "test-audit-log-export"));
  const pages = JSON.parse(out.pages);
  const rows = JSON.parse(out.rows);
  const exportRow = JSON.parse(out.export_row);
  const first = pages[0];

  check("BE-18 the export counts the 1,000 rows of the period", first.total, 1000);
  check(
    "BE-18 in pages of 300",
    pages.map((p) => p.next_after_id === null),
    [false, false, false, true],
  );
  check("BE-18 every page belongs to one export", new Set(pages.map((p) => p.export_id)).size, 1);
  check("BE-18 all 1,000 rows come back", rows.length, 1000);
  check("BE-18 each once", new Set(rows.map((r) => r.id)).size, 1000);
  check(
    "BE-18 oldest first",
    rows.every((r, i) => i === 0 || r.id > rows[i - 1].id),
    true,
  );
  check(
    "BE-18 only the table asked for",
    rows.every((r) => r.table_name === "be18_fixture"),
    true,
  );
  check(
    "BE-18 only the period asked for",
    rows.every((r) => r.new_data.n >= 1 && Date.parse(r.created_at) >= Date.parse(FROM)),
    true,
  );
  check(
    "BE-18 a row written while paging is not in the export",
    rows.some((r) => r.new_data.late),
    false,
  );
  check(
    "BE-18 rows carry their hashes",
    rows.every((r) => r.row_hash && r.prev_hash),
    true,
  );
  check("BE-18 the chain was verified intact", first.chain, { ok: true, broken_id: null });
  check("BE-18 the export's audit row names the admin", exportRow.actor_id, admin.id);
  check(
    "BE-18 and records the export",
    [
      exportRow.new_data.event,
      exportRow.new_data.total,
      exportRow.new_data.tables,
      exportRow.new_data.chain_ok,
    ],
    ["audit_export", 1000, ["be18_fixture"], true],
  );
  check(
    "BE-18 without a table filter every table of the period counts",
    out.all_tables_total,
    "1006",
  );
  check("BE-18 a tampered row shows in the chain result", JSON.parse(out.tampered_chain), {
    ok: false,
    broken_id: Number(out.tampered_id),
  });

  console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll audit-log export tests passed.");
}

try {
  await main();
} catch (err) {
  console.error("Test run threw:", err);
  failures += 1;
}
process.exit(failures > 0 ? 1 : 0);
