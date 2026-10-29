-- Magistrate Wizard -- 0181: a complete, audited audit-log export
--
-- Problem (backend sweep BE-18)
--   The Audit activity page builds its CSV in the browser from the rows on
--   screen: at most 200 of each kind, newest first, with no date range. An
--   admin cannot produce the whole ledger for a period, and nothing records
--   that an export happened.
--
-- Change
--   export_audit_log() returns the audit_log rows of a period, oldest
--   first, a page at a time, for an admin only.
--
--   Start an export with the range (and optionally the tables):
--     export_audit_log(p_from, p_to, p_tables, p_limit)
--   It verifies the whole hash chain (verify_audit_hash_chain(), 0126),
--   pins the export to the ledger as it stands (rows up to as_of_id, so
--   rows written while paging do not shift it), counts the rows, writes one
--   audit_log row for the export (table_name 'audit_log', new_data.event
--   'audit_export', with the range, tables, count and chain result) and
--   returns the first page.
--
--   Continue it with the export id and the cursor of the previous page:
--     export_audit_log(p_export_id => ..., p_after_id => ..., p_limit)
--   The range, tables, count and chain result are read back from that
--   export's audit row, which must be the caller's own and under a day
--   old, so every page of every export is covered by an audit row and the
--   range cannot change half way.
--
--   Each page is jsonb:
--     { export_id, from, to, tables, as_of_id, total,
--       chain: { ok, broken_id },
--       rows: [ { id, created_at, action, table_name, record_id, actor_id,
--                 actor_name, actor_email, old_data, new_data, prev_hash,
--                 row_hash } ],
--       next_after_id }        -- null on the last page
--   The range is half-open: from <= created_at < to. A page holds 1 to
--   1000 rows (default 500).
--
--   The typed result and a paging helper for the app are in
--   src/lib/audit-ledger-export.ts.
--
-- Threat model
--   SECURITY DEFINER because it writes the export's audit_log row, which no
--   client role may insert, in the same call as the read. It returns only
--   what an admin can already select from audit_log and profiles under RLS
--   (0009, 0126); is_admin() is checked first and on every page. Fixed
--   search_path; EXECUTE for authenticated (the check is inside), none for
--   anon or PUBLIC.
-- ============================================================================

create or replace function public.export_audit_log(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_tables text[] default null,
  p_export_id bigint default null,
  p_after_id bigint default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_export jsonb;
  v_export_id bigint;
  v_from timestamptz;
  v_to timestamptz;
  v_tables text[];
  v_as_of bigint;
  v_first bigint;
  v_total bigint;
  v_chain_ok boolean;
  v_chain_broken bigint;
  v_rows jsonb;
  v_last bigint;
  v_more boolean;
begin
  if not (select public.is_admin()) then
    raise exception 'Only administrators can export the audit log'
      using errcode = '42501';
  end if;

  if p_export_id is null then
    -- Start an export.
    if p_from is null or p_to is null or p_from >= p_to then
      raise exception 'An export needs a range with from before to'
        using errcode = '22023';
    end if;
    if p_after_id is not null then
      raise exception 'p_after_id continues an export; pass p_export_id with it'
        using errcode = '22023';
    end if;
    if p_tables is not null then
      select array_agg(distinct btrim(t) order by btrim(t))
        into v_tables
      from unnest(p_tables) as t
      where nullif(btrim(t), '') is not null;
      if v_tables is null then
        raise exception 'p_tables must name at least one table, or be null for all'
          using errcode = '22023';
      end if;
    end if;
    v_from := p_from;
    v_to := p_to;

    select v.ok, v.broken_id
      into v_chain_ok, v_chain_broken
    from public.verify_audit_hash_chain() v;

    select max(a.id) into v_as_of from public.audit_log a;

    select count(*), min(a.id)
      into v_total, v_first
    from public.audit_log a
    where a.created_at >= v_from
      and a.created_at < v_to
      and a.id <= coalesce(v_as_of, 0)
      and (v_tables is null or a.table_name = any (v_tables));

    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (
      (select auth.uid()),
      'insert',
      'audit_log',
      null,
      jsonb_build_object(
        'event', 'audit_export',
        'from', v_from,
        'to', v_to,
        'tables', to_jsonb(v_tables),
        'as_of_id', coalesce(v_as_of, 0),
        'first_id', v_first,
        'total', v_total,
        'chain_ok', v_chain_ok,
        'chain_broken_id', v_chain_broken
      )
    )
    returning id into v_export_id;
  else
    -- Continue one.
    if p_from is not null or p_to is not null or p_tables is not null then
      raise exception 'A continued export keeps its own range; pass only p_export_id, p_after_id and p_limit'
        using errcode = '22023';
    end if;

    select a.new_data
      into v_export
    from public.audit_log a
    where a.id = p_export_id
      and a.table_name = 'audit_log'
      and a.new_data ->> 'event' = 'audit_export'
      and a.actor_id = (select auth.uid())
      and a.created_at > now() - interval '1 day';
    if v_export is null then
      raise exception 'Audit export % not found, not yours, or over a day old; start a new export', p_export_id
        using errcode = 'P0002';
    end if;

    v_export_id := p_export_id;
    v_from := (v_export ->> 'from')::timestamptz;
    v_to := (v_export ->> 'to')::timestamptz;
    v_tables := case
      when jsonb_typeof(v_export -> 'tables') = 'array'
        then array(select jsonb_array_elements_text(v_export -> 'tables'))
    end;
    v_as_of := (v_export ->> 'as_of_id')::bigint;
    v_first := (v_export ->> 'first_id')::bigint;
    v_total := (v_export ->> 'total')::bigint;
    v_chain_ok := (v_export ->> 'chain_ok')::boolean;
    v_chain_broken := (v_export ->> 'chain_broken_id')::bigint;
  end if;

  -- One page, in id (chain) order. first_id and as_of_id bound the id range
  -- so the primary key serves the scan; created_at still decides the period.
  with page as (
    select a.*
    from public.audit_log a
    where a.id > greatest(coalesce(p_after_id, 0), coalesce(v_first, 0) - 1)
      and a.id <= coalesce(v_as_of, 0)
      and a.created_at >= v_from
      and a.created_at < v_to
      and (v_tables is null or a.table_name = any (v_tables))
    order by a.id
    limit v_limit
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'created_at', p.created_at,
          'action', p.action,
          'table_name', p.table_name,
          'record_id', p.record_id,
          'actor_id', p.actor_id,
          'actor_name', pr.full_name,
          'actor_email', pr.email,
          'old_data', p.old_data,
          'new_data', p.new_data,
          'prev_hash', p.prev_hash,
          'row_hash', p.row_hash
        )
        order by p.id
      ),
      '[]'::jsonb
    ),
    max(p.id)
    into v_rows, v_last
  from page p
  left join public.profiles pr on pr.id = p.actor_id;

  v_more := v_last is not null and exists (
    select 1
    from public.audit_log a
    where a.id > v_last
      and a.id <= coalesce(v_as_of, 0)
      and a.created_at >= v_from
      and a.created_at < v_to
      and (v_tables is null or a.table_name = any (v_tables))
  );

  return jsonb_build_object(
    'export_id', v_export_id,
    'from', v_from,
    'to', v_to,
    'tables', to_jsonb(v_tables),
    'as_of_id', coalesce(v_as_of, 0),
    'total', v_total,
    'chain', jsonb_build_object('ok', v_chain_ok, 'broken_id', v_chain_broken),
    'rows', v_rows,
    'next_after_id', case when v_more then v_last end
  );
end;
$$;

comment on function public.export_audit_log(timestamptz, timestamptz, text[], bigint, bigint, integer) is
  'Admin-only, audited, paged audit-log export (0181). Start with p_from, p_to (half-open) and optional p_tables: verifies the hash chain, pins the export to the current ledger, writes an audit_log row (new_data.event = audit_export) and returns the first page. Continue with p_export_id and p_after_id = the previous next_after_id. Returns jsonb { export_id, from, to, tables, as_of_id, total, chain { ok, broken_id }, rows [...], next_after_id }.';

revoke all on function public.export_audit_log(timestamptz, timestamptz, text[], bigint, bigint, integer) from public, anon;
grant execute on function public.export_audit_log(timestamptz, timestamptz, text[], bigint, bigint, integer) to authenticated;
