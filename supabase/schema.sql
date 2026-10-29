


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."audit_action" AS ENUM (
    'insert',
    'update',
    'delete'
);


ALTER TYPE "public"."audit_action" OWNER TO "postgres";


CREATE TYPE "public"."auth_event_type" AS ENUM (
    'login_success',
    'login_failed',
    'logout',
    'password_reset_requested'
);


ALTER TYPE "public"."auth_event_type" OWNER TO "postgres";


CREATE TYPE "public"."bookmark_entity_type" AS ENUM (
    'case',
    'bench_note',
    'statute',
    'case_law',
    'docket_matter',
    'judgment',
    'quick_code',
    'statute_provision'
);


ALTER TYPE "public"."bookmark_entity_type" OWNER TO "postgres";


COMMENT ON TYPE "public"."bookmark_entity_type" IS 'Polymorphic Bookmark target discriminator. Seven approved values: case | bench_note | statute | case_law (original, 0008) | docket_matter | judgment | quick_code (added across 0041/0042, split across two migrations because the enum values could not safely be used in the same transaction that added them to this pre-existing type). `document` is deliberately excluded -- Documents (0040) are subordinate attachments whose access follows their parent; whether to allow bookmarking the attachment itself versus only its parent record is an unresolved product question, not decided here. case_law_annotation, docket_event, docket_matter_party, tag, association/join rows, and share are not bookmarkable targets and were never considered for this enum.';



CREATE TYPE "public"."case_status" AS ENUM (
    'open',
    'pending',
    'closed',
    'archived'
);


ALTER TYPE "public"."case_status" OWNER TO "postgres";


CREATE TYPE "public"."clerk_access_decision" AS ENUM (
    'approved',
    'rejected'
);


ALTER TYPE "public"."clerk_access_decision" OWNER TO "postgres";


CREATE TYPE "public"."clerk_access_request_status" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled',
    'expired'
);


ALTER TYPE "public"."clerk_access_request_status" OWNER TO "postgres";


CREATE TYPE "public"."docket_matter_status" AS ENUM (
    'active',
    'stayed',
    'completed',
    'archived',
    'dismissed'
);


ALTER TYPE "public"."docket_matter_status" OWNER TO "postgres";


COMMENT ON TYPE "public"."docket_matter_status" IS 'Docket Matter lifecycle status. Distinct from the legacy cases.case_status enum — different table, different values, no relationship.';



CREATE TYPE "public"."magistrate_court_decision" AS ENUM (
    'approved',
    'rejected'
);


ALTER TYPE "public"."magistrate_court_decision" OWNER TO "postgres";


CREATE TYPE "public"."magistrate_court_request_status" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled',
    'expired'
);


ALTER TYPE "public"."magistrate_court_request_status" OWNER TO "postgres";


CREATE TYPE "public"."note_status" AS ENUM (
    'draft',
    'published'
);


ALTER TYPE "public"."note_status" OWNER TO "postgres";


CREATE TYPE "public"."party_role" AS ENUM (
    'plaintiff',
    'defendant',
    'petitioner',
    'respondent',
    'appellant',
    'appellee',
    'witness',
    'other'
);


ALTER TYPE "public"."party_role" OWNER TO "postgres";


CREATE TYPE "public"."search_result" AS (
	"entity_type" "text",
	"id" "uuid",
	"title" "text",
	"subtitle" "text",
	"headline" "text",
	"rank" real
);


ALTER TYPE "public"."search_result" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'magistrate',
    'clerk',
    'admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."active_account_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id from public.profiles p where p.id = (select auth.uid()) and p.is_active;
$$;


ALTER FUNCTION "public"."active_account_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."active_account_id"() IS 'The caller''s id when their account is active, else null (0200, BE-09). The restrictive "Deactivated accounts have no access" policies test it for null, which the planner estimates as keeping almost every row, where a bare boolean would halve every estimate.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."magistrate_courts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "court_id" "uuid" NOT NULL,
    "assignment_type" "text" DEFAULT 'regular'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "can_manage_clerks" boolean DEFAULT false NOT NULL,
    "ended_by" "uuid",
    "end_reason" "text",
    "occupies_primary_slot" boolean DEFAULT false NOT NULL,
    CONSTRAINT "magistrate_courts_assignment_type_check" CHECK (("assignment_type" = ANY (ARRAY['regular'::"text", 'acting'::"text", 'relief'::"text", 'other'::"text"]))),
    CONSTRAINT "magistrate_courts_end_fields_consistent" CHECK ((("ended_at" IS NOT NULL) OR (("ended_by" IS NULL) AND ("end_reason" IS NULL)))),
    CONSTRAINT "magistrate_courts_ended_after_started" CHECK ((("ended_at" IS NULL) OR ("ended_at" >= "started_at")))
);


ALTER TABLE "public"."magistrate_courts" OWNER TO "postgres";


COMMENT ON TABLE "public"."magistrate_courts" IS 'Which magistrates currently sit, or historically sat, at which courts. ended_at IS NULL means the assignment is current; this is the mechanism that grants ordinary operational Docket access (see docket_matters, a later migration). Rows are never deleted — only ended.';



COMMENT ON COLUMN "public"."magistrate_courts"."court_id" IS 'ON DELETE RESTRICT: a court with any assignment history, current or ended, cannot be deleted.';



COMMENT ON COLUMN "public"."magistrate_courts"."assignment_type" IS 'Descriptive only (regular/acting/relief/other) — does NOT alter Docket permissions. Any current assignment, regardless of type, grants identical operational access.';



COMMENT ON COLUMN "public"."magistrate_courts"."ended_at" IS 'NULL = current assignment. The sole source of truth for assignment state; there is no separate is_active column.';



COMMENT ON COLUMN "public"."magistrate_courts"."can_manage_clerks" IS 'Admin-set (0086). Needed only when more than one CURRENT primary (regular) sits at the same court, or when several coverings sit with no unique primary. A unique current primary may always review clerk access there even if acting/relief also sit (0144). Distinct from assignment_type (0017).';



COMMENT ON COLUMN "public"."magistrate_courts"."ended_by" IS 'Who ended this assignment (relinquishment or admin correction). Force-set by protect_magistrate_court_history() below whenever ended_at transitions from NULL -- never trusted from any RPC parameter or client input. NULL while the assignment is current.';



COMMENT ON COLUMN "public"."magistrate_courts"."end_reason" IS 'Optional free-text reason recorded at relinquishment/administrative ending. NULL while the assignment is current.';



COMMENT ON COLUMN "public"."magistrate_courts"."occupies_primary_slot" IS 'True only for an active assignment_type=regular sitting whose magistrate has signed in at least once. Pending requests and never-logged-in regulars do not occupy the court.';



CREATE OR REPLACE FUNCTION "public"."admin_assign_magistrate_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text" DEFAULT 'regular'::"text") RETURNS "public"."magistrate_courts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result public.magistrate_courts;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may create a court assignment';
  end if;

  if p_assignment_type not in ('regular', 'acting', 'relief', 'other') then
    raise exception 'Invalid assignment type: %', p_assignment_type;
  end if;

  if p_assignment_type = 'regular' and p_profile_id = (select auth.uid()) then
    raise exception 'An administrator cannot directly self-assign a primary court. Submit a court assignment request and have another administrator approve it, or -- only if you are the sole active administrator -- use the explicit bootstrap self-approval exception.';
  end if;

  begin
    insert into public.magistrate_courts (profile_id, court_id, assignment_type)
    values (p_profile_id, p_court_id, p_assignment_type)
    returning * into v_result;
  exception
    when unique_violation then
      raise exception 'This profile already has an active assignment to this court, or this court already has an active primary magistrate assignment.';
  end;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."admin_assign_magistrate_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_assign_magistrate_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text") IS 'Admin-only (Court Assignment Administrator). Creates a magistrate_courts assignment for any profile at any active court. Blocks a ''regular'' assignment where p_profile_id equals the caller (0110) -- an administrator must go through the request/approval path (ordinary or the explicit sole-administrator bootstrap exception) to acquire their OWN primary court, never a silent direct self-assignment. Assigning a DIFFERENT profile a ''regular'' court, and self-assigning acting/relief/other, are both unaffected. The sole path for assignment_type IN (''acting'',''relief'',''other'') -- exempt from the 0105 primary-exclusivity trigger by construction.';



CREATE TABLE IF NOT EXISTS "public"."magistrate_court_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "court_id" "uuid" NOT NULL,
    "requested_assignment_type" "text" DEFAULT 'regular'::"text" NOT NULL,
    "status" "public"."magistrate_court_request_status" DEFAULT 'pending'::"public"."magistrate_court_request_status" NOT NULL,
    "staff_id" "text",
    "note" "text",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "rejection_reason" "text",
    "cancelled_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "approval_kind" "text",
    "notified_requester_at" timestamp with time zone,
    "notified_admin_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "request_kind" "text" DEFAULT 'ordinary'::"text" NOT NULL,
    "occupied_resolution" "text",
    CONSTRAINT "magistrate_court_requests_approval_kind_check" CHECK (("approval_kind" = ANY (ARRAY['ordinary'::"text", 'bootstrap_self_approval'::"text"]))),
    CONSTRAINT "magistrate_court_requests_approval_kind_iff_approved" CHECK ((("approval_kind" IS NULL) OR ("status" = 'approved'::"public"."magistrate_court_request_status"))),
    CONSTRAINT "magistrate_court_requests_cancelled_iff_cancelled" CHECK ((("cancelled_at" IS NOT NULL) = ("status" = 'cancelled'::"public"."magistrate_court_request_status"))),
    CONSTRAINT "magistrate_court_requests_expiry_only_while_relevant" CHECK ((("expires_at" IS NULL) OR ("status" = ANY (ARRAY['pending'::"public"."magistrate_court_request_status", 'expired'::"public"."magistrate_court_request_status"])))),
    CONSTRAINT "magistrate_court_requests_occupied_resolution_check" CHECK ((("occupied_resolution" IS NULL) OR ("occupied_resolution" = ANY (ARRAY['replace'::"text", 'co_sit'::"text"])))),
    CONSTRAINT "magistrate_court_requests_rejection_reason_iff_rejected" CHECK ((("rejection_reason" IS NULL) OR ("status" = 'rejected'::"public"."magistrate_court_request_status"))),
    CONSTRAINT "magistrate_court_requests_request_kind_check" CHECK (("request_kind" = ANY (ARRAY['ordinary'::"text", 'occupied_exception'::"text"]))),
    CONSTRAINT "magistrate_court_requests_requested_assignment_type_check" CHECK (("requested_assignment_type" = 'regular'::"text")),
    CONSTRAINT "magistrate_court_requests_reviewed_iff_decided" CHECK (((("status" = ANY (ARRAY['approved'::"public"."magistrate_court_request_status", 'rejected'::"public"."magistrate_court_request_status"])) AND ("reviewed_at" IS NOT NULL) AND ("reviewed_by" IS NOT NULL)) OR (("status" <> ALL (ARRAY['approved'::"public"."magistrate_court_request_status", 'rejected'::"public"."magistrate_court_request_status"])) AND ("reviewed_at" IS NULL) AND ("reviewed_by" IS NULL))))
);


ALTER TABLE "public"."magistrate_court_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."magistrate_court_requests" IS 'One row per (magistrate, court) court-assignment request -- every requested court is reviewed and decided independently (see the partial unique index below). Ordinary magistrates reach this table only through submit_magistrate_court_request()/cancel_magistrate_court_request() (SECURITY DEFINER, 0107) and signup-time creation in handle_new_user() -- there is no direct client INSERT/UPDATE policy, so status/reviewer/decision fields cannot be altered by a raw Supabase call.';



COMMENT ON COLUMN "public"."magistrate_court_requests"."staff_id" IS 'Optional employee/staff identification number, as supplied at request time.';



COMMENT ON COLUMN "public"."magistrate_court_requests"."note" IS 'Optional short free-text note supplied at request time.';



COMMENT ON COLUMN "public"."magistrate_court_requests"."approval_kind" IS 'NULL until decided. ''ordinary'' for a normal Court Assignment Administrator approval via decide_magistrate_court_request(). ''bootstrap_self_approval'' ONLY when approved via admin_bootstrap_self_approve_magistrate_court_request() (0107) -- the sole-administrator self-approval exception, permanently visible here and in audit_log so a bootstrap approval is never indistinguishable from an ordinary one.';



COMMENT ON COLUMN "public"."magistrate_court_requests"."notified_requester_at" IS 'Set once the requester has been notified of the decision. In-app only for this pass (no email provider configured project-wide) -- reserved for a future notification mechanism, mirroring clerk_access_requests.notified_clerk_at.';



COMMENT ON COLUMN "public"."magistrate_court_requests"."notified_admin_at" IS 'Set once an administrator has been notified a new request needs review. In-app only for this pass, mirroring clerk_access_requests.notified_magistrate_at.';



COMMENT ON COLUMN "public"."magistrate_court_requests"."request_kind" IS 'ordinary = court was free at request time. occupied_exception = requester asked for a court that already has a signed-in primary; admin must replace or co-sit. The request itself never occupies the court.';



COMMENT ON COLUMN "public"."magistrate_court_requests"."occupied_resolution" IS 'Admin decision on an occupied-exception approval: replace the incumbent primary, or seat this magistrate as acting alongside them.';



CREATE OR REPLACE FUNCTION "public"."admin_bootstrap_self_approve_magistrate_court_request"("p_request_id" "uuid", "p_reason" "text") RETURNS "public"."magistrate_court_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_request public.magistrate_court_requests;
  v_now timestamptz := now();
  v_active_admin_count int;
  v_reason text;
  v_token_age_seconds numeric;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may use this exception';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A reason is required to use the sole-administrator self-approval exception';
  end if;

  v_token_age_seconds := extract(epoch from now()) - (select (auth.jwt() ->> 'iat')::numeric);
  if v_token_age_seconds is null or v_token_age_seconds > 300 then
    raise exception 'This action requires a recent sign-in. Please re-enter your password and try again.';
  end if;

  select * into v_request
  from public.magistrate_court_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Court assignment request not found';
  end if;

  if v_request.status in ('approved', 'rejected') then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request is no longer pending (status: %)', v_request.status;
  end if;

  if v_request.profile_id <> (select auth.uid()) then
    raise exception 'This exception is only for approving your own request -- use decide_magistrate_court_request() for other requests';
  end if;

  select count(*) into v_active_admin_count
  from public.profiles
  where role = 'admin' and is_active = true;

  if v_active_admin_count <> 1 then
    raise exception 'The sole-administrator exception is unavailable: % active administrators currently exist. Ask another administrator to review this request.', v_active_admin_count;
  end if;

  if public.court_has_active_primary_magistrate(v_request.court_id)
     or v_request.request_kind = 'occupied_exception' then
    raise exception 'This court already has a signed-in primary magistrate. The sole-administrator exception cannot replace or co-sit; ask another administrator once one exists, or transfer from People.';
  end if;

  begin
    insert into public.magistrate_courts (profile_id, court_id, assignment_type, started_at)
    values (v_request.profile_id, v_request.court_id, 'regular', v_now)
    on conflict (profile_id, court_id) where ended_at is null do nothing;
  exception when unique_violation then
    raise exception 'This court already has an active primary magistrate assignment -- cannot approve.';
  end;

  update public.magistrate_court_requests
  set status = 'approved',
      reviewed_at = v_now,
      reviewed_by = (select auth.uid()),
      rejection_reason = null,
      approval_kind = 'bootstrap_self_approval'
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;


ALTER FUNCTION "public"."admin_bootstrap_self_approve_magistrate_court_request"("p_request_id" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_bootstrap_self_approve_magistrate_court_request"("p_request_id" "uuid", "p_reason" "text") IS 'The explicit sole-administrator self-approval exception -- never automatic. Requires: caller is_admin(); the request belongs to the caller; exactly ONE active administrator exists system-wide; a non-empty reason; and a JWT issued within the last 5 minutes (recent-reauthentication proxy -- the client must call signInWithPassword again immediately before this RPC). Sets approval_kind=''bootstrap_self_approval'', permanently distinguishing it from an ordinary approval in both magistrate_court_requests and audit_log. Once a second active administrator exists, this exception is unreachable for anyone (the count check fails) -- ordinary self-approval is never permitted regardless.';



CREATE OR REPLACE FUNCTION "public"."admin_seat_magistrate_at_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text" DEFAULT 'regular'::"text", "p_if_occupied" "text" DEFAULT NULL::"text", "p_reason" "text" DEFAULT NULL::"text") RETURNS "public"."magistrate_courts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role public.user_role;
  v_type text;
  v_resolution text;
  v_row public.magistrate_courts;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may assign a court';
  end if;

  select role into v_role from public.profiles where id = p_profile_id;
  if v_role is null then
    raise exception 'Profile not found';
  end if;
  if v_role not in ('magistrate', 'admin') then
    raise exception 'Only a magistrate (or administrator) can be seated at a court';
  end if;

  if not exists (select 1 from public.courts where id = p_court_id and is_active = true) then
    raise exception 'Court not found or inactive';
  end if;

  v_type := coalesce(nullif(trim(p_assignment_type), ''), 'regular');
  if v_type not in ('regular', 'acting', 'relief', 'other') then
    raise exception 'Invalid assignment type';
  end if;

  v_resolution := nullif(trim(coalesce(p_if_occupied, '')), '');

  if v_type = 'regular' and public.court_has_active_primary_magistrate(p_court_id) then
    if v_resolution is null or v_resolution not in ('replace', 'co_sit') then
      raise exception 'This court already has a signed-in primary magistrate. Choose replace or co_sit.';
    end if;
    if v_resolution = 'replace' then
      perform public.end_other_regular_assignments_at_court(
        p_court_id,
        p_profile_id,
        coalesce(nullif(trim(p_reason), ''), 'Replaced by administrator')
      );
    else
      v_type := 'acting';
    end if;
  end if;

  begin
    insert into public.magistrate_courts (profile_id, court_id, assignment_type, started_at)
    values (p_profile_id, p_court_id, v_type, now())
    on conflict (profile_id, court_id) where ended_at is null do nothing
    returning * into v_row;
  exception when unique_violation then
    raise exception 'This court already has an active primary magistrate assignment -- cannot assign.';
  end;

  if v_row.id is null then
    raise exception 'This person already has an active assignment at this court';
  end if;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."admin_seat_magistrate_at_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text", "p_if_occupied" "text", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_seat_magistrate_at_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text", "p_if_occupied" "text", "p_reason" "text") IS 'Admin seating from People/Roster. Occupied courts require p_if_occupied=replace|co_sit (co-sit seats acting). Never-logged-in regulars do not occupy; a pending request never occupies.';



CREATE OR REPLACE FUNCTION "public"."admin_transfer_magistrate_court"("p_assignment_id" "uuid", "p_new_court_id" "uuid", "p_if_occupied" "text" DEFAULT NULL::"text", "p_reason" "text" DEFAULT NULL::"text") RETURNS "public"."magistrate_courts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_src public.magistrate_courts;
  v_reason text;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may transfer a court assignment';
  end if;

  select * into v_src
  from public.magistrate_courts
  where id = p_assignment_id
  for update;

  if v_src.id is null then
    raise exception 'Court assignment not found';
  end if;
  if v_src.ended_at is not null then
    raise exception 'This assignment has already ended';
  end if;
  if v_src.court_id = p_new_court_id then
    raise exception 'Choose a different court to transfer to';
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'Transferred by administrator');

  update public.magistrate_courts
  set ended_at = now(),
      ended_by = (select auth.uid()),
      end_reason = v_reason
  where id = p_assignment_id;

  return public.admin_seat_magistrate_at_court(
    v_src.profile_id,
    p_new_court_id,
    v_src.assignment_type,
    p_if_occupied,
    v_reason
  );
end;
$$;


ALTER FUNCTION "public"."admin_transfer_magistrate_court"("p_assignment_id" "uuid", "p_new_court_id" "uuid", "p_if_occupied" "text", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_transfer_magistrate_court"("p_assignment_id" "uuid", "p_new_court_id" "uuid", "p_if_occupied" "text", "p_reason" "text") IS 'Ends the current sitting and seats the same magistrate at another court. If the destination has a signed-in primary, p_if_occupied=replace|co_sit is required.';



CREATE OR REPLACE FUNCTION "public"."anon_executable_definer_functions"() RETURNS SETOF "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')
  order by 1;
$$;


ALTER FUNCTION "public"."anon_executable_definer_functions"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."anon_executable_definer_functions"() IS 'Signatures of the public SECURITY DEFINER functions (triggers excluded) that anon can execute (0169). For the live test that keeps that set to its reviewed allowlist. Service role only.';



CREATE OR REPLACE FUNCTION "public"."apply_case_law_tags"("p_case_law_id" "uuid", "p_tag_names" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_name text;
  v_tag_id uuid;
  v_final_ids uuid[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Only administrators may apply Case Law tags.';
  end if;

  -- 0162: canonical rows only (ADR 0007).
  if not exists (
    select 1 from public.case_law where id = p_case_law_id and owner_id is null
  ) then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  foreach v_name in array coalesce(p_tag_names, '{}') loop
    v_name := trim(v_name);
    continue when v_name = '';

    select id into v_tag_id from public.tags where lower(name) = lower(v_name) limit 1;
    if v_tag_id is null then
      insert into public.tags (name, created_by) values (v_name, auth.uid())
      returning id into v_tag_id;
    end if;
    v_final_ids := array_append(v_final_ids, v_tag_id);
  end loop;

  delete from public.case_law_tags
  where case_law_id = p_case_law_id
    and not (tag_id = any (v_final_ids));

  insert into public.case_law_tags (case_law_id, tag_id)
  select p_case_law_id, t
  from unnest(v_final_ids) as t
  on conflict do nothing;
end;
$$;


ALTER FUNCTION "public"."apply_case_law_tags"("p_case_law_id" "uuid", "p_tag_names" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_data_retention"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_days integer;
  v_count integer := 0;
begin
  select retention_days
    into v_days
  from public.data_retention_policies
  where table_name = 'notifications'
    and action = 'purge';

  if v_days is not null then
    delete from public.notifications
    where created_at < now() - make_interval(days => v_days);
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."apply_data_retention"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_data_retention"() IS 'Purges allowlisted operational rows (notifications only). Never touches audit_log, docket, or judicial writing.';



CREATE OR REPLACE FUNCTION "public"."apply_statute_tags"("p_statute_id" "uuid", "p_tag_names" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_name text;
  v_tag_id uuid;
  v_final_ids uuid[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Only administrators may apply Legislation tags.';
  end if;

  if not exists (select 1 from public.statutes where id = p_statute_id) then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  foreach v_name in array coalesce(p_tag_names, '{}') loop
    v_name := trim(v_name);
    continue when v_name = '';

    select id into v_tag_id from public.tags where lower(name) = lower(v_name) limit 1;
    if v_tag_id is null then
      insert into public.tags (name, created_by) values (v_name, auth.uid())
      returning id into v_tag_id;
    end if;
    v_final_ids := array_append(v_final_ids, v_tag_id);
  end loop;

  delete from public.statute_tags
  where statute_id = p_statute_id
    and not (tag_id = any (v_final_ids));

  insert into public.statute_tags (statute_id, tag_id)
  select p_statute_id, t
  from unnest(v_final_ids) as t
  on conflict do nothing;
end;
$$;


ALTER FUNCTION "public"."apply_statute_tags"("p_statute_id" "uuid", "p_tag_names" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log_assign_hash"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  prev text;
  digest text;
begin
  -- 0154: serialise chain-head reads. FOR UPDATE alone lets two inserts
  -- read the same predecessor when neither has hashed yet.
  perform pg_advisory_xact_lock(hashtext('audit_log_hash_chain'));

  select a.row_hash
    into prev
  from public.audit_log a
  where a.id <> new.id
    and a.row_hash is not null
  order by a.id desc
  limit 1
  for update;

  prev := coalesce(prev, 'genesis');
  digest := public.audit_log_digest(
    public.audit_log_payload(
      prev,
      new.id,
      new.action,
      new.table_name,
      new.record_id,
      new.actor_id,
      new.created_at,
      new.old_data,
      new.new_data
    )
  );

  update public.audit_log
     set prev_hash = prev,
         row_hash = digest
   where id = new.id;

  return null;
end;
$$;


ALTER FUNCTION "public"."audit_log_assign_hash"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log_digest"("p_payload" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select encode(extensions.digest(convert_to(p_payload, 'utf8'), 'sha256'), 'hex');
$$;


ALTER FUNCTION "public"."audit_log_digest"("p_payload" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_log rows cannot be deleted';
  end if;
  if old.row_hash is not null then
    raise exception 'audit_log rows cannot be updated';
  end if;
  if new.id is distinct from old.id
    or new.actor_id is distinct from old.actor_id
    or new.action is distinct from old.action
    or new.table_name is distinct from old.table_name
    or new.record_id is distinct from old.record_id
    or new.old_data is distinct from old.old_data
    or new.new_data is distinct from old.new_data
    or new.created_at is distinct from old.created_at
  then
    raise exception 'audit_log rows cannot be updated';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."audit_log_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log_payload"("p_prev_hash" "text", "p_id" bigint, "p_action" "public"."audit_action", "p_table_name" "text", "p_record_id" "uuid", "p_actor_id" "uuid", "p_created_at" timestamp with time zone, "p_old_data" "jsonb", "p_new_data" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select concat_ws(
    '|',
    coalesce(p_prev_hash, 'genesis'),
    p_id::text,
    p_action::text,
    coalesce(p_table_name, ''),
    coalesce(p_record_id::text, ''),
    coalesce(p_actor_id::text, ''),
    coalesce(p_created_at::text, ''),
    coalesce(p_old_data::text, ''),
    coalesce(p_new_data::text, '')
  );
$$;


ALTER FUNCTION "public"."audit_log_payload"("p_prev_hash" "text", "p_id" bigint, "p_action" "public"."audit_action", "p_table_name" "text", "p_record_id" "uuid", "p_actor_id" "uuid", "p_created_at" timestamp with time zone, "p_old_data" "jsonb", "p_new_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_trigger_fn"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_old jsonb;
  v_new jsonb;
  v_keep text[];
  v_private boolean;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  end if;

  -- 0162: private rows record an allowlist of metadata, never content.
  -- Titles, case names, case numbers, code words and file names are
  -- content (ADR 0007). A column added later stays out until listed here.
  if tg_table_name = 'judgments' then
    v_keep := array[
      'id', 'owner_id', 'status', 'is_discoverable', 'category_id',
      'finalized_at', 'finalized_by', 'created_at', 'updated_at'
    ];
  elsif tg_table_name = 'bench_notes' then
    v_keep := array[
      'id', 'author_id', 'status', 'is_private', 'entity_type', 'entity_id',
      'created_at', 'updated_at'
    ];
  elsif tg_table_name = 'quick_codes' then
    v_keep := array['id', 'owner_id', 'created_at', 'updated_at'];
  elsif tg_table_name = 'case_law_annotations' then
    v_keep := array['id', 'case_law_id', 'owner_id', 'created_at', 'updated_at'];
  elsif tg_table_name = 'docket_matter_parties' then
    v_old := v_old - 'contact_info';
    v_new := v_new - 'contact_info';
  elsif tg_table_name = 'case_law' then
    if coalesce(v_new ->> 'owner_id', v_old ->> 'owner_id') is not null then
      v_keep := array[
        'id', 'owner_id', 'created_by', 'is_discoverable', 'review_status',
        'content_quality_status', 'import_job_id', 'category_id',
        'created_at', 'updated_at'
      ];
    end if;
  elsif tg_table_name = 'documents' then
    -- Library files (statutes, canonical Case Law) and court files
    -- (docket matters, legacy cases) keep their file name; files on a
    -- private parent, on personal Case Law, or on nothing do not. A
    -- parent already deleted (the cascade from its DELETE) counts as
    -- private, failing closed.
    v_private := case coalesce(v_new ->> 'entity_type', v_old ->> 'entity_type')
      when 'statute' then false
      when 'docket_matter' then false
      when 'case' then false
      when 'case_law' then not exists (
        select 1 from public.case_law cl
        where cl.id = coalesce(v_new ->> 'entity_id', v_old ->> 'entity_id')::uuid
          and cl.owner_id is null
      )
      else true
    end;
    if v_private then
      v_keep := array[
        'id', 'uploaded_by', 'entity_type', 'entity_id', 'purpose', 'mime_type',
        'file_size', 'source_document_id', 'created_at'
      ];
    end if;
  end if;

  if v_keep is not null then
    v_old := (select jsonb_object_agg(e.key, e.value) from jsonb_each(v_old) e where e.key = any (v_keep));
    v_new := (select jsonb_object_agg(e.key, e.value) from jsonb_each(v_new) e where e.key = any (v_keep));
  end if;

  -- Privilege-only capture for profiles. The UPDATE trigger's WHEN
  -- clause already skips name/avatar noise; this slim object is what
  -- actually lands in audit_log so avatar_url never does.
  if tg_table_name = 'profiles' then
    if tg_op = 'DELETE' then
      v_old := jsonb_build_object(
        'id', old.id,
        'role', old.role,
        'is_active', old.is_active,
        'court_id', old.court_id,
        'email', old.email,
        'full_name', old.full_name
      );
    else
      if tg_op = 'UPDATE' then
        v_old := jsonb_build_object(
          'id', old.id,
          'role', old.role,
          'is_active', old.is_active,
          'court_id', old.court_id,
          'email', old.email,
          'full_name', old.full_name
        );
      end if;
      v_new := jsonb_build_object(
        'id', new.id,
        'role', new.role,
        'is_active', new.is_active,
        'court_id', new.court_id,
        'email', new.email,
        'full_name', new.full_name
      );
    end if;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (auth.uid(), 'insert', tg_table_name, new.id, v_new);
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'update', tg_table_name, new.id, v_old, v_new);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data)
    values (auth.uid(), 'delete', tg_table_name, old.id, v_old);
    return old;
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."audit_trigger_fn"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."audit_trigger_fn"() IS 'Generic AFTER INSERT/UPDATE/DELETE audit trigger, SECURITY DEFINER, search_path pinned to public. 0113: profiles writes a slim privilege payload only. 0154: that payload also carries court_id. 0162: judgments, bench_notes, quick_codes, case_law_annotations, personal case_law and documents on private or personal parents record an allowlist of metadata only (no titles, names, case numbers or file names).';



CREATE OR REPLACE FUNCTION "public"."bench_notes_entity_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_visible boolean;
  v_reference_changed boolean;
  v_statute_id uuid;
begin
  new.author_id := auth.uid();

  v_reference_changed := (tg_op = 'INSERT')
    or (new.entity_type is distinct from old.entity_type)
    or (new.entity_id is distinct from old.entity_id);

  if v_reference_changed then
    if new.entity_type = 'docket_matter' then
      v_visible := public.can_view_docket_matter(new.entity_id);
    elsif new.entity_type = 'judgment' then
      v_visible := public.can_view_judgment(new.entity_id);
    elsif new.entity_type = 'case_law' then
      v_visible := public.can_view_case_law(new.entity_id);
    elsif new.entity_type in ('statute', 'statute_provision') then
      if new.entity_type = 'statute' then
        v_statute_id := new.entity_id;
      else
        select sp.statute_id into v_statute_id
        from public.statute_provisions sp
        where sp.id = new.entity_id;
      end if;
      -- The published Act (can_view_statute), or the author's own draft,
      -- matching "Magistrates can view own draft statutes" (0157).
      v_visible := v_statute_id is not null and (
        public.can_view_statute(v_statute_id)
        or exists (
          select 1 from public.statutes s
          where s.id = v_statute_id
            and s.review_status = 'draft'
            and s.created_by = auth.uid()
            and public.is_magistrate()
            and public.has_active_magistrate_court()
        )
      );
    else
      v_visible := false;
    end if;

    -- A parent the author cannot see gets the same error as a missing one.
    if not coalesce(v_visible, false) then
      raise exception 'bench_notes.entity_id does not reference an existing % row', new.entity_type;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."bench_notes_entity_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bench_notes_entity_guard"() IS 'BEFORE INSERT OR UPDATE on bench_notes. Forces author_id to the caller. On INSERT, or when entity_type/entity_id changes, the parent must be one the author can see (0165: can_view_docket_matter / can_view_judgment / can_view_case_law / can_view_statute, or the author''s own draft Act); an invisible parent gets the same "does not reference an existing row" error as a missing one, so the guard is not an existence oracle. An ordinary edit never re-checks (0039), so a note survives losing access to, or deletion of, its parent. SECURITY DEFINER for the author_id stamp and the provision-to-Act lookup; the can_view_* helpers judge the caller.';



CREATE OR REPLACE FUNCTION "public"."btrim_whitespace"("p_text" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  -- The set String.prototype.trim() removes: ASCII whitespace (\x0b is the
  -- vertical tab; E'' strings have no \v), the no-break and other Unicode
  -- space separators, the line and paragraph separators, and the BOM.
  select pg_catalog.btrim(
    p_text,
    E' \t\n\r\x0b\f                 　﻿'
  );
$$;


ALTER FUNCTION "public"."btrim_whitespace"("p_text" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."btrim_whitespace"("p_text" "text") IS 'Trims the characters JavaScript''s String.prototype.trim() removes (0166), so the database and the forms'' zod .trim() agree on blank values and on which case numbers are the same. Used by the docket_matters case-number unique index, its CHECKs and its trimming trigger, and by the search functions.';



CREATE TABLE IF NOT EXISTS "public"."docket_matters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "court_id" "uuid" NOT NULL,
    "district_id" "uuid" NOT NULL,
    "case_number" "text" NOT NULL,
    "matter_title" "text" NOT NULL,
    "charge_or_issue" "text",
    "orders_summary" "text",
    "outcome" "text",
    "status" "public"."docket_matter_status" DEFAULT 'active'::"public"."docket_matter_status" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "last_updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", ((((((((COALESCE("case_number", ''::"text") || ' '::"text") || COALESCE("matter_title", ''::"text")) || ' '::"text") || COALESCE("charge_or_issue", ''::"text")) || ' '::"text") || COALESCE("orders_summary", ''::"text")) || ' '::"text") || COALESCE("outcome", ''::"text")))) STORED,
    "cover_image_path" "text",
    "arraignment_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "custody_status" "text" DEFAULT 'unset'::"text" NOT NULL,
    "disclosure_status" "text" DEFAULT 'none'::"text" NOT NULL,
    "trial_status" "text" DEFAULT 'not_commenced'::"text" NOT NULL,
    "ruling_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "judgment_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "sentence_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "appeal_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "category_id" "uuid",
    "category_other" "text",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "brought_forward_from" "text",
    "brought_forward_at" "date",
    "outcome_status" "text",
    "workflow_protocol" "text" DEFAULT 'criminal_trial'::"text" NOT NULL,
    "paper_committal_status" "text" DEFAULT 'not_commenced'::"text" NOT NULL,
    "information_sworn_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "summons_served" "text" DEFAULT 'unset'::"text" NOT NULL,
    "returns_of_summons" "text" DEFAULT 'unset'::"text" NOT NULL,
    "civil_trial_held" "text" DEFAULT 'unset'::"text" NOT NULL,
    "decision_granted" "text",
    "decision_amount" numeric,
    "stage_adjournments" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "outcome_adjourned" boolean DEFAULT false NOT NULL,
    "procedure_stage" "text" DEFAULT 'arraignment'::"text" NOT NULL,
    CONSTRAINT "docket_matters_appeal_status_check" CHECK (("appeal_status" = ANY (ARRAY['not_started'::"text", 'noted'::"text", 'disposed'::"text"]))),
    CONSTRAINT "docket_matters_arraignment_status_check" CHECK (("arraignment_status" = ANY (ARRAY['not_started'::"text", 'done'::"text", 'not_found'::"text"]))),
    CONSTRAINT "docket_matters_case_number_length" CHECK (("char_length"("case_number") <= 100)),
    CONSTRAINT "docket_matters_case_number_not_blank" CHECK (("public"."btrim_whitespace"("case_number") <> ''::"text")),
    CONSTRAINT "docket_matters_charge_or_issue_length" CHECK (("char_length"("charge_or_issue") <= 2000)),
    CONSTRAINT "docket_matters_civil_trial_held_check" CHECK (("civil_trial_held" = ANY (ARRAY['unset'::"text", 'yes'::"text", 'no'::"text"]))),
    CONSTRAINT "docket_matters_custody_status_check" CHECK (("custody_status" = ANY (ARRAY['unset'::"text", 'on_bail'::"text", 'remanded'::"text"]))),
    CONSTRAINT "docket_matters_decision_granted_check" CHECK ((("decision_granted" IS NULL) OR ("decision_granted" = ANY (ARRAY['granted'::"text", 'not_granted'::"text"])))),
    CONSTRAINT "docket_matters_disclosure_status_check" CHECK (("disclosure_status" = ANY (ARRAY['none'::"text", 'partial'::"text", 'full'::"text"]))),
    CONSTRAINT "docket_matters_information_sworn_status_check" CHECK (("information_sworn_status" = ANY (ARRAY['not_started'::"text", 'done'::"text"]))),
    CONSTRAINT "docket_matters_judgment_status_check" CHECK (("judgment_status" = ANY (ARRAY['not_started'::"text", 'reserved'::"text", 'delivered'::"text"]))),
    CONSTRAINT "docket_matters_matter_title_length" CHECK (("char_length"("matter_title") <= 300)),
    CONSTRAINT "docket_matters_matter_title_not_blank" CHECK (("public"."btrim_whitespace"("matter_title") <> ''::"text")),
    CONSTRAINT "docket_matters_outcome_status_check" CHECK (("outcome_status" = ANY (ARRAY['dismissed'::"text", 'completed'::"text"]))),
    CONSTRAINT "docket_matters_paper_committal_status_check" CHECK (("paper_committal_status" = ANY (ARRAY['not_commenced'::"text", 'commenced'::"text", 'partial'::"text", 'completed'::"text"]))),
    CONSTRAINT "docket_matters_procedure_stage_check" CHECK (("procedure_stage" = ANY (ARRAY['arraignment'::"text", 'custody'::"text", 'disclosure'::"text", 'trial'::"text", 'paper_committal'::"text", 'ruling'::"text", 'judgment'::"text", 'sentence'::"text", 'appeal'::"text", 'information_sworn'::"text", 'summons_served'::"text", 'returns_of_summons'::"text", 'civil_trial'::"text", 'decision'::"text"]))),
    CONSTRAINT "docket_matters_returns_of_summons_check" CHECK (("returns_of_summons" = ANY (ARRAY['unset'::"text", 'yes'::"text", 'no'::"text"]))),
    CONSTRAINT "docket_matters_ruling_status_check" CHECK (("ruling_status" = ANY (ARRAY['not_started'::"text", 'reserved'::"text", 'delivered'::"text"]))),
    CONSTRAINT "docket_matters_sentence_status_check" CHECK (("sentence_status" = ANY (ARRAY['not_started'::"text", 'passed'::"text"]))),
    CONSTRAINT "docket_matters_summons_served_check" CHECK (("summons_served" = ANY (ARRAY['unset'::"text", 'yes'::"text", 'no'::"text"]))),
    CONSTRAINT "docket_matters_trial_status_check" CHECK (("trial_status" = ANY (ARRAY['not_commenced'::"text", 'partial'::"text", 'completed'::"text"]))),
    CONSTRAINT "docket_matters_workflow_protocol_check" CHECK (("workflow_protocol" = ANY (ARRAY['criminal_trial'::"text", 'paper_committal'::"text", 'civil_summons'::"text"])))
);


ALTER TABLE "public"."docket_matters" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_matters" IS 'The operational Docket. Court-anchored: ordinary access derives from a current magistrate_courts assignment to court_id, not from created_by. No owner_id, no is_discoverable, no DELETE policy — archive via status only. See can_access_court() and the RLS policies below for the (currently single-path) access predicate.';



COMMENT ON COLUMN "public"."docket_matters"."district_id" IS 'Always derived from court_id → courts.district_id by trigger. Never client-writable in practice, regardless of what is sent.';



COMMENT ON COLUMN "public"."docket_matters"."case_number" IS 'NOT globally unique. Unique per district ignoring letter case and surrounding whitespace (docket_matters_district_case_number_unique, 0166), matching the Magisterial District''s own registry sequence. Stored trimmed; 1-100 characters.';



COMMENT ON COLUMN "public"."docket_matters"."matter_title" IS 'Concise human-readable case style/title (e.g. party names), distinct from case_number (official registry identifier) and from the future structured docket_matter_parties table. Entered directly, not derived or synchronized.';



COMMENT ON COLUMN "public"."docket_matters"."charge_or_issue" IS 'Nullable free text — may not exist at initial Docket creation. No enum/vocabulary imposed.';



COMMENT ON COLUMN "public"."docket_matters"."orders_summary" IS 'Nullable free text — may not exist at initial Docket creation.';



COMMENT ON COLUMN "public"."docket_matters"."outcome" IS 'Nullable free text — may not exist at initial Docket creation.';



COMMENT ON COLUMN "public"."docket_matters"."created_by" IS 'Provenance only. Never used for access control — see can_access_court(). Immutable after creation (enforced by trigger, not just RLS).';



COMMENT ON COLUMN "public"."docket_matters"."last_updated_by" IS 'Provenance only. Never used for access control. Trigger-populated on every UPDATE; NULL until the first update.';



COMMENT ON COLUMN "public"."docket_matters"."cover_image_path" IS 'Storage object name in the documents bucket used as the matter cover. Must correspond to a public.documents row so Storage RLS can mint a signed URL. Cleared independently of the documents row (ON DELETE is not declarative here).';



COMMENT ON COLUMN "public"."docket_matters"."arraignment_status" IS 'not_started / done / not_found. not_found (0131): the accused was not found and needs to be (re-)summoned -- still counts as arraignment not done for procedure_stage purposes.';



COMMENT ON COLUMN "public"."docket_matters"."custody_status" IS 'Procedure board: unset | on_bail | remanded. Fork after arraignment; persists through later stages.';



COMMENT ON COLUMN "public"."docket_matters"."disclosure_status" IS 'Procedure board: none | partial | full. Prosecution papers.';



COMMENT ON COLUMN "public"."docket_matters"."trial_status" IS 'Procedure board: not_commenced | partial | completed. partial = part-heard.';



COMMENT ON COLUMN "public"."docket_matters"."ruling_status" IS 'Procedure board: not_started | reserved | delivered. Oral decision.';



COMMENT ON COLUMN "public"."docket_matters"."judgment_status" IS 'Procedure board: not_started | reserved | delivered. Written reasons — pinning a Judgment document is separate.';



COMMENT ON COLUMN "public"."docket_matters"."sentence_status" IS 'Procedure board: not_started | passed.';



COMMENT ON COLUMN "public"."docket_matters"."appeal_status" IS 'Procedure board: not_started | noted | disposed.';



COMMENT ON COLUMN "public"."docket_matters"."category_id" IS 'Matter classification (Criminal trial, Paper Committal, Maintenance matter, Liability matter, Protection order matter, Other). Distinct from docket_events.category_id, which is the hearing-level capacity bucket and defaults from this column. Nullable so pre-0119 rows are not rewritten.';



COMMENT ON COLUMN "public"."docket_matters"."category_other" IS 'Free-text type when category_id points at the Other lookup row. Null for every other classification.';



COMMENT ON COLUMN "public"."docket_matters"."deleted_at" IS 'When set, the matter is in the bin and hidden from ordinary Docket lists. Permanently purged 7 days later (or sooner via purge_docket_matter). Distinct from status = archived.';



COMMENT ON COLUMN "public"."docket_matters"."deleted_by" IS 'Profile who moved the matter to the bin. Provenance only.';



COMMENT ON COLUMN "public"."docket_matters"."brought_forward_from" IS 'Free text: the predecessor magistrate, transferring court, or prior file reference this matter came from. Set only when a matter is entered mid-flow (already arraigned, part-heard, etc.). NULL for an ordinary new matter.';



COMMENT ON COLUMN "public"."docket_matters"."brought_forward_at" IS 'The date this matter entered THIS docket, which is not its commencement date. Provenance only -- never used for scheduling or capacity.';



COMMENT ON COLUMN "public"."docket_matters"."outcome_status" IS 'dismissed / completed / NULL. Board-visible disposition, settable at any procedure stage. Setting it forces status to match (docket_matters_outcome_sync trigger, below); clearing it does NOT auto-revert status -- that stays a free edit on the Overview tab. Distinct from the free-text `outcome` narrative column and from docket_callover_items.outcome (0129).';



COMMENT ON COLUMN "public"."docket_matters"."workflow_protocol" IS 'Row-local board protocol, set from category_id: criminal_trial | paper_committal | civil_summons. Other and null classification keep criminal_trial.';



COMMENT ON COLUMN "public"."docket_matters"."paper_committal_status" IS 'Paper Committal board: not_commenced | commenced | partial | completed. UI: Commenced / Partial / Completed.';



COMMENT ON COLUMN "public"."docket_matters"."information_sworn_status" IS 'Civil summons board: not_started | done.';



COMMENT ON COLUMN "public"."docket_matters"."summons_served" IS 'Civil summons board: unset | yes | no. no keeps the file at this stage.';



COMMENT ON COLUMN "public"."docket_matters"."returns_of_summons" IS 'Civil summons board: unset | yes | no. no keeps the file at this stage.';



COMMENT ON COLUMN "public"."docket_matters"."civil_trial_held" IS 'Civil summons board: unset | yes | no. Either yes or no completes the stage; unset keeps the pointer here.';



COMMENT ON COLUMN "public"."docket_matters"."decision_granted" IS 'Protection order Decision: granted | not_granted | null.';



COMMENT ON COLUMN "public"."docket_matters"."decision_amount" IS 'Maintenance = amount ordered; Liability = amount paid. Null until entered.';



COMMENT ON COLUMN "public"."docket_matters"."stage_adjournments" IS 'Per-stage adjournment map { stage: { adjourned, reason } }. Not a board column. Used by the civil summons protocol.';



COMMENT ON COLUMN "public"."docket_matters"."outcome_adjourned" IS 'Civil Outcome Adjourned. Must not be stored on outcome_status: 0131 would force docket_matters.status to an invalid enum. Completed still uses outcome_status.';



COMMENT ON COLUMN "public"."docket_matters"."procedure_stage" IS 'Current stage for list filters. Set by docket_matters_set_workflow_protocol from workflow_protocol; matches src/lib/docket-protocols.ts currentStageForProtocol(). Completing the board does not change docket_matter_status.';



CREATE OR REPLACE FUNCTION "public"."bin_docket_matter"("p_id" "uuid") RETURNS "public"."docket_matters"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.docket_matters;
begin
  if p_id is null then
    raise exception 'Matter id is required.';
  end if;

  if not public.has_docket_matter_authority(p_id) then
    raise exception 'You do not have permission to delete this matter.';
  end if;

  select * into v_row from public.docket_matters where id = p_id for update;
  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  if v_row.deleted_at is not null then
    return v_row;
  end if;

  update public.docket_matters
  set deleted_at = now(),
      deleted_by = (select auth.uid())
  where id = p_id
  returning * into v_row;

  perform public.notify_court_staff_except(
    v_row.court_id,
    (select auth.uid()),
    'docket_matter_binned',
    'Matter moved to the bin',
    coalesce(v_row.case_number || ' · ', '') || coalesce(v_row.matter_title, 'A matter')
      || ' is in the bin and will be permanently deleted after 7 days unless it is restored.',
    '/docket/' || v_row.id::text
  );

  return v_row;
end;
$$;


ALTER FUNCTION "public"."bin_docket_matter"("p_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bin_docket_matter"("p_id" "uuid") IS 'Moves a Docket Matter to the bin, stamping deleted_at = now() and deleted_by = auth.uid(). Requires has_docket_matter_authority (court or retained assignment; never a share or a clerk attachment). Tells the court''s other staff. No-op if already binned. SECURITY DEFINER so it is the only writer of the bin columns (0161).';



CREATE OR REPLACE FUNCTION "public"."callover_provenance_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.last_updated_by := null;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.last_updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."callover_provenance_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."callover_provenance_guard"() IS 'Forces created_by/created_at on INSERT and last_updated_by on UPDATE for both callover tables, so a client can never claim authorship of a sitting record. Mirrors docket_matters_guard()''s own provenance handling.';



CREATE OR REPLACE FUNCTION "public"."can_access_callover"("p_callover_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.docket_callovers co
    where co.id = p_callover_id
      and ((select public.can_access_court(co.court_id)) or (select public.is_admin()))
  );
$$;


ALTER FUNCTION "public"."can_access_callover"("p_callover_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_access_callover"("p_callover_id" "uuid") IS 'True if the caller currently sits (or administers) the court a callover belongs to. SECURITY DEFINER so docket_callover_items'' RLS can consult its parent without recursing through the parent''s own policy.';



CREATE OR REPLACE FUNCTION "public"."can_access_court"("p_court_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select (select public.is_active_account()) and exists (
    select 1 from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.profile_id = auth.uid()
      and mc.ended_at is null
  );
$$;


ALTER FUNCTION "public"."can_access_court"("p_court_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_access_court"("p_court_id" "uuid") IS 'True if the authenticated user has a current (ended_at IS NULL) magistrate_courts assignment to the given court. Does not check courts.is_active — new-entry availability only, never a historical-access gate. This is currently the ONLY implemented Docket access path; has_retained_assignment() and the shares-based path are added by later migrations per the approved incremental RLS plan.';



CREATE OR REPLACE FUNCTION "public"."can_attach_preview_derivative"("p_source_document_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.documents d
    where d.id = p_source_document_id
      and d.purpose <> 'preview_derivative'
      and d.entity_type is not distinct from p_entity_type
      and d.entity_id is not distinct from p_entity_id
      and (
        d.uploaded_by = (select auth.uid())
        or (d.entity_type = 'docket_matter' and public.can_view_docket_matter(d.entity_id))
        or (d.entity_type = 'judgment' and public.can_view_judgment(d.entity_id))
        or (d.entity_type = 'case_law' and public.can_view_case_law(d.entity_id))
        or (d.entity_type = 'quick_code' and exists (select 1 from public.quick_codes qc where qc.id = d.entity_id))
        or (d.entity_type = 'bench_note' and exists (select 1 from public.bench_notes bn where bn.id = d.entity_id))
        or (d.entity_type = 'case' and exists (select 1 from public.cases c where c.id = d.entity_id))
        or (d.entity_type = 'statute' and public.can_view_statute(d.entity_id))
      )
  );
$$;


ALTER FUNCTION "public"."can_attach_preview_derivative"("p_source_document_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_attach_preview_derivative"("p_source_document_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") IS 'SECURITY DEFINER (0085) -- backs the preview-derivative INSERT policy on documents. Mirrors "Users can view documents they have access to" (0055) for the SOURCE document, plus requires the new row''s entity_type/entity_id to match the source''s exactly. Runs as a function (not an inline same-table subquery) specifically so Postgres does not reject the owning policy as self-referentially recursive (42P17) -- see this migration''s header.';



CREATE OR REPLACE FUNCTION "public"."can_edit_case_law"("p_case_law_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.case_law cl
    where cl.id = p_case_law_id
      and not (select public.is_clerk())
      and (
        (cl.owner_id is null and public.is_admin())
        or cl.owner_id = (select auth.uid())
        or public.has_item_share('case_law', p_case_law_id, 'edit')
      )
  );
$$;


ALTER FUNCTION "public"."can_edit_case_law"("p_case_law_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_edit_case_law"("p_case_law_id" "uuid") IS 'Case Law edit envelope: admin on canonical, owner on personal, or active edit share on personal. Clerks denied. Admin still cannot edit another user''s personal row merely by being admin.';



CREATE OR REPLACE FUNCTION "public"."can_edit_docket_matter"("p_docket_matter_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.docket_matters dm
    where dm.id = p_docket_matter_id
      and (
        public.can_access_court(dm.court_id)
        or public.has_retained_assignment(dm.id)
        or public.has_docket_share(dm.id, 'edit')
        or public.has_active_clerk_assignment(dm.court_id)
      )
  );
$$;


ALTER FUNCTION "public"."can_edit_docket_matter"("p_docket_matter_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_edit_docket_matter"("p_docket_matter_id" "uuid") IS 'Docket edit envelope: current magistrate Court assignment OR retained assignment OR an active EDIT Docket share OR (0090) an active clerk_courts assignment to the matter''s exact court -- an approved clerk has full operational edit parity at their approved court, exactly like a magistrate, via this one additive branch. No admin bypass, no DELETE implication (Docket Matters have no DELETE policy).';



CREATE OR REPLACE FUNCTION "public"."can_edit_judgment"("p_judgment_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.judgments j
    where j.id = p_judgment_id
      and not (select public.is_clerk())
      and (
        j.owner_id = (select auth.uid())
        or public.has_item_share('judgment', p_judgment_id, 'edit')
      )
  );
$$;


ALTER FUNCTION "public"."can_edit_judgment"("p_judgment_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_edit_judgment"("p_judgment_id" "uuid") IS 'Judgment edit envelope: owner OR active edit share. Clerks denied. Lifecycle locking (0045) remains a separate trigger, not folded in here.';



CREATE OR REPLACE FUNCTION "public"."can_manage_clerk_access"("p_court_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select (select public.is_admin()) or ((select public.is_active_account()) and exists (
    select 1 from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.profile_id = (select auth.uid())
      and mc.ended_at is null
      and (
        mc.can_manage_clerks = true
        or (
          select count(*) from public.magistrate_courts mc2
          where mc2.court_id = p_court_id and mc2.ended_at is null
        ) = 1
        or (
          mc.assignment_type = 'regular'
          and (
            select count(*) from public.magistrate_courts mc3
            where mc3.court_id = p_court_id
              and mc3.ended_at is null
              and mc3.assignment_type = 'regular'
          ) = 1
        )
      )
  ));
$$;


ALTER FUNCTION "public"."can_manage_clerk_access"("p_court_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_manage_clerk_access"("p_court_id" "uuid") IS 'True if the caller may review Clerk access requests for this court: a Court Assignment Administrator (any court), or a currently assigned magistrate who is flagged can_manage_clerks, the sole sitting of any type, or the unique current primary (regular) even when acting/relief also sit. SECURITY DEFINER so inner counts see every current row.';



CREATE OR REPLACE FUNCTION "public"."can_receive_research_share"("p_profile_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.is_active
      and p.role <> 'clerk'
      and (
        p.role <> 'magistrate'
        or exists (
          select 1 from public.magistrate_courts mc
          where mc.profile_id = p.id and mc.ended_at is null
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_receive_research_share"("p_profile_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_receive_research_share"("p_profile_id" "uuid") IS 'Whether a profile can read a Judgment or personal Case Law through a share: active, not a clerk, and a magistrate only while they sit a court. The recipient half of can_view_judgment / can_view_case_law (0093, 0117), evaluated for someone other than the caller (0165). Internal: used by the share resolver, shares_recipient_guard() and judgments_notify_final().';



CREATE OR REPLACE FUNCTION "public"."can_view_case_law"("p_case_law_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.case_law cl
    where cl.id = p_case_law_id
      and (select auth.uid()) is not null
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (
        (cl.owner_id is null and (cl.review_status = 'published' or (select public.is_admin())))
        or cl.owner_id = (select auth.uid())
        or (cl.owner_id is not null and cl.is_discoverable = true)
        or public.has_item_share('case_law', p_case_law_id, 'view')
      )
  );
$$;


ALTER FUNCTION "public"."can_view_case_law"("p_case_law_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_view_case_law"("p_case_law_id" "uuid") IS 'The Case Law read envelope for a signed-in, non-clerk caller (magistrates need an active court): published canonical rows (any review status for an admin), the caller''s own personal rows, discoverable personal rows, and rows shared with them. No admin read path into another user''s personal research (ADR 0007). 0160: false with no auth.uid(). 0162: unpublished canonical rows are admin-only again, as in 0058.';



CREATE OR REPLACE FUNCTION "public"."can_view_docket_matter"("p_docket_matter_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.docket_matters dm
    where dm.id = p_docket_matter_id
      and (
        public.can_access_court(dm.court_id)
        or public.has_retained_assignment(dm.id)
        or public.has_docket_share(dm.id, 'view')
        or public.has_active_clerk_assignment(dm.court_id)
      )
  );
$$;


ALTER FUNCTION "public"."can_view_docket_matter"("p_docket_matter_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_view_docket_matter"("p_docket_matter_id" "uuid") IS 'Docket read envelope: current magistrate Court assignment OR retained/part-heard assignment OR an active view/edit Docket share OR (0090) an active clerk_courts assignment to the matter''s exact court. No admin bypass. The clerk branch is a wholly separate, additive pathway -- it never grants Case Law/Judgment access, which have no equivalent branch.';



CREATE OR REPLACE FUNCTION "public"."can_view_judgment"("p_judgment_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.judgments j
    where j.id = p_judgment_id
      and (select auth.uid()) is not null
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (
        j.owner_id = (select auth.uid())
        or j.is_discoverable = true
        or public.has_item_share('judgment', p_judgment_id, 'view')
      )
  );
$$;


ALTER FUNCTION "public"."can_view_judgment"("p_judgment_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_view_judgment"("p_judgment_id" "uuid") IS 'Judgment read envelope: owner OR discoverable OR active share — EXCEPT a clerk (0093) or a magistrate with no currently-active Court (0117).';



CREATE OR REPLACE FUNCTION "public"."can_view_statute"("p_statute_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.statutes s
    where s.id = p_statute_id
      and (select auth.uid()) is not null
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (s.review_status = 'published' or public.is_admin())
  );
$$;


ALTER FUNCTION "public"."can_view_statute"("p_statute_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_view_statute"("p_statute_id" "uuid") IS 'Statute (Legislation) read envelope: published OR admin -- EXCEPT a clerk (always denied, 0093) or a magistrate with no currently-active Court (0117). Admin is unaffected by the Court condition (both the review_status branch and this one).';



CREATE TABLE IF NOT EXISTS "public"."clerk_access_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "court_id" "uuid" NOT NULL,
    "status" "public"."clerk_access_request_status" DEFAULT 'pending'::"public"."clerk_access_request_status" NOT NULL,
    "staff_id" "text",
    "note" "text",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "rejection_reason" "text",
    "cancelled_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "notified_magistrate_at" timestamp with time zone,
    "notified_clerk_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clerk_access_requests_cancelled_iff_cancelled" CHECK ((("cancelled_at" IS NOT NULL) = ("status" = 'cancelled'::"public"."clerk_access_request_status"))),
    CONSTRAINT "clerk_access_requests_expiry_only_while_relevant" CHECK ((("expires_at" IS NULL) OR ("status" = ANY (ARRAY['pending'::"public"."clerk_access_request_status", 'expired'::"public"."clerk_access_request_status"])))),
    CONSTRAINT "clerk_access_requests_rejection_reason_iff_rejected" CHECK ((("rejection_reason" IS NULL) OR ("status" = 'rejected'::"public"."clerk_access_request_status"))),
    CONSTRAINT "clerk_access_requests_reviewed_iff_decided" CHECK (((("status" = ANY (ARRAY['approved'::"public"."clerk_access_request_status", 'rejected'::"public"."clerk_access_request_status"])) AND ("reviewed_at" IS NOT NULL) AND ("reviewed_by" IS NOT NULL)) OR (("status" <> ALL (ARRAY['approved'::"public"."clerk_access_request_status", 'rejected'::"public"."clerk_access_request_status"])) AND ("reviewed_at" IS NULL) AND ("reviewed_by" IS NULL))))
);


ALTER TABLE "public"."clerk_access_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."clerk_access_requests" IS 'One row per (clerk, court) court-access request -- every requested court is reviewed and decided independently (see the partial unique index below). Ordinary clerks reach this table only through submit_clerk_access_request()/cancel_clerk_access_request() (SECURITY DEFINER) and signup-time creation in handle_new_user() -- there is no direct client INSERT/UPDATE policy for clerks or magistrates, so status/reviewer/decision fields cannot be altered by a raw Supabase call.';



COMMENT ON COLUMN "public"."clerk_access_requests"."staff_id" IS 'Optional employee/staff identification number, as supplied at request time.';



COMMENT ON COLUMN "public"."clerk_access_requests"."note" IS 'Optional short free-text note (e.g. clerk''s office or the magistrate they expect to work under).';



COMMENT ON COLUMN "public"."clerk_access_requests"."notified_magistrate_at" IS 'Set by the clerk-access-notify Edge Function after it independently re-verifies and sends the magistrate notification email -- never client-writable.';



COMMENT ON COLUMN "public"."clerk_access_requests"."notified_clerk_at" IS 'Set by the clerk-access-notify Edge Function after it independently re-verifies and sends the clerk decision notification email -- never client-writable.';



CREATE OR REPLACE FUNCTION "public"."cancel_clerk_access_request"("p_request_id" "uuid") RETURNS "public"."clerk_access_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result public.clerk_access_requests;
begin
  update public.clerk_access_requests
  set status = 'cancelled', cancelled_at = now()
  where id = p_request_id
    and status = 'pending'
    and (
      profile_id = (select auth.uid())
      or (select public.is_admin())
    )
  returning * into v_result;

  if v_result.id is null then
    raise exception 'This request cannot be cancelled (not found, not yours, or no longer pending)';
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."cancel_clerk_access_request"("p_request_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cancel_clerk_access_request"("p_request_id" "uuid") IS 'Cancels one still-pending clerk access request. The clerk who owns it, or a Court Assignment Administrator, may call this. No effect on any other request or on an already-approved clerk_courts row.';



CREATE OR REPLACE FUNCTION "public"."cancel_magistrate_court_request"("p_request_id" "uuid") RETURNS "public"."magistrate_court_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result public.magistrate_court_requests;
begin
  update public.magistrate_court_requests
  set status = 'cancelled', cancelled_at = now()
  where id = p_request_id
    and status = 'pending'
    and (
      profile_id = (select auth.uid())
      or (select public.is_admin())
    )
  returning * into v_result;

  if v_result.id is null then
    raise exception 'This request cannot be cancelled (not found, not yours, or no longer pending)';
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."cancel_magistrate_court_request"("p_request_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cancel_magistrate_court_request"("p_request_id" "uuid") IS 'Cancels one still-pending magistrate court request. The requester, or a Court Assignment Administrator, may call this. No effect on any other request or on an already-approved assignment.';



CREATE OR REPLACE FUNCTION "public"."capture_judgment_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  next_n integer;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.title is not distinct from new.title
     and old.case_number is not distinct from new.case_number
     and old.citation is not distinct from new.citation
     and old.court_name is not distinct from new.court_name
     and old.judgment_date is not distinct from new.judgment_date
     and old.content is not distinct from new.content
     and old.content_text is not distinct from new.content_text then
    return new;
  end if;

  select coalesce(max(v.version_number), 0) + 1
    into next_n
  from public.judgment_versions v
  where v.judgment_id = old.id;

  insert into public.judgment_versions (
    judgment_id,
    version_number,
    title,
    case_number,
    citation,
    court_name,
    judgment_date,
    content,
    content_text,
    created_by
  ) values (
    old.id,
    next_n,
    old.title,
    old.case_number,
    old.citation,
    old.court_name,
    old.judgment_date,
    old.content,
    old.content_text,
    (select auth.uid())
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."capture_judgment_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."case_law_annotations_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := (select auth.uid());
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'A Case Law Annotation''s owner_id is immutable; ownership cannot be transferred by UPDATE.';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."case_law_annotations_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."case_law_counts_by_category"("p_query" "text" DEFAULT NULL::"text", "p_court_id" "uuid" DEFAULT NULL::"uuid", "p_jurisdiction_id" "uuid" DEFAULT NULL::"uuid", "p_tag_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("category_id" "uuid", "result_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with matched as (
    select c.* from public.case_law c
    where p_query is null or p_query = ''
    union all
    select c.* from private.case_law_search_hits(p_query) h
    join public.case_law c on c.id = h.id
  )
  select cl.category_id, count(*) as result_count
  from matched cl
  where cl.category_id is not null
    and (cl.owner_id is not null or p_court_id is null or cl.court_id = p_court_id)
    and (cl.owner_id is not null or p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  group by cl.category_id;
$$;


ALTER FUNCTION "public"."case_law_counts_by_category"("p_query" "text", "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_tag_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."case_law_counts_by_category"("p_query" "text", "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_tag_id" "uuid") IS 'RLS-respecting, cross-filtered result counts per category (0084). 0171: private.case_law_search_hits.';



CREATE OR REPLACE FUNCTION "public"."case_law_counts_by_court"("p_query" "text" DEFAULT NULL::"text", "p_jurisdiction_id" "uuid" DEFAULT NULL::"uuid", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_tag_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("court_id" "uuid", "result_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with matched as (
    select c.* from public.case_law c
    where p_query is null or p_query = ''
    union all
    select c.* from private.case_law_search_hits(p_query) h
    join public.case_law c on c.id = h.id
  )
  select cl.court_id, count(*) as result_count
  from matched cl
  where cl.owner_id is null
    and cl.court_id is not null
    and (p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_category_id is null or cl.category_id = p_category_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  group by cl.court_id;
$$;


ALTER FUNCTION "public"."case_law_counts_by_court"("p_query" "text", "p_jurisdiction_id" "uuid", "p_category_id" "uuid", "p_tag_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."case_law_counts_by_court"("p_query" "text", "p_jurisdiction_id" "uuid", "p_category_id" "uuid", "p_tag_id" "uuid") IS 'RLS-respecting, cross-filtered result counts per court (0084). 0171: the same private.case_law_search_hits match as search_case_law_scoped, so a facet never shows an option the search would then return zero results for, or vice versa.';



CREATE OR REPLACE FUNCTION "public"."case_law_counts_by_jurisdiction"("p_query" "text" DEFAULT NULL::"text", "p_court_id" "uuid" DEFAULT NULL::"uuid", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_tag_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("jurisdiction_id" "uuid", "result_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with matched as (
    select c.* from public.case_law c
    where p_query is null or p_query = ''
    union all
    select c.* from private.case_law_search_hits(p_query) h
    join public.case_law c on c.id = h.id
  )
  select cl.jurisdiction_id, count(*) as result_count
  from matched cl
  where cl.owner_id is null
    and cl.jurisdiction_id is not null
    and (p_court_id is null or cl.court_id = p_court_id)
    and (p_category_id is null or cl.category_id = p_category_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  group by cl.jurisdiction_id;
$$;


ALTER FUNCTION "public"."case_law_counts_by_jurisdiction"("p_query" "text", "p_court_id" "uuid", "p_category_id" "uuid", "p_tag_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."case_law_counts_by_jurisdiction"("p_query" "text", "p_court_id" "uuid", "p_category_id" "uuid", "p_tag_id" "uuid") IS 'Same shape/semantics as case_law_counts_by_court, keyed on jurisdiction_id (0171: private.case_law_search_hits).';



CREATE OR REPLACE FUNCTION "public"."case_law_matches_query"("p_case_name" "text", "p_citation" "text", "p_search_vector" "tsvector", "p_query" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select case
    -- No query is the browse listing (search_case_law_scoped, the facet
    -- counts), exactly as 0112.
    when p_query is null or p_query = '' then true
    -- Only whitespace is not a query, and matches nothing.
    when public.btrim_whitespace(p_query) = '' then false
    else
      p_search_vector @@ websearch_to_tsquery('english', public.btrim_whitespace(p_query))
      or extensions.similarity(p_case_name, public.btrim_whitespace(p_query)) > 0.3
      or p_case_name ilike '%' || public.escape_like_pattern(public.btrim_whitespace(p_query)) || '%'
      or p_citation ilike '%' || public.escape_like_pattern(public.btrim_whitespace(p_query)) || '%'
  end;
$$;


ALTER FUNCTION "public"."case_law_matches_query"("p_case_name" "text", "p_citation" "text", "p_search_vector" "tsvector", "p_query" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."case_law_matches_query"("p_case_name" "text", "p_citation" "text", "p_search_vector" "tsvector", "p_query" "text") IS 'Single-row case_law match predicate (0112, 0166). No search surface calls it since 0171: they all use private.case_law_search_hits, which applies the same rule through the indexes. Kept for compatibility; change both together.';



CREATE OR REPLACE FUNCTION "public"."case_law_ownership_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.owner_id is null then
      if not (select public.is_admin()) then
        raise exception 'Only administrators may create canonical (owner_id IS NULL) Case Law records. Submit owner_id as your own profile to create a personal Case Law record instead.';
      end if;
    else
      new.owner_id := v_actor;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'Case Law ownership is immutable: a canonical record cannot become personal, a personal record cannot become canonical, and personal ownership cannot be transferred, through UPDATE.';
    end if;

    -- 0162: who can see personal research, and its review status, are
    -- ownership decisions. An active EDIT share (can_edit_case_law, the
    -- UPDATE policy) may edit content only. auth.uid() IS NULL (service
    -- role / cron, which bypasses RLS anyway) is deliberately not blocked.
    if v_actor is not null
       and old.owner_id is not null
       and old.owner_id <> v_actor
       and (
         new.is_discoverable is distinct from old.is_discoverable
         or new.review_status is distinct from old.review_status
       )
    then
      raise exception 'Only the owner of this Case Law research may change its discoverability or review status.';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."case_law_ownership_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."case_law_ownership_guard"() IS 'Case Law ownership guard (0035): canonical inserts are admin-only, personal inserts are stamped with the caller, owner_id is immutable. 0162: is_discoverable and review_status changes on a personal row raise unless auth.uid() is the owner (an edit-share recipient may edit content only). Service-role context (auth.uid() null) untouched.';



CREATE OR REPLACE FUNCTION "public"."case_law_search_rank"("p_case_name" "text", "p_search_vector" "tsvector", "p_query" "text") RETURNS real
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_query is null or public.btrim_whitespace(p_query) = '' then 0::real
    else greatest(
      ts_rank(p_search_vector, websearch_to_tsquery('english', public.btrim_whitespace(p_query))),
      extensions.similarity(p_case_name, public.btrim_whitespace(p_query)),
      case
        when p_case_name ilike '%' || public.escape_like_pattern(public.btrim_whitespace(p_query)) || '%'
        then 0.5
        else 0
      end
    )
  end;
$$;


ALTER FUNCTION "public"."case_law_search_rank"("p_case_name" "text", "p_search_vector" "tsvector", "p_query" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."case_law_search_rank"("p_case_name" "text", "p_search_vector" "tsvector", "p_query" "text") IS 'Relevance score for case_law search (0112, 0166): greatest of full-text ts_rank, trigram similarity to case_name, and a 0.5 floor for a literal case-name substring hit (the query trimmed, with %, _ and \ escaped). Used by search_case_law, search_case_law_scoped, and global_search''s case_law branch.';



CREATE OR REPLACE FUNCTION "public"."case_law_title_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.case_name := public.format_case_law_title(new.case_name);
  return new;
end;
$$;


ALTER FUNCTION "public"."case_law_title_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_court_active_for_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_is_active boolean;
begin
  if new.ended_at is null then
    select is_active into v_is_active from public.courts where id = new.court_id;
    if not coalesce(v_is_active, false) then
      raise exception 'Cannot create or maintain a current magistrate_courts assignment to an inactive court (court_id = %)', new.court_id;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_court_active_for_assignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_primary_magistrate_exclusivity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.assignment_type is distinct from 'regular' then
    return new;
  end if;
  if new.ended_at is not null then
    return new;
  end if;
  if not coalesce(new.occupies_primary_slot, false) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.court_id::text, 0));

  if exists (
    select 1
    from public.magistrate_courts mc
    where mc.court_id = new.court_id
      and mc.assignment_type = 'regular'
      and mc.ended_at is null
      and mc.occupies_primary_slot
      and mc.id is distinct from new.id
  ) then
    raise exception 'This court already has an active primary magistrate assignment -- cannot approve.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."check_primary_magistrate_exclusivity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_primary_magistrate_exclusivity"() IS 'Blocks a second occupying (signed-in) regular magistrate at the same court. Never-logged-in regulars and acting/relief/other sittings are exempt. Takes a per-court advisory lock. Raises 23505.';



CREATE OR REPLACE FUNCTION "public"."claim_primary_slot_on_first_sign_in"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_profile_id uuid;
  v_ended record;
  v_court_name text;
  v_person text;
begin
  if new.event_type is distinct from 'login_success' then
    return new;
  end if;

  v_profile_id := new.actor_id;
  if v_profile_id is null and new.email is not null then
    select p.id into v_profile_id
    from public.profiles p
    where lower(p.email) = lower(new.email)
    limit 1;
  end if;
  if v_profile_id is null then
    return new;
  end if;

  for v_ended in
    update public.magistrate_courts mc
    set ended_at = now(),
        ended_by = v_profile_id,
        end_reason = 'Ended automatically: this court already has a signed-in primary magistrate'
    where mc.profile_id = v_profile_id
      and mc.assignment_type = 'regular'
      and mc.ended_at is null
      and exists (
        select 1
        from public.magistrate_courts o
        where o.court_id = mc.court_id
          and o.assignment_type = 'regular'
          and o.ended_at is null
          and o.occupies_primary_slot
          and o.profile_id is distinct from v_profile_id
      )
    returning mc.id, mc.court_id, mc.profile_id, mc.end_reason
  loop
    select c.name into v_court_name from public.courts c where c.id = v_ended.court_id;
    select coalesce(p.full_name, p.email) into v_person
    from public.profiles p where p.id = v_ended.profile_id;

    perform public.notify_user(
      v_ended.profile_id,
      'court_ended',
      'Your court assignment ended',
      coalesce(v_court_name, 'A court') || ': ' || v_ended.end_reason
        || '. Request the court again as a special exception, or another court, under Court Assignments.',
      '/court-assignments'
    );
    perform public.notify_admins(
      'court_ended',
      'A court assignment ended automatically',
      coalesce(v_person, 'A magistrate') || ' was not seated at ' || coalesce(v_court_name, 'a court')
        || ' on first sign-in: ' || v_ended.end_reason || '.',
      '/admin/court-assignments?court=' || v_ended.court_id::text
    );
  end loop;

  update public.magistrate_courts mc
  set updated_at = now()
  where mc.profile_id = v_profile_id
    and mc.assignment_type = 'regular'
    and mc.ended_at is null;

  return new;
end;
$$;


ALTER FUNCTION "public"."claim_primary_slot_on_first_sign_in"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_webhook_deliveries"("p_limit" integer DEFAULT 25) RETURNS TABLE("id" "uuid", "event" "text", "payload" "jsonb", "attempts" integer, "url" "text", "secret" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  update public.webhook_outbox o
     set status = 'skipped',
         locked_at = null,
         last_error = 'Endpoint inactive when the delivery fell due'
    from public.webhook_endpoints e
   where e.id = o.endpoint_id
     and not e.active
     and (
       (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_at < now() - interval '5 minutes')
     );

  return query
  with due as (
    select o.id
    from public.webhook_outbox o
    join public.webhook_endpoints e on e.id = o.endpoint_id and e.active
    where (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_at < now() - interval '5 minutes')
    order by o.next_attempt_at, o.created_at
    limit v_limit
    for update of o skip locked
  ),
  claimed as (
    update public.webhook_outbox o
       set status = 'sending',
           locked_at = now()
      from due
     where o.id = due.id
    returning o.id, o.endpoint_id, o.event, o.payload, o.attempts
  )
  select c.id, c.event, c.payload, c.attempts, e.url, e.secret
  from claimed c
  join public.webhook_endpoints e on e.id = c.endpoint_id;
end;
$$;


ALTER FUNCTION "public"."claim_webhook_deliveries"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_webhook_deliveries"("p_limit" integer) IS 'Called by the webhook-dispatch Edge Function (0180). Marks due rows of inactive endpoints skipped, then moves up to p_limit (1-100) due rows of active endpoints to sending under FOR UPDATE SKIP LOCKED and returns them with the endpoint URL and secret. A row sending for over five minutes is due again. Service role only.';



CREATE OR REPLACE FUNCTION "public"."clerk_access_request_email_confirmed"("p_request_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.clerk_access_requests r
    join auth.users u on u.id = r.profile_id
    where r.id = p_request_id and u.email_confirmed_at is not null
  );
$$;


ALTER FUNCTION "public"."clerk_access_request_email_confirmed"("p_request_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."clerk_access_request_email_confirmed"("p_request_id" "uuid") IS 'True only if the clerk who owns clerk_access_requests row p_request_id has a confirmed email (auth.users.email_confirmed_at is not null). Scoped to one specific existing request id, not a general profile-email-status lookup. Used to keep an unverified clerk''s request invisible to the reviewing magistrate and un-notified, regardless of the project''s auth confirmation setting.';



CREATE OR REPLACE FUNCTION "public"."clerk_access_requests_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_court text;
begin
  select name into v_court from public.courts where id = new.court_id;

  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_court_staff(
      new.court_id,
      'clerk_request',
      'Clerk access request',
      coalesce(v_court, 'A clerk requested court access.'),
      '/clerk-access-requests'
    );
    perform public.notify_admins(
      'clerk_request',
      'Clerk access request',
      coalesce(v_court, 'A clerk requested court access.'),
      '/admin/clerk-access'
    );
  elsif tg_op = 'UPDATE'
    and old.status = 'pending'
    and new.status in ('approved', 'rejected')
  then
    perform public.notify_user(
      new.profile_id,
      'clerk_request_decided',
      'Your clerk access request was ' || new.status,
      coalesce(v_court, 'See Clerk Access for details.'),
      '/clerk-access'
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."clerk_access_requests_notify"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clerk_profiles_for_review"("p_profile_ids" "uuid"[]) RETURNS TABLE("id" "uuid", "full_name" "text", "email" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id, p.full_name, p.email
  from public.profiles p
  where p.id = any (p_profile_ids)
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.clerk_access_requests r
        where r.profile_id = p.id and public.can_manage_clerk_access(r.court_id)
      )
      or exists (
        select 1 from public.clerk_courts cc
        where cc.profile_id = p.id and public.can_manage_clerk_access(cc.court_id)
      )
    );
$$;


ALTER FUNCTION "public"."clerk_profiles_for_review"("p_profile_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."clerk_profiles_for_review"("p_profile_ids" "uuid"[]) IS 'Returns id/full_name/email for each requested profile id that is (a) a clerk with a request or assignment at a court the CALLER currently manages, or (b) any profile at all if the caller is_admin(). Every other id is silently omitted, not erroring. Never exposes role, court_id, staff_id, or any field beyond name/email. Does not alter profiles'' own RLS.';



CREATE OR REPLACE FUNCTION "public"."correct_unassigned_account_type"("p_profile_id" "uuid", "p_new_role" "public"."user_role", "p_reason" "text") RETURNS "public"."user_role"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role public.user_role;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
  v_link text;
  v_title text;
begin
  if not (select public.is_admin()) then
    raise exception 'You are not currently authorized to correct account types';
  end if;

  if p_profile_id is null then
    raise exception 'Profile is required';
  end if;

  if p_profile_id = (select auth.uid()) then
    raise exception 'You cannot correct your own account type from this screen';
  end if;

  if v_reason is null then
    raise exception 'A reason is required so the person knows why their account type changed';
  end if;

  if p_new_role is null or p_new_role not in ('magistrate', 'clerk') then
    raise exception 'Account type can only be corrected between magistrate and clerk';
  end if;

  select role into v_role
  from public.profiles
  where id = p_profile_id
  for update;

  if v_role is null then
    raise exception 'Profile not found';
  end if;

  if v_role not in ('magistrate', 'clerk') then
    raise exception 'Only a magistrate or clerk account can be corrected this way';
  end if;

  if v_role = p_new_role then
    raise exception 'This account is already that type';
  end if;

  if exists (
    select 1
    from public.magistrate_courts
    where profile_id = p_profile_id
      and ended_at is null
  ) then
    raise exception 'End their magistrate court assignment before correcting the account type';
  end if;

  if exists (
    select 1
    from public.clerk_courts
    where profile_id = p_profile_id
      and ended_at is null
  ) then
    raise exception 'End their clerk court access before correcting the account type';
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_profile_id;

  -- Cancel, do not reject: rejected would notify them to request again
  -- as the old role (magistrate_court_requests_notify / clerk_access_requests_notify).
  update public.magistrate_court_requests
  set status = 'cancelled',
      cancelled_at = v_now
  where profile_id = p_profile_id
    and status = 'pending';

  update public.clerk_access_requests
  set status = 'cancelled',
      cancelled_at = v_now
  where profile_id = p_profile_id
    and status = 'pending';

  if p_new_role = 'clerk' then
    v_link := '/clerk-access';
    v_title := 'Your account type was corrected to Court Clerk';
  else
    v_link := '/court-assignments';
    v_title := 'Your account type was corrected to Magistrate';
  end if;

  perform public.notify_user(
    p_profile_id,
    'account_type_corrected',
    v_title,
    trim(both from concat_ws(
      ' ',
      v_reason,
      'Refresh or sign in again, then request access on the correct page.'
    )),
    v_link
  );

  return p_new_role;
end;
$$;


ALTER FUNCTION "public"."correct_unassigned_account_type"("p_profile_id" "uuid", "p_new_role" "public"."user_role", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."correct_unassigned_account_type"("p_profile_id" "uuid", "p_new_role" "public"."user_role", "p_reason" "text") IS 'Admin-only recovery for a magistrate/clerk signup mistake. Flips profiles.role between magistrate and clerk when the person has no active magistrate_courts or clerk_courts row. Cancels pending requests of either type so they leave the old queue, and notifies them to continue on the matching page. Never converts to/from admin, never acts on the caller''s own profile. Role change is captured by the existing profiles privilege audit trigger (0113).';



CREATE OR REPLACE FUNCTION "public"."court_has_active_primary_magistrate"("p_court_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.assignment_type = 'regular'
      and mc.ended_at is null
      and mc.occupies_primary_slot
  );
$$;


ALTER FUNCTION "public"."court_has_active_primary_magistrate"("p_court_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."court_has_active_primary_magistrate"("p_court_id" "uuid") IS 'True when a signed-in primary (regular) magistrate currently sits this court. Pending requests and never-logged-in regulars do not count.';



CREATE OR REPLACE FUNCTION "public"."court_has_no_clerk_approver"("p_court_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select not exists (
    select 1 from public.magistrate_courts mc
    where mc.court_id = p_court_id
      and mc.ended_at is null
      and (
        mc.can_manage_clerks = true
        or (
          select count(*) from public.magistrate_courts mc2
          where mc2.court_id = p_court_id and mc2.ended_at is null
        ) = 1
        or (
          mc.assignment_type = 'regular'
          and (
            select count(*) from public.magistrate_courts mc3
            where mc3.court_id = p_court_id
              and mc3.ended_at is null
              and mc3.assignment_type = 'regular'
          ) = 1
        )
      )
  );
$$;


ALTER FUNCTION "public"."court_has_no_clerk_approver"("p_court_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."court_has_no_clerk_approver"("p_court_id" "uuid") IS 'True if NO currently-assigned magistrate at this court would satisfy can_manage_clerk_access() for it today (no current magistrate, several coverings with no unique primary and none flagged can_manage_clerks, or several primaries with none flagged). Used only to flag orphaned pending requests for the admin fallback view -- never used to auto-approve anything.';



CREATE OR REPLACE FUNCTION "public"."create_case_law_import"("p_case_name" "text", "p_citation" "text", "p_court" "text", "p_jurisdiction" "text", "p_court_id" "uuid" DEFAULT NULL::"uuid", "p_jurisdiction_id" "uuid" DEFAULT NULL::"uuid", "p_neutral_citation" "text" DEFAULT NULL::"text", "p_reported_citation" "text" DEFAULT NULL::"text", "p_decided_date" "date" DEFAULT NULL::"date", "p_full_text" "text" DEFAULT NULL::"text", "p_source_url" "text" DEFAULT NULL::"text", "p_source_id" "uuid" DEFAULT NULL::"uuid", "p_original_filename" "text" DEFAULT NULL::"text", "p_document_hash" "text" DEFAULT NULL::"text", "p_batch_id" "uuid" DEFAULT NULL::"uuid", "p_extracted_metadata" "jsonb" DEFAULT NULL::"jsonb", "p_proposed_tags" "text"[] DEFAULT NULL::"text"[], "p_duplicate_warning" "text" DEFAULT NULL::"text", "p_content_quality_status" "text" DEFAULT 'unknown'::"text", "p_category_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("case_law_id" "uuid", "import_job_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_case_law_id uuid;
  v_import_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may create a canonical Case Law import.';
  end if;

  insert into public.case_law (
    case_name, citation, court, jurisdiction, court_id, jurisdiction_id,
    neutral_citation, reported_citation, decided_date, full_text,
    source_url, source_id, original_filename, document_hash, retrieved_at,
    owner_id, review_status, content_quality_status, category_id
  ) values (
    p_case_name, p_citation, p_court, p_jurisdiction, p_court_id, p_jurisdiction_id,
    p_neutral_citation, p_reported_citation, p_decided_date, p_full_text,
    p_source_url, p_source_id, p_original_filename, p_document_hash, now(),
    null, 'needs_review', coalesce(p_content_quality_status, 'unknown'), p_category_id
  )
  returning id into v_case_law_id;

  insert into public.import_jobs (
    batch_id, content_type, source_id, source_url, status,
    target_case_law_id, extracted_text, extracted_metadata, proposed_tags,
    duplicate_warning, created_by, started_at, completed_at
  ) values (
    p_batch_id, 'case_law', p_source_id, p_source_url, 'needs_review',
    v_case_law_id, p_full_text, p_extracted_metadata, p_proposed_tags,
    p_duplicate_warning, auth.uid(), now(), now()
  )
  returning id into v_import_job_id;

  update public.case_law set import_job_id = v_import_job_id where id = v_case_law_id;

  return query select v_case_law_id, v_import_job_id;
end;
$$;


ALTER FUNCTION "public"."create_case_law_import"("p_case_name" "text", "p_citation" "text", "p_court" "text", "p_jurisdiction" "text", "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_neutral_citation" "text", "p_reported_citation" "text", "p_decided_date" "date", "p_full_text" "text", "p_source_url" "text", "p_source_id" "uuid", "p_original_filename" "text", "p_document_hash" "text", "p_batch_id" "uuid", "p_extracted_metadata" "jsonb", "p_proposed_tags" "text"[], "p_duplicate_warning" "text", "p_content_quality_status" "text", "p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_legislation_import"("p_code" "text", "p_title" "text", "p_jurisdiction" "text", "p_jurisdiction_id" "uuid" DEFAULT NULL::"uuid", "p_short_title" "text" DEFAULT NULL::"text", "p_full_text" "text" DEFAULT NULL::"text", "p_source_url" "text" DEFAULT NULL::"text", "p_source_id" "uuid" DEFAULT NULL::"uuid", "p_original_filename" "text" DEFAULT NULL::"text", "p_document_hash" "text" DEFAULT NULL::"text", "p_batch_id" "uuid" DEFAULT NULL::"uuid", "p_extracted_metadata" "jsonb" DEFAULT NULL::"jsonb", "p_proposed_tags" "text"[] DEFAULT NULL::"text"[], "p_duplicate_warning" "text" DEFAULT NULL::"text", "p_provisions" "jsonb" DEFAULT '[]'::"jsonb", "p_act_number" "text" DEFAULT NULL::"text", "p_enactment_year" integer DEFAULT NULL::integer, "p_instrument_type" "text" DEFAULT NULL::"text", "p_chapter_number" "text" DEFAULT NULL::"text", "p_effective_date" "date" DEFAULT NULL::"date", "p_content_quality_status" "text" DEFAULT 'unknown'::"text") RETURNS TABLE("statute_id" "uuid", "import_job_id" "uuid", "provision_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_statute_id uuid;
  v_import_job_id uuid;
  v_provision jsonb;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may create a canonical Legislation import.';
  end if;

  insert into public.statutes (
    code, title, short_title, jurisdiction, jurisdiction_id, full_text,
    source_url, source_id, original_filename, document_hash, retrieved_at,
    review_status, act_number, enactment_year, instrument_type,
    chapter_number, effective_date, content_quality_status
  ) values (
    p_code, p_title, p_short_title, p_jurisdiction, p_jurisdiction_id, p_full_text,
    p_source_url, p_source_id, p_original_filename, p_document_hash, now(),
    'needs_review', p_act_number, p_enactment_year, p_instrument_type,
    p_chapter_number, p_effective_date, coalesce(p_content_quality_status, 'unknown')
  )
  returning id into v_statute_id;

  for v_provision in select * from jsonb_array_elements(coalesce(p_provisions, '[]'::jsonb))
  loop
    insert into public.statute_provisions (statute_id, level, number, heading, body_text, sort_order)
    values (
      v_statute_id,
      v_provision->>'level',
      v_provision->>'number',
      v_provision->>'heading',
      v_provision->>'body_text',
      coalesce((v_provision->>'sort_order')::integer, 0)
    );
    v_count := v_count + 1;
  end loop;

  insert into public.import_jobs (
    batch_id, content_type, source_id, source_url, status,
    target_statute_id, extracted_text, extracted_metadata, proposed_tags,
    duplicate_warning, created_by, started_at, completed_at
  ) values (
    p_batch_id, 'legislation', p_source_id, p_source_url, 'needs_review',
    v_statute_id, p_full_text, p_extracted_metadata, p_proposed_tags,
    p_duplicate_warning, auth.uid(), now(), now()
  )
  returning id into v_import_job_id;

  update public.statutes set import_job_id = v_import_job_id where id = v_statute_id;

  return query select v_statute_id, v_import_job_id, v_count;
end;
$$;


ALTER FUNCTION "public"."create_legislation_import"("p_code" "text", "p_title" "text", "p_jurisdiction" "text", "p_jurisdiction_id" "uuid", "p_short_title" "text", "p_full_text" "text", "p_source_url" "text", "p_source_id" "uuid", "p_original_filename" "text", "p_document_hash" "text", "p_batch_id" "uuid", "p_extracted_metadata" "jsonb", "p_proposed_tags" "text"[], "p_duplicate_warning" "text", "p_provisions" "jsonb", "p_act_number" "text", "p_enactment_year" integer, "p_instrument_type" "text", "p_chapter_number" "text", "p_effective_date" "date", "p_content_quality_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_profile_court_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select court_id from public.profiles where id = auth.uid();
$$;


ALTER FUNCTION "public"."current_profile_court_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_profile_court_id"() IS 'The caller''s own current court_id, read via SECURITY DEFINER so the profiles self-update WITH CHECK (0154) can pin it without recursing into profiles RLS. Same pattern and threat model as current_profile_role() (0132): own row only, pinned search_path, authenticated only.';



CREATE OR REPLACE FUNCTION "public"."current_profile_email"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select email from public.profiles where id = auth.uid();
$$;


ALTER FUNCTION "public"."current_profile_email"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_profile_email"() IS 'The caller''s own current profiles.email (0154). See current_profile_court_id().';



CREATE OR REPLACE FUNCTION "public"."current_profile_is_active"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select is_active from public.profiles where id = auth.uid();
$$;


ALTER FUNCTION "public"."current_profile_is_active"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_profile_is_active"() IS 'The caller''s own current is_active flag (0154). See current_profile_court_id().';



CREATE OR REPLACE FUNCTION "public"."current_profile_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.profiles where id = auth.uid();
$$;


ALTER FUNCTION "public"."current_profile_role"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_profile_role"() IS 'The caller''s own current role, read via SECURITY DEFINER so callers checking "is this update leaving my role unchanged" (0012''s profiles self-update policy) don''t recursively re-invoke RLS on profiles -- the bug this function was added to fix (0132). Mirrors is_admin()''s existing pattern in the same policy.';



CREATE OR REPLACE FUNCTION "public"."decide_clerk_access_request"("p_request_id" "uuid", "p_decision" "public"."clerk_access_decision", "p_rejection_reason" "text" DEFAULT NULL::"text") RETURNS "public"."clerk_access_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_request public.clerk_access_requests;
  v_now timestamptz := now();
begin
  select * into v_request
  from public.clerk_access_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Access request not found';
  end if;

  if v_request.status in ('approved', 'rejected') then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request is no longer pending (status: %)', v_request.status;
  end if;

  if not (
    (select public.can_manage_clerk_access(v_request.court_id))
    or (select public.is_admin())
  ) then
    raise exception 'You are not currently authorized to review access requests for this court';
  end if;

  if p_decision = 'approved' then
    update public.clerk_access_requests
    set status = 'approved',
        reviewed_at = v_now,
        reviewed_by = (select auth.uid()),
        rejection_reason = null
    where id = p_request_id
    returning * into v_request;

    insert into public.clerk_courts (profile_id, court_id, approved_by, started_at)
    values (v_request.profile_id, v_request.court_id, (select auth.uid()), v_now)
    on conflict (profile_id, court_id) where ended_at is null do nothing;
  else
    update public.clerk_access_requests
    set status = 'rejected',
        reviewed_at = v_now,
        reviewed_by = (select auth.uid()),
        rejection_reason = nullif(trim(coalesce(p_rejection_reason, '')), '')
    where id = p_request_id
    returning * into v_request;
  end if;

  return v_request;
end;
$$;


ALTER FUNCTION "public"."decide_clerk_access_request"("p_request_id" "uuid", "p_decision" "public"."clerk_access_decision", "p_rejection_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."decide_clerk_access_request"("p_request_id" "uuid", "p_decision" "public"."clerk_access_decision", "p_rejection_reason" "text") IS 'Atomically approves or rejects a pending clerk_access_requests row. Approval also creates the active clerk_courts assignment in the same transaction. Authorized sitting magistrate (can_manage_clerk_access) or Court Assignment Administrator. Idempotent on already-decided rows.';



CREATE OR REPLACE FUNCTION "public"."decide_magistrate_court_request"("p_request_id" "uuid", "p_decision" "public"."magistrate_court_decision", "p_rejection_reason" "text" DEFAULT NULL::"text", "p_occupied_resolution" "text" DEFAULT NULL::"text") RETURNS "public"."magistrate_court_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_request public.magistrate_court_requests;
  v_now timestamptz := now();
  v_reason text;
  v_resolution text;
  v_occupied boolean;
  v_assignment_type text;
begin
  if not (select public.is_admin()) then
    raise exception 'Only a Court Assignment Administrator may review court assignment requests';
  end if;

  select * into v_request
  from public.magistrate_court_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Court assignment request not found';
  end if;

  if v_request.profile_id = (select auth.uid()) then
    raise exception 'You cannot approve or reject your own court assignment request';
  end if;

  if v_request.status in ('approved', 'rejected') then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request is no longer pending (status: %)', v_request.status;
  end if;

  if p_decision = 'rejected' then
    v_reason := nullif(trim(coalesce(p_rejection_reason, '')), '');
    if v_reason is null then
      raise exception 'A reason is required when returning a request to the requester';
    end if;

    update public.magistrate_court_requests
    set status = 'rejected',
        reviewed_at = v_now,
        reviewed_by = (select auth.uid()),
        rejection_reason = v_reason,
        occupied_resolution = null
    where id = p_request_id
    returning * into v_request;

    return v_request;
  end if;

  v_occupied := public.court_has_active_primary_magistrate(v_request.court_id);
  v_resolution := nullif(trim(coalesce(p_occupied_resolution, '')), '');

  if v_occupied or v_request.request_kind = 'occupied_exception' then
    if not v_occupied then
      v_assignment_type := 'regular';
      v_resolution := null;
    else
      if v_resolution is null or v_resolution not in ('replace', 'co_sit') then
        raise exception 'This court already has a signed-in primary magistrate. Choose replace (end the current primary) or co_sit (seat this magistrate as acting alongside them).';
      end if;
      if v_resolution = 'replace' then
        perform public.end_other_regular_assignments_at_court(
          v_request.court_id,
          v_request.profile_id,
          'Replaced by administrator for a special seating exception'
        );
        v_assignment_type := 'regular';
      else
        v_assignment_type := 'acting';
      end if;
    end if;
  else
    v_assignment_type := 'regular';
    v_resolution := null;
  end if;

  begin
    insert into public.magistrate_courts (profile_id, court_id, assignment_type, started_at)
    values (v_request.profile_id, v_request.court_id, v_assignment_type, v_now)
    on conflict (profile_id, court_id) where ended_at is null do nothing;
  exception when unique_violation then
    raise exception 'This court already has an active primary magistrate assignment -- cannot approve.';
  end;

  update public.magistrate_court_requests
  set status = 'approved',
      reviewed_at = v_now,
      reviewed_by = (select auth.uid()),
      rejection_reason = null,
      approval_kind = coalesce(v_request.approval_kind, 'ordinary'),
      occupied_resolution = v_resolution
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;


ALTER FUNCTION "public"."decide_magistrate_court_request"("p_request_id" "uuid", "p_decision" "public"."magistrate_court_decision", "p_rejection_reason" "text", "p_occupied_resolution" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."decide_magistrate_court_request"("p_request_id" "uuid", "p_decision" "public"."magistrate_court_decision", "p_rejection_reason" "text", "p_occupied_resolution" "text") IS 'Admin approve/return of a magistrate court request. Occupied courts require p_occupied_resolution=replace|co_sit. Requests never occupy a slot; replace/co-sit only take effect on approval. Self-approval is still blocked.';



CREATE OR REPLACE FUNCTION "public"."dispatch_pending_webhooks"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if public.request_webhook_dispatch_run() is null then
    return 0;
  end if;
  return 1;
end;
$$;


ALTER FUNCTION "public"."dispatch_pending_webhooks"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dispatch_pending_webhooks"() IS 'Asks the webhook-dispatch Edge Function for a run when a row is due (0180); returns the number of runs requested (0 or 1). Sends nothing itself.';



CREATE OR REPLACE FUNCTION "public"."docket_booked_count"("p_magistrate_id" "uuid", "p_category_id" "uuid", "p_scheduled_date" "date", "p_exclude_matter_id" "uuid" DEFAULT NULL::"uuid", "p_court_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select count(distinct e.docket_matter_id)::integer
  from public.docket_events e
  join public.docket_matters dm on dm.id = e.docket_matter_id
  where e.presiding_magistrate_id = p_magistrate_id
    and e.category_id = p_category_id
    and e.scheduled_date = p_scheduled_date
    and e.event_status in ('scheduled', 'completed')
    and dm.deleted_at is null
    and (p_exclude_matter_id is null or e.docket_matter_id <> p_exclude_matter_id)
    and (p_court_id is null or dm.court_id = p_court_id);
$$;


ALTER FUNCTION "public"."docket_booked_count"("p_magistrate_id" "uuid", "p_category_id" "uuid", "p_scheduled_date" "date", "p_exclude_matter_id" "uuid", "p_court_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_booked_count"("p_magistrate_id" "uuid", "p_category_id" "uuid", "p_scheduled_date" "date", "p_exclude_matter_id" "uuid", "p_court_id" "uuid") IS 'The one capacity count (0163): distinct live (not binned) matters with a scheduled or completed hearing in the category on the date presided by the magistrate. A completed sitting still fills its day (0119). p_exclude_matter_id leaves out the matter being booked; p_court_id narrows to one court for display only (enforcement never passes it). SECURITY INVOKER: callers see only rows their RLS allows; the SECURITY DEFINER booking RPCs see every row.';



CREATE OR REPLACE FUNCTION "public"."docket_callover_items_record_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    if new.callover_id is distinct from old.callover_id then
      raise exception 'A callover item cannot be moved to another callover.';
    end if;

    if new.docket_matter_id is distinct from old.docket_matter_id then
      raise exception 'A callover item cannot be changed to another matter. Remove it and add the other matter instead.';
    end if;

    if old.called_at is not null then
      if new.called_at is null then
        raise exception 'This matter has been called. That call is part of the record of the sitting and cannot be cleared.';
      end if;
      -- The first call is the record; a later stamp from a stale screen
      -- does not move it.
      new.called_at := old.called_at;
    end if;
  end if;

  if current_user in ('anon', 'authenticated') then
    select co.status into v_status
    from public.docket_callovers co
    where co.id = case when tg_op = 'INSERT' then new.callover_id else old.callover_id end
    for share;

    if v_status = 'completed' then
      raise exception 'This callover is completed. Its sheet is the record of the sitting and cannot be changed.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."docket_callover_items_record_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_callover_items_record_guard"() IS 'Keeps a callover sheet a record of its sitting (0164): callover_id and docket_matter_id are fixed at INSERT, a recorded call is never cleared and keeps its first time, and for client roles a completed callover''s items take no INSERT, UPDATE or DELETE. Owner-run code (purge_docket_matter_row, FK actions) is not bound by the completed freeze.';



CREATE OR REPLACE FUNCTION "public"."docket_callovers_record_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE' then
    if new.court_id is distinct from old.court_id then
      raise exception 'A callover''s court cannot be changed.';
    end if;

    if current_user in ('anon', 'authenticated') then
      if old.status = 'completed' then
        raise exception 'This callover is completed. It is the record of the sitting and cannot be changed.';
      end if;

      if old.status = 'in_progress' and new.status = 'draft' then
        raise exception 'A callover in progress cannot be set back to draft.';
      end if;
    end if;

    return new;
  end if;

  -- DELETE. The policy already limits it to a draft; a draft whose matters
  -- have been called is still the record of a sitting.
  if current_user in ('anon', 'authenticated')
    and exists (
      select 1 from public.docket_callover_items i
      where i.callover_id = old.id
        and i.called_at is not null
    )
  then
    raise exception 'Matters on this callover have been called, so it is the record of a sitting and cannot be deleted.';
  end if;

  return old;
end;
$$;


ALTER FUNCTION "public"."docket_callovers_record_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_callovers_record_guard"() IS 'Keeps a callover a record of its sitting (0164): court_id is fixed; for client roles a completed callover cannot change, in_progress cannot return to draft, and a callover with a called item cannot be deleted. Owner-run code (the purge path, FK actions) is not bound by the client-role rules.';



CREATE OR REPLACE FUNCTION "public"."docket_capacity_settings_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := (select auth.uid());
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'A Docket Capacity Setting''s owner_id is immutable; ownership cannot be transferred by UPDATE.';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."docket_capacity_settings_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."docket_event_calendar_links_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.profile_id := (select auth.uid());
  elsif tg_op = 'UPDATE' then
    new.profile_id := old.profile_id;
    new.docket_event_id := old.docket_event_id;
    new.provider := old.provider;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."docket_event_calendar_links_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."docket_events_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_client boolean := current_user in ('anon', 'authenticated');
begin
  if tg_op = 'UPDATE' and new.docket_matter_id is distinct from old.docket_matter_id then
    raise exception 'A Docket Event''s docket_matter_id is immutable; it cannot be moved to another Docket Matter. Create a new event on the correct matter instead.';
  end if;

  -- 0161 (B-10), carried over unchanged.
  if exists (
    select 1 from public.docket_matters dm
    where dm.id = new.docket_matter_id
      and dm.deleted_at is not null
  ) then
    raise exception 'A binned Docket Matter cannot be edited. Restore it first.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;

  -- A client never chooses who presides. The scheduling RPCs (SECURITY
  -- DEFINER, so not a client role here) write the value they computed
  -- with the same function, because only they know which sitting the new
  -- hearing supersedes.
  if tg_op = 'INSERT' and v_client then
    new.presiding_magistrate_id := public.new_docket_event_presiding_magistrate(new.docket_matter_id);
  end if;

  -- The FK's ON DELETE SET NULL runs as the table owner, so it passes.
  if tg_op = 'UPDATE'
    and v_client
    and new.presiding_magistrate_id is distinct from old.presiding_magistrate_id
  then
    if new.presiding_magistrate_id is null then
      raise exception 'A hearing''s presiding magistrate cannot be removed.';
    end if;
    if old.presiding_magistrate_id is not null then
      raise exception 'This hearing already has a presiding magistrate and cannot be reassigned.';
    end if;
    if new.presiding_magistrate_id is distinct from (select auth.uid())
      or public.is_clerk()
      or not public.has_docket_matter_authority(new.docket_matter_id)
    then
      raise exception 'Only a magistrate who sits at this court, or holds this matter, can take an unassigned hearing, and only for themselves.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.last_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."docket_events_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_events_guard"() IS 'BEFORE INSERT OR UPDATE guard: docket_matter_id immutability; no new or changed event on a binned matter (0161); created_by forced at creation and preserved after; presiding_magistrate_id (0163) set on a client insert by new_docket_event_presiding_magistrate() (a clerk never presides), written as computed by the SECURITY DEFINER scheduling RPCs, never removed or reassigned by a client, and taken from unassigned only by a magistrate with court or retained authority, for themselves. The profile''s own ON DELETE SET NULL runs as the table owner and passes. last_updated_by forced on UPDATE.';



CREATE OR REPLACE FUNCTION "public"."docket_magistrate_can_hear"("p_profile_id" "uuid", "p_docket_matter_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles p
    join public.docket_matters dm on dm.id = p_docket_matter_id
    where p.id = p_profile_id
      and p.role <> 'clerk'
      and (
        exists (
          select 1 from public.magistrate_courts mc
          where mc.profile_id = p.id
            and mc.court_id = dm.court_id
            and mc.ended_at is null
        )
        or exists (
          select 1 from public.docket_matter_assignments dma
          where dma.profile_id = p.id
            and dma.docket_matter_id = dm.id
            and dma.ended_at is null
        )
      )
  );
$$;


ALTER FUNCTION "public"."docket_magistrate_can_hear"("p_profile_id" "uuid", "p_docket_matter_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_magistrate_can_hear"("p_profile_id" "uuid", "p_docket_matter_id" "uuid") IS 'Internal (0163): true when the profile is not a clerk and currently sits at the matter''s court or holds a retained assignment on it. Used only by new_docket_event_presiding_magistrate().';



CREATE OR REPLACE FUNCTION "public"."docket_matter_case_law_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;


ALTER FUNCTION "public"."docket_matter_case_law_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."docket_matter_judgments_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;


ALTER FUNCTION "public"."docket_matter_judgments_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."docket_matter_matches_query"("p_case_number" "text", "p_matter_title" "text", "p_charge_or_issue" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select
    p_query is null or btrim(p_query) = '' or (
      p_search_vector @@ websearch_to_tsquery('english', btrim(p_query))
      or extensions.similarity(p_matter_title, btrim(p_query)) > 0.3
      or position(lower(btrim(p_query)) in lower(p_case_number)) > 0
      or position(lower(btrim(p_query)) in lower(p_matter_title)) > 0
      or position(lower(btrim(p_query)) in lower(coalesce(p_charge_or_issue, ''))) > 0
      or exists (
        select 1
        from public.docket_matter_parties p
        where p.docket_matter_id = p_docket_matter_id
          and p.party_status = 'active'
          and (
            position(lower(btrim(p_query)) in lower(p.full_name)) > 0
            or position(lower(btrim(p_query)) in lower(coalesce(p.attorney_name, ''))) > 0
          )
      )
    );
$$;


ALTER FUNCTION "public"."docket_matter_matches_query"("p_case_number" "text", "p_matter_title" "text", "p_charge_or_issue" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_matter_matches_query"("p_case_number" "text", "p_matter_title" "text", "p_charge_or_issue" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") IS 'Single-row Docket Matter match predicate (0145). No search surface calls it since 0171: they all use private.docket_matter_search_hits, which applies the same rule through the indexes. Kept for compatibility; change both together.';



CREATE OR REPLACE FUNCTION "public"."docket_matter_parties_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE' and new.docket_matter_id is distinct from old.docket_matter_id then
    raise exception 'A Docket Matter Party''s docket_matter_id is immutable; it cannot be moved to another Docket Matter.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;

  if tg_op = 'UPDATE' then
    new.last_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."docket_matter_parties_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_matter_parties_guard"() IS 'BEFORE INSERT OR UPDATE guard: docket_matter_id immutability (exception on change), created_by provenance (forced at creation, force-preserved after — safe unconditionally since created_by is ON DELETE RESTRICT), last_updated_by provenance (forced to auth.uid() on every UPDATE).';



CREATE OR REPLACE FUNCTION "public"."docket_matter_search_rank"("p_case_number" "text", "p_matter_title" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") RETURNS real
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_query is null or btrim(p_query) = '' then 0::real
    else greatest(
      ts_rank(p_search_vector, websearch_to_tsquery('english', btrim(p_query))),
      extensions.similarity(p_matter_title, btrim(p_query)),
      case
        when position(lower(btrim(p_query)) in lower(p_case_number)) > 0
          or position(lower(btrim(p_query)) in lower(p_matter_title)) > 0
        then 0.5
        else 0
      end,
      case
        when exists (
          select 1
          from public.docket_matter_parties p
          where p.docket_matter_id = p_docket_matter_id
            and p.party_status = 'active'
            and (
              position(lower(btrim(p_query)) in lower(p.full_name)) > 0
              or position(lower(btrim(p_query)) in lower(coalesce(p.attorney_name, ''))) > 0
            )
        ) then 0.45
        else 0
      end
    )
  end;
$$;


ALTER FUNCTION "public"."docket_matter_search_rank"("p_case_number" "text", "p_matter_title" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_matter_search_rank"("p_case_number" "text", "p_matter_title" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") IS 'Relevance for Docket Matter search (0145): greatest of full-text rank, title trigram similarity, a 0.5 floor for a case-number/title substring, and a 0.45 floor for an active party/attorney substring.';



CREATE OR REPLACE FUNCTION "public"."docket_matter_tags_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.created_by := (select auth.uid());
  new.tag_name := btrim(new.tag_name);
  return new;
end;
$$;


ALTER FUNCTION "public"."docket_matter_tags_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."docket_matters_category_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_name text;
begin
  new.category_other := nullif(btrim(coalesce(new.category_other, '')), '');
  if new.category_id is null then
    new.category_other := null;
    return new;
  end if;
  select c.name into v_name from public.docket_matter_categories c where c.id = new.category_id;
  if v_name is null then
    raise exception 'Unknown docket matter category.';
  end if;
  if v_name = 'Other' then
    if new.category_other is null then
      raise exception 'Describe the matter type when classification is Other.';
    end if;
  else
    new.category_other := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."docket_matters_category_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."docket_matters_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_district_id uuid;
  v_is_active boolean;
begin
  if tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is not null then
    raise exception 'A binned Docket Matter cannot be edited. Restore it first.';
  end if;

  if tg_op = 'INSERT' and (new.deleted_at is not null or new.deleted_by is not null) then
    raise exception 'A Docket Matter cannot be created in the bin.';
  end if;

  -- bin_docket_matter / restore_docket_matter are SECURITY DEFINER, so a
  -- client role here means the change came straight from the API.
  if tg_op = 'UPDATE'
    and (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
    and current_user in ('anon', 'authenticated')
  then
    raise exception 'A Docket Matter moves to and from the bin only through Move to bin and Restore.';
  end if;

  if tg_op = 'UPDATE' and new.court_id is distinct from old.court_id then
    raise exception 'A Docket Matter''s court cannot be changed through an ordinary update. Court reassignment is not supported.';
  end if;

  if tg_op = 'INSERT' then
    select c.district_id, c.is_active into v_district_id, v_is_active
    from public.courts c
    where c.id = new.court_id;

    if v_district_id is null then
      raise exception 'Cannot create a Docket Matter at court % - that court has no Magisterial District assigned', new.court_id;
    end if;

    if not coalesce(v_is_active, false) then
      raise exception 'Cannot create a Docket Matter at inactive court % - is_active must be true to accept new Docket entry', new.court_id;
    end if;

    new.district_id := v_district_id;
  else
    new.district_id := old.district_id;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;

  if tg_op = 'UPDATE' then
    new.last_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."docket_matters_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_matters_guard"() IS 'Derives district_id from court_id on INSERT only; force-preserves district_id/created_by on UPDATE; forces last_updated_by on UPDATE. court_id is immutable (0097). Binned rows (deleted_at set) reject further edits until restored (0120). deleted_at/deleted_by are never set on INSERT and never changed by a client role: only bin_docket_matter/restore_docket_matter write them (0161).';



CREATE OR REPLACE FUNCTION "public"."docket_matters_outcome_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.outcome_status is not null
     and (tg_op = 'INSERT' or new.outcome_status is distinct from old.outcome_status)
  then
    new.status := new.outcome_status::docket_matter_status;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."docket_matters_outcome_sync"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_matters_outcome_sync"() IS 'Forces docket_matters.status to match outcome_status whenever the latter is set to a non-null value. One-directional by design (0131): clearing outcome_status does not revert status, and changing status directly does not back-fill outcome_status.';



CREATE OR REPLACE FUNCTION "public"."docket_matters_set_workflow_protocol"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_name text;
begin
  v_name := null;
  if new.category_id is not null then
    select c.name into v_name
    from public.docket_matter_categories c
    where c.id = new.category_id;
  end if;

  if v_name = 'Paper Committal' then
    new.workflow_protocol := 'paper_committal';
  elsif v_name in ('Maintenance matter', 'Liability matter', 'Protection order matter') then
    new.workflow_protocol := 'civil_summons';
  else
    new.workflow_protocol := 'criminal_trial';
  end if;

  if new.workflow_protocol = 'criminal_trial' then
    new.procedure_stage := case
      when new.arraignment_status <> 'done' then 'arraignment'
      when new.custody_status = 'unset' then 'custody'
      when new.disclosure_status <> 'full' then 'disclosure'
      when new.trial_status <> 'completed' then 'trial'
      when new.ruling_status <> 'delivered' then 'ruling'
      when new.judgment_status <> 'delivered' then 'judgment'
      when new.sentence_status <> 'passed' then 'sentence'
      else 'appeal'
    end;
  elsif new.workflow_protocol = 'paper_committal' then
    new.procedure_stage := case
      when new.arraignment_status <> 'done' then 'arraignment'
      when new.custody_status = 'unset' then 'custody'
      when new.disclosure_status <> 'full' then 'disclosure'
      when new.paper_committal_status <> 'completed' then 'paper_committal'
      when new.ruling_status <> 'delivered' then 'ruling'
      when new.judgment_status <> 'delivered' then 'judgment'
      else 'appeal'
    end;
  else
    new.procedure_stage := case
      when new.information_sworn_status is distinct from 'done' then 'information_sworn'
      when new.summons_served is distinct from 'yes' then 'summons_served'
      when new.returns_of_summons is distinct from 'yes' then 'returns_of_summons'
      when coalesce(new.civil_trial_held, 'unset') = 'unset' then 'civil_trial'
      else 'decision'
    end;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."docket_matters_set_workflow_protocol"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_matters_set_workflow_protocol"() IS 'Sets workflow_protocol from classification, then walks that protocol into procedure_stage. Criminal Trial walk is byte-identical to the former 0070 generated column.';



CREATE OR REPLACE FUNCTION "public"."docket_matters_trim_text"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.case_number := public.btrim_whitespace(new.case_number);
  new.matter_title := public.btrim_whitespace(new.matter_title);
  new.charge_or_issue := nullif(public.btrim_whitespace(new.charge_or_issue), '');
  return new;
end;
$$;


ALTER FUNCTION "public"."docket_matters_trim_text"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."docket_matters_trim_text"() IS 'BEFORE INSERT OR UPDATE OF case_number, matter_title, charge_or_issue on docket_matters (0166): trims the surrounding whitespace, and stores a blank charge as NULL. The CHECKs then refuse a case number or title that was only whitespace.';



CREATE OR REPLACE FUNCTION "public"."documents_parent_cascade_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_entity_type text;
begin
  case tg_table_name
    when 'docket_matters' then v_entity_type := 'docket_matter';
    when 'judgments'      then v_entity_type := 'judgment';
    when 'case_law'       then v_entity_type := 'case_law';
    when 'quick_codes'    then v_entity_type := 'quick_code';
    when 'bench_notes'    then v_entity_type := 'bench_note';
    when 'cases'          then v_entity_type := 'case';
    when 'statutes'       then v_entity_type := 'statute';
    else
      raise exception 'documents_parent_cascade_delete: unsupported parent table %', tg_table_name;
  end case;

  delete from public.documents
  where entity_type = v_entity_type
    and entity_id = old.id;

  return old;
end;
$$;


ALTER FUNCTION "public"."documents_parent_cascade_delete"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."documents_parent_cascade_delete"() IS 'AFTER DELETE trigger, installed identically on all six polymorphic parent tables (docket_matters, judgments, case_law, quick_codes, bench_notes, cases). Reproduces the pre-0040 documents_case_id_fkey/documents_bench_note_id_fkey ON DELETE CASCADE behavior for a polymorphic entity_id that cannot carry a declarative FK. Deletes only public.documents rows matching (entity_type = the hardcoded mapping for TG_TABLE_NAME, entity_id = OLD.id) -- an exact type+id match, so cross-type UUID collisions cannot cross-delete unrelated Documents. SECURITY DEFINER so cleanup does not depend on the deleting user satisfying documents'' own DELETE RLS. No dynamic SQL (explicit CASE over exactly the six approved table names, fails closed for anything else), no is_admin()/Court/Docket logic, no other mutation, does not touch storage.objects. Does not fire for standalone Documents (entity_type/entity_id both NULL), which have no parent to be deleted.';



CREATE OR REPLACE FUNCTION "public"."documents_queue_storage_cleanup"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if old.file_path is null then
    return old;
  end if;

  -- Another row still references the file: it is not an orphan.
  if exists (select 1 from public.documents d where d.file_path = old.file_path) then
    return old;
  end if;

  -- Already removed through the Storage API (useDeleteDocument removes the
  -- file before the row), so there is nothing to clean up.
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'documents' and o.name = old.file_path
  ) then
    return old;
  end if;

  insert into public.storage_cleanup_queue (bucket_id, object_name)
  values ('documents', old.file_path)
  on conflict (bucket_id, object_name) do nothing;

  return old;
end;
$$;


ALTER FUNCTION "public"."documents_queue_storage_cleanup"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."documents_queue_storage_cleanup"() IS 'AFTER DELETE on documents (0165). Queues the deleted row''s file in storage_cleanup_queue when it is still stored and no other documents row references it, so a deleted parent never loses track of its files. SECURITY DEFINER: it reads storage.objects and writes the queue, neither of which a client role may touch.';



CREATE OR REPLACE FUNCTION "public"."download_my_data"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  v_email text;
begin
  perform public.enforce_rpc_rate_limit('download_my_data', 5, 60);
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select lower(p.email) into v_email from public.profiles p where p.id = uid;

  return jsonb_build_object(
    'exported_at', now(),
    'profile', (
      select to_jsonb(p) - 'avatar_url'
      from public.profiles p
      where p.id = uid
    ),
    'judgments', coalesce((
      select jsonb_agg(to_jsonb(j) - 'search_vector' order by j.updated_at desc, j.id)
      from public.judgments j
      where j.owner_id = uid
    ), '[]'::jsonb),
    'judgment_versions', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.judgment_id, v.version_number)
      from public.judgment_versions v
      join public.judgments j on j.id = v.judgment_id
      where j.owner_id = uid
    ), '[]'::jsonb),
    'judgment_tags', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at, t.id)
      from public.judgment_tags t
      where t.created_by = uid
        or exists (select 1 from public.judgments j where j.id = t.judgment_id and j.owner_id = uid)
    ), '[]'::jsonb),
    'judgment_docket_links', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at, l.id)
      from public.docket_matter_judgments l
      where l.created_by = uid
        or exists (select 1 from public.judgments j where j.id = l.judgment_id and j.owner_id = uid)
    ), '[]'::jsonb),
    'judgment_ownership_transfers', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at, t.id)
      from public.judgment_ownership_transfers t
      where uid in (t.from_owner_id, t.to_owner_id, t.original_author_id, t.transferred_by)
    ), '[]'::jsonb),
    'bench_notes', coalesce((
      select jsonb_agg(to_jsonb(b) - 'search_vector' order by b.updated_at desc, b.id)
      from public.bench_notes b
      where b.author_id = uid
    ), '[]'::jsonb),
    'bench_note_tags', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bench_note_id', bt.bench_note_id,
          'tag_id', bt.tag_id,
          'tag_name', tg.name,
          'created_at', bt.created_at
        )
        order by bt.created_at, bt.bench_note_id, bt.tag_id
      )
      from public.bench_note_tags bt
      join public.bench_notes b on b.id = bt.bench_note_id
      join public.tags tg on tg.id = bt.tag_id
      where b.author_id = uid
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at, c.id)
      from public.comments c
      where c.author_id = uid
    ), '[]'::jsonb),
    'case_law', coalesce((
      select jsonb_agg(to_jsonb(c) - 'search_vector' order by c.updated_at desc, c.id)
      from public.case_law c
      where c.owner_id = uid
    ), '[]'::jsonb),
    'case_law_tags', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'case_law_id', ct.case_law_id,
          'tag_id', ct.tag_id,
          'tag_name', tg.name,
          'created_at', ct.created_at
        )
        order by ct.created_at, ct.case_law_id, ct.tag_id
      )
      from public.case_law_tags ct
      join public.case_law c on c.id = ct.case_law_id
      join public.tags tg on tg.id = ct.tag_id
      where c.owner_id = uid
    ), '[]'::jsonb),
    'case_law_annotations', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at, a.id)
      from public.case_law_annotations a
      where a.owner_id = uid
    ), '[]'::jsonb),
    'quick_codes', coalesce((
      select jsonb_agg(to_jsonb(q) - 'search_vector' order by q.updated_at desc, q.id)
      from public.quick_codes q
      where q.owner_id = uid
    ), '[]'::jsonb),
    'quick_code_judgments', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at, l.id)
      from public.quick_code_judgments l
      where l.created_by = uid
        or exists (select 1 from public.quick_codes q where q.id = l.quick_code_id and q.owner_id = uid)
    ), '[]'::jsonb),
    'quick_code_docket_matters', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at, l.id)
      from public.quick_code_docket_matters l
      where l.created_by = uid
        or exists (select 1 from public.quick_codes q where q.id = l.quick_code_id and q.owner_id = uid)
    ), '[]'::jsonb),
    'quick_code_case_law', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at, l.id)
      from public.quick_code_case_law l
      where l.created_by = uid
        or exists (select 1 from public.quick_codes q where q.id = l.quick_code_id and q.owner_id = uid)
    ), '[]'::jsonb),
    'bookmarks', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.created_at desc, b.id)
      from public.bookmarks b
      where b.user_id = uid
    ), '[]'::jsonb),
    'shares', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc, s.id)
      from public.shares s
      where s.granted_by = uid or s.recipient_id = uid
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc, n.id)
      from public.notifications n
      where n.user_id = uid
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.created_at desc, d.id)
      from public.documents d
      where d.uploaded_by = uid
    ), '[]'::jsonb),
    'clerk_access_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
      from public.clerk_access_requests r
      where r.profile_id = uid
    ), '[]'::jsonb),
    'clerk_courts', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.started_at desc, c.id)
      from public.clerk_courts c
      where c.profile_id = uid
    ), '[]'::jsonb),
    'magistrate_court_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
      from public.magistrate_court_requests r
      where r.profile_id = uid
    ), '[]'::jsonb),
    'magistrate_courts', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.started_at desc, m.id)
      from public.magistrate_courts m
      where m.profile_id = uid
    ), '[]'::jsonb),
    'docket_matter_assignments', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.started_at desc, a.id)
      from public.docket_matter_assignments a
      where a.profile_id = uid
    ), '[]'::jsonb),
    'docket_capacity_settings', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at, s.id)
      from public.docket_capacity_settings s
      where s.owner_id = uid
    ), '[]'::jsonb),
    'docket_capacity_overrides', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.created_at desc, o.id)
      from public.docket_capacity_overrides o
      where o.magistrate_profile_id = uid
    ), '[]'::jsonb),
    'docket_event_calendar_links', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc, l.id)
      from public.docket_event_calendar_links l
      where l.profile_id = uid
    ), '[]'::jsonb),
    'issue_reports', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
      from public.issue_reports r
      where r.reporter_id = uid
    ), '[]'::jsonb),
    'auth_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc, e.id)
      from (
        select a.* from public.auth_event_log a where a.actor_id = uid
        union all
        select a.* from public.auth_event_log a
        where a.actor_id is null
          and a.event_type = any (enum_range(null::public.auth_event_type))
          and a.email = v_email
      ) e
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'created_at', a.created_at,
          'action', a.action,
          'table_name', a.table_name,
          'record_id', a.record_id
        )
        order by a.id
      )
      from public.audit_log a
      where a.actor_id = uid
    ), '[]'::jsonb),
    'rpc_rate_limits', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.window_start desc, r.rpc_name)
      from public.rpc_rate_limit_buckets r
      where r.user_id = uid
    ), '[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."download_my_data"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."download_my_data"() IS 'JSON export of everything the caller owns, authored, holds, received or is the subject of, with its content (0221, BE-19): profile, judgments and their versions, tags, pins and transfers, bench notes, comments, personal case law and annotations, quick codes and their links, bookmarks, shares, notifications, document metadata, court requests and assignments, retained assignments, capacity settings, calendar links, issue reports, sign-in events, the caller''s audit_log activity (no values) and rate-limit counters. Court and library records the caller only created are not exported. enforce_rpc_rate_limit 5/60s (0137).';



CREATE OR REPLACE FUNCTION "public"."end_other_regular_assignments_at_court"("p_court_id" "uuid", "p_keep_profile_id" "uuid", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_ended record;
  v_court_name text;
begin
  select c.name into v_court_name from public.courts c where c.id = p_court_id;

  for v_ended in
    update public.magistrate_courts
    set ended_at = now(),
        ended_by = (select auth.uid()),
        end_reason = coalesce(nullif(trim(p_reason), ''), 'Replaced by administrator')
    where court_id = p_court_id
      and assignment_type = 'regular'
      and ended_at is null
      and profile_id is distinct from p_keep_profile_id
    returning profile_id, end_reason
  loop
    perform public.notify_user(
      v_ended.profile_id,
      'court_ended',
      'Your court assignment ended',
      coalesce(v_court_name, 'A court') || ': ' || v_ended.end_reason
        || '. See Court Assignments for the ended sitting and to request a court.',
      '/court-assignments'
    );
  end loop;
end;
$$;


ALTER FUNCTION "public"."end_other_regular_assignments_at_court"("p_court_id" "uuid", "p_keep_profile_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_rpc_rate_limit"("p_rpc" "text", "p_max" integer, "p_window_seconds" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  v_window timestamptz;
  v_count integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_rpc is null or btrim(p_rpc) = '' or p_max is null or p_window_seconds is null
     or p_max < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit arguments';
  end if;
  if p_rpc not in (
    'global_search',
    'search_docket_matters',
    'search_case_law',
    'search_case_law_scoped',
    'search_judgments',
    'search_statutes',
    'search_bench_notes',
    'download_my_data'
  ) then
    raise exception 'Unknown rate-limited RPC';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rpc_rate_limit_buckets as b (user_id, rpc_name, window_start, hit_count)
  values (uid, p_rpc, v_window, 1)
  on conflict (user_id, rpc_name, window_start)
  do update set hit_count = b.hit_count + 1
  returning hit_count into v_count;

  delete from public.rpc_rate_limit_buckets
  where user_id = uid
    and rpc_name = p_rpc
    and window_start < v_window;

  -- 0154: sweep every stale bucket, not only the caller's, so users who
  -- never search again do not leave rows behind for ever.
  delete from public.rpc_rate_limit_buckets
  where window_start < now() - interval '1 day';

  if v_count > p_max then
    raise exception 'rate_limited'
      using hint = 'Too many requests. Try again in a minute.';
  end if;
end;
$$;


ALTER FUNCTION "public"."enforce_rpc_rate_limit"("p_rpc" "text", "p_max" integer, "p_window_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_rpc_rate_limit"("p_rpc" "text", "p_max" integer, "p_window_seconds" integer) IS 'Increments the caller''s window for p_rpc and raises rate_limited when hit_count exceeds p_max. 0154: p_rpc must be one of the fixed wrapper names; buckets older than one day are swept on every call.';



CREATE OR REPLACE FUNCTION "public"."enqueue_webhook_event"("p_event" "text", "p_payload" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer := 0;
begin
  insert into public.webhook_outbox (endpoint_id, event, payload)
  select e.id, p_event, p_payload
  from public.webhook_endpoints e
  where e.active
    and p_event = any (e.events);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."enqueue_webhook_event"("p_event" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."escape_like_pattern"("p_text" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select pg_catalog.replace(
    pg_catalog.replace(pg_catalog.replace(p_text, '\', '\\'), '%', '\%'),
    '_',
    '\_'
  );
$$;


ALTER FUNCTION "public"."escape_like_pattern"("p_text" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."escape_like_pattern"("p_text" "text") IS 'Escapes \, % and _ so user text is matched literally inside a LIKE/ILIKE pattern with the default escape character (0166).';



CREATE OR REPLACE FUNCTION "public"."export_audit_log"("p_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_tables" "text"[] DEFAULT NULL::"text"[], "p_export_id" bigint DEFAULT NULL::bigint, "p_after_id" bigint DEFAULT NULL::bigint, "p_limit" integer DEFAULT 500) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."export_audit_log"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_tables" "text"[], "p_export_id" bigint, "p_after_id" bigint, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."export_audit_log"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_tables" "text"[], "p_export_id" bigint, "p_after_id" bigint, "p_limit" integer) IS 'Admin-only, audited, paged audit-log export (0181). Start with p_from, p_to (half-open) and optional p_tables: verifies the hash chain, pins the export to the current ledger, writes an audit_log row (new_data.event = audit_export) and returns the first page. Continue with p_export_id and p_after_id = the previous next_after_id. Returns jsonb { export_id, from, to, tables, as_of_id, total, chain { ok, broken_id }, rows [...], next_after_id }.';



CREATE OR REPLACE FUNCTION "public"."feature_flags_admin_mfa_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.key = 'require_admin_mfa'
    and new.enabled
    and not (tg_op = 'UPDATE' and old.key = 'require_admin_mfa' and old.enabled)
    and current_user in ('anon', 'authenticated')
    and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
  then
    raise exception 'Verify a second factor before requiring one for administrators'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."feature_flags_admin_mfa_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."feature_flags_admin_mfa_guard"() IS 'Refuses turning require_admin_mfa on from a client session below aal2, so the administrator who turns the gate on can still pass it (0210).';



CREATE OR REPLACE FUNCTION "public"."finalize_legislation_document"("p_statute_id" "uuid", "p_document_id" "uuid", "p_page_count" integer DEFAULT NULL::integer, "p_has_text_layer" boolean DEFAULT NULL::boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_supersedes uuid;
  v_created_by uuid;
  v_review_status text;
begin
  select supersedes_statute_id, created_by, review_status
    into v_supersedes, v_created_by, v_review_status
  from public.statutes
  where id = p_statute_id
  for update;

  if not found then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  if (select public.is_admin()) then
    null;
  elsif (select public.is_magistrate())
    and v_created_by = (select auth.uid())
    and v_review_status = 'draft'
    and v_supersedes is null
  then
    null;
  else
    raise exception 'Only administrators may replace existing Legislation; magistrates may only publish a new Act they just created.';
  end if;

  if not exists (
    select 1 from public.documents d
    where d.id = p_document_id
      and d.entity_type = 'statute'
      and d.entity_id = p_statute_id
  ) then
    raise exception 'The Legislation file must be attached to this record before it can be published.';
  end if;

  if v_supersedes is not null then
    update public.statutes set is_current_version = false where id = v_supersedes;
  end if;

  update public.statutes
  set primary_document_id = p_document_id,
      page_count = p_page_count,
      has_text_layer = p_has_text_layer,
      review_status = 'published',
      is_current_version = true
  where id = p_statute_id;
end;
$$;


ALTER FUNCTION "public"."finalize_legislation_document"("p_statute_id" "uuid", "p_document_id" "uuid", "p_page_count" integer, "p_has_text_layer" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_legislation_document"("p_statute_id" "uuid", "p_document_id" "uuid", "p_page_count" integer, "p_has_text_layer" boolean) IS 'File-first Legislation flow (0098/0099, magistrate create 0114): links the uploaded PDF as the canonical viewing document and publishes. Admins may finalize any row (including replacements). Magistrates may finalize only a draft they created. Does not touch import_jobs.';



CREATE OR REPLACE FUNCTION "public"."find_next_available_docket_date"("p_category_id" "uuid", "p_start_date" "date", "p_max_days_ahead" integer DEFAULT 60, "p_docket_matter_id" "uuid" DEFAULT NULL::"uuid") RETURNS "date"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid;
  v_capacity integer;
  v_date date := p_start_date;
  v_days integer := 0;
begin
  if p_docket_matter_id is null then
    v_owner := (select auth.uid());
  else
    v_owner := public.new_docket_event_presiding_magistrate(p_docket_matter_id);
  end if;

  select daily_capacity into v_capacity
  from public.docket_capacity_settings
  where owner_id = v_owner and category_id = p_category_id;

  if v_owner is null or v_capacity is null then
    return p_start_date;
  end if;

  loop
    if public.docket_booked_count(v_owner, p_category_id, v_date, p_docket_matter_id) < v_capacity then
      return v_date;
    end if;

    v_date := v_date + 1;
    v_days := v_days + 1;
    exit when v_days >= p_max_days_ahead;
  end loop;

  return null;
end;
$$;


ALTER FUNCTION "public"."find_next_available_docket_date"("p_category_id" "uuid", "p_start_date" "date", "p_max_days_ahead" integer, "p_docket_matter_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."find_next_available_docket_date"("p_category_id" "uuid", "p_start_date" "date", "p_max_days_ahead" integer, "p_docket_matter_id" "uuid") IS 'Assistive only: the first date on/after p_start_date where the capacity owner is under their configured capacity for p_category_id, by docket_booked_count (0163), the count the booking enforces; p_start_date itself when no capacity is configured; null if none within p_max_days_ahead. The owner is the caller, or with p_docket_matter_id the magistrate a hearing the caller lists on that matter would go to (new_docket_event_presiding_magistrate), so a clerk is offered a day the sitting magistrate has free. SECURITY DEFINER to read that magistrate''s setting; returns only a date. Never writes anything.';



CREATE OR REPLACE FUNCTION "public"."flag_stale_drafts"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select j.id, j.owner_id, j.title
    from public.judgments j
    left join public.stale_draft_notices n
      on n.item_type = 'judgment' and n.item_id = j.id
    where j.status = 'draft'
      and j.updated_at < now() - interval '90 days'
      and j.owner_id is not null
      and (n.notified_at is null or n.notified_at < now() - interval '30 days')
  loop
    perform public.notify_user(
      r.owner_id,
      'stale_draft',
      'A judgment draft is stale',
      coalesce(r.title, 'This draft has not been edited in 90 days.'),
      '/judgments/' || r.id::text
    );
    insert into public.stale_draft_notices (item_type, item_id, notified_at)
    values ('judgment', r.id, now())
    on conflict (item_type, item_id) do update set notified_at = excluded.notified_at;
    v_count := v_count + 1;
  end loop;

  for r in
    select c.id, c.owner_id, c.case_name
    from public.case_law c
    left join public.stale_draft_notices n
      on n.item_type = 'case_law' and n.item_id = c.id
    where c.owner_id is not null
      and c.review_status in ('draft', 'needs_review')
      and c.updated_at < now() - interval '90 days'
      and (n.notified_at is null or n.notified_at < now() - interval '30 days')
  loop
    perform public.notify_user(
      r.owner_id,
      'stale_draft',
      'Case law research is stale',
      coalesce(r.case_name, 'This draft has not been edited in 90 days.'),
      '/case-law/' || r.id::text
    );
    insert into public.stale_draft_notices (item_type, item_id, notified_at)
    values ('case_law', r.id, now())
    on conflict (item_type, item_id) do update set notified_at = excluded.notified_at;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."flag_stale_drafts"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flag_stale_drafts"() IS 'Daily: notifies owners of judgment / personal case-law drafts untouched for 90 days, at most once per 30 days per record (stale_draft_notices). Called by run_scheduled_maintenance(); no email.';



CREATE OR REPLACE FUNCTION "public"."format_case_law_title"("p_input" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
declare
  v_placeholder constant text := 'Untitled (pending review)';
  v_trimmed text;
  v_parts text[];
  v_i integer;
  v_prev_connector boolean := false;
  v_out text[] := '{}';
  v_word text;
begin
  if p_input is null then
    return p_input;
  end if;
  v_trimmed := btrim(regexp_replace(p_input, '\s+', ' ', 'g'));
  if v_trimmed = '' then
    return v_trimmed;
  end if;
  if lower(v_trimmed) = lower(v_placeholder) then
    return v_placeholder;
  end if;

  v_parts := regexp_split_to_array(v_trimmed, ' ');
  for v_i in 1..coalesce(array_length(v_parts, 1), 0) loop
    v_word := v_parts[v_i];
    v_out := array_append(
      v_out,
      public.format_case_law_title_word(v_word, v_i = 1 or v_prev_connector)
    );
    v_prev_connector := lower(v_word) in ('v', 'vs', 'v.', 'vs.');
  end loop;
  return array_to_string(v_out, ' ');
end;
$$;


ALTER FUNCTION "public"."format_case_law_title"("p_input" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."format_case_law_title"("p_input" "text") IS 'Legal-aware Proper Case for case_law.case_name only. Keep in lockstep with src/lib/case-law-title.ts.';



CREATE OR REPLACE FUNCTION "public"."format_case_law_title_atom"("p_word" "text", "p_force_cap" boolean) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $_$
declare
  v_lower text;
begin
  if p_word is null or p_word = '' then
    return p_word;
  end if;
  v_lower := lower(p_word);

  if v_lower in ('v', 'vs', 'v.', 'vs.') then
    return v_lower;
  end if;

  if not p_force_cap and v_lower in ('of', 'the', 'and', 'in', 'for', 'ex', 'p', 'parte') then
    return v_lower;
  end if;

  if v_lower = 'a-g' then
    return 'A-G';
  end if;
  if v_lower in ('r', 'dpp', 'ag', 'ccj', 'cj') then
    return upper(p_word);
  end if;

  if v_lower ~ '^mc[a-z]{2,}$' then
    return 'Mc' || upper(substr(p_word, 3, 1)) || lower(substr(p_word, 4));
  end if;

  if v_lower ~ '^o''[a-z]+$' then
    return 'O''' || upper(substr(p_word, 3, 1)) || lower(substr(p_word, 4));
  end if;

  return upper(substr(p_word, 1, 1)) || lower(substr(p_word, 2));
end;
$_$;


ALTER FUNCTION "public"."format_case_law_title_atom"("p_word" "text", "p_force_cap" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."format_case_law_title_word"("p_word" "text", "p_force_cap" boolean) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
declare
  v_parts text[];
  v_out text[] := '{}';
  v_i integer;
begin
  if p_word is null then
    return p_word;
  end if;
  v_parts := string_to_array(p_word, '-');
  for v_i in 1..coalesce(array_length(v_parts, 1), 0) loop
    v_out := array_append(
      v_out,
      public.format_case_law_title_atom(v_parts[v_i], case when v_i = 1 then p_force_cap else true end)
    );
  end loop;
  return array_to_string(v_out, '-');
end;
$$;


ALTER FUNCTION "public"."format_case_law_title_word"("p_word" "text", "p_force_cap" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_docket_report_data"("p_date" "date", "p_court_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("matter_id" "uuid", "case_number" "text", "matter_title" "text", "charge_or_issue" "text", "status" "public"."docket_matter_status", "court_name" "text", "district_name" "text", "custody_status" "text", "procedure_stage" "text", "appearance_status" "text", "appearance_stage" "text", "category_id" "uuid", "category_name" "text", "witnesses_called" integer, "witnesses_completed" integer, "witnesses_partly_heard" integer, "witnesses_remaining" integer, "outcome_at_event" "text", "notes" "text", "orders_summary" "text", "outcome" "text", "next_appearance" "date", "parties" "jsonb")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select
    dm.id as matter_id,
    dm.case_number,
    dm.matter_title,
    dm.charge_or_issue,
    dm.status,
    c.name as court_name,
    md.name as district_name,
    dm.custody_status,
    dm.procedure_stage,
    appear.event_status as appearance_status,
    appear.stage_at_event as appearance_stage,
    appear.category_id,
    cat.name as category_name,
    appear.witnesses_called,
    appear.witnesses_completed,
    appear.witnesses_partly_heard,
    appear.witnesses_remaining,
    appear.outcome_at_event,
    appear.notes,
    dm.orders_summary,
    dm.outcome,
    (
      select min(e.scheduled_date)
      from public.docket_events e
      where e.docket_matter_id = dm.id
        and e.event_status = 'scheduled'
        and e.scheduled_date >= current_date
    ) as next_appearance,
    (
      select coalesce(jsonb_agg(jsonb_build_object('full_name', p.full_name, 'role', p.role) order by p.role, p.full_name), '[]'::jsonb)
      from public.docket_matter_parties p
      where p.docket_matter_id = dm.id and p.party_status = 'active'
    ) as parties
  from public.docket_matters dm
  left join public.courts c on c.id = dm.court_id
  left join public.magisterial_districts md on md.id = dm.district_id
  left join lateral (
    select e.event_status, e.stage_at_event, e.category_id, e.witnesses_called, e.witnesses_completed,
           e.witnesses_partly_heard, e.witnesses_remaining, e.outcome_at_event, e.notes
    from public.docket_events e
    where e.docket_matter_id = dm.id
      and e.scheduled_date = p_date
      and e.event_status <> 'entered_in_error'
    order by e.created_at desc
    limit 1
  ) appear on true
  left join public.docket_matter_categories cat on cat.id = appear.category_id
  where dm.deleted_at is null
  and exists (
    select 1 from public.docket_events e2
    where e2.docket_matter_id = dm.id
      and e2.scheduled_date = p_date
      and e2.event_status <> 'entered_in_error'
  )
  and (p_court_id is null or dm.court_id = p_court_id)
  order by dm.case_number, dm.matter_title;
$$;


ALTER FUNCTION "public"."get_daily_docket_report_data"("p_date" "date", "p_court_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_daily_docket_report_data"("p_date" "date", "p_court_id" "uuid") IS 'Daily Docket Progress Report. 0120 excludes binned matters.';



CREATE OR REPLACE FUNCTION "public"."get_docket_capacity_snapshot"("p_scheduled_date" "date", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_court_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("category_id" "uuid", "category_name" "text", "daily_capacity" integer, "scheduled_count" bigint, "status" "text", "total_matters_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with day_total as (
    select count(distinct e.docket_matter_id) as total_matters_count
    from public.docket_events e
    join public.docket_matters dm on dm.id = e.docket_matter_id
    where e.scheduled_date = p_scheduled_date
      and e.event_status <> 'entered_in_error'
      and dm.deleted_at is null
      and (p_court_id is null or dm.court_id = p_court_id)
  )
  select
    c.id as category_id,
    c.name as category_name,
    s.daily_capacity,
    ev.scheduled_count,
    case
      when s.daily_capacity is null then 'not_set'
      when ev.scheduled_count > s.daily_capacity then 'over_capacity'
      when ev.scheduled_count = s.daily_capacity then 'full'
      else 'available'
    end as status,
    coalesce((select dt.total_matters_count from day_total dt), 0) as total_matters_count
  from public.docket_matter_categories c
  left join public.docket_capacity_settings s
    on s.category_id = c.id and s.owner_id = (select auth.uid())
  cross join lateral (
    select public.docket_booked_count(
      (select auth.uid()), c.id, p_scheduled_date, null, p_court_id
    )::bigint as scheduled_count
  ) ev
  where p_category_id is null or c.id = p_category_id
  order by c.sort_order;
$$;


ALTER FUNCTION "public"."get_docket_capacity_snapshot"("p_scheduled_date" "date", "p_category_id" "uuid", "p_court_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_docket_capacity_snapshot"("p_scheduled_date" "date", "p_category_id" "uuid", "p_court_id" "uuid") IS 'Per-category capacity for the calling magistrate on one date, counted by docket_booked_count (0163), the same count the booking RPCs enforce, plus total_matters_count: distinct live files listed that day under the same membership as list_docket_matters(p_exact_date), any non-entered_in_error appearance, any classification, not restricted to the caller as presiding magistrate. Optional p_court_id narrows both counts to one court for display; tiles omit it, so their status matches enforcement.';



CREATE OR REPLACE FUNCTION "public"."global_search"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS SETOF "public"."search_result"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.enforce_rpc_rate_limit('global_search', 60, 60);

  -- A blank query is not a search: without this, the docket branch's
  -- "empty means browse" rule (0145) returned every matter in scope.
  p_query := public.btrim_whitespace(p_query);
  if p_query is null or p_query = '' then
    return;
  end if;
  if char_length(p_query) > 500 then
    raise exception 'Search terms must be 500 characters or fewer.'
      using errcode = '22001';
  end if;
  -- The cap for EACH result type (0172).
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 100);

  return query
  with provision_hits as (
    -- Best-ranked matching provision per Act, so an Act whose forty
    -- sections match is still one result.
    select distinct on (sp.statute_id)
      sp.statute_id,
      sp.id as provision_id,
      sp.level,
      sp.number,
      sp.heading,
      sp.body_text,
      ts_rank(sp.search_vector, websearch_to_tsquery('english', p_query)) as rank
    from public.statute_provisions sp
    where sp.search_vector @@ websearch_to_tsquery('english', p_query)
    order by sp.statute_id, ts_rank(sp.search_vector, websearch_to_tsquery('english', p_query)) desc
  )
  select
    hit.entity_type,
    hit.id,
    hit.title,
    hit.subtitle,
    ts_headline('english', hit.headline_source,
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10'),
    hit.rank
  from (
    (
      select
        'case'::text as entity_type,
        c.id,
        c.title,
        c.case_number as subtitle,
        coalesce(c.description, '') as headline_source,
        ts_rank(c.search_vector, websearch_to_tsquery('english', p_query)) as rank
      from public.cases c
      where c.search_vector @@ websearch_to_tsquery('english', p_query)
        and public.user_can_access_case(c.id)
      order by rank desc, c.id
      limit p_limit
    )

    union all

    (
      select
        'bench_note'::text,
        n.id,
        n.title,
        null::text,
        coalesce(n.content_text, ''),
        ts_rank(n.search_vector, websearch_to_tsquery('english', p_query)) as rank
      from public.bench_notes n
      where n.search_vector @@ websearch_to_tsquery('english', p_query)
        and public.user_can_access_bench_note(n.id)
      order by rank desc, n.id
      limit p_limit
    )

    union all

    (
      select
        'statute'::text,
        s.id,
        s.title,
        -- Name the section when one matched, so a hit inside an Act says
        -- WHERE it is rather than only which Act it was in.
        case
          when ph.provision_id is not null then
            nullif(
              trim(coalesce(initcap(ph.level), '') || ' ' || coalesce(ph.number, '')),
              ''
            ) || coalesce(' - ' || nullif(ph.heading, ''), '')
          else s.code
        end,
        -- A provision hit takes its excerpt from that section.
        case
          when ph.provision_id is not null then
            coalesce(ph.heading, '') || ' ' || coalesce(ph.body_text, '')
          else coalesce(s.summary, s.full_text, '')
        end,
        greatest(
          coalesce(ts_rank(s.search_vector, websearch_to_tsquery('english', p_query)), 0),
          coalesce(ph.rank, 0)
        ) as rank
      from public.statutes s
      left join provision_hits ph on ph.statute_id = s.id
      where s.search_vector @@ websearch_to_tsquery('english', p_query)
         or ph.provision_id is not null
      order by rank desc, s.id
      limit p_limit
    )

    union all

    (
      select
        'case_law'::text,
        cl.id,
        cl.case_name,
        cl.citation,
        coalesce(cl.summary, cl.full_text, ''),
        public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) as rank
      from private.case_law_search_hits(p_query) h
      join public.case_law cl on cl.id = h.id
      order by rank desc, cl.id
      limit p_limit
    )

    union all

    (
      select
        'docket_matter'::text,
        dm.id,
        dm.matter_title,
        dm.case_number,
        concat_ws(' ', dm.case_number, dm.matter_title, coalesce(dm.charge_or_issue, ''), coalesce(dm.orders_summary, '')),
        public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query) as rank
      from private.docket_matter_search_hits(p_query) h
      join public.docket_matters dm on dm.id = h.id
      where dm.deleted_at is null
      order by rank desc, dm.id
      limit p_limit
    )

    union all

    (
      select
        'judgment'::text,
        j.id,
        j.title,
        j.citation,
        coalesce(j.content_text, ''),
        ts_rank(j.search_vector, websearch_to_tsquery('english', p_query)) as rank
      from public.judgments j
      where j.search_vector @@ websearch_to_tsquery('english', p_query)
      order by rank desc, j.id
      limit p_limit
    )

    union all

    (
      select
        'quick_code'::text,
        qc.id,
        coalesce(qc.title, qc.code_word),
        qc.code_word,
        coalesce(qc.content, ''),
        ts_rank(qc.search_vector, websearch_to_tsquery('english', p_query)) as rank
      from public.quick_codes qc
      where qc.search_vector @@ websearch_to_tsquery('english', p_query)
      order by rank desc, qc.id
      limit p_limit
    )
  ) hit
  order by hit.rank desc, hit.entity_type, hit.id;
end;
$$;


ALTER FUNCTION "public"."global_search"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."global_search"("p_query" "text", "p_limit" integer) IS 'Unified search across case, bench note, statute (and provision), case law, docket matter, judgment and quick code. 0166: blank query, length and limit guards. 0171: index-served case_law and docket_matter candidates. 0172: p_limit (1-100, default 20) caps EACH type, so one type can no longer crowd out the rest; rows still come ordered by rank, and headlines are built only for the rows returned. RLS applies to every returned row.';



CREATE OR REPLACE FUNCTION "public"."guyana_today"() RETURNS "date"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select (timezone('America/Guyana', now()))::date;
$$;


ALTER FUNCTION "public"."guyana_today"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role public.user_role;
  v_requested_court_ids uuid[];
begin
  v_role := case
    when new.raw_user_meta_data ->> 'requested_role' = 'clerk' then 'clerk'::public.user_role
    else 'magistrate'::public.user_role
  end;

  -- profiles.court_id is never taken from sign-up metadata (0160): court
  -- access comes only from an approved magistrate_courts / clerk_courts row.
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    v_role
  );

  begin
    select array_agg(elem::uuid)
    into v_requested_court_ids
    from jsonb_array_elements_text(
      coalesce(new.raw_user_meta_data -> 'requested_court_ids', '[]'::jsonb)
    ) as elem;
  exception when others then
    v_requested_court_ids := null;
  end;

  if v_requested_court_ids is not null and array_length(v_requested_court_ids, 1) > 0 then
    if v_role = 'clerk' then
      insert into public.clerk_access_requests (profile_id, court_id, staff_id, note)
      select
        new.id,
        c.id,
        nullif(trim(new.raw_user_meta_data ->> 'staff_id'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'note'), '')
      from public.courts c
      where c.id = any (v_requested_court_ids) and c.is_active = true
      on conflict (profile_id, court_id) where status = 'pending' do nothing;
    elsif v_role = 'magistrate' then
      insert into public.magistrate_court_requests (profile_id, court_id, staff_id, note, request_kind)
      select
        new.id,
        c.id,
        nullif(trim(new.raw_user_meta_data ->> 'staff_id'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'note'), ''),
        case
          when public.court_has_active_primary_magistrate(c.id) then 'occupied_exception'
          else 'ordinary'
        end
      from public.courts c
      where c.id = any (v_requested_court_ids) and c.is_active = true
      on conflict (profile_id, court_id) where status = 'pending' do nothing;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_new_user"() IS 'Auto-provisions a profiles row on signup, and creates pending court requests for valid active court ids. Magistrate requests for a court that already has a signed-in primary are stored as occupied_exception and do not occupy the slot. Invalid ids never fail signup.';



CREATE OR REPLACE FUNCTION "public"."has_active_clerk_assignment"("p_court_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select (select public.is_active_account()) and exists (
    select 1 from public.clerk_courts cc
    where cc.court_id = p_court_id
      and cc.profile_id = auth.uid()
      and cc.ended_at is null
  );
$$;


ALTER FUNCTION "public"."has_active_clerk_assignment"("p_court_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_active_clerk_assignment"("p_court_id" "uuid") IS 'True if the authenticated user has a CURRENT (ended_at IS NULL) clerk_courts assignment to the given court -- the clerk analogue of can_access_court() (0020). This is the ONLY Docket access path a clerk role can ever satisfy; case_law/judgment/statute policies never call this function.';



CREATE OR REPLACE FUNCTION "public"."has_active_magistrate_court"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select (select public.is_active_account()) and exists (
    select 1 from public.magistrate_courts
    where profile_id = (select auth.uid())
      and ended_at is null
  );
$$;


ALTER FUNCTION "public"."has_active_magistrate_court"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_active_magistrate_court"() IS 'True if the authenticated caller currently holds at least one active (ended_at IS NULL) magistrate_courts row, of any assignment_type. Used to gate the shared Case Law/Judgments/Legislation library to a magistrate who has not yet been approved for a court (0117) -- a no-op for admin and for a magistrate who already holds a court.';



CREATE OR REPLACE FUNCTION "public"."has_docket_matter_authority"("p_docket_matter_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.docket_matters dm
    where dm.id = p_docket_matter_id
      and ((select public.can_access_court(dm.court_id))
           or (select public.has_retained_assignment(dm.id)))
  );
$$;


ALTER FUNCTION "public"."has_docket_matter_authority"("p_docket_matter_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_docket_matter_authority"("p_docket_matter_id" "uuid") IS 'True if the authenticated user currently satisfies can_access_court() OR has_retained_assignment() for the given Docket Matter -- i.e. ordinary lawful Docket access, NEVER share-based. SECURITY DEFINER, deliberately: queries docket_matters directly, bypassing its own RLS, so this function can safely be called FROM WITHIN shares'' own RLS policies without re-triggering docket_matters'' policy (which itself calls has_docket_share(), which queries shares) -- breaking what would otherwise be a structurally circular RLS dependency. Returns only a boolean derived from auth.uid() and the given id; no row data (e.g. court_id) is ever exposed. Used ONLY for shares-management authority (create/revoke/see-for-management-purposes) -- NEVER used to grant Docket Matter access itself (that remains can_access_court()/has_retained_assignment() called directly, or has_docket_share() for the share path).';



CREATE OR REPLACE FUNCTION "public"."has_docket_share"("p_docket_matter_id" "uuid", "p_required_permission" "text" DEFAULT 'view'::"text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select (select public.is_active_account()) and exists (
    select 1 from public.shares s
    where s.item_type = 'docket_matter'
      and s.item_id = p_docket_matter_id
      and s.recipient_id = (select auth.uid())
      and s.revoked_at is null
      and (p_required_permission = 'view' or s.permission = 'edit')
  );
$$;


ALTER FUNCTION "public"."has_docket_share"("p_docket_matter_id" "uuid", "p_required_permission" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_docket_share"("p_docket_matter_id" "uuid", "p_required_permission" "text") IS 'True if the authenticated user holds a currently-active (revoked_at IS NULL) Docket share on the given Docket Matter, at or above the required permission level. p_required_permission defaults to ''view'' -- pass ''edit'' to require edit specifically. edit implies view (satisfies a ''view'' check); view never satisfies an ''edit'' check. SECURITY INVOKER: queries shares as the calling user, subject to shares'' own RLS as normal -- safe from recursion because shares'' RLS only reaches back into docket_matters via the SECURITY DEFINER has_docket_matter_authority(), never through a normal RLS-filtered reference. Used by docket_matters and its institutional children/association tables to extend view/edit access via an active share, alongside (never replacing) can_access_court()/has_retained_assignment().';



CREATE OR REPLACE FUNCTION "public"."has_item_share"("p_item_type" "text", "p_item_id" "uuid", "p_required_permission" "text" DEFAULT 'view'::"text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.shares s
    where s.item_type = p_item_type
      and s.item_id = p_item_id
      and s.recipient_id = (select auth.uid())
      and s.revoked_at is null
      and (p_required_permission = 'view' or s.permission = 'edit')
  );
$$;


ALTER FUNCTION "public"."has_item_share"("p_item_type" "text", "p_item_id" "uuid", "p_required_permission" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_item_share"("p_item_type" "text", "p_item_id" "uuid", "p_required_permission" "text") IS 'True if the caller holds an active share on (item_type, item_id) at or above p_required_permission. edit implies view. SECURITY DEFINER so can_view_* / inline table policies can call it without RLS recursion through shares.';



CREATE OR REPLACE FUNCTION "public"."has_item_share_authority"("p_item_type" "text", "p_item_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case p_item_type
    when 'docket_matter' then public.has_docket_matter_authority(p_item_id)
    when 'judgment' then exists (
      select 1 from public.judgments j
      where j.id = p_item_id and j.owner_id = (select auth.uid())
    )
    when 'case_law' then exists (
      select 1 from public.case_law cl
      where cl.id = p_item_id and cl.owner_id = (select auth.uid())
    )
    else false
  end;
$$;


ALTER FUNCTION "public"."has_item_share_authority"("p_item_type" "text", "p_item_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_item_share_authority"("p_item_type" "text", "p_item_id" "uuid") IS 'Share-management authority (create/revoke/see): Docket Court/retained path, Judgment owner, or personal Case Law owner. Canonical Case Law (owner_id IS NULL) is never true. Does not consult shares — no resharing. SECURITY DEFINER so shares RLS can call it without recursion.';



CREATE OR REPLACE FUNCTION "public"."has_retained_assignment"("p_docket_matter_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select (select public.is_active_account()) and exists (
    select 1 from public.docket_matter_assignments dma
    where dma.docket_matter_id = p_docket_matter_id
      and dma.profile_id = auth.uid()
      and dma.ended_at is null
  );
$$;


ALTER FUNCTION "public"."has_retained_assignment"("p_docket_matter_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_retained_assignment"("p_docket_matter_id" "uuid") IS 'True if the authenticated user holds a current (ended_at IS NULL) retained/part-heard assignment to the given Docket Matter. This is the second of the three approved Docket access paths (court assignment, retained assignment, shares) — the shares path remains unimplemented per the approved incremental RLS plan.';



CREATE OR REPLACE FUNCTION "public"."is_active_account"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select p.is_active from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;


ALTER FUNCTION "public"."is_active_account"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_active_account"() IS 'True when the caller has a profile and it is active (0200, BE-09). False for anon and for a deactivated account. Every role, court and docket helper ANDs it in; the restrictive policies use active_account_id().';



CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  )
  and (
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or not coalesce(
      (select f.enabled from public.feature_flags f where f.key = 'require_admin_mfa'),
      false
    )
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_admin"() IS 'True when the caller''s profile is an active administrator (0200) and, while the require_admin_mfa feature flag is on, the session has verified a second factor (aal2, 0210). The gate of every admin-only RPC and policy.';



CREATE OR REPLACE FUNCTION "public"."is_clerk"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'clerk' and is_active
  );
$$;


ALTER FUNCTION "public"."is_clerk"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_clerk"() IS 'True if the authenticated user''s profiles.role is ''clerk''. A role check only -- carries no Court access by itself; see has_active_clerk_assignment() (0087).';



CREATE OR REPLACE FUNCTION "public"."is_court_sitting_day"("p_date" "date", "p_court_id" "uuid" DEFAULT NULL::"uuid", "p_district_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with scoped as (
    select d.kind
    from public.court_non_sitting_days d
    where d.holiday_date = p_date
      and (
        (d.court_id is null and d.district_id is null)
        or (p_court_id is not null and d.court_id = p_court_id)
        or (p_district_id is not null and d.district_id = p_district_id)
      )
  )
  select case
    -- An explicit sitting exception beats the weekend rule and any
    -- holiday recorded for the same day.
    when exists (select 1 from scoped where kind = 'sitting_exception') then true
    when exists (select 1 from scoped) then false
    -- Saturday (6) and Sunday (7): a rule, never rows.
    when extract(isodow from p_date) >= 6 then false
    else true
  end;
$$;


ALTER FUNCTION "public"."is_court_sitting_day"("p_date" "date", "p_court_id" "uuid", "p_district_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_court_sitting_day"("p_date" "date", "p_court_id" "uuid", "p_district_id" "uuid") IS 'Advisory: does this court sit on this date? Weekends are a rule; recorded non-sitting days are data; a sitting_exception beats both. SECURITY INVOKER -- court_non_sitting_days is readable by every authenticated user, so DEFINER would add nothing. The district is a PARAMETER rather than resolved from public.courts: resolving it here would silently return the wrong answer for any caller who cannot read that court row, which is a failure mode that looks like "the warning just stopped appearing". Deliberately NOT called by set_docket_matter_next_date: scheduling warns, it never blocks.';



CREATE OR REPLACE FUNCTION "public"."is_magistrate"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'magistrate' and is_active
  );
$$;


ALTER FUNCTION "public"."is_magistrate"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_magistrate"() IS 'True if the authenticated user''s profiles.role is ''magistrate''. Mirrors is_admin() (0001). A role check only -- carries no Court access by itself; see can_access_court().';



CREATE OR REPLACE FUNCTION "public"."is_sole_admin_bootstrap_available"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select (select public.is_admin())
    and (select count(*) from public.profiles where role = 'admin' and is_active = true) = 1;
$$;


ALTER FUNCTION "public"."is_sole_admin_bootstrap_available"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_sole_admin_bootstrap_available"() IS 'True only when the caller is_admin() AND exactly one active administrator profile exists system-wide. A convenience check for the admin review UI to decide whether to render the sole-administrator self-approval control (admin_bootstrap_self_approve_magistrate_court_request(), 0107) at all -- the RPC itself independently re-verifies the same condition (and more) server-side regardless of what this returns, so this is UI guidance only, never the actual authorization boundary.';



CREATE OR REPLACE FUNCTION "public"."issue_reports_notify_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_status_label text;
begin
  if tg_op <> 'UPDATE' or new.status is not distinct from old.status then
    return new;
  end if;

  v_status_label := case new.status
    when 'open' then 'reopened'
    when 'in_progress' then 'in progress'
    when 'resolved' then 'resolved'
    when 'wont_fix' then 'closed (will not fix)'
    else replace(new.status, '_', ' ')
  end;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    new.reporter_id,
    'issue_report_decided',
    'Your ' || new.type || ' report is ' || v_status_label,
    left(new.title, 200),
    null
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."issue_reports_notify_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."judgment_tags_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.created_by := (select auth.uid());
  new.tag_name := btrim(new.tag_name);
  return new;
end;
$$;


ALTER FUNCTION "public"."judgment_tags_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."judgments_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := (select auth.uid());
  elsif tg_op = 'UPDATE' then
    -- transfer_judgment_ownership is SECURITY DEFINER, so a client or the
    -- service role here means the change did not come through it.
    if new.owner_id is distinct from old.owner_id
      and current_user in ('anon', 'authenticated', 'service_role')
    then
      raise exception 'A Judgment''s owner changes only through an administrator''s transfer (transfer_judgment_ownership).'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."judgments_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."judgments_guard"() IS 'BEFORE INSERT OR UPDATE on judgments: forces owner_id to auth.uid() at creation, and refuses an owner_id change from anon, authenticated or the service role, so it changes only through transfer_judgment_ownership (0220, ADR 0011), which records it.';



CREATE OR REPLACE FUNCTION "public"."judgments_notify_final"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
begin
  if old.status is not distinct from new.status or new.status is distinct from 'final' then
    return new;
  end if;

  for r in
    select recipient_id
    from public.shares
    where item_type = 'judgment'
      and item_id = new.id
      and revoked_at is null
      and recipient_id is not null
      and public.can_receive_research_share(recipient_id)
  loop
    perform public.notify_user(
      r.recipient_id,
      'judgment_final',
      'A judgment was finalised',
      coalesce(new.title, 'A shared judgment is now final.'),
      '/judgments/' || new.id::text
    );
  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."judgments_notify_final"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_active_courts_for_magistrate_signup"() RETURNS TABLE("id" "uuid", "name" "text", "district_id" "uuid", "is_assigned" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select c.id, c.name, c.district_id, public.court_has_active_primary_magistrate(c.id)
  from public.courts c
  where c.is_active = true
  order by c.name;
$$;


ALTER FUNCTION "public"."list_active_courts_for_magistrate_signup"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_active_courts_for_magistrate_signup"() IS 'Anon-callable: id/name/district_id/is_assigned of currently-active courts, for the public magistrate-registration picker. is_assigned discloses occupancy only, never identity (see court_has_active_primary_magistrate(), 0107). Deliberately does not expose jurisdiction/address/created_at/updated_at, and does not alter courts'' own RLS (still authenticated-only).';



CREATE OR REPLACE FUNCTION "public"."list_active_courts_for_signup"() RETURNS TABLE("id" "uuid", "name" "text", "district_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id, name, district_id
  from public.courts
  where is_active = true
  order by name;
$$;


ALTER FUNCTION "public"."list_active_courts_for_signup"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_active_courts_for_signup"() IS 'Anon-callable (0095): id/name/district_id of currently-active courts only, for the public clerk-registration picker. Deliberately does not expose jurisdiction/address/created_at/updated_at, and does not alter courts'' own RLS (still authenticated-only).';



CREATE OR REPLACE FUNCTION "public"."list_active_magisterial_districts_for_signup"() RETURNS TABLE("id" "uuid", "name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id, name
  from public.magisterial_districts
  where is_active = true
  order by name;
$$;


ALTER FUNCTION "public"."list_active_magisterial_districts_for_signup"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_active_magisterial_districts_for_signup"() IS 'Anon-callable (0095): id/name of currently-active Magisterial Districts only, for the public clerk-registration picker. Deliberately does not expose is_active/created_at/updated_at, and does not alter magisterial_districts'' own RLS (still authenticated-only).';



CREATE OR REPLACE FUNCTION "public"."list_binned_docket_matters"() RETURNS TABLE("id" "uuid", "case_number" "text", "matter_title" "text", "status" "public"."docket_matter_status", "court_id" "uuid", "court_name" "text", "deleted_at" timestamp with time zone, "deleted_by" "uuid", "updated_at" timestamp with time zone, "can_purge" boolean)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select
    dm.id,
    dm.case_number,
    dm.matter_title,
    dm.status,
    dm.court_id,
    c.name as court_name,
    dm.deleted_at,
    dm.deleted_by,
    dm.updated_at,
    public.has_docket_matter_authority(dm.id) as can_purge
  from public.docket_matters dm
  left join public.courts c on c.id = dm.court_id
  where dm.deleted_at is not null
    and public.can_edit_docket_matter(dm.id)
  order by dm.deleted_at desc;
$$;


ALTER FUNCTION "public"."list_binned_docket_matters"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_binned_docket_matters"() IS 'Matters in the bin that the caller can edit (and so restore), with can_purge where the caller may also empty them now. Read only: it no longer runs purge_expired_docket_matters (0161); the hourly pg_cron job does.';



CREATE OR REPLACE FUNCTION "public"."list_clerk_access_requests_needing_admin_attention"() RETURNS SETOF "public"."clerk_access_requests"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.*
  from public.clerk_access_requests r
  where (select public.is_admin())
    and r.status = 'pending'
    and (select public.clerk_access_request_email_confirmed(r.id))
    and (select public.court_has_no_clerk_approver(r.court_id));
$$;


ALTER FUNCTION "public"."list_clerk_access_requests_needing_admin_attention"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_clerk_access_requests_needing_admin_attention"() IS 'Admin-only (returns zero rows for any non-admin caller, rather than raising): every verified, still-pending clerk access request whose court currently has no magistrate who could review it. Surfaces exactly the "no authorized approving magistrate can be identified" case the feature spec requires be exposed to an administrator, never silently or automatically approved.';



CREATE OR REPLACE FUNCTION "public"."list_courts_for_magistrate_request"() RETURNS TABLE("id" "uuid", "name" "text", "district_id" "uuid", "status" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    c.id,
    c.name,
    c.district_id,
    case
      when not c.is_active then 'inactive'
      when exists (
        select 1 from public.magistrate_courts mc
        where mc.court_id = c.id and mc.profile_id = (select auth.uid()) and mc.ended_at is null
      ) then 'assigned_to_you'
      when exists (
        select 1 from public.magistrate_court_requests r
        where r.court_id = c.id and r.profile_id = (select auth.uid()) and r.status = 'pending'
      ) then 'pending'
      when public.court_has_active_primary_magistrate(c.id) then 'assigned'
      else 'available'
    end as status
  from public.courts c
  order by c.name;
$$;


ALTER FUNCTION "public"."list_courts_for_magistrate_request"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_courts_for_magistrate_request"() IS 'Authenticated-only, personalized: per active-or-inactive court, one of inactive|assigned_to_you|pending|assigned|available, folding in the caller''s own magistrate_courts/magistrate_court_requests rows -- never discloses who else holds a court.';



CREATE OR REPLACE FUNCTION "public"."list_docket_matters"("p_query" "text" DEFAULT ''::"text", "p_limit" integer DEFAULT 100, "p_procedure_stages" "text"[] DEFAULT NULL::"text"[], "p_custody" "text"[] DEFAULT NULL::"text"[], "p_disclosure" "text"[] DEFAULT NULL::"text"[], "p_trial" "text"[] DEFAULT NULL::"text"[], "p_next_date" "text"[] DEFAULT NULL::"text"[], "p_exact_date" "date" DEFAULT NULL::"date", "p_court_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "case_number" "text", "matter_title" "text", "status" "public"."docket_matter_status", "charge_or_issue" "text", "cover_image_path" "text", "court_id" "uuid", "district_id" "uuid", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "court_name" "text", "arraignment_status" "text", "custody_status" "text", "disclosure_status" "text", "trial_status" "text", "paper_committal_status" "text", "ruling_status" "text", "judgment_status" "text", "sentence_status" "text", "appeal_status" "text", "information_sworn_status" "text", "summons_served" "text", "returns_of_summons" "text", "civil_trial_held" "text", "decision_granted" "text", "decision_amount" numeric, "stage_adjournments" "jsonb", "outcome_status" "text", "outcome_adjourned" boolean, "workflow_protocol" "text", "procedure_stage" "text", "next_appearance" "date", "can_edit" boolean, "has_ruling_document" boolean, "has_judgment_document" boolean, "appearance_status" "text", "appearance_stage" "text", "appearance_outcome" "text", "category_id" "uuid", "category_name" "text", "category_other" "text", "rank" real, "headline" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with board as (
    select
      dm.id,
      dm.case_number,
      dm.matter_title,
      dm.status,
      dm.charge_or_issue,
      dm.cover_image_path,
      dm.court_id,
      dm.district_id,
      dm.created_at,
      dm.updated_at,
      c.name as court_name,
      dm.arraignment_status,
      dm.custody_status,
      dm.disclosure_status,
      dm.trial_status,
      dm.paper_committal_status,
      dm.ruling_status,
      dm.judgment_status,
      dm.sentence_status,
      dm.appeal_status,
      dm.information_sworn_status,
      dm.summons_served,
      dm.returns_of_summons,
      dm.civil_trial_held,
      dm.decision_granted,
      dm.decision_amount,
      dm.stage_adjournments,
      dm.outcome_status,
      dm.outcome_adjourned,
      dm.workflow_protocol,
      dm.procedure_stage,
      (
        select min(e.scheduled_date)
        from public.docket_events e
        where e.docket_matter_id = dm.id
          and e.event_status = 'scheduled'
          and e.scheduled_date >= current_date
      ) as next_appearance,
      public.can_edit_docket_matter(dm.id) as can_edit,
      exists (
        select 1 from public.documents d
        where d.entity_type = 'docket_matter' and d.entity_id = dm.id and d.purpose = 'ruling'
      ) as has_ruling_document,
      exists (
        select 1 from public.documents d
        where d.entity_type = 'docket_matter' and d.entity_id = dm.id and d.purpose = 'judgment'
      ) as has_judgment_document,
      appear.event_status as appearance_status,
      appear.stage_at_event as appearance_stage,
      appear.outcome_at_event as appearance_outcome,
      dm.category_id,
      cat.name as category_name,
      dm.category_other,
      case
        when btrim(coalesce(p_query, '')) = '' then 0::real
        else public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query)
      end as rank,
      case
        when btrim(coalesce(p_query, '')) = '' then null::text
        else ts_headline(
          'english',
          concat_ws(' ', dm.case_number, dm.matter_title, coalesce(dm.charge_or_issue, ''), coalesce(dm.orders_summary, '')),
          websearch_to_tsquery('english', p_query),
          'MaxFragments=2, MaxWords=30, MinWords=10'
        )
      end as headline
    from (
      select d.* from public.docket_matters d
      where btrim(coalesce(p_query, '')) = ''
      union all
      select d.* from private.docket_matter_search_hits(p_query) h
      join public.docket_matters d on d.id = h.id
    ) dm
    left join public.courts c on c.id = dm.court_id
    left join public.docket_matter_categories cat on cat.id = dm.category_id
    left join lateral (
      select e.event_status, e.stage_at_event, e.outcome_at_event
      from public.docket_events e
      where e.docket_matter_id = dm.id
        and p_exact_date is not null
        and e.scheduled_date = p_exact_date
        and e.event_status <> 'entered_in_error'
      order by e.created_at desc
      limit 1
    ) appear on true
    where dm.deleted_at is null
      and (p_court_id is null or dm.court_id = p_court_id)
      and (
        p_procedure_stages is null
        or cardinality(p_procedure_stages) = 0
        or dm.procedure_stage = any (p_procedure_stages)
      )
      and (
        p_custody is null
        or cardinality(p_custody) = 0
        or (
          dm.workflow_protocol in ('criminal_trial', 'paper_committal')
          and dm.custody_status = any (p_custody)
        )
      )
      and (
        p_disclosure is null
        or cardinality(p_disclosure) = 0
        or (
          dm.workflow_protocol in ('criminal_trial', 'paper_committal')
          and dm.disclosure_status = any (p_disclosure)
        )
      )
      and (
        p_trial is null
        or cardinality(p_trial) = 0
        or (
          dm.workflow_protocol = 'criminal_trial'
          and dm.trial_status = any (p_trial)
        )
      )
      and (
        p_exact_date is null
        or exists (
          select 1 from public.docket_events e2
          where e2.docket_matter_id = dm.id
            and e2.scheduled_date = p_exact_date
            and e2.event_status <> 'entered_in_error'
        )
      )
  )
  select
    board.id, board.case_number, board.matter_title, board.status, board.charge_or_issue,
    board.cover_image_path, board.court_id, board.district_id, board.created_at, board.updated_at,
    board.court_name, board.arraignment_status, board.custody_status, board.disclosure_status,
    board.trial_status, board.paper_committal_status, board.ruling_status, board.judgment_status,
    board.sentence_status, board.appeal_status, board.information_sworn_status, board.summons_served,
    board.returns_of_summons, board.civil_trial_held, board.decision_granted, board.decision_amount,
    board.stage_adjournments, board.outcome_status, board.outcome_adjourned, board.workflow_protocol,
    board.procedure_stage, board.next_appearance, board.can_edit,
    board.has_ruling_document, board.has_judgment_document, board.appearance_status,
    board.appearance_stage, board.appearance_outcome, board.category_id, board.category_name,
    board.category_other, board.rank, board.headline
  from board
  where
    p_exact_date is not null
    or p_next_date is null
    or cardinality(p_next_date) = 0
    or (
      ('today' = any (p_next_date) and board.next_appearance = current_date)
      or ('upcoming' = any (p_next_date) and board.next_appearance > current_date)
      or ('no_date' = any (p_next_date) and board.next_appearance is null)
    )
  order by board.rank desc, board.updated_at desc
  limit p_limit;
$$;


ALTER FUNCTION "public"."list_docket_matters"("p_query" "text", "p_limit" integer, "p_procedure_stages" "text"[], "p_custody" "text"[], "p_disclosure" "text"[], "p_trial" "text"[], "p_next_date" "text"[], "p_exact_date" "date", "p_court_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_docket_matters"("p_query" "text", "p_limit" integer, "p_procedure_stages" "text"[], "p_custody" "text"[], "p_disclosure" "text"[], "p_trial" "text"[], "p_next_date" "text"[], "p_exact_date" "date", "p_court_id" "uuid") IS 'Docket spreadsheet/tiles list. SECURITY INVOKER. 0146 adds workflow_protocol columns. 0171: a search reads its candidates from private.docket_matter_search_hits (index-served), the same match as search_docket_matters and global_search.';



CREATE OR REPLACE FUNCTION "public"."list_magistrate_court_request_email_confirmation"() RETURNS TABLE("request_id" "uuid", "email_confirmed" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.id, (u.email_confirmed_at is not null)
  from public.magistrate_court_requests r
  join auth.users u on u.id = r.profile_id
  where r.profile_id = (select auth.uid())
     or (select public.is_admin());
$$;


ALTER FUNCTION "public"."list_magistrate_court_request_email_confirmation"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_magistrate_court_request_email_confirmation"() IS 'Returns (request_id, email_confirmed) for magistrate_court_requests the caller may see: own rows, or all rows if is_admin(). Does not expose auth.users.';



CREATE OR REPLACE FUNCTION "public"."magistrate_court_request_email_confirmed"("p_request_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.magistrate_court_requests r
    join auth.users u on u.id = r.profile_id
    where r.id = p_request_id and u.email_confirmed_at is not null
  );
$$;


ALTER FUNCTION "public"."magistrate_court_request_email_confirmed"("p_request_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."magistrate_court_request_email_confirmed"("p_request_id" "uuid") IS 'True only if the magistrate who owns magistrate_court_requests row p_request_id has a confirmed email. Scoped to one specific existing request id, not a general profile-email-status lookup. Used to keep an unverified magistrate''s request invisible to admin review until confirmed, mirroring clerk_access_request_email_confirmed().';



CREATE OR REPLACE FUNCTION "public"."magistrate_court_requests_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_court text;
  v_reason text;
begin
  select name into v_court from public.courts where id = new.court_id;

  if tg_op = 'INSERT' and new.status::text = 'pending' then
    perform public.notify_admins(
      'court_request',
      'Magistrate court request',
      coalesce(v_court, 'A magistrate requested a court assignment.'),
      '/admin/court-assignments'
    );
  elsif tg_op = 'UPDATE'
    and old.status::text = 'pending'
    and new.status::text in ('approved', 'rejected')
  then
    v_reason := nullif(trim(coalesce(new.rejection_reason, '')), '');
    perform public.notify_user(
      new.profile_id,
      'court_request_decided',
      case
        when new.status::text = 'approved' then 'Your court request was approved'
        else 'Your court request was returned'
      end,
      case
        when new.status::text = 'approved' then
          coalesce(v_court, 'See Court Assignments for details.')
        else
          trim(both from concat_ws(
            ' ',
            v_reason,
            'You can request again from Court Assignments. If you signed up as the wrong account type, contact a Court Assignment Administrator.'
          ))
      end,
      '/court-assignments'
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."magistrate_court_requests_notify"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."magistrate_courts_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_court text;
begin
  if new.ended_at is not null then
    return new;
  end if;

  select name into v_court from public.courts where id = new.court_id;

  perform public.notify_user(
    new.profile_id,
    'court_assigned',
    'You were assigned to a court',
    coalesce(v_court, 'A court assignment is now active.'),
    '/court-assignments'
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."magistrate_courts_notify"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_past_hearings"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer;
begin
  update public.docket_events de
     set event_status = 'past'
   where de.event_status = 'scheduled'
     and de.scheduled_date < public.guyana_today()
     and not exists (
       select 1 from public.docket_matters dm
       where dm.id = de.docket_matter_id
         and dm.deleted_at is not null
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."mark_past_hearings"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_past_hearings"() IS 'Marks still-scheduled docket_events as past once the Guyana calendar date has elapsed. Skips binned matters, which are frozen until restored (0161).';



CREATE OR REPLACE FUNCTION "public"."matter_current_stage_label"("p_docket_matter_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select case dm.procedure_stage
    when 'arraignment' then 'Arraignment'
    when 'custody' then 'Custody'
    when 'disclosure' then 'Disclosure'
    when 'trial' then 'Trial'
    when 'paper_committal' then 'Paper Committal'
    when 'ruling' then 'Ruling'
    when 'judgment' then 'Judgment'
    when 'sentence' then 'Sentence'
    when 'appeal' then 'Appeal'
    when 'information_sworn' then 'Information Sworn'
    when 'summons_served' then 'Summons Served'
    when 'returns_of_summons' then 'Returns of Summons'
    when 'civil_trial' then 'Trial'
    when 'decision' then 'Decision'
    else initcap(replace(dm.procedure_stage, '_', ' '))
  end
  from public.docket_matters dm
  where dm.id = p_docket_matter_id;
$$;


ALTER FUNCTION "public"."matter_current_stage_label"("p_docket_matter_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_court_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.court_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
    and (
      exists (
        select 1 from public.magistrate_courts mc
        where mc.profile_id = p.id and mc.court_id = p.court_id and mc.ended_at is null
      )
      or exists (
        select 1 from public.clerk_courts cc
        where cc.profile_id = p.id and cc.court_id = p.court_id and cc.ended_at is null
      )
    );
$$;


ALTER FUNCTION "public"."my_court_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."my_court_id"() IS 'The caller''s legacy profiles.court_id, but only while they hold an active, approved magistrate_courts or clerk_courts assignment at that court (0160). Gates the legacy cases family and its documents; the column alone grants nothing.';



CREATE OR REPLACE FUNCTION "public"."new_docket_event_presiding_magistrate"("p_docket_matter_id" "uuid", "p_prior_event_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_profile_id uuid;
begin
  if not public.is_clerk() then
    return (select auth.uid());
  end if;

  if not public.can_edit_docket_matter(p_docket_matter_id) then
    return null;
  end if;

  -- The magistrate of the sitting being superseded, while they can still
  -- hear the matter: an adjourned matter returns before the same bench.
  if p_prior_event_id is not null then
    select e.presiding_magistrate_id into v_profile_id
    from public.docket_events e
    where e.id = p_prior_event_id
      and e.docket_matter_id = p_docket_matter_id;
    if v_profile_id is not null
      and public.docket_magistrate_can_hear(v_profile_id, p_docket_matter_id)
    then
      return v_profile_id;
    end if;
  end if;

  -- Otherwise the magistrate of the matter's latest sitting.
  select e.presiding_magistrate_id into v_profile_id
  from public.docket_events e
  where e.docket_matter_id = p_docket_matter_id
    and e.event_status <> 'entered_in_error'
    and e.presiding_magistrate_id is not null
    and public.docket_magistrate_can_hear(e.presiding_magistrate_id, p_docket_matter_id)
  order by e.scheduled_date desc, e.created_at desc
  limit 1;
  if v_profile_id is not null then
    return v_profile_id;
  end if;

  -- Otherwise the court's only sitting magistrate; with several, nobody
  -- is guessed and the hearing waits, unassigned, for one to take it.
  select (array_agg(distinct mc.profile_id))[1] into v_profile_id
  from public.docket_matters dm
  join public.magistrate_courts mc on mc.court_id = dm.court_id and mc.ended_at is null
  join public.profiles p on p.id = mc.profile_id and p.role <> 'clerk'
  where dm.id = p_docket_matter_id
  having count(distinct mc.profile_id) = 1;

  return v_profile_id;
end;
$$;


ALTER FUNCTION "public"."new_docket_event_presiding_magistrate"("p_docket_matter_id" "uuid", "p_prior_event_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."new_docket_event_presiding_magistrate"("p_docket_matter_id" "uuid", "p_prior_event_id" "uuid") IS 'The presiding magistrate a new hearing on this matter gets when the caller lists it (0163). A magistrate presides over what they list. A clerk never presides: their hearing goes to the magistrate of p_prior_event_id (the sitting it supersedes), else of the matter''s latest sitting, while that magistrate still sits at the court or holds the matter; else to the court''s only sitting magistrate; else null (unassigned, claimable). Returns null when the caller cannot edit the matter. Used by docket_events_guard() and both scheduling RPCs, so the guard and the capacity check agree.';



CREATE OR REPLACE FUNCTION "public"."notifications_enqueue_webhook"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_event text;
begin
  v_event := case new.type
    when 'share_granted' then 'share.granted'
    when 'share_revoked' then 'share.revoked'
    when 'judgment_final' then 'judgment.final'
    when 'hearing_tomorrow' then 'hearing.tomorrow'
    when 'clerk_request' then 'clerk_request.created'
    else null
  end;
  if v_event is not null then
    perform public.enqueue_webhook_event(
      v_event,
      jsonb_build_object(
        'type', new.type,
        'title', new.title,
        'body', new.body,
        'link', new.link,
        'created_at', new.created_at
      )
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."notifications_enqueue_webhook"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notifications_protect"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.user_id is distinct from old.user_id
      or new.type is distinct from old.type
      or new.title is distinct from old.title
      or new.body is distinct from old.body
      or new.link is distinct from old.link
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Notifications are immutable except for read_at';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."notifications_protect"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_admins"("p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
begin
  for r in
    select id
    from public.profiles
    where role = 'admin'
      and is_active = true
  loop
    perform public.notify_user(r.id, p_type, p_title, p_body, p_link);
  end loop;
end;
$$;


ALTER FUNCTION "public"."notify_admins"("p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_court_staff"("p_court_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
begin
  for r in
    select profile_id
    from public.magistrate_courts
    where court_id = p_court_id
      and ended_at is null
    union
    select profile_id
    from public.clerk_courts
    where court_id = p_court_id
      and ended_at is null
  loop
    perform public.notify_user(r.profile_id, p_type, p_title, p_body, p_link);
  end loop;
end;
$$;


ALTER FUNCTION "public"."notify_court_staff"("p_court_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_court_staff_except"("p_court_id" "uuid", "p_except_profile_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
begin
  for r in
    select profile_id
    from public.magistrate_courts
    where court_id = p_court_id
      and ended_at is null
    union
    select profile_id
    from public.clerk_courts
    where court_id = p_court_id
      and ended_at is null
  loop
    if r.profile_id is distinct from p_except_profile_id then
      perform public.notify_user(r.profile_id, p_type, p_title, p_body, p_link);
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "public"."notify_court_staff_except"("p_court_id" "uuid", "p_except_profile_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."notify_court_staff_except"("p_court_id" "uuid", "p_except_profile_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") IS 'notify_court_staff() (0123) without the acting user: the court''s current magistrates and clerks, minus p_except_profile_id. Internal; called by the bin and purge functions (0161).';



CREATE OR REPLACE FUNCTION "public"."notify_tomorrows_hearings"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer := 0;
  r record;
  v_tomorrow date := public.guyana_today() + 1;
begin
  for r in
    select
      de.id,
      de.docket_matter_id,
      dm.court_id,
      dm.case_number,
      dm.matter_title
    from public.docket_events de
    join public.docket_matters dm on dm.id = de.docket_matter_id
    where de.event_status = 'scheduled'
      and de.scheduled_date = v_tomorrow
      and dm.deleted_at is null
  loop
    perform public.notify_court_staff(
      r.court_id,
      'hearing_tomorrow',
      'Hearing tomorrow',
      coalesce(r.case_number || ' — ', '') || coalesce(r.matter_title, 'A matter is listed tomorrow.'),
      '/docket/' || r.docket_matter_id::text
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."notify_tomorrows_hearings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_user"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text" DEFAULT NULL::"text", "p_link" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
begin
  if p_user_id is null or p_type is null or p_title is null then
    return null;
  end if;

  -- A share notice records a change of access, and revoke-then-share is
  -- how a share's level changes, so those are never collapsed.
  if p_type not in ('share_granted', 'share_revoked') and exists (
    select 1
    from public.notifications n
    where n.user_id = p_user_id
      and n.type = p_type
      and coalesce(n.link, '') = coalesce(p_link, '')
      and n.created_at > now() - interval '20 hours'
  ) then
    return null;
  end if;

  insert into public.notifications (user_id, type, title, body, link)
  values (p_user_id, p_type, p_title, p_body, p_link)
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."notify_user"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."notify_user"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") IS 'Insert an in-app notification for one user. Dedupes identical type+link rows within 20 hours, except share_granted / share_revoked, which are always delivered (0165). No email.';



CREATE OR REPLACE FUNCTION "public"."populate_callover_from_date"("p_callover_id" "uuid", "p_date" "date" DEFAULT NULL::"date") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_court_id uuid;
  v_date date;
  v_count integer := 0;
begin
  select co.court_id, coalesce(p_date, co.callover_date)
    into v_court_id, v_date
  from public.docket_callovers co
  where co.id = p_callover_id;

  if v_court_id is null then
    raise exception 'That callover could not be found, or you no longer have access to it.';
  end if;

  insert into public.docket_callover_items (callover_id, docket_matter_id, sort_order)
  select
    p_callover_id,
    dm.id,
    row_number() over (order by dm.case_number, dm.matter_title)
  from public.docket_matters dm
  where dm.court_id = v_court_id
    and dm.deleted_at is null
    and exists (
      select 1 from public.docket_events e
      where e.docket_matter_id = dm.id
        and e.scheduled_date = v_date
        and e.event_status not in ('cancelled', 'entered_in_error')
    )
  on conflict (callover_id, docket_matter_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."populate_callover_from_date"("p_callover_id" "uuid", "p_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."populate_callover_from_date"("p_callover_id" "uuid", "p_date" "date") IS 'Adds every live matter at the callover''s court with an appearance on the given date (defaults to the callover''s own date). SECURITY INVOKER -- RLS and can_edit_docket_matter() still apply to every row. Idempotent: re-running adds only what is missing.';



CREATE OR REPLACE FUNCTION "public"."profile_has_completed_first_sign_in"("p_profile_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.auth_event_log e
    where e.event_type = 'login_success'
      and (
        e.actor_id = p_profile_id
        or (
          e.email is not null
          and e.email = (select p.email from public.profiles p where p.id = p_profile_id)
        )
      )
  );
$$;


ALTER FUNCTION "public"."profile_has_completed_first_sign_in"("p_profile_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."profile_has_completed_first_sign_in"("p_profile_id" "uuid") IS 'True when this profile has at least one login_success in auth_event_log, matching /admin/people last-login. Used to decide whether an active regular sitting occupies the court''s primary slot.';



CREATE OR REPLACE FUNCTION "public"."profiles_identity_columns_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception
      'An account''s type, court and email cannot be edited directly. Use Correct account type or the court assignment screens.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."profiles_identity_columns_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."profiles_identity_columns_guard"() IS 'BEFORE UPDATE on profiles (0168): refuses a change to role, court_id or email from a client role (anon, authenticated), admins included, so they change only through SECURITY DEFINER RPCs, sign-up, the service role or the SQL editor. INVOKER on purpose: it reads current_user.';



CREATE OR REPLACE FUNCTION "public"."profiles_is_active_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception
      'An account is deactivated or reactivated only through set_profile_active, which also signs it out.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."profiles_is_active_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."profiles_is_active_guard"() IS 'BEFORE UPDATE on profiles (0201): refuses an is_active change from a client role (anon, authenticated), admins included, so it changes only through set_profile_active, the service role or the SQL editor. INVOKER on purpose: it reads current_user.';



CREATE OR REPLACE FUNCTION "public"."protect_clerk_court_history"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  -- Provenance: whenever a row transitions from current to ended, force
  -- ended_by to the authenticated caller regardless of what the client
  -- sent -- never trusted from client input, mirroring how
  -- docket_matters_guard() (0020) forces created_by/last_updated_by.
  -- Applies to admins too (an admin's correction is still their own act).
  if old.ended_at is null and new.ended_at is not null then
    new.ended_by := (select auth.uid());
  end if;

  if (select public.is_admin()) then
    return new;
  end if;

  if old.ended_at is not null then
    raise exception 'Cannot modify a historical (already-ended) clerk court assignment';
  end if;

  if new.profile_id is distinct from old.profile_id
     or new.court_id is distinct from old.court_id
     or new.approved_by is distinct from old.approved_by
     or new.started_at is distinct from old.started_at then
    raise exception 'A clerk court assignment may only be ended (ended_at/ended_by/end_reason); no other field may change outside admin correction';
  end if;

  if new.ended_at is null then
    raise exception 'Reactivating an ended clerk court assignment is not permitted; approve a new access request instead';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."protect_clerk_court_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_court_district_once_referenced"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.district_id is distinct from old.district_id
     and exists (select 1 from public.docket_matters dm where dm.court_id = old.id) then
    raise exception 'Cannot change district_id for court % — it is already referenced by one or more Docket Matters', old.id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_court_district_once_referenced"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."protect_court_district_once_referenced"() IS 'Blocks changing a court''s district_id once any Docket Matter references that court, preventing silent historical district drift. No admin exception. Deferred from migration 0016 until docket_matters existed.';



CREATE OR REPLACE FUNCTION "public"."protect_docket_matter_assignment_history"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_profile_nulled boolean;
  v_granted_by_nulled boolean;
begin
  v_profile_nulled := old.profile_id is not null and new.profile_id is null;
  v_granted_by_nulled := old.granted_by is not null and new.granted_by is null;

  if v_profile_nulled or v_granted_by_nulled then
    if new.docket_matter_id is distinct from old.docket_matter_id
       or new.started_at is distinct from old.started_at
       or new.reason is distinct from old.reason
       or (new.profile_id is distinct from old.profile_id and not v_profile_nulled)
       or (new.granted_by is distinct from old.granted_by and not v_granted_by_nulled) then
      raise exception 'Unexpected combined change alongside a profile/grantor removal on a Docket Matter Assignment';
    end if;

    if v_profile_nulled and old.ended_at is null then
      new.ended_at := now();
    end if;

    return new;
  end if;

  if old.ended_at is not null then
    raise exception 'Cannot modify a historical (already-ended) Docket Matter Assignment';
  end if;

  if new.docket_matter_id is distinct from old.docket_matter_id
     or new.profile_id is distinct from old.profile_id
     or new.granted_by is distinct from old.granted_by
     or new.started_at is distinct from old.started_at
     or new.reason is distinct from old.reason then
    raise exception 'A Docket Matter Assignment may only have ended_at set to end it; no other field may change';
  end if;

  if new.ended_at is null then
    raise exception 'Reactivating an ended Docket Matter Assignment is not permitted; create a new assignment instead, subject to the ordinary creation authorization at that time';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."protect_docket_matter_assignment_history"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."protect_docket_matter_assignment_history"() IS 'No admin exception, unlike the analogous magistrate_courts trigger — docket_matter_assignments gates private judicial content, not administrative roster data. Ordinarily, only ending (ended_at null -> timestamp) is permitted; identity/provenance fields and historical rows are immutable. Separately permits the profile_id/granted_by FK''s own ON DELETE SET NULL action to null those columns (and only those columns), auto-ending the row first if it was still current, so a NULL profile_id can never coincide with a live (ended_at IS NULL) assignment.';



CREATE OR REPLACE FUNCTION "public"."protect_judgment_lifecycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.finalized_at := null;
    new.finalized_by := null;
    return new;
  end if;

  -- 0154: finalise / unlock / discoverability are ownership decisions.
  -- An active EDIT share (can_edit_judgment, 0121) may edit content but
  -- never change lifecycle state. auth.uid() IS NULL (service role /
  -- cron, which bypasses RLS anyway) is deliberately not blocked here.
  if v_actor is not null
     and old.owner_id <> v_actor
     and (
       new.status is distinct from old.status
       or new.is_discoverable is distinct from old.is_discoverable
     )
  then
    raise exception 'Only the Judgment owner may finalise, unlock, or change discoverability.';
  end if;

  if old.status = 'draft' and new.status = 'final' then
    new.finalized_at := now();
    new.finalized_by := v_actor;
    return new;
  end if;

  if old.status = 'final' then
    if new.status = 'draft' then
      if new.title is distinct from old.title
        or new.case_number is distinct from old.case_number
        or new.court_name is distinct from old.court_name
        or new.judgment_date is distinct from old.judgment_date
        or new.citation is distinct from old.citation
        or new.content is distinct from old.content
        or new.content_text is distinct from old.content_text
      then
        raise exception 'Cannot unlock (final -> draft) and edit substantive Judgment fields in the same statement. Unlock first, then edit in a separate UPDATE.';
      end if;
      new.finalized_at := old.finalized_at;
      new.finalized_by := old.finalized_by;
      return new;
    elsif new.status = 'final' then
      if new.title is distinct from old.title
        or new.case_number is distinct from old.case_number
        or new.court_name is distinct from old.court_name
        or new.judgment_date is distinct from old.judgment_date
        or new.citation is distinct from old.citation
        or new.content is distinct from old.content
        or new.content_text is distinct from old.content_text
      then
        raise exception 'Judgment is final; substantive fields (title, case_number, court_name, judgment_date, citation, content, content_text) are locked. Unlock (status -> draft) before editing.';
      end if;
      new.finalized_at := old.finalized_at;
      new.finalized_by := old.finalized_by;
      return new;
    else
      raise exception 'Invalid Judgment status transition.';
    end if;
  end if;

  new.finalized_at := old.finalized_at;
  new.finalized_by := old.finalized_by;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_judgment_lifecycle"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."protect_judgment_lifecycle"() IS 'Judgment lifecycle guard (0045/0046/0116). 0154: status and is_discoverable changes raise unless auth.uid() is the owner (an edit-share recipient may edit content only). No admin bypass; service-role context (auth.uid() null) untouched.';



CREATE OR REPLACE FUNCTION "public"."protect_magistrate_court_history"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if old.ended_at is null and new.ended_at is not null then
    new.ended_by := (select auth.uid());
  end if;

  if (select public.is_admin()) then
    return new;
  end if;

  if old.ended_at is not null then
    raise exception 'Cannot modify a historical (already-ended) court assignment';
  end if;

  if new.profile_id is distinct from old.profile_id
     or new.court_id is distinct from old.court_id
     or new.started_at is distinct from old.started_at
     or new.assignment_type is distinct from old.assignment_type then
    raise exception 'Ordinary self-service may only set ended_at/end_reason to end a current assignment, or refresh occupancy after first sign-in; no other field may change';
  end if;

  if new.ended_at is null then
    if new.can_manage_clerks is distinct from old.can_manage_clerks
       or new.ended_by is distinct from old.ended_by
       or new.end_reason is distinct from old.end_reason then
      raise exception 'Ordinary self-service may only set ended_at/end_reason to end a current assignment, or refresh occupancy after first sign-in; no other field may change';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."protect_magistrate_court_history"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."protect_magistrate_court_history"() IS '0104 rules plus occupancy: historical rows stay immutable; identity fields stay frozen; ending still force-sets ended_by. A current row may refresh occupies_primary_slot/updated_at after first sign-in without being treated as reactivation. Admin JWT still bypasses.';



CREATE OR REPLACE FUNCTION "public"."publish_case_law_import"("p_case_law_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job_id uuid;
  v_case_name text;
  v_citation text;
  v_court text;
  v_jurisdiction text;
  v_court_id uuid;
  v_jurisdiction_id uuid;
  v_content_quality_status text;
  -- Mirrors the PLACEHOLDER_VALUES set in
  -- src/lib/publication-validation.ts -- keep both lists in sync.
  v_bad text[] := array[
    '', 'untitled', 'untitled (pending review)', 'unknown', 'tbd', 'n/a',
    'na', 'none', 'pending', 'pending review', 'coa', 'court', 'jurisdiction'
  ];
begin
  if not public.is_admin() then
    raise exception 'Only administrators may publish canonical Case Law.';
  end if;

  select import_job_id, case_name, citation, court, jurisdiction, court_id,
         jurisdiction_id, content_quality_status
    into v_job_id, v_case_name, v_citation, v_court, v_jurisdiction, v_court_id,
         v_jurisdiction_id, v_content_quality_status
    from public.case_law
    where id = p_case_law_id and owner_id is null
    for update;

  if not found then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  if lower(trim(coalesce(v_case_name, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Case name requires review.';
  end if;
  if lower(trim(coalesce(v_citation, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Citation is missing.';
  end if;
  if v_jurisdiction_id is null or lower(trim(coalesce(v_jurisdiction, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Jurisdiction is missing.';
  end if;
  if v_court_id is null or lower(trim(coalesce(v_court, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Court is missing.';
  end if;
  if v_content_quality_status = 'failed' then
    raise exception 'Cannot publish: extracted text failed automated quality checks and requires correction before publish.';
  end if;

  update public.case_law set review_status = 'published' where id = p_case_law_id;

  if v_job_id is not null then
    update public.import_jobs set status = 'published', completed_at = now() where id = v_job_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."publish_case_law_import"("p_case_law_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_legislation_import"("p_statute_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job_id uuid;
  v_code text;
  v_title text;
  v_jurisdiction text;
  v_jurisdiction_id uuid;
  v_content_quality_status text;
  v_bad text[] := array[
    '', 'untitled', 'untitled (pending review)', 'unknown', 'tbd', 'n/a',
    'na', 'none', 'pending', 'pending review', 'coa', 'court', 'jurisdiction'
  ];
begin
  if not public.is_admin() then
    raise exception 'Only administrators may publish canonical Legislation.';
  end if;

  select import_job_id, code, title, jurisdiction, jurisdiction_id, content_quality_status
    into v_job_id, v_code, v_title, v_jurisdiction, v_jurisdiction_id, v_content_quality_status
    from public.statutes
    where id = p_statute_id
    for update;

  if not found then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  if lower(trim(coalesce(v_title, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Title requires review.';
  end if;
  if lower(trim(coalesce(v_code, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Code is missing.';
  end if;
  if v_jurisdiction_id is null or lower(trim(coalesce(v_jurisdiction, ''))) = any(v_bad) then
    raise exception 'Cannot publish: Jurisdiction is missing.';
  end if;
  if v_content_quality_status = 'failed' then
    raise exception 'Cannot publish: extracted text failed automated quality checks and requires correction before publish.';
  end if;

  update public.statutes set review_status = 'published' where id = p_statute_id;

  if v_job_id is not null then
    update public.import_jobs set status = 'published', completed_at = now() where id = v_job_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."publish_legislation_import"("p_statute_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_docket_matter"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.docket_matters;
begin
  if p_id is null then
    raise exception 'Matter id is required.';
  end if;

  if not (
    public.has_docket_matter_authority(p_id)
    or public.is_admin()
  ) then
    raise exception 'You do not have permission to permanently delete this matter.';
  end if;

  select * into v_row from public.docket_matters where id = p_id for update;
  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  if v_row.deleted_at is null then
    raise exception 'A live Docket Matter cannot be permanently deleted. Move it to the bin first.';
  end if;

  perform public.purge_docket_matter_row(p_id);

  perform public.notify_court_staff_except(
    v_row.court_id,
    (select auth.uid()),
    'docket_matter_purged',
    'Matter permanently deleted',
    coalesce(v_row.case_number || ' · ', '') || coalesce(v_row.matter_title, 'A matter')
      || ' was emptied from the bin and permanently deleted.',
    '/docket/' || v_row.id::text
  );
end;
$$;


ALTER FUNCTION "public"."purge_docket_matter"("p_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."purge_docket_matter"("p_id" "uuid") IS 'Permanently deletes a binned Docket Matter ("Empty now"). Requires has_docket_matter_authority or is_admin; a share or a clerk attachment is not enough (0161). Live rows are rejected under a row lock, so a racing restore cannot be lost. Tells the court''s other staff.';



CREATE OR REPLACE FUNCTION "public"."purge_docket_matter_row"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_id is null then
    return;
  end if;

  perform 1 from public.docket_matters where id = p_id and deleted_at is not null for update;
  if not found then
    raise exception 'This matter is no longer in the bin, so it was not permanently deleted.';
  end if;

  delete from public.docket_event_calendar_links
  where docket_event_id in (
    select id from public.docket_events where docket_matter_id = p_id
  );

  delete from public.docket_events where docket_matter_id = p_id;
  delete from public.docket_matter_parties where docket_matter_id = p_id;
  delete from public.docket_matter_tags where docket_matter_id = p_id;
  delete from public.docket_matter_assignments where docket_matter_id = p_id;
  delete from public.shares where item_type = 'docket_matter' and item_id = p_id;
  delete from public.docket_matter_judgments where docket_matter_id = p_id;
  delete from public.docket_matter_case_law where docket_matter_id = p_id;
  delete from public.quick_code_docket_matters where docket_matter_id = p_id;
  delete from public.bookmarks where entity_type = 'docket_matter' and entity_id = p_id;
  delete from public.docket_callover_items where docket_matter_id = p_id;

  delete from public.docket_matters where id = p_id and deleted_at is not null;
  if not found then
    raise exception 'This matter is no longer in the bin, so it was not permanently deleted.';
  end if;
end;
$$;


ALTER FUNCTION "public"."purge_docket_matter_row"("p_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."purge_docket_matter_row"("p_id" "uuid") IS 'Internal hard-delete of one binned Docket Matter and matter-owned children, including its callover items (0129). Locks the row and refuses unless it is still binned (0161). Keeps every bench note (0038, ADR 0004). Not granted to authenticated. Called only by purge_docket_matter / purge_expired_docket_matters.';



CREATE OR REPLACE FUNCTION "public"."purge_expired_docket_matters"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select id, court_id, case_number, matter_title
    from public.docket_matters
    where deleted_at is not null
      and deleted_at <= now() - interval '7 days'
    for update skip locked
  loop
    perform public.purge_docket_matter_row(r.id);
    perform public.notify_court_staff_except(
      r.court_id,
      null,
      'docket_matter_purged',
      'Matter permanently deleted',
      coalesce(r.case_number || ' · ', '') || coalesce(r.matter_title, 'A matter')
        || ' spent 7 days in the bin and was permanently deleted.',
      '/docket/' || r.id::text
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."purge_expired_docket_matters"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."purge_expired_docket_matters"() IS 'Hard-deletes every Docket Matter binned for 7 days or more and tells the court''s staff. Run only by the hourly pg_cron job (0120); not executable by anon or authenticated (0161). Skips a row a restore is holding.';



CREATE OR REPLACE FUNCTION "public"."quick_code_case_law_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;


ALTER FUNCTION "public"."quick_code_case_law_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."quick_code_docket_matters_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;


ALTER FUNCTION "public"."quick_code_docket_matters_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."quick_code_judgments_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;


ALTER FUNCTION "public"."quick_code_judgments_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."quick_codes_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := (select auth.uid());
    new.code_word := btrim(new.code_word);
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'A Quick Code''s owner_id is immutable; ownership cannot be transferred by UPDATE.';
    end if;
    new.code_word := btrim(new.code_word);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."quick_codes_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_auth_event"("p_event" "text", "p_email" "text", "p_user_agent" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_event public.auth_event_type;
  v_email text;
  v_ua text;
  v_recent int;
  v_window timestamptz;
  v_accepted int;
begin
  begin
    v_event := p_event::public.auth_event_type;
  exception when invalid_text_representation then
    raise exception 'invalid auth event';
  end;

  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  if v_email is not null then
    v_email := left(v_email, 320);
  end if;
  v_ua := nullif(left(btrim(coalesce(p_user_agent, '')), 512), '');

  if v_event in ('login_success', 'logout') then
    if auth.uid() is null then
      raise exception 'not authenticated';
    end if;
    select count(*) into v_recent
    from public.auth_event_log
    where actor_id = auth.uid()
      and event_type = v_event
      and created_at > now() - interval '1 minute';
    if v_recent >= 20 then
      return;
    end if;
    insert into public.auth_event_log (event_type, actor_id, email, user_agent)
    values (
      v_event,
      auth.uid(),
      coalesce((select p.email from public.profiles p where p.id = auth.uid()), v_email),
      v_ua
    );
    return;
  end if;

  if v_event in ('login_failed', 'password_reset_requested') then
    if v_email is null then
      return;
    end if;
    select count(*) into v_recent
    from public.auth_event_log
    where event_type = v_event
      and email = v_email
      and created_at > now() - interval '1 minute';
    if v_recent >= 10 then
      return;
    end if;

    -- One budget for every anonymous report, whatever the email (0170).
    v_window := date_trunc('minute', now());
    insert into public.rpc_rate_limit_buckets as b (user_id, rpc_name, window_start, hit_count)
    values ('00000000-0000-0000-0000-000000000000', 'record_auth_event:anonymous', v_window, 1)
    on conflict (user_id, rpc_name, window_start)
    do update set hit_count = b.hit_count + 1
    returning hit_count into v_accepted;
    delete from public.rpc_rate_limit_buckets
    where user_id = '00000000-0000-0000-0000-000000000000'
      and rpc_name = 'record_auth_event:anonymous'
      and window_start < v_window;
    if v_accepted > 120 then
      return;
    end if;

    insert into public.auth_event_log (event_type, actor_id, email, user_agent)
    values (v_event, null, v_email, v_ua);
  end if;
end;
$$;


ALTER FUNCTION "public"."record_auth_event"("p_event" "text", "p_email" "text", "p_user_agent" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_auth_event"("p_event" "text", "p_email" "text", "p_user_agent" "text") IS 'Write one auth_event_log row. login_success/logout require auth.uid() and force actor_id to that uid (20 a minute per user). login_failed/password_reset_requested are anon-callable, store email only, actor_id always null, and are limited to 10 a minute per email and 120 a minute across all emails (0170).';



CREATE OR REPLACE FUNCTION "public"."record_maintenance_failure"("p_step" "text", "p_sqlstate" "text", "p_message" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (
    null,
    'insert',
    'scheduled_maintenance',
    null,
    jsonb_build_object(
      'step', p_step,
      'ok', false,
      'sqlstate', p_sqlstate,
      'error', left(p_message, 2000),
      'failed_at', now()
    )
  );

  perform public.notify_admins(
    'maintenance_failed',
    'Scheduled maintenance step failed',
    'The daily step ' || p_step || ' failed and was skipped; the other steps still ran. Error: '
      || left(p_message, 500),
    -- One link per step: notify_user collapses same-type, same-link notices
    -- within 20 hours, and two steps failing in one run are two problems.
    '/admin/operations?maintenance=' || p_step
  );
end;
$$;


ALTER FUNCTION "public"."record_maintenance_failure"("p_step" "text", "p_sqlstate" "text", "p_message" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_maintenance_failure"("p_step" "text", "p_sqlstate" "text", "p_message" "text") IS 'Records one failed run_scheduled_maintenance step (0173): an append-only audit_log row (table_name scheduled_maintenance) and a maintenance_failed notification to every active admin. Executable by no client role.';



CREATE OR REPLACE FUNCTION "public"."reject_case_law_import"("p_case_law_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job_id uuid;
  v_review_status text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may reject a Case Law draft.';
  end if;

  select import_job_id, review_status into v_job_id, v_review_status
  from public.case_law
  where id = p_case_law_id and owner_id is null
  for update;

  if not found then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  if v_review_status = 'published' then
    raise exception 'This Case Law record has already been published, so it can no longer be rejected. Refresh the review queue.';
  end if;

  if v_job_id is not null then
    update public.import_jobs
    set status = 'failed',
        error_summary = coalesce(p_reason, 'Rejected by curator during review.'),
        target_case_law_id = null,
        completed_at = now()
    where id = v_job_id;
  end if;

  -- documents_parent_cascade_delete() (0055) removes any attached
  -- `documents` metadata rows on this DELETE; SQL cannot delete the
  -- Storage objects themselves.
  delete from public.case_law where id = p_case_law_id;
end;
$$;


ALTER FUNCTION "public"."reject_case_law_import"("p_case_law_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_legislation_import"("p_statute_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job_id uuid;
  v_review_status text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may reject a Legislation draft.';
  end if;

  select import_job_id, review_status into v_job_id, v_review_status
  from public.statutes
  where id = p_statute_id
  for update;

  if not found then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  if v_review_status = 'published' then
    raise exception 'This Legislation record has already been published, so it can no longer be rejected. Refresh the review queue.';
  end if;

  if v_job_id is not null then
    update public.import_jobs
    set status = 'failed',
        error_summary = coalesce(p_reason, 'Rejected by curator during review.'),
        target_statute_id = null,
        completed_at = now()
    where id = v_job_id;
  end if;

  -- statute_provisions cascade-delete via their own FK (0055, on delete
  -- cascade); documents_parent_cascade_delete() (0058) removes any
  -- attached `documents` metadata rows.
  delete from public.statutes where id = p_statute_id;
end;
$$;


ALTER FUNCTION "public"."reject_legislation_import"("p_statute_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_retained_assignments_on_matter_close"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status in ('completed', 'archived') and new.status is distinct from old.status then
    update public.docket_matter_assignments
    set ended_at = now()
    where docket_matter_id = new.id
      and ended_at is null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."release_retained_assignments_on_matter_close"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."release_retained_assignments_on_matter_close"() IS 'SECURITY DEFINER by necessity: ends current retained assignments on a matter transitioning to completed/archived, regardless of whether the magistrate closing the matter is the retained magistrate themselves. Never fires on a transition to stayed.';



CREATE OR REPLACE FUNCTION "public"."relinquish_magistrate_court"("p_assignment_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "public"."magistrate_courts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.magistrate_courts;
begin
  select * into v_row
  from public.magistrate_courts
  where id = p_assignment_id
  for update;

  if v_row.id is null then
    raise exception 'Court assignment not found';
  end if;

  if v_row.ended_at is not null then
    return v_row;
  end if;

  if not (v_row.profile_id = (select auth.uid()) or (select public.is_admin())) then
    raise exception 'You are not authorized to end this court assignment';
  end if;

  update public.magistrate_courts
  set ended_at = now(),
      end_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_assignment_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."relinquish_magistrate_court"("p_assignment_id" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."relinquish_magistrate_court"("p_assignment_id" "uuid", "p_reason" "text") IS 'Ends exactly one magistrate''s active court assignment (ended_at set; ended_by force-set by protect_magistrate_court_history()''s trigger, 0104, never trusted from any input here). Serves both "magistrate relinquishes their own court" (profile_id = auth.uid()) and "administrator ends an incorrect assignment" (is_admin()) -- the same function, distinguished only by who is calling, mirroring revoke_clerk_court_access() (0089). Never deletes the row, never touches docket_matters/docket_matter_assignments/clerk_courts. Ending the assignment unlinks the magistrate''s judgment pins at that court that are now visible to nobody (magistrate_courts_unlink_orphaned_judgment_pins, 0220); relinquish_preflight lists them, and the un-retained part-heard matters, beforehand. Idempotent: relinquishing an already-ended assignment returns it unchanged. Ending one court has no effect on any other court the same magistrate holds. The court becomes available for a successor the instant this commits (court_has_active_primary_magistrate() re-evaluates live) -- this IS how succession works; there is no separate succession RPC.';



CREATE OR REPLACE FUNCTION "public"."relinquish_preflight"("p_assignment_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.magistrate_courts;
  v_self boolean;
  v_court_name text;
  v_part_heard jsonb;
  v_pins jsonb;
begin
  select * into v_row from public.magistrate_courts where id = p_assignment_id;
  if not found then
    raise exception 'Court assignment not found'
      using errcode = 'P0002';
  end if;

  v_self := v_row.profile_id = (select auth.uid()) and (select public.is_active_account());
  if not (v_self or (select public.is_admin())) then
    raise exception 'You are not authorized to review this court assignment'
      using errcode = '42501';
  end if;

  select c.name into v_court_name from public.courts c where c.id = v_row.court_id;

  with held as (
    select
      e.docket_matter_id,
      e.scheduled_date,
      e.presiding_magistrate_id,
      (
        coalesce(e.witnesses_completed, 0) > 0
        or coalesce(e.witnesses_partly_heard, 0) > 0
        or coalesce(e.outcome_at_event, '') ~* '^\s*part[- ]?heard'
      ) as took_evidence,
      row_number() over (
        partition by e.docket_matter_id
        order by e.scheduled_date desc, e.scheduled_time desc nulls last, e.created_at desc
      ) as recency
    from public.docket_events e
    join public.docket_matters dm on dm.id = e.docket_matter_id
    where dm.court_id = v_row.court_id
      and dm.deleted_at is null
      and dm.status in ('active', 'stayed')
      and e.event_status not in ('cancelled', 'entered_in_error')
      and e.scheduled_date <= current_date
  ),
  part_heard as (
    select
      dm.id,
      dm.case_number,
      dm.matter_title,
      dm.status,
      max(h.scheduled_date) filter (where h.presiding_magistrate_id = v_row.profile_id)
        as last_heard_on
    from public.docket_matters dm
    join held h on h.docket_matter_id = dm.id
    group by dm.id
    having bool_or(
      h.presiding_magistrate_id = v_row.profile_id
      and (
        h.took_evidence
        or (
          h.recency = 1
          and (dm.trial_status = 'partial' or dm.paper_committal_status in ('commenced', 'partial'))
        )
      )
    )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'docket_matter_id', ph.id,
        'status', ph.status,
        'last_heard_on', ph.last_heard_on
      )
      || case
        when v_self then jsonb_build_object(
          'case_number', ph.case_number,
          'matter_title', ph.matter_title
        )
        else '{}'::jsonb
      end
      order by ph.last_heard_on desc, ph.id
    ),
    '[]'::jsonb
  )
  into v_part_heard
  from part_heard ph
  where not exists (
    select 1 from public.docket_matter_assignments a
    where a.docket_matter_id = ph.id
      and a.profile_id = v_row.profile_id
      and a.ended_at is null
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'pin_id', p.pin_id,
        'judgment_id', p.judgment_id,
        'docket_matter_id', p.docket_matter_id,
        'pinned_at', p.pinned_at,
        'judgment_status', p.judgment_status,
        'is_discoverable', p.is_discoverable,
        'shared', p.shared,
        'will_unlink', not p.is_discoverable and not p.shared and not p.keeps_access
      )
      || case
        when v_self then jsonb_build_object('judgment_title', p.judgment_title)
        else '{}'::jsonb
      end
      order by p.pinned_at, p.pin_id
    ),
    '[]'::jsonb
  )
  into v_pins
  from (
    select
      dmj.id as pin_id,
      dmj.judgment_id,
      dmj.docket_matter_id,
      dmj.created_at as pinned_at,
      j.status as judgment_status,
      j.is_discoverable,
      j.title as judgment_title,
      exists (
        select 1 from public.shares s
        where s.item_type = 'judgment'
          and s.item_id = j.id
          and s.recipient_id is not null
          and s.revoked_at is null
      ) as shared,
      (
        exists (
          select 1 from public.magistrate_courts mc
          where mc.profile_id = v_row.profile_id
            and mc.court_id = dm.court_id
            and mc.ended_at is null
            and mc.id <> v_row.id
        )
        or exists (
          select 1 from public.docket_matter_assignments a
          where a.profile_id = v_row.profile_id
            and a.docket_matter_id = dm.id
            and a.ended_at is null
        )
        or exists (
          select 1 from public.shares s
          where s.item_type = 'docket_matter'
            and s.item_id = dm.id
            and s.recipient_id = v_row.profile_id
            and s.revoked_at is null
        )
      ) as keeps_access
    from public.docket_matter_judgments dmj
    join public.judgments j on j.id = dmj.judgment_id
    join public.docket_matters dm on dm.id = dmj.docket_matter_id
    where j.owner_id = v_row.profile_id
      and dm.court_id = v_row.court_id
  ) p;

  return jsonb_build_object(
    'assignment_id', v_row.id,
    'profile_id', v_row.profile_id,
    'court_id', v_row.court_id,
    'court_name', v_court_name,
    'ended', v_row.ended_at is not null,
    'part_heard_unretained', v_part_heard,
    'part_heard_unretained_count', jsonb_array_length(v_part_heard),
    'pinned_judgments', v_pins,
    'pinned_judgment_count', jsonb_array_length(v_pins),
    'pins_to_unlink_count', (
      select count(*) from jsonb_array_elements(v_pins) e where (e ->> 'will_unlink')::boolean
    )
  );
end;
$$;


ALTER FUNCTION "public"."relinquish_preflight"("p_assignment_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."relinquish_preflight"("p_assignment_id" "uuid") IS 'Read-only check before ending a magistrate''s court assignment (0220, BE-26). For the assignment''s magistrate or an administrator: the open matters at that court the magistrate heard evidence in and has not retained (part_heard_unretained), and the magistrate''s judgments pinned to that court''s matters with will_unlink for the pins that ending the assignment unlinks. Case numbers, matter titles and judgment titles go to the magistrate only; an administrator gets ids, statuses and dates (ADR 0005, 0007).';



CREATE OR REPLACE FUNCTION "public"."request_edge_function_run"("p_function" "text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_url text;
  v_key text;
begin
  if p_function is null or p_function !~ '^[a-z0-9][a-z0-9-]*$' then
    raise exception 'Invalid Edge Function name';
  end if;

  if to_regnamespace('net') is null or to_regnamespace('vault') is null then
    return null;
  end if;

  select s.decrypted_secret into v_url
  from vault.decrypted_secrets s
  where s.name = 'project_url';
  select s.decrypted_secret into v_key
  from vault.decrypted_secrets s
  where s.name = 'service_role_key';
  if nullif(btrim(coalesce(v_url, '')), '') is null
     or nullif(btrim(coalesce(v_key, '')), '') is null then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_url), '/') || '/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || btrim(v_key),
      'apikey', btrim(v_key)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$_$;


ALTER FUNCTION "public"."request_edge_function_run"("p_function" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."request_edge_function_run"("p_function" "text") IS 'Asks one of this project''s Edge Functions for a run through pg_net (0180). Reads project_url and service_role_key from Vault; returns null and sends nothing while pg_net or either secret is missing. Called only by the scheduled request_* functions. SECURITY DEFINER: reads Vault; executable by no client role.';



CREATE OR REPLACE FUNCTION "public"."request_storage_cleanup_run"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1
    from public.storage_cleanup_queue q
    where q.dead_lettered_at is null
      and q.next_attempt_at <= now()
  ) then
    return null;
  end if;

  return public.request_edge_function_run('storage-cleanup');
end;
$$;


ALTER FUNCTION "public"."request_storage_cleanup_run"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."request_storage_cleanup_run"() IS 'Asks the storage-cleanup Edge Function for one run through pg_net when a due, live storage_cleanup_queue row is waiting (0167). Reads project_url and service_role_key from Vault; returns null and sends nothing while pg_net or either secret is missing. Run every minute by pg_cron. SECURITY DEFINER: reads Vault and the queue; executable by no client role.';



CREATE OR REPLACE FUNCTION "public"."request_webhook_dispatch_run"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1
    from public.webhook_outbox o
    where (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_at < now() - interval '5 minutes')
  ) then
    return null;
  end if;

  return public.request_edge_function_run('webhook-dispatch');
end;
$$;


ALTER FUNCTION "public"."request_webhook_dispatch_run"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."request_webhook_dispatch_run"() IS 'Asks the webhook-dispatch Edge Function for one run through pg_net when a webhook_outbox row is due (0180). Returns null and sends nothing while no row is due or pg_net or the Vault secrets are missing. Run every minute by pg_cron. SECURITY DEFINER: reads Vault and the outbox; executable by no client role.';



CREATE OR REPLACE FUNCTION "public"."resolve_docket_assignment_identities"("p_ids" "uuid"[]) RETURNS TABLE("assignment_id" "uuid", "profile_id" "uuid", "display_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    dma.id as assignment_id,
    dma.profile_id,
    p.full_name as display_name
  from public.docket_matter_assignments dma
  join public.docket_matters dm on dm.id = dma.docket_matter_id
  left join public.profiles p on p.id = dma.profile_id
  where dma.id = any (p_ids)
    and (
      (select public.can_access_court(dm.court_id))
      or (select public.has_retained_assignment(dm.id))
      or (select public.has_docket_share(dm.id, 'view'))
    );
$$;


ALTER FUNCTION "public"."resolve_docket_assignment_identities"("p_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_docket_assignment_identities"("p_ids" "uuid"[]) IS 'Batch form of resolve_docket_assignment_identity (0043): (assignment_id, profile_id, display_name) for many docket_matter_assignments rows in one call, including ended/historical rows, each gated by the caller being able to read its parent Docket Matter (can_access_court OR has_retained_assignment OR has_docket_share view). Rows the caller may not see are simply absent. SECURITY DEFINER; EXECUTE for authenticated only.';



CREATE OR REPLACE FUNCTION "public"."resolve_docket_assignment_identity"("p_assignment_id" "uuid") RETURNS TABLE("profile_id" "uuid", "display_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    dma.profile_id,
    p.full_name as display_name
  from public.docket_matter_assignments dma
  join public.docket_matters dm on dm.id = dma.docket_matter_id
  left join public.profiles p on p.id = dma.profile_id
  where dma.id = p_assignment_id
    and (
      (select public.can_access_court(dm.court_id))
      or (select public.has_retained_assignment(dm.id))
      or (select public.has_docket_share(dm.id, 'view'))
    );
$$;


ALTER FUNCTION "public"."resolve_docket_assignment_identity"("p_assignment_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_docket_assignment_identity"("p_assignment_id" "uuid") IS 'Narrow identity lookup for one docket_matter_assignments row (retained/part-heard authority), including ended/historical rows. Returns (profile_id, display_name) -- display_name from profiles.full_name only, NULL-safe if the profile has been offboarded (ON DELETE SET NULL) or has no full_name set. Returns zero rows if the assignment does not exist OR the caller cannot read its parent Docket Matter under the current three-path docket_matters SELECT envelope (can_access_court OR has_retained_assignment(own) OR has_docket_share view) -- these two cases are indistinguishable by design. SECURITY DEFINER (required: docket_matter_assignments and profiles are both self-only under ordinary RLS). No is_admin() bypass. EXECUTE revoked from anon (schema-default grant explicitly reversed) and from public; granted only to authenticated. Does not itself grant Docket access -- it discloses identity only to a caller who already, independently, has it.';



CREATE OR REPLACE FUNCTION "public"."resolve_docket_share_identities"("p_share_ids" "uuid"[]) RETURNS TABLE("share_id" "uuid", "recipient_id" "uuid", "recipient_display_name" "text", "granted_by" "uuid", "grantor_display_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    s.id as share_id,
    s.recipient_id,
    pr.full_name as recipient_display_name,
    s.granted_by,
    pg2.full_name as grantor_display_name
  from public.shares s
  left join public.profiles pr on pr.id = s.recipient_id
  left join public.profiles pg2 on pg2.id = s.granted_by
  where s.id = any (p_share_ids)
    and (
      s.granted_by = (select auth.uid())
      or s.recipient_id = (select auth.uid())
      or (select public.has_item_share_authority(s.item_type, s.item_id))
    );
$$;


ALTER FUNCTION "public"."resolve_docket_share_identities"("p_share_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_docket_share_identities"("p_share_ids" "uuid"[]) IS 'Batch form of resolve_docket_share_identity (0121): identity lookup for many shares rows (any item_type) in one call, gated per row by grantor, recipient, or has_item_share_authority(). Rows the caller may not see are simply absent. SECURITY DEFINER; EXECUTE for authenticated only.';



CREATE OR REPLACE FUNCTION "public"."resolve_docket_share_identity"("p_share_id" "uuid") RETURNS TABLE("recipient_id" "uuid", "recipient_display_name" "text", "granted_by" "uuid", "grantor_display_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    s.recipient_id,
    pr.full_name as recipient_display_name,
    s.granted_by,
    pg2.full_name as grantor_display_name
  from public.shares s
  left join public.profiles pr on pr.id = s.recipient_id
  left join public.profiles pg2 on pg2.id = s.granted_by
  where s.id = p_share_id
    and (
      s.granted_by = (select auth.uid())
      or s.recipient_id = (select auth.uid())
      or (select public.has_item_share_authority(s.item_type, s.item_id))
    );
$$;


ALTER FUNCTION "public"."resolve_docket_share_identity"("p_share_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_docket_share_identity"("p_share_id" "uuid") IS 'Identity lookup for one shares row (any item_type). Gated by grantor, recipient, or has_item_share_authority().';



CREATE OR REPLACE FUNCTION "public"."resolve_docket_share_recipient"("p_docket_matter_id" "uuid", "p_email" "text") RETURNS TABLE("profile_id" "uuid", "display_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    p.id as profile_id,
    p.full_name as display_name
  from public.profiles p
  where (select public.has_docket_matter_authority(p_docket_matter_id))
    and p.is_active
    and p.id is distinct from (select auth.uid())
    and lower(p.email) = lower(btrim(p_email))
  limit 1;
$$;


ALTER FUNCTION "public"."resolve_docket_share_recipient"("p_docket_matter_id" "uuid", "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_item_share_recipient"("p_item_type" "text", "p_item_id" "uuid", "p_email" "text") RETURNS TABLE("profile_id" "uuid", "display_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    p.id as profile_id,
    p.full_name as display_name
  from public.profiles p
  where (select public.has_item_share_authority(p_item_type, p_item_id))
    and p.is_active
    and p.id is distinct from (select auth.uid())
    and lower(p.email) = lower(btrim(p_email))
    and (p_item_type = 'docket_matter' or public.can_receive_research_share(p.id))
  limit 1;
$$;


ALTER FUNCTION "public"."resolve_item_share_recipient"("p_item_type" "text", "p_item_id" "uuid", "p_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_item_share_recipient"("p_item_type" "text", "p_item_id" "uuid", "p_email" "text") IS 'Exact email recipient lookup for creating a Share on docket_matter, judgment, or personal case_law. Same collapse-to-empty failure modes as resolve_docket_share_recipient (0051). 0165: for judgment and case_law, also empty unless can_receive_research_share() (never a clerk, never a magistrate without a court).';



CREATE OR REPLACE FUNCTION "public"."restore_docket_matter"("p_id" "uuid") RETURNS "public"."docket_matters"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.docket_matters;
begin
  if p_id is null then
    raise exception 'Matter id is required.';
  end if;

  if not public.can_edit_docket_matter(p_id) then
    raise exception 'You do not have permission to restore this matter.';
  end if;

  select * into v_row from public.docket_matters where id = p_id for update;
  if not found then
    raise exception 'This matter could not be found, or you no longer have access to it.';
  end if;

  if v_row.deleted_at is null then
    return v_row;
  end if;

  update public.docket_matters
  set deleted_at = null,
      deleted_by = null
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."restore_docket_matter"("p_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."restore_docket_matter"("p_id" "uuid") IS 'Clears deleted_at/deleted_by so the matter returns to the live Docket. Requires can_edit_docket_matter. Locks the row, so it cannot interleave with a purge. SECURITY DEFINER so it is the only writer of the bin columns besides bin_docket_matter (0161).';



CREATE OR REPLACE FUNCTION "public"."retry_webhook_delivery"("p_outbox_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'Only administrators can retry webhook deliveries';
  end if;

  update public.webhook_outbox
     set status = 'pending',
         last_error = null,
         dead_lettered_at = null,
         locked_at = null,
         next_attempt_at = now()
   where id = p_outbox_id
     and status = 'failed'
  returning id into v_id;

  return v_id is not null;
end;
$$;


ALTER FUNCTION "public"."retry_webhook_delivery"("p_outbox_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."retry_webhook_delivery"("p_outbox_id" "uuid") IS 'Admin-only. Re-queues one failed webhook_outbox row (status -> pending, due now). Returns false when the row is not failed or does not exist.';



CREATE OR REPLACE FUNCTION "public"."return_unassigned_magistrate_to_requester"("p_profile_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role public.user_role;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_rejected integer := 0;
  v_now timestamptz := now();
begin
  if not (select public.is_admin()) then
    raise exception 'You are not currently authorized to review court assignment requests';
  end if;

  if p_profile_id is null then
    raise exception 'Profile is required';
  end if;

  if p_profile_id = (select auth.uid()) then
    raise exception 'You cannot send your own court assignment back from this screen';
  end if;

  if v_reason is null then
    raise exception 'A reason is required so the requester knows what to do next';
  end if;

  select role into v_role
  from public.profiles
  where id = p_profile_id
  for update;

  if v_role is null then
    raise exception 'Profile not found';
  end if;

  if v_role <> 'magistrate' then
    raise exception 'Only an unassigned magistrate can be sent back to request a court';
  end if;

  if exists (
    select 1
    from public.magistrate_courts
    where profile_id = p_profile_id
      and ended_at is null
  ) then
    raise exception 'This magistrate already has an active court. End that assignment first.';
  end if;

  -- Notify first so a following per-row reject trigger is deduped
  -- (notify_user matches type+link within 20 hours) and the person
  -- sees the return wording rather than a generic rejection.
  perform public.notify_user(
    p_profile_id,
    'court_request_decided',
    'Your court request was returned',
    trim(both from concat_ws(
      ' ',
      v_reason,
      'You can request again from Court Assignments. If you signed up as the wrong account type, contact a Court Assignment Administrator.'
    )),
    '/court-assignments'
  );

  update public.magistrate_court_requests
  set status = 'rejected',
      reviewed_at = v_now,
      reviewed_by = (select auth.uid()),
      rejection_reason = v_reason
  where profile_id = p_profile_id
    and status = 'pending';

  get diagnostics v_rejected = row_count;

  return v_rejected;
end;
$$;


ALTER FUNCTION "public"."return_unassigned_magistrate_to_requester"("p_profile_id" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."return_unassigned_magistrate_to_requester"("p_profile_id" "uuid", "p_reason" "text") IS 'Admin-only Roster action for a magistrate with no active court. Requires a reason. Rejects any still-pending magistrate_court_requests for that profile and notifies them to request again. Does not change profiles.role. Blocked for the caller''s own profile and for anyone who already holds an active magistrate_courts row.';



CREATE OR REPLACE FUNCTION "public"."reveal_webhook_secret"("p_endpoint_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_secret text;
begin
  if not (select public.is_admin()) then
    raise exception 'Only administrators can reveal a webhook secret';
  end if;

  select e.secret into v_secret
  from public.webhook_endpoints e
  where e.id = p_endpoint_id;

  if v_secret is null then
    raise exception 'Webhook endpoint not found';
  end if;

  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (
    (select auth.uid()),
    'update',
    'webhook_endpoints',
    p_endpoint_id,
    jsonb_build_object('event', 'secret_revealed')
  );

  return v_secret;
end;
$$;


ALTER FUNCTION "public"."reveal_webhook_secret"("p_endpoint_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reveal_webhook_secret"("p_endpoint_id" "uuid") IS 'Admin-only. Returns the HMAC signing secret for one endpoint and writes an audit_log row (table webhook_endpoints, new_data.event = secret_revealed) for every reveal.';



CREATE TABLE IF NOT EXISTS "public"."clerk_courts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "court_id" "uuid" NOT NULL,
    "approved_by" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "ended_by" "uuid",
    "end_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clerk_courts_end_fields_consistent" CHECK ((("ended_at" IS NOT NULL) OR (("ended_by" IS NULL) AND ("end_reason" IS NULL)))),
    CONSTRAINT "clerk_courts_ended_after_started" CHECK ((("ended_at" IS NULL) OR ("ended_at" >= "started_at")))
);


ALTER TABLE "public"."clerk_courts" OWNER TO "postgres";


COMMENT ON TABLE "public"."clerk_courts" IS 'Which clerks currently have, or historically had, approved operational Docket access at which courts. ended_at IS NULL means the assignment is current -- the sole source of truth, mirroring magistrate_courts (0017). Rows are created only by decide_clerk_access_request() (0089) on approval, or directly by an admin for exceptional correction. Never deleted -- only ended.';



COMMENT ON COLUMN "public"."clerk_courts"."approved_by" IS 'The magistrate (or admin, in an exceptional/fallback case) who approved this specific court access.';



COMMENT ON COLUMN "public"."clerk_courts"."ended_at" IS 'NULL = current assignment. Revoking access is an UPDATE (ended_at set), never a DELETE.';



COMMENT ON COLUMN "public"."clerk_courts"."ended_by" IS 'Who revoked/ended this assignment. NULL while the assignment is current.';



COMMENT ON COLUMN "public"."clerk_courts"."end_reason" IS 'Optional free-text reason for revocation. NULL while the assignment is current.';



CREATE OR REPLACE FUNCTION "public"."revoke_clerk_court_access"("p_assignment_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "public"."clerk_courts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.clerk_courts;
begin
  select * into v_row
  from public.clerk_courts
  where id = p_assignment_id
  for update;

  if v_row.id is null then
    raise exception 'Clerk court assignment not found';
  end if;

  if v_row.ended_at is not null then
    return v_row;
  end if;

  if not ((select public.can_manage_clerk_access(v_row.court_id)) or (select public.is_admin())) then
    raise exception 'You are not currently authorized to revoke clerk access for this court';
  end if;

  update public.clerk_courts
  set ended_at = now(),
      end_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_assignment_id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."revoke_clerk_court_access"("p_assignment_id" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."revoke_clerk_court_access"("p_assignment_id" "uuid", "p_reason" "text") IS 'Ends exactly one clerk''s active court assignment (ended_at set; ended_by is force-set by protect_clerk_court_history()''s trigger, 0087, not trusted from any input here). Never deletes the row. Idempotent: revoking an already-ended assignment returns it unchanged. Revoking one court has no effect on any other court the same clerk is separately approved for.';



CREATE OR REPLACE FUNCTION "public"."run_scheduled_maintenance"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  -- In run order. The last two are skipped when their migration is absent,
  -- as in 0124; a missing required step is a failure like any other.
  v_steps constant text[] := array[
    'mark_past_hearings',
    'flag_stale_drafts',
    'notify_tomorrows_hearings',
    'apply_data_retention',
    'dispatch_pending_webhooks'
  ];
  v_optional constant text[] := array['apply_data_retention', 'dispatch_pending_webhooks'];
  v_step text;
  v_sqlstate text;
  v_message text;
  v_failed text[] := array[]::text[];
begin
  foreach v_step in array v_steps loop
    if v_step = any (v_optional)
      and to_regprocedure('public.' || v_step || '()') is null then
      continue;
    end if;

    begin
      execute format('select public.%I()', v_step);
    exception when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
      v_failed := v_failed || v_step;
      -- Recording must never stop the remaining steps either.
      begin
        perform public.record_maintenance_failure(v_step, v_sqlstate, v_message);
      exception when others then
        raise warning 'run_scheduled_maintenance: could not record the failure of %: %',
          v_step, sqlerrm;
      end;
    end;
  end loop;

  if cardinality(v_failed) > 0 then
    raise warning 'run_scheduled_maintenance: step(s) failed and were skipped: %',
      array_to_string(v_failed, ', ');
  end if;
end;
$$;


ALTER FUNCTION "public"."run_scheduled_maintenance"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."run_scheduled_maintenance"() IS 'Daily in-app maintenance: past hearings, stale-draft notices, tomorrow hearing notices, data retention, webhook dispatch. 0173: each step runs in its own subtransaction, so one failure no longer skips the rest; each failure is recorded by record_maintenance_failure (audit_log row and a notification to every active admin). Email is not sent.';



CREATE OR REPLACE FUNCTION "public"."schedule_docket_event_with_capacity"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_event_id" "uuid" DEFAULT NULL::"uuid", "p_scheduled_time" time without time zone DEFAULT NULL::time without time zone, "p_event_type" "text" DEFAULT NULL::"text", "p_stage_at_event" "text" DEFAULT NULL::"text", "p_outcome_at_event" "text" DEFAULT NULL::"text", "p_orders_made_at_event" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text", "p_location" "text" DEFAULT NULL::"text", "p_event_status" "text" DEFAULT 'scheduled'::"text", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_acknowledge_override" boolean DEFAULT false, "p_override_reason" "text" DEFAULT NULL::"text", "p_expected_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("status" "text", "event_id" "uuid", "category_id" "uuid", "category_name" "text", "configured_capacity" integer, "scheduled_count" integer, "is_over_capacity" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_matter_id uuid;
  v_capacity integer;
  v_category_name text;
  v_count integer;
  v_event_id uuid;
  v_will_count boolean;
  v_presiding uuid;
  v_old_date date;
  v_old_status text;
  v_old_outcome text;
  v_old_presiding uuid;
  v_old_updated_at timestamptz;
  v_is_adjournment boolean := false;
  v_adjourn_label text;
begin
  if p_event_id is not null then
    select ev0.docket_matter_id into v_matter_id
    from public.docket_events ev0
    where ev0.id = p_event_id;
    if v_matter_id is null then
      raise exception 'Docket Event % not found.', p_event_id;
    end if;
    if p_docket_matter_id is not null and p_docket_matter_id <> v_matter_id then
      raise exception 'A Docket Event''s docket_matter_id is immutable; it cannot be moved to another Docket Matter.';
    end if;
  else
    v_matter_id := p_docket_matter_id;
    if v_matter_id is null then
      raise exception 'p_docket_matter_id is required when creating a new Docket Event.';
    end if;
  end if;

  if not public.can_edit_docket_matter(v_matter_id) then
    raise exception 'Not authorized to schedule Docket Events on this matter.';
  end if;

  -- B-03: one scheduling write per matter at a time.
  perform 1 from public.docket_matters dm where dm.id = v_matter_id for no key update;

  if p_event_id is not null then
    select ev.scheduled_date, ev.event_status, ev.outcome_at_event,
           ev.presiding_magistrate_id, ev.updated_at
      into v_old_date, v_old_status, v_old_outcome, v_old_presiding, v_old_updated_at
    from public.docket_events ev
    where ev.id = p_event_id
    for update;

    -- B-12: the hearing changed since the caller read it.
    if p_expected_updated_at is not null and v_old_updated_at is distinct from p_expected_updated_at then
      return query select
        'conflict'::text, p_event_id, p_category_id, null::text, null::integer, null::integer, false;
      return;
    end if;

    v_is_adjournment := v_old_status = 'scheduled' and v_old_date is distinct from p_scheduled_date;
  end if;

  -- An in-place edit keeps its presiding magistrate; a new row gets the
  -- one docket_events_guard() would give it.
  if p_event_id is not null and not v_is_adjournment then
    v_presiding := v_old_presiding;
  else
    v_presiding := public.new_docket_event_presiding_magistrate(v_matter_id, p_event_id);
  end if;

  v_will_count := p_category_id is not null and p_event_status = 'scheduled' and v_presiding is not null;

  if v_will_count then
    -- B-05: one capacity decision per magistrate, category and day at a time.
    perform pg_advisory_xact_lock(hashtextextended(
      format('docket_capacity:%s:%s:%s', v_presiding, p_category_id, p_scheduled_date), 0));

    select s.daily_capacity into v_capacity
    from public.docket_capacity_settings s
    where s.owner_id = v_presiding and s.category_id = p_category_id;

    select c.name into v_category_name from public.docket_matter_categories c where c.id = p_category_id;

    v_count := public.docket_booked_count(v_presiding, p_category_id, p_scheduled_date, v_matter_id);

    if v_capacity is not null and v_count >= v_capacity and not p_acknowledge_override then
      return query select
        'capacity_reached'::text,
        null::uuid,
        p_category_id,
        v_category_name,
        v_capacity,
        v_count,
        (v_count >= v_capacity);
      return;
    end if;
  end if;

  if v_is_adjournment then
    v_adjourn_label := 'Adjourned to ' || to_char(p_scheduled_date, 'FMDD Mon YYYY');
    update public.docket_events set
      event_status = 'completed',
      outcome_at_event = coalesce(nullif(btrim(coalesce(v_old_outcome, '')), ''), v_adjourn_label)
    where id = p_event_id;

    insert into public.docket_events (
      docket_matter_id, scheduled_date, scheduled_time, event_type,
      stage_at_event, outcome_at_event, orders_made_at_event, notes,
      location, event_status, category_id, created_by, presiding_magistrate_id
    ) values (
      v_matter_id, p_scheduled_date, p_scheduled_time, p_event_type,
      p_stage_at_event, p_outcome_at_event, p_orders_made_at_event, p_notes,
      p_location, p_event_status, p_category_id, (select auth.uid()), v_presiding
    )
    returning id into v_event_id;
  elsif p_event_id is not null then
    update public.docket_events set
      scheduled_date = p_scheduled_date,
      scheduled_time = p_scheduled_time,
      event_type = p_event_type,
      stage_at_event = p_stage_at_event,
      outcome_at_event = p_outcome_at_event,
      orders_made_at_event = p_orders_made_at_event,
      notes = p_notes,
      location = p_location,
      event_status = p_event_status,
      category_id = p_category_id
    where id = p_event_id
    returning id into v_event_id;
  else
    insert into public.docket_events (
      docket_matter_id, scheduled_date, scheduled_time, event_type,
      stage_at_event, outcome_at_event, orders_made_at_event, notes,
      location, event_status, category_id, created_by, presiding_magistrate_id
    ) values (
      v_matter_id, p_scheduled_date, p_scheduled_time, p_event_type,
      p_stage_at_event, p_outcome_at_event, p_orders_made_at_event, p_notes,
      p_location, p_event_status, p_category_id, (select auth.uid()), v_presiding
    )
    returning id into v_event_id;
  end if;

  if v_will_count and v_capacity is not null and v_count >= v_capacity then
    insert into public.docket_capacity_overrides (
      docket_event_id, docket_matter_id, category_id, magistrate_profile_id, overridden_by,
      scheduled_date, configured_capacity, scheduled_count_at_override, reason
    ) values (
      v_event_id, v_matter_id, p_category_id, v_presiding, (select auth.uid()),
      p_scheduled_date, v_capacity, v_count + 1, nullif(btrim(coalesce(p_override_reason, '')), '')
    );
  end if;

  return query select
    'created'::text,
    v_event_id,
    p_category_id,
    v_category_name,
    v_capacity,
    case when v_will_count then v_count + 1 else v_count end,
    (v_will_count and v_capacity is not null and (v_count + 1) > v_capacity);
end;
$$;


ALTER FUNCTION "public"."schedule_docket_event_with_capacity"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_event_id" "uuid", "p_scheduled_time" time without time zone, "p_event_type" "text", "p_stage_at_event" "text", "p_outcome_at_event" "text", "p_orders_made_at_event" "text", "p_notes" "text", "p_location" "text", "p_event_status" "text", "p_category_id" "uuid", "p_acknowledge_override" boolean, "p_override_reason" "text", "p_expected_updated_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."schedule_docket_event_with_capacity"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_event_id" "uuid", "p_scheduled_time" time without time zone, "p_event_type" "text", "p_stage_at_event" "text", "p_outcome_at_event" "text", "p_orders_made_at_event" "text", "p_notes" "text", "p_location" "text", "p_event_status" "text", "p_category_id" "uuid", "p_acknowledge_override" boolean, "p_override_reason" "text", "p_expected_updated_at" timestamp with time zone) IS 'Capacity-aware create/update for a single Docket Event. Requires can_edit_docket_matter (0141). Locks the matter, then takes an advisory lock per presiding magistrate, category and date before counting with docket_booked_count (0163), so concurrent bookings cannot overbook. Capacity belongs to the hearing''s presiding magistrate: the existing one for an in-place edit, new_docket_event_presiding_magistrate() for a new row. With p_expected_updated_at, an edit of a hearing changed since it was read returns status conflict and writes nothing (0163). Changing the date of a still-scheduled event is an adjournment (0119): the original row stays on its date as completed with outcome_at_event stamped Adjourned to …, and a new row is inserted for the new date.';



CREATE OR REPLACE FUNCTION "public"."search_bench_notes"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "entity_type" "text", "entity_id" "uuid", "title" "text", "rank" real, "headline" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.enforce_rpc_rate_limit('search_bench_notes', 60, 60);
  return query
  select
    n.id, n.entity_type, n.entity_id, n.title,
    ts_rank(n.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(n.content_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.bench_notes n
  where n.search_vector @@ websearch_to_tsquery('english', p_query)
    and public.user_can_access_bench_note(n.id)
  order by ts_rank(n.search_vector, websearch_to_tsquery('english', p_query)) desc
  limit p_limit;
end;
$$;


ALTER FUNCTION "public"."search_bench_notes"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_bench_notes"("p_query" "text", "p_limit" integer) IS 'Full-text search over bench notes. 0137: enforce_rpc_rate_limit 60/60s. Query body unchanged from 0038.';



CREATE OR REPLACE FUNCTION "public"."search_case_law"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "case_name" "text", "citation" "text", "court" "text", "jurisdiction" "text", "summary" "text", "rank" real, "headline" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.enforce_rpc_rate_limit('search_case_law', 60, 60);
  return query
  with matched as (
    select c.* from public.case_law c
    where p_query is null or p_query = ''
    union all
    select c.* from private.case_law_search_hits(p_query) h
    join public.case_law c on c.id = h.id
  )
  select
    cl.id, cl.case_name, cl.citation, cl.court, cl.jurisdiction, cl.summary,
    public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) as rank,
    ts_headline('english', coalesce(cl.summary, cl.full_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from matched cl
  order by public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) desc
  limit p_limit;
end;
$$;


ALTER FUNCTION "public"."search_case_law"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_case_law"("p_query" "text", "p_limit" integer) IS 'Full-text + trigram-fuzzy search over case_law. 0137: enforce_rpc_rate_limit 60/60s. 0171: candidates from private.case_law_search_hits (index-served); RLS still applies to every returned row.';



CREATE OR REPLACE FUNCTION "public"."search_case_law_scoped"("p_query" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_court_id" "uuid" DEFAULT NULL::"uuid", "p_jurisdiction_id" "uuid" DEFAULT NULL::"uuid", "p_tag_id" "uuid" DEFAULT NULL::"uuid", "p_category_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "case_name" "text", "citation" "text", "court" "text", "jurisdiction" "text", "summary" "text", "rank" real, "headline" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.enforce_rpc_rate_limit('search_case_law_scoped', 60, 60);
  return query
  with matched as (
    select c.* from public.case_law c
    where p_query is null or p_query = ''
    union all
    select c.* from private.case_law_search_hits(p_query) h
    join public.case_law c on c.id = h.id
  )
  select
    cl.id, cl.case_name, cl.citation, cl.court, cl.jurisdiction, cl.summary,
    public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) as rank,
    case when p_query is not null and p_query <> ''
      then ts_headline('english', coalesce(cl.summary, cl.full_text, ''),
             websearch_to_tsquery('english', p_query), 'MaxFragments=2, MaxWords=30, MinWords=10')
      else null end as headline
  from matched cl
  where cl.owner_id is null
    and (p_court_id is null or cl.court_id = p_court_id)
    and (p_jurisdiction_id is null or cl.jurisdiction_id = p_jurisdiction_id)
    and (p_category_id is null or cl.category_id = p_category_id)
    and (p_tag_id is null or exists (
      select 1 from public.case_law_tags clt where clt.case_law_id = cl.id and clt.tag_id = p_tag_id
    ))
  order by (p_query is not null and p_query <> '') desc,
    public.case_law_search_rank(cl.case_name, cl.search_vector, p_query) desc,
    cl.updated_at desc
  limit p_limit;
end;
$$;


ALTER FUNCTION "public"."search_case_law_scoped"("p_query" "text", "p_limit" integer, "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_tag_id" "uuid", "p_category_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_case_law_scoped"("p_query" "text", "p_limit" integer, "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_tag_id" "uuid", "p_category_id" "uuid") IS 'Canonical, facet-scoped Case Law Browse search. 0137: enforce_rpc_rate_limit 60/60s. 0171: candidates from private.case_law_search_hits (index-served); filters unchanged.';



CREATE OR REPLACE FUNCTION "public"."search_cases"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "case_number" "text", "title" "text", "status" "public"."case_status", "rank" real, "headline" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select
    c.id, c.case_number, c.title, c.status,
    ts_rank(c.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(c.description, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.cases c
  where c.search_vector @@ websearch_to_tsquery('english', p_query)
    and public.user_can_access_case(c.id)
  order by rank desc
  limit p_limit;
$$;


ALTER FUNCTION "public"."search_cases"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_docket_matters"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "case_number" "text", "matter_title" "text", "status" "public"."docket_matter_status", "rank" real, "headline" "text", "cover_image_path" "text", "charge_or_issue" "text", "arraignment_status" "text", "custody_status" "text", "disclosure_status" "text", "trial_status" "text", "ruling_status" "text", "judgment_status" "text", "sentence_status" "text", "appeal_status" "text", "procedure_stage" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.enforce_rpc_rate_limit('search_docket_matters', 60, 60);
  return query
  with matched as (
    select d.* from public.docket_matters d
    where p_query is null or btrim(p_query) = ''
    union all
    select d.* from private.docket_matter_search_hits(p_query) h
    join public.docket_matters d on d.id = h.id
  )
  select
    dm.id, dm.case_number, dm.matter_title, dm.status,
    public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query) as rank,
    ts_headline(
      'english',
      concat_ws(' ', dm.case_number, dm.matter_title, coalesce(dm.charge_or_issue, ''), coalesce(dm.orders_summary, '')),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10'
    ) as headline,
    dm.cover_image_path,
    dm.charge_or_issue,
    dm.arraignment_status,
    dm.custody_status,
    dm.disclosure_status,
    dm.trial_status,
    dm.ruling_status,
    dm.judgment_status,
    dm.sentence_status,
    dm.appeal_status,
    dm.procedure_stage
  from matched dm
  where dm.deleted_at is null
  order by public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, p_query) desc
  limit p_limit;
end;
$$;


ALTER FUNCTION "public"."search_docket_matters"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_docket_matters"("p_query" "text", "p_limit" integer) IS 'Docket Matter search. 0145: case number substring, title, charge, and active party/attorney names, plus the original full-text vector. 0171: candidates from private.docket_matter_search_hits (index-served). Rate limit unchanged from 0137.';



CREATE OR REPLACE FUNCTION "public"."search_judgments"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "title" "text", "case_number" "text", "citation" "text", "status" "text", "rank" real, "headline" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.enforce_rpc_rate_limit('search_judgments', 60, 60);
  return query
  select
    j.id, j.title, j.case_number, j.citation, j.status,
    ts_rank(j.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(j.content_text, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.judgments j
  where j.search_vector @@ websearch_to_tsquery('english', p_query)
  order by ts_rank(j.search_vector, websearch_to_tsquery('english', p_query)) desc
  limit p_limit;
end;
$$;


ALTER FUNCTION "public"."search_judgments"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_judgments"("p_query" "text", "p_limit" integer) IS 'Full-text search over judgments. 0137: enforce_rpc_rate_limit 60/60s. Query body unchanged from 0047.';



CREATE OR REPLACE FUNCTION "public"."search_quick_codes"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "code_word" "text", "title" "text", "rank" real, "headline" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select
    qc.id, qc.code_word, qc.title,
    ts_rank(qc.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(qc.content, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline
  from public.quick_codes qc
  where qc.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;


ALTER FUNCTION "public"."search_quick_codes"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_quick_codes"("p_query" "text", "p_limit" integer) IS 'Full-text search over quick_codes (code_word, title, content, description -- never owner_id). SECURITY INVOKER -- relies entirely on quick_codes'' own SELECT RLS (owner_id = auth.uid(), unchanged, no Court/Docket/share path, no is_admin() bypass). A non-owner never sees another user''s Quick Codes in search, exactly as in ordinary SELECT.';



CREATE OR REPLACE FUNCTION "public"."search_statutes"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "code" "text", "title" "text", "jurisdiction" "text", "summary" "text", "rank" real, "headline" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.enforce_rpc_rate_limit('search_statutes', 60, 60);
  return query
  with statute_matches as (
    select
      s.id, s.code, s.title, s.jurisdiction, s.summary,
      ts_rank(s.search_vector, websearch_to_tsquery('english', p_query)) as search_rank,
      ts_headline('english', coalesce(s.summary, s.full_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10') as headline
    from public.statutes s
    where s.search_vector @@ websearch_to_tsquery('english', p_query)
  ),
  provision_matches as (
    select
      s.id, s.code, s.title, s.jurisdiction, s.summary,
      ts_rank(sp.search_vector, websearch_to_tsquery('english', p_query)) as search_rank,
      ts_headline('english', coalesce(sp.heading, '') || ' ' || coalesce(sp.body_text, ''),
        websearch_to_tsquery('english', p_query),
        'MaxFragments=2, MaxWords=30, MinWords=10') as headline
    from public.statute_provisions sp
    join public.statutes s on s.id = sp.statute_id
    where sp.search_vector @@ websearch_to_tsquery('english', p_query)
  ),
  combined as (
    select * from statute_matches
    union all
    select * from provision_matches
  ),
  best_per_statute as (
    select distinct on (c.id)
      c.id, c.code, c.title, c.jurisdiction, c.summary, c.search_rank, c.headline
    from combined c
    order by c.id, c.search_rank desc
  )
  select b.id, b.code, b.title, b.jurisdiction, b.summary, b.search_rank, b.headline
  from best_per_statute b
  order by b.search_rank desc
  limit p_limit;
end;
$$;


ALTER FUNCTION "public"."search_statutes"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_statutes"("p_query" "text", "p_limit" integer) IS 'Full-text search over statutes and provisions. 0137: enforce_rpc_rate_limit 60/60s. 0157: CTE columns qualified so the PL/pgSQL OUT variables no longer make `id` ambiguous; results unchanged from 0055.';



CREATE OR REPLACE FUNCTION "public"."set_case_law_review_status"("p_case_law_id" "uuid", "p_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may change Case Law review status.';
  end if;

  if p_status not in ('draft', 'needs_review', 'ready') then
    raise exception 'set_case_law_review_status only accepts draft/needs_review/ready -- use publish_case_law_import or reject_case_law_import for other transitions.';
  end if;

  -- 0162: canonical rows only; a personal id is indistinguishable from a
  -- missing one (ADR 0007).
  select import_job_id into v_job_id
  from public.case_law
  where id = p_case_law_id and owner_id is null
  for update;

  if not found then
    raise exception 'Case Law record % not found.', p_case_law_id;
  end if;

  update public.case_law set review_status = p_status where id = p_case_law_id;

  -- import_jobs.status has no 'draft' value (0055) -- only sync the job
  -- when the target status exists in both vocabularies.
  if v_job_id is not null and p_status in ('needs_review', 'ready') then
    update public.import_jobs set status = p_status where id = v_job_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."set_case_law_review_status"("p_case_law_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_docket_matter_next_date"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_acknowledge_override" boolean DEFAULT false, "p_override_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("status" "text", "event_id" "uuid", "category_id" "uuid", "category_name" "text", "configured_capacity" integer, "scheduled_count" integer, "is_over_capacity" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_old_event_id uuid;
  v_old_scheduled_date date;
  v_old_outcome text;
  v_old_presiding uuid;
  v_presiding uuid;
  v_stage text;
  v_capacity integer;
  v_category_id uuid;
  v_category_name text;
  v_count integer;
  v_event_id uuid;
  v_will_count boolean;
  v_adjourn_label text;
begin
  if not public.can_edit_docket_matter(p_docket_matter_id) then
    raise exception 'Not authorized to schedule Docket Events on this matter.';
  end if;

  -- B-03: lock before reading the current next date, so a concurrent
  -- adjournment is seen and superseded rather than left live beside ours.
  select dm.category_id into v_category_id
  from public.docket_matters dm
  where dm.id = p_docket_matter_id
  for no key update;

  if p_category_id is not null then
    v_category_id := p_category_id;
  end if;

  select e.id, e.scheduled_date, e.outcome_at_event, e.presiding_magistrate_id
    into v_old_event_id, v_old_scheduled_date, v_old_outcome, v_old_presiding
  from public.docket_events e
  where e.docket_matter_id = p_docket_matter_id
    and e.event_status = 'scheduled'
    and e.scheduled_date >= current_date
  order by e.scheduled_date
  limit 1;

  if v_old_event_id is not null and v_old_scheduled_date = p_scheduled_date then
    v_will_count := v_category_id is not null and v_old_presiding is not null;
    if v_will_count then
      select s.daily_capacity into v_capacity
      from public.docket_capacity_settings s
      where s.owner_id = v_old_presiding and s.category_id = v_category_id;
      select c.name into v_category_name from public.docket_matter_categories c where c.id = v_category_id;
      v_count := public.docket_booked_count(v_old_presiding, v_category_id, p_scheduled_date);
    end if;
    return query select
      'created'::text, v_old_event_id, v_category_id, v_category_name, v_capacity,
      coalesce(v_count, 0), (v_capacity is not null and coalesce(v_count, 0) > v_capacity);
    return;
  end if;

  v_presiding := public.new_docket_event_presiding_magistrate(p_docket_matter_id, v_old_event_id);
  v_will_count := v_category_id is not null and v_presiding is not null;

  if v_will_count then
    -- B-05: one capacity decision per magistrate, category and day at a time.
    perform pg_advisory_xact_lock(hashtextextended(
      format('docket_capacity:%s:%s:%s', v_presiding, v_category_id, p_scheduled_date), 0));

    select s.daily_capacity into v_capacity
    from public.docket_capacity_settings s
    where s.owner_id = v_presiding and s.category_id = v_category_id;

    select c.name into v_category_name from public.docket_matter_categories c where c.id = v_category_id;

    v_count := public.docket_booked_count(v_presiding, v_category_id, p_scheduled_date, p_docket_matter_id);

    if v_capacity is not null and v_count >= v_capacity and not p_acknowledge_override then
      return query select
        'capacity_reached'::text, null::uuid, v_category_id, v_category_name, v_capacity, v_count,
        (v_count >= v_capacity);
      return;
    end if;
  end if;

  if v_old_event_id is not null then
    -- 0119: a Next Date change is an adjournment. The original sitting
    -- stays on its date as completed so that date remains filled and
    -- counted. True cancellations go through event_status = cancelled.
    v_adjourn_label := 'Adjourned to ' || to_char(p_scheduled_date, 'FMDD Mon YYYY');
    update public.docket_events set
      event_status = 'completed',
      outcome_at_event = coalesce(nullif(btrim(coalesce(v_old_outcome, '')), ''), v_adjourn_label)
    where id = v_old_event_id;
  end if;

  select public.matter_current_stage_label(p_docket_matter_id) into v_stage;

  insert into public.docket_events (
    docket_matter_id, scheduled_date, event_status, stage_at_event, category_id,
    created_by, presiding_magistrate_id
  ) values (
    p_docket_matter_id, p_scheduled_date, 'scheduled', v_stage, v_category_id,
    (select auth.uid()), v_presiding
  )
  returning id into v_event_id;

  if v_will_count and v_capacity is not null and v_count >= v_capacity then
    insert into public.docket_capacity_overrides (
      docket_event_id, docket_matter_id, category_id, magistrate_profile_id, overridden_by,
      scheduled_date, configured_capacity, scheduled_count_at_override, reason
    ) values (
      v_event_id, p_docket_matter_id, v_category_id, v_presiding, (select auth.uid()),
      p_scheduled_date, v_capacity, v_count + 1, nullif(btrim(coalesce(p_override_reason, '')), '')
    );
  end if;

  return query select
    'created'::text,
    v_event_id,
    v_category_id,
    v_category_name,
    v_capacity,
    case when v_will_count then v_count + 1 else v_count end,
    (v_will_count and v_capacity is not null and (v_count + 1) > v_capacity);
end;
$$;


ALTER FUNCTION "public"."set_docket_matter_next_date"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_category_id" "uuid", "p_acknowledge_override" boolean, "p_override_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_docket_matter_next_date"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_category_id" "uuid", "p_acknowledge_override" boolean, "p_override_reason" "text") IS 'Sets/changes a Docket Matter''s Next Date. Requires can_edit_docket_matter (0141). Locks the matter first, so concurrent adjournments run in turn and one live next date remains (0163). Supersedes the event currently driving next_appearance by marking it completed (0119 adjournment, including future dates) and stamping outcome_at_event Adjourned to … when empty. The new hearing''s presiding magistrate, and so the capacity it counts against, is new_docket_event_presiding_magistrate(); the count is docket_booked_count under an advisory lock per magistrate, category and date (0163). When p_category_id is null, the matter''s own category_id is used.';



CREATE OR REPLACE FUNCTION "public"."set_legislation_review_status"("p_statute_id" "uuid", "p_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may change Legislation review status.';
  end if;

  if p_status not in ('draft', 'needs_review', 'ready') then
    raise exception 'set_legislation_review_status only accepts draft/needs_review/ready -- use publish_legislation_import or reject_legislation_import for other transitions.';
  end if;

  if not exists (select 1 from public.statutes where id = p_statute_id) then
    raise exception 'Legislation record % not found.', p_statute_id;
  end if;

  select import_job_id into v_job_id from public.statutes where id = p_statute_id;

  update public.statutes set review_status = p_status where id = p_statute_id;

  if v_job_id is not null and p_status in ('needs_review', 'ready') then
    update public.import_jobs set status = p_status where id = v_job_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."set_legislation_review_status"("p_statute_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_profile_active"("p_profile_id" "uuid", "p_active" boolean, "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_target public.profiles%rowtype;
  v_changed boolean;
  v_sessions integer := 0;
  v_assignments jsonb;
begin
  if p_profile_id is null or p_active is null then
    raise exception 'p_profile_id and p_active are required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.set_profile_active'));

  if not (select public.is_admin()) then
    raise exception 'Only an active administrator can deactivate or reactivate an account'
      using errcode = '42501';
  end if;
  if not p_active and v_reason is null then
    raise exception 'Give a reason for deactivating this account'
      using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters or fewer'
      using errcode = '22023';
  end if;

  select * into v_target from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Account % not found', p_profile_id
      using errcode = 'P0002';
  end if;

  if not p_active
    and v_target.role = 'admin'
    and v_target.is_active
    and not exists (
      select 1 from public.profiles
      where role = 'admin' and is_active and id <> p_profile_id
    )
  then
    raise exception 'This is the last active administrator. Make another account an administrator before deactivating this one.'
      using errcode = 'P0001';
  end if;

  v_changed := v_target.is_active is distinct from p_active;
  if v_changed then
    update public.profiles set is_active = p_active where id = p_profile_id;

    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (
      (select auth.uid()),
      'update',
      'profiles',
      p_profile_id,
      jsonb_build_object(
        'event', case when p_active then 'account_reactivated' else 'account_deactivated' end,
        'reason', v_reason
      )
    );
  end if;

  if p_active then
    update auth.users set banned_until = null
    where id = p_profile_id and banned_until is not null;
  else
    update auth.users set banned_until = timestamptz '9999-12-31 00:00:00+00'
    where id = p_profile_id;
    delete from auth.sessions where user_id = p_profile_id;
    get diagnostics v_sessions = row_count;
  end if;

  select coalesce(jsonb_agg(a.assignment order by a.started_at, a.id), '[]'::jsonb)
  into v_assignments
  from (
    select
      mc.id,
      mc.started_at,
      jsonb_build_object(
        'kind', 'magistrate',
        'assignment_id', mc.id,
        'court_id', mc.court_id,
        'court_name', c.name,
        'assignment_type', mc.assignment_type,
        'occupies_primary_slot', mc.occupies_primary_slot,
        'can_manage_clerks', mc.can_manage_clerks,
        'started_at', mc.started_at
      ) as assignment
    from public.magistrate_courts mc
    join public.courts c on c.id = mc.court_id
    where mc.profile_id = p_profile_id and mc.ended_at is null
    union all
    select
      cc.id,
      cc.started_at,
      jsonb_build_object(
        'kind', 'clerk',
        'assignment_id', cc.id,
        'court_id', cc.court_id,
        'court_name', c.name,
        'started_at', cc.started_at
      )
    from public.clerk_courts cc
    join public.courts c on c.id = cc.court_id
    where cc.profile_id = p_profile_id and cc.ended_at is null
  ) a;

  return jsonb_build_object(
    'profile_id', p_profile_id,
    'is_active', p_active,
    'changed', v_changed,
    'sessions_revoked', v_sessions,
    'court_assignments', v_assignments
  );
end;
$$;


ALTER FUNCTION "public"."set_profile_active"("p_profile_id" "uuid", "p_active" boolean, "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_profile_active"("p_profile_id" "uuid", "p_active" boolean, "p_reason" "text") IS 'Deactivates or reactivates one account (0201, BE-09). Active administrators only. Deactivating needs a reason, is refused for the last active administrator, bans the user and deletes their sessions; reactivating lifts the ban. Never ends court assignments: returns { profile_id, is_active, changed, sessions_revoked, court_assignments[] } listing the open magistrate and clerk assignments to reassign. Audited; idempotent.';



CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shares_delete_for_parent"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.shares
  where item_type = tg_argv[0]
    and item_id = old.id;
  return old;
end;
$$;


ALTER FUNCTION "public"."shares_delete_for_parent"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shares_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_recipient_nulled boolean;
  v_granted_by_nulled boolean;
begin
  if tg_op = 'INSERT' then
    new.granted_by := (select auth.uid());
    return new;
  end if;

  v_recipient_nulled := old.recipient_id is not null and new.recipient_id is null;
  v_granted_by_nulled := old.granted_by is not null and new.granted_by is null;

  if v_recipient_nulled or v_granted_by_nulled then
    if new.item_type is distinct from old.item_type
       or new.item_id is distinct from old.item_id
       or new.permission is distinct from old.permission
       or new.created_at is distinct from old.created_at
       or (new.recipient_id is distinct from old.recipient_id and not v_recipient_nulled)
       or (new.granted_by is distinct from old.granted_by and not v_granted_by_nulled) then
      raise exception 'Unexpected combined change alongside a recipient/granter removal on a Share';
    end if;

    if v_recipient_nulled and old.revoked_at is null then
      new.revoked_at := now();
    end if;

    return new;
  end if;

  if old.revoked_at is not null then
    raise exception 'Cannot modify an already-revoked Share';
  end if;

  if new.item_type is distinct from old.item_type
     or new.item_id is distinct from old.item_id
     or new.recipient_id is distinct from old.recipient_id
     or new.granted_by is distinct from old.granted_by
     or new.permission is distinct from old.permission
     or new.created_at is distinct from old.created_at then
    raise exception 'A Share may only have revoked_at set to revoke it; no other field may change';
  end if;

  if new.revoked_at is null then
    raise exception 'Reactivating a revoked Share is not permitted; create a new Share instead, subject to the ordinary creation authorization at that time';
  end if;

  -- Any non-null revoked_at means "revoke now": the device clock is
  -- never stored (0165).
  new.revoked_at := now();

  return new;
end;
$$;


ALTER FUNCTION "public"."shares_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."shares_guard"() IS 'Forces granted_by at INSERT. On UPDATE: permits ONLY setting revoked_at (once, never cleared) via the ordinary client path, and separately permits the recipient_id/granted_by FK''s own ON DELETE SET NULL action -- auto-revoking a still-active share ONLY when recipient_id is the column being nulled, never merely because granted_by is nulled. 0165: a revoke is always stamped with the server''s now(); the value the client sends only signals the revoke.';



CREATE OR REPLACE FUNCTION "public"."shares_item_must_exist"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.item_type = 'docket_matter' then
    if not exists (select 1 from public.docket_matters where id = new.item_id) then
      raise exception 'Share item_id must reference an existing Docket Matter';
    end if;
  elsif new.item_type = 'judgment' then
    if not exists (select 1 from public.judgments where id = new.item_id) then
      raise exception 'Share item_id must reference an existing Judgment';
    end if;
  elsif new.item_type = 'case_law' then
    if not exists (
      select 1 from public.case_law
      where id = new.item_id and owner_id is not null
    ) then
      raise exception 'Share item_id must reference existing personal Case Law; canonical Case Law cannot be shared';
    end if;
  else
    raise exception 'Unsupported share item_type';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."shares_item_must_exist"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shares_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_noun text;
  v_link text;
begin
  v_noun := case new.item_type
    when 'docket_matter' then 'docket matter'
    when 'judgment' then 'judgment'
    when 'case_law' then 'case law research'
    else 'item'
  end;
  v_link := case new.item_type
    when 'docket_matter' then '/docket/' || new.item_id::text
    when 'judgment' then '/judgments/' || new.item_id::text
    when 'case_law' then '/case-law/' || new.item_id::text
    else null
  end;

  if tg_op = 'INSERT' and new.revoked_at is null and new.recipient_id is not null then
    perform public.notify_user(
      new.recipient_id,
      'share_granted',
      'A ' || v_noun || ' was shared with you',
      'You were granted ' || new.permission || ' access.',
      v_link
    );
  elsif tg_op = 'UPDATE'
    and old.revoked_at is null
    and new.revoked_at is not null
    and new.recipient_id is not null
  then
    perform public.notify_user(
      new.recipient_id,
      'share_revoked',
      'A share was revoked',
      'Your access to a ' || v_noun || ' was revoked.',
      v_link
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."shares_notify"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shares_prevent_docket_parent_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if exists (
    select 1 from public.shares s
    where s.item_type = 'docket_matter' and s.item_id = old.id
  ) then
    raise exception 'Cannot delete a Docket Matter while Shares still reference it';
  end if;
  return old;
end;
$$;


ALTER FUNCTION "public"."shares_prevent_docket_parent_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shares_recipient_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.item_type in ('judgment', 'case_law')
    and new.recipient_id is not null
    and not public.can_receive_research_share(new.recipient_id)
  then
    raise exception 'Judgments and research can be shared only with a magistrate who sits a court, or an administrator. Clerks cannot open them.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."shares_recipient_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."shares_recipient_guard"() IS 'BEFORE INSERT on shares (0165): a Judgment or personal Case Law share must go to someone can_receive_research_share() accepts. SECURITY DEFINER because the recipient''s role and court are not readable by the granting user.';



CREATE OR REPLACE FUNCTION "public"."statutes_created_by_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' and (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  elsif tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."statutes_created_by_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_clerk_access_request"("p_court_id" "uuid", "p_staff_id" "text" DEFAULT NULL::"text", "p_note" "text" DEFAULT NULL::"text") RETURNS "public"."clerk_access_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result public.clerk_access_requests;
begin
  if not (select public.is_clerk()) then
    raise exception 'Only a clerk account may submit a court access request';
  end if;

  if not exists (select 1 from public.courts where id = p_court_id and is_active = true) then
    raise exception 'Court not found or inactive';
  end if;

  if exists (
    select 1 from public.clerk_courts
    where profile_id = (select auth.uid()) and court_id = p_court_id and ended_at is null
  ) then
    raise exception 'You already have access to this court';
  end if;

  if exists (
    select 1 from public.clerk_access_requests
    where profile_id = (select auth.uid()) and court_id = p_court_id and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this court';
  end if;

  begin
    insert into public.clerk_access_requests (profile_id, court_id, staff_id, note)
    values ((select auth.uid()), p_court_id, nullif(trim(p_staff_id), ''), nullif(trim(p_note), ''))
    returning * into v_result;
  exception when unique_violation then
    -- A concurrent double submit passed the pre-check above; the partial
    -- unique index clerk_access_requests_pending_pair_idx caught it.
    raise exception 'You already have a pending request for this court';
  end;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."submit_clerk_access_request"("p_court_id" "uuid", "p_staff_id" "text", "p_note" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."submit_clerk_access_request"("p_court_id" "uuid", "p_staff_id" "text", "p_note" "text") IS 'Lets an authenticated clerk request access to one additional court. Always creates its own independent request row -- never implies access to any other court in the same or a different district. Rejects a duplicate active pending request for the same (clerk, court) pair via the partial unique index.';



CREATE OR REPLACE FUNCTION "public"."submit_magistrate_court_request"("p_court_id" "uuid", "p_staff_id" "text" DEFAULT NULL::"text", "p_note" "text" DEFAULT NULL::"text") RETURNS "public"."magistrate_court_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role public.user_role;
  v_request public.magistrate_court_requests;
  v_kind text;
begin
  select role into v_role from public.profiles where id = (select auth.uid());
  if v_role is null or v_role not in ('magistrate', 'admin') then
    raise exception 'Only a magistrate (or an administrator who also sits as a magistrate) may request a court assignment';
  end if;

  if not exists (select 1 from public.courts where id = p_court_id and is_active = true) then
    raise exception 'Court not found or inactive';
  end if;

  if exists (
    select 1 from public.magistrate_courts
    where profile_id = (select auth.uid()) and court_id = p_court_id and ended_at is null
  ) then
    raise exception 'You already have an active assignment at this court';
  end if;

  if exists (
    select 1 from public.magistrate_court_requests
    where profile_id = (select auth.uid()) and court_id = p_court_id and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this court';
  end if;

  v_kind := case
    when public.court_has_active_primary_magistrate(p_court_id) then 'occupied_exception'
    else 'ordinary'
  end;

  insert into public.magistrate_court_requests (
    profile_id, court_id, staff_id, note, request_kind
  ) values (
    (select auth.uid()),
    p_court_id,
    nullif(trim(coalesce(p_staff_id, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    v_kind
  )
  returning * into v_request;

  return v_request;
end;
$$;


ALTER FUNCTION "public"."submit_magistrate_court_request"("p_court_id" "uuid", "p_staff_id" "text", "p_note" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."submit_magistrate_court_request"("p_court_id" "uuid", "p_staff_id" "text", "p_note" "text") IS 'Magistrate (or sitting-admin) self-service: create one independent pending request. Occupied courts are accepted as request_kind=occupied_exception and still do not occupy the slot. Admin replace/co-sit is required before seating.';



CREATE OR REPLACE FUNCTION "public"."sync_magistrate_court_occupies_primary_slot"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.assignment_type = 'regular' and new.ended_at is null then
    new.occupies_primary_slot := public.profile_has_completed_first_sign_in(new.profile_id);
  else
    new.occupies_primary_slot := false;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_magistrate_court_occupies_primary_slot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_judgment_ownership"("p_judgment_id" "uuid", "p_to_profile_id" "uuid", "p_court_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := nullif(btrim(p_reason), '');
  v_from uuid;
  v_original uuid;
  v_transfer public.judgment_ownership_transfers;
begin
  if p_judgment_id is null or p_to_profile_id is null or p_court_id is null then
    raise exception 'p_judgment_id, p_to_profile_id and p_court_id are required'
      using errcode = '22023';
  end if;
  if not (select public.is_admin()) then
    raise exception 'Only an active administrator can transfer a judgment'
      using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for this transfer'
      using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters or fewer'
      using errcode = '22023';
  end if;

  select j.owner_id into v_from
  from public.judgments j
  where j.id = p_judgment_id
  for update;
  if not found then
    raise exception 'Judgment % not found', p_judgment_id
      using errcode = 'P0002';
  end if;

  if v_from = p_to_profile_id then
    raise exception 'This magistrate already owns the judgment'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.magistrate_courts mc
    where mc.profile_id = v_from and mc.court_id = p_court_id
  ) then
    raise exception 'The judgment''s owner has never sat at this court'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.magistrate_courts mc on mc.profile_id = p.id
    where p.id = p_to_profile_id
      and p.is_active
      and p.role in ('magistrate', 'admin')
      and mc.court_id = p_court_id
      and mc.ended_at is null
  ) then
    raise exception 'A judgment can be transferred only to an active magistrate who sits at this court'
      using errcode = 'P0001';
  end if;

  select t.original_author_id into v_original
  from public.judgment_ownership_transfers t
  where t.judgment_id = p_judgment_id
  order by t.created_at, t.id
  limit 1;
  v_original := coalesce(v_original, v_from);

  update public.judgments set owner_id = p_to_profile_id where id = p_judgment_id;

  insert into public.judgment_ownership_transfers (
    judgment_id, from_owner_id, to_owner_id, original_author_id, transferred_by, court_id, reason
  )
  values (p_judgment_id, v_from, p_to_profile_id, v_original, v_actor, p_court_id, v_reason)
  returning * into v_transfer;

  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (
    v_actor,
    'update',
    'judgments',
    p_judgment_id,
    jsonb_build_object(
      'event', 'judgment_ownership_transferred',
      'transfer_id', v_transfer.id,
      'from_owner_id', v_from,
      'to_owner_id', p_to_profile_id,
      'original_author_id', v_original,
      'court_id', p_court_id,
      'reason', v_reason
    )
  );

  perform public.notify_user(
    p_to_profile_id,
    'judgment_transferred',
    'A judgment was transferred to you',
    'An administrator made you the owner of a judgment. Its original author stays on record.',
    '/judgments/' || p_judgment_id::text
  );
  perform public.notify_user(
    v_from,
    'judgment_transferred',
    'A judgment you owned was transferred',
    'An administrator transferred one of your judgments to another magistrate of the court. Its original author stays on record.',
    '/judgments?transferred=' || p_judgment_id::text
  );

  return jsonb_build_object(
    'transfer_id', v_transfer.id,
    'judgment_id', p_judgment_id,
    'from_owner_id', v_from,
    'to_owner_id', p_to_profile_id,
    'original_author_id', v_original,
    'court_id', p_court_id,
    'transferred_at', v_transfer.created_at
  );
end;
$$;


ALTER FUNCTION "public"."transfer_judgment_ownership"("p_judgment_id" "uuid", "p_to_profile_id" "uuid", "p_court_id" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."transfer_judgment_ownership"("p_judgment_id" "uuid", "p_to_profile_id" "uuid", "p_court_id" "uuid", "p_reason" "text") IS 'Moves a judgment to another owner (0220, BE-26, ADR 0011). Active administrators only, with a reason (500 characters at most). The new owner must be an active magistrate (or administrator) who sits at p_court_id, and the current owner must sit or have sat there. Changes owner_id only: content, status, finalisation, versions, tags, shares, pins and documents stay as they are and nothing is deleted. Records the transfer with the original author in judgment_ownership_transfers, writes an audit_log event and notifies both magistrates (judgment_transferred). Returns ids only, never content.';



CREATE OR REPLACE FUNCTION "public"."unlink_judgment_pins_on_court_end"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.unlink_orphaned_judgment_pins(
    new.profile_id, new.court_id, null, 'court_assignment_ended'
  );
  return null;
end;
$$;


ALTER FUNCTION "public"."unlink_judgment_pins_on_court_end"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."unlink_judgment_pins_on_court_end"() IS 'AFTER UPDATE OF ended_at on magistrate_courts (0220, BE-26): when an assignment ends, by relinquish, an administrator or the first-sign-in rule, unlinks that magistrate''s judgment pins at that court that are now visible to nobody (unlink_orphaned_judgment_pins). Executable by no client role.';



CREATE OR REPLACE FUNCTION "public"."unlink_judgment_pins_on_retained_end"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.unlink_orphaned_judgment_pins(
    new.profile_id, null, new.docket_matter_id, 'retained_assignment_ended'
  );
  return null;
end;
$$;


ALTER FUNCTION "public"."unlink_judgment_pins_on_retained_end"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."unlink_judgment_pins_on_retained_end"() IS 'AFTER UPDATE OF ended_at on docket_matter_assignments (0220, BE-26): when a retained assignment ends, unlinks that magistrate''s judgment pins on that matter that are now visible to nobody (unlink_orphaned_judgment_pins). A profile already removed (profile_id null) has nothing to unlink. Executable by no client role.';



CREATE OR REPLACE FUNCTION "public"."unlink_my_orphaned_judgment_pins"("p_dry_run" boolean DEFAULT false) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if (select auth.uid()) is null or not (select public.is_active_account()) then
    raise exception 'Not authenticated'
      using errcode = '42501';
  end if;

  return public.unlink_orphaned_judgment_pins(
    (select auth.uid()), null, null, 'owner_unlinked', coalesce(p_dry_run, false)
  );
end;
$$;


ALTER FUNCTION "public"."unlink_my_orphaned_judgment_pins"("p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."unlink_my_orphaned_judgment_pins"("p_dry_run" boolean) IS 'The caller''s own judgment pins that nobody else can see, on matters the caller can no longer see (0220, BE-26): p_dry_run counts them, otherwise they are unlinked and audited. For pins left by hand-overs before 0220; since 0220 ending an assignment unlinks them itself.';



CREATE OR REPLACE FUNCTION "public"."unlink_orphaned_judgment_pins"("p_owner_id" "uuid", "p_court_id" "uuid" DEFAULT NULL::"uuid", "p_docket_matter_id" "uuid" DEFAULT NULL::"uuid", "p_reason" "text" DEFAULT NULL::"text", "p_dry_run" boolean DEFAULT false) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_ids uuid[];
  v_count integer;
begin
  if p_owner_id is null then
    return 0;
  end if;

  -- A pin is visible to someone who can see both its matter and its
  -- judgment. A judgment that is not discoverable and has no active share
  -- is visible only to its owner, so once the owner cannot see the matter
  -- either, nobody can see the pin.
  select coalesce(array_agg(dmj.id order by dmj.created_at, dmj.id), '{}')
  into v_ids
  from public.docket_matter_judgments dmj
  join public.judgments j on j.id = dmj.judgment_id
  join public.docket_matters dm on dm.id = dmj.docket_matter_id
  where j.owner_id = p_owner_id
    and (p_court_id is null or dm.court_id = p_court_id)
    and (p_docket_matter_id is null or dm.id = p_docket_matter_id)
    and not j.is_discoverable
    and not exists (
      select 1 from public.shares s
      where s.item_type = 'judgment'
        and s.item_id = j.id
        and s.recipient_id is not null
        and s.revoked_at is null
    )
    and not exists (
      select 1 from public.magistrate_courts mc
      where mc.profile_id = p_owner_id
        and mc.court_id = dm.court_id
        and mc.ended_at is null
    )
    and not exists (
      select 1 from public.docket_matter_assignments a
      where a.profile_id = p_owner_id
        and a.docket_matter_id = dm.id
        and a.ended_at is null
    )
    and not exists (
      select 1 from public.shares s
      where s.item_type = 'docket_matter'
        and s.item_id = dm.id
        and s.recipient_id = p_owner_id
        and s.revoked_at is null
    );

  if p_dry_run or cardinality(v_ids) = 0 then
    return cardinality(v_ids);
  end if;

  with gone as (
    delete from public.docket_matter_judgments dmj
    where dmj.id = any (v_ids)
    returning dmj.id, dmj.docket_matter_id, dmj.judgment_id, dmj.created_by, dmj.created_at
  ),
  logged as (
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    select
      (select auth.uid()),
      'delete',
      'docket_matter_judgments',
      g.id,
      jsonb_build_object(
        'id', g.id,
        'docket_matter_id', g.docket_matter_id,
        'judgment_id', g.judgment_id,
        'created_by', g.created_by,
        'created_at', g.created_at
      ),
      jsonb_build_object(
        'event', 'judgment_pin_unlinked',
        'owner_id', p_owner_id,
        'reason', p_reason
      )
    from gone g
    returning 1
  )
  select count(*) into v_count from logged;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."unlink_orphaned_judgment_pins"("p_owner_id" "uuid", "p_court_id" "uuid", "p_docket_matter_id" "uuid", "p_reason" "text", "p_dry_run" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."unlink_orphaned_judgment_pins"("p_owner_id" "uuid", "p_court_id" "uuid", "p_docket_matter_id" "uuid", "p_reason" "text", "p_dry_run" boolean) IS 'Internal (0220, BE-26). Unlinks, or with p_dry_run counts, the pins of p_owner_id''s judgments that nobody else can see (not discoverable, no active share) on matters p_owner_id can no longer see (no current court or retained assignment, no docket share), optionally within one court or one matter. Writes one audit_log row per unlinked pin (ids only). Executable by no client role.';



CREATE OR REPLACE FUNCTION "public"."user_can_access_bench_note"("p_note_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.bench_notes n
    where n.id = p_note_id
      and n.author_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."user_can_access_bench_note"("p_note_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_can_access_bench_note"("p_note_id" "uuid") IS 'Corrected in 0038 to match the resolved §8 model: author_id = auth.uid() only, no is_admin() bypass, no is_private-gated Court-mate visibility (that path relied on the now-dropped case_id join). Signature unchanged so bench_note_tags/documents/comments/storage.objects RLS and global_search() all inherit the corrected behavior automatically.';



CREATE OR REPLACE FUNCTION "public"."user_can_access_case"("p_case_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.cases c
    where c.id = p_case_id
      and (public.is_admin() or c.court_id = public.my_court_id())
  );
$$;


ALTER FUNCTION "public"."user_can_access_case"("p_case_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_bookmark_entity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  case new.entity_type
    when 'case' then
      if not exists (select 1 from public.cases where id = new.entity_id) then
        raise exception 'bookmark references a case that does not exist: %', new.entity_id;
      end if;
    when 'bench_note' then
      if not exists (select 1 from public.bench_notes where id = new.entity_id) then
        raise exception 'bookmark references a bench note that does not exist: %', new.entity_id;
      end if;
    when 'statute' then
      if not exists (select 1 from public.statutes where id = new.entity_id) then
        raise exception 'bookmark references a statute that does not exist: %', new.entity_id;
      end if;
    when 'statute_provision' then
      if not exists (select 1 from public.statute_provisions where id = new.entity_id) then
        raise exception 'bookmark references a statute provision that does not exist: %', new.entity_id;
      end if;
    when 'case_law' then
      if not exists (select 1 from public.case_law where id = new.entity_id) then
        raise exception 'bookmark references a case law entry that does not exist: %', new.entity_id;
      end if;
    when 'docket_matter' then
      if not exists (select 1 from public.docket_matters where id = new.entity_id) then
        raise exception 'bookmark references a docket matter that does not exist or is not accessible: %', new.entity_id;
      end if;
    when 'judgment' then
      if not exists (select 1 from public.judgments where id = new.entity_id) then
        raise exception 'bookmark references a judgment that does not exist or is not accessible: %', new.entity_id;
      end if;
    when 'quick_code' then
      if not exists (select 1 from public.quick_codes where id = new.entity_id) then
        raise exception 'bookmark references a quick code that does not exist or is not accessible: %', new.entity_id;
      end if;
  end case;
  return new;
end;
$$;


ALTER FUNCTION "public"."validate_bookmark_entity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_bookmark_entity"() IS 'BEFORE INSERT OR UPDATE on bookmarks. Validates entity_id exists in (and, being SECURITY INVOKER, is lawfully readable under caller RLS in) the table named by entity_type, for all seven approved types: case | bench_note | statute | case_law (unchanged since 0008) | docket_matter | judgment | quick_code (added 0041/0042). SECURITY INVOKER deliberately preserved -- unlike bench_notes_entity_guard() (0038/0039), a Bookmark must only be creatable against an entity the caller can currently access; the check must NOT bypass the parent table''s own RLS. No dynamic SQL (explicit CASE over exactly the seven CHECK-enum-constrained entity types). Runs unconditionally on both INSERT and UPDATE with no reference-changed guard -- structurally similar to the bug fixed in 0039 for bench_notes, but not a live issue here because bookmarks has no UPDATE RLS policy at all, so no UPDATE ever reaches this trigger. Does not grant, return, or expose any parent row data -- existence/visibility only.';



CREATE OR REPLACE FUNCTION "public"."verify_audit_hash_chain"() RETURNS TABLE("ok" boolean, "broken_id" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  r record;
  prev text := 'genesis';
  expected text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  for r in
    select id, action, table_name, record_id, actor_id, created_at, old_data, new_data, prev_hash, row_hash
    from public.audit_log
    order by id
  loop
    if r.prev_hash is distinct from prev then
      ok := false;
      broken_id := r.id;
      return next;
      return;
    end if;
    expected := public.audit_log_digest(
      public.audit_log_payload(
        r.prev_hash, r.id, r.action, r.table_name, r.record_id, r.actor_id, r.created_at, r.old_data, r.new_data
      )
    );
    if r.row_hash is distinct from expected then
      ok := false;
      broken_id := r.id;
      return next;
      return;
    end if;
    prev := r.row_hash;
  end loop;

  ok := true;
  broken_id := null;
  return next;
end;
$$;


ALTER FUNCTION "public"."verify_audit_hash_chain"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."verify_audit_hash_chain"() IS 'Walks audit_log in id order and reports the first broken hash link. Callable by admins via RLS on the page that displays it; the function itself does not leak row bodies.';



CREATE OR REPLACE FUNCTION "public"."webhook_signature"("p_secret" "text", "p_body" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select encode(extensions.hmac(convert_to(p_body, 'utf8'), convert_to(p_secret, 'utf8'), 'sha256'), 'hex');
$$;


ALTER FUNCTION "public"."webhook_signature"("p_secret" "text", "p_body" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" bigint NOT NULL,
    "actor_id" "uuid",
    "action" "public"."audit_action" NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid",
    "old_data" "jsonb",
    "new_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prev_hash" "text",
    "row_hash" "text"
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_log" IS 'Append-only audit trail populated by audit_trigger_fn() on sensitive tables.';



ALTER TABLE "public"."audit_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."auth_event_log" (
    "id" bigint NOT NULL,
    "event_type" "public"."auth_event_type" NOT NULL,
    "actor_id" "uuid",
    "email" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."auth_event_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."auth_event_log" IS 'Append-only sign-in trail written only by record_auth_event(). Admin SELECT only.';



ALTER TABLE "public"."auth_event_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."auth_event_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."bench_note_tags" (
    "bench_note_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bench_note_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bench_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "content_text" "text" DEFAULT ''::"text" NOT NULL,
    "status" "public"."note_status" DEFAULT 'draft'::"public"."note_status" NOT NULL,
    "is_private" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", ((COALESCE("title", ''::"text") || ' '::"text") || COALESCE("content_text", ''::"text")))) STORED,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    CONSTRAINT "bench_notes_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['docket_matter'::"text", 'judgment'::"text", 'case_law'::"text", 'statute'::"text", 'statute_provision'::"text"])))
);


ALTER TABLE "public"."bench_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."bench_notes" IS 'Magistrate/clerk notes, optionally tied to a case; content is TipTap JSON, content_text is its plain-text extraction used for search.';



COMMENT ON COLUMN "public"."bench_notes"."author_id" IS 'ON DELETE RESTRICT preserves judicial notes; deactivate the profile (is_active = false) instead of deleting it.';



COMMENT ON COLUMN "public"."bench_notes"."is_private" IS 'DEPRECATED as of 0038 -- legacy column, inert under the resolved §8 access model (author_id = auth.uid() only). No RLS policy or function on this table reads this column anymore. Retained for now rather than dropped; do not consult it for access control. Candidate for removal in a future dedicated cleanup migration once confirmed unused by application code.';



COMMENT ON COLUMN "public"."bench_notes"."entity_type" IS 'Polymorphic parent discriminator -- docket_matter | judgment | case_law. No policy or function on this table reads it for access control; it exists purely to locate/organize notes, never to gate visibility (see §8 -- access is author_id = auth.uid() only, no parent-access cascade).';



COMMENT ON COLUMN "public"."bench_notes"."entity_id" IS 'Polymorphic parent id. No declarative FK is possible across three target tables; existence is enforced procedurally by bench_notes_entity_guard() below, which runs SECURITY DEFINER specifically so a note''s validity never depends on whether the author can currently see the parent row (see migration header).';



CREATE TABLE IF NOT EXISTS "public"."bookmarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "entity_type" "public"."bookmark_entity_type" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bookmarks" OWNER TO "postgres";


COMMENT ON TABLE "public"."bookmarks" IS 'Per-user saved references to a case, bench note, statute, or case law entry.';



CREATE TABLE IF NOT EXISTS "public"."case_law" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_name" "text" NOT NULL,
    "citation" "text" NOT NULL,
    "court" "text" NOT NULL,
    "jurisdiction" "text" NOT NULL,
    "decided_date" "date",
    "summary" "text",
    "full_text" "text",
    "source_url" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", ((((((((((COALESCE("case_name", ''::"text") || ' '::"text") || COALESCE("citation", ''::"text")) || ' '::"text") || COALESCE("court", ''::"text")) || ' '::"text") || COALESCE("jurisdiction", ''::"text")) || ' '::"text") || COALESCE("summary", ''::"text")) || ' '::"text") || COALESCE("full_text", ''::"text")))) STORED,
    "owner_id" "uuid",
    "is_discoverable" boolean DEFAULT false NOT NULL,
    "neutral_citation" "text",
    "reported_citation" "text",
    "judges" "text",
    "parties" "text",
    "issues" "text",
    "principles" "text",
    "key_passages" "text",
    "disposition" "text",
    "review_status" "text" DEFAULT 'published'::"text" NOT NULL,
    "source_id" "uuid",
    "retrieved_at" timestamp with time zone,
    "document_hash" "text",
    "import_job_id" "uuid",
    "original_filename" "text",
    "court_id" "uuid",
    "jurisdiction_id" "uuid",
    "content_quality_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "category_id" "uuid",
    CONSTRAINT "case_law_content_quality_status_check" CHECK (("content_quality_status" = ANY (ARRAY['good'::"text", 'fair'::"text", 'poor'::"text", 'failed'::"text", 'unknown'::"text"]))),
    CONSTRAINT "case_law_review_status_check" CHECK (("review_status" = ANY (ARRAY['draft'::"text", 'needs_review'::"text", 'ready'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."case_law" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_law" IS 'Dual-model Case Law: canonical/institutional legal authority (owner_id IS NULL, admin-curated, globally readable, admin-only write) coexisting with privately owned personal Case Law research (owner_id IS NOT NULL, private by default with owner-controlled is_discoverable, owner-only write) in a single table -- see 0035. Ownership is immutable after creation. No admin bypass into personal rows; Admin''s canonical curation authority and a magistrate''s personal-record privacy are separate concerns. citation uniqueness is enforced only among canonical rows (case_law_citation_canonical_unique_idx); personal rows have no citation uniqueness constraint. docket_matter_case_law (0030) and quick_code_case_law (0034) both express Case-Law-side access as a live, unmodified EXISTS against this table, so they automatically inherit this new access model with zero change to either table. Related details that belong with a row: summary/full_text (same row); case_law_tags (FK ON DELETE CASCADE); case_law_annotations (FK ON DELETE CASCADE); documents where entity_type=''case_law'' and entity_id=id (polymorphic, no declarative FK); storage object at documents.file_path.';



COMMENT ON COLUMN "public"."case_law"."court" IS 'Free-text deciding court as entered/extracted -- preserved for backward compatibility and as a display fallback. Prefer court_id (legal_authority_courts) where set; do not delete/overwrite this column.';



COMMENT ON COLUMN "public"."case_law"."jurisdiction" IS 'Free-text jurisdiction as entered/extracted -- preserved for backward compatibility and as a display fallback. Prefer jurisdiction_id (legal_jurisdictions) where set; do not delete/overwrite this column.';



COMMENT ON COLUMN "public"."case_law"."owner_id" IS 'Nullable. NULL = canonical/institutional Case Law (admin-curated, readable by all authenticated users regardless of is_discoverable). NOT NULL = personal Case Law research owned by exactly one magistrate, private by default. Immutable after creation (enforced by case_law_ownership_guard()) -- a canonical record can never become personal and a personal record can never become canonical or change owners via ordinary UPDATE. Forced to auth.uid() at INSERT time for any non-NULL submission (cannot be forged to another user); creating a NULL (canonical) row requires is_admin(). ON DELETE RESTRICT makes an owning profile impossible to hard-delete while personal Case Law exists.';



COMMENT ON COLUMN "public"."case_law"."is_discoverable" IS 'Owner-controlled sharing flag for PERSONAL research only (owner_id IS NOT NULL). Meaningless/inert on a canonical row (owner_id IS NULL) -- canonical visibility is governed exclusively by review_status/is_admin(), never by this column (see can_view_case_law(), 0058).';



COMMENT ON COLUMN "public"."case_law"."review_status" IS 'Workflow state, distinct from owner_id/is_discoverable. A canonical row (owner_id IS NULL) is publicly visible ONLY when review_status = ''published'' (see the updated SELECT policy/can_view_case_law() below) -- this lets a curator create+review a draft canonical import without it appearing in the ordinary Case Law library before approval. Existing rows default to ''published'' so nothing already visible is hidden by this migration. Personal (owner_id IS NOT NULL) rows are UNAFFECTED by review_status -- their visibility remains exactly the owner/is_discoverable rule it always was.';



COMMENT ON COLUMN "public"."case_law"."content_quality_status" IS 'Same purpose/derivation as statutes.content_quality_status -- see that column comment.';



COMMENT ON COLUMN "public"."case_law"."category_id" IS 'The type of matter this case relates to (legal_case_categories) -- e.g. Murder, Narcotics. Nullable: uncategorized until a curator/owner sets it, never inferred.';



CREATE TABLE IF NOT EXISTS "public"."case_law_annotations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_law_id" "uuid" NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "annotation_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_law_annotations_text_not_blank" CHECK (("btrim"("annotation_text") <> ''::"text"))
);


ALTER TABLE "public"."case_law_annotations" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_law_annotations" IS 'Private personal research notes, one owner per row, attached to one Case Law record (canonical or personal, own or another user''s discoverable). Never canonical content; never modifies the parent. SELECT/INSERT/UPDATE/DELETE all require AnnotationOwnership AND CaseLawReadAccess (owner_id = auth.uid() AND a live, undecorated EXISTS against case_law -- reusing the 0030/0034 nested-RLS pattern unmodified, so annotation access automatically tracks the parent Case Law''s own current RLS with zero code change here). Strictly private, permanently, in 0036 -- no discoverability, no sharing, no admin bypass; even the parent Case Law''s own owner has no special visibility into another magistrate''s annotations on it. Multiple annotations per owner per Case Law record are allowed (no uniqueness). case_law_id is ON DELETE CASCADE (annotations are subordinate personal notes that must never block a lawful Case Law deletion) -- deliberately different from the RESTRICT association-table model used by docket_matter_case_law/quick_code_case_law.';



COMMENT ON COLUMN "public"."case_law_annotations"."case_law_id" IS 'ON DELETE CASCADE -- deliberately different from the docket_matter_case_law/quick_code_case_law RESTRICT model. Annotations are personal subordinate notes, not citations/references; a lawful Case Law deletion (admin deleting canonical, or a magistrate deleting their own personal record) must never be blocked by, or require consulting, anyone''s annotations on it. All annotations on a deleted Case Law record disappear automatically, regardless of which magistrate(s) authored them.';



COMMENT ON COLUMN "public"."case_law_annotations"."owner_id" IS 'Forced to auth.uid() at creation by a guard trigger (cannot be forged) and immutable thereafter -- an annotation can never be transferred to another profile by UPDATE. ON DELETE RESTRICT preserves the established profile-preservation convention -- normal offboarding must not silently destroy a magistrate''s personal research notes.';



COMMENT ON COLUMN "public"."case_law_annotations"."annotation_text" IS 'The private note itself. Must not be blank after trimming (CHECK). Never auto-rewritten/reformatted -- only validated.';



CREATE TABLE IF NOT EXISTS "public"."case_law_tags" (
    "case_law_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_law_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_parties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "role" "public"."party_role" DEFAULT 'other'::"public"."party_role" NOT NULL,
    "attorney_name" "text",
    "contact_info" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_parties" OWNER TO "postgres";


COMMENT ON TABLE "public"."case_parties" IS 'Parties (plaintiffs, defendants, counsel, witnesses, etc.) associated with a case.';



CREATE TABLE IF NOT EXISTS "public"."case_tags" (
    "case_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "court_id" "uuid" NOT NULL,
    "case_number" "text" NOT NULL,
    "title" "text" NOT NULL,
    "case_type" "text",
    "status" "public"."case_status" DEFAULT 'open'::"public"."case_status" NOT NULL,
    "description" "text",
    "filed_date" "date",
    "closed_date" "date",
    "assigned_magistrate_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", ((((((COALESCE("case_number", ''::"text") || ' '::"text") || COALESCE("title", ''::"text")) || ' '::"text") || COALESCE("case_type", ''::"text")) || ' '::"text") || COALESCE("description", ''::"text")))) STORED,
    CONSTRAINT "cases_dates_check" CHECK ((("closed_date" IS NULL) OR ("filed_date" IS NULL) OR ("closed_date" >= "filed_date")))
);


ALTER TABLE "public"."cases" OWNER TO "postgres";


COMMENT ON TABLE "public"."cases" IS 'Court cases tracked within Magistrate Wizard, scoped to a court for RLS.';



COMMENT ON COLUMN "public"."cases"."created_by" IS 'References the profile that filed the case record; ON DELETE RESTRICT preserves accountability for judicial records.';



CREATE TABLE IF NOT EXISTS "public"."comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid",
    "bench_note_id" "uuid",
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "comments_content_check" CHECK (("char_length"("btrim"("content")) > 0)),
    CONSTRAINT "comments_parent_check" CHECK (((("case_id" IS NOT NULL) AND ("bench_note_id" IS NULL)) OR (("case_id" IS NULL) AND ("bench_note_id" IS NOT NULL))))
);


ALTER TABLE "public"."comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."comments" IS 'Threaded discussion attached to exactly one case or one bench note.';



CREATE TABLE IF NOT EXISTS "public"."court_non_sitting_days" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "holiday_date" "date" NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "court_id" "uuid",
    "district_id" "uuid",
    "notes" "text",
    "created_by" "uuid",
    "last_updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "court_non_sitting_days_kind_check" CHECK (("kind" = ANY (ARRAY['public_holiday'::"text", 'court_closure'::"text", 'sitting_exception'::"text"]))),
    CONSTRAINT "court_non_sitting_days_one_scope" CHECK ((("court_id" IS NULL) OR ("district_id" IS NULL)))
);


ALTER TABLE "public"."court_non_sitting_days" OWNER TO "postgres";


COMMENT ON TABLE "public"."court_non_sitting_days" IS 'Days a court does not sit: national, per magisterial district, or per court. Weekends are NOT stored here -- they are a rule in application code and in is_court_sitting_day(). kind = ''sitting_exception'' marks a day the court DOES sit that would otherwise be non-sitting (a special Saturday sitting), and beats every other rule. Advisory only: nothing blocks scheduling on one of these days, because a magistrate may lawfully sit on a holiday.';



COMMENT ON COLUMN "public"."court_non_sitting_days"."district_id" IS 'Applies to every court in this district. The district is passed to is_court_sitting_day() by the caller rather than resolved from public.courts: resolving it inside the function would silently return the wrong answer for anyone who cannot read that court row. Callers take it from the board row (courts.district_id), never docket_matters.district_id.';



CREATE TABLE IF NOT EXISTS "public"."courts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "jurisdiction" "text" NOT NULL,
    "address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "district_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."courts" OWNER TO "postgres";


COMMENT ON TABLE "public"."courts" IS 'Courts/jurisdictions. Cases and profiles are scoped to a court for RLS purposes.';



COMMENT ON COLUMN "public"."courts"."district_id" IS 'The Magisterial District this court belongs to. Nullable: a court may be created before its district is assigned. A Docket Matter may not be created against a court with a null district_id — enforced by a trigger on docket_matters in a later migration, not here.';



COMMENT ON COLUMN "public"."courts"."is_active" IS 'Governs whether this court is normally offered for new magistrate assignments and new Docket entry. Not a historical-access control — do not use this as an RLS gate for existing Docket access; ending an individual magistrate''s access always goes through ending their magistrate_courts assignment, never through this flag.';



CREATE TABLE IF NOT EXISTS "public"."data_retention_policies" (
    "table_name" "text" NOT NULL,
    "retention_days" integer NOT NULL,
    "action" "text" NOT NULL,
    "notes" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "data_retention_policies_action_check" CHECK (("action" = ANY (ARRAY['flag'::"text", 'purge'::"text"]))),
    CONSTRAINT "data_retention_policies_retention_days_check" CHECK (("retention_days" >= 1))
);


ALTER TABLE "public"."data_retention_policies" OWNER TO "postgres";


COMMENT ON TABLE "public"."data_retention_policies" IS 'How long operational rows are kept. purge is allowed only for notifications (see apply_data_retention).';



CREATE TABLE IF NOT EXISTS "public"."docket_callover_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "callover_id" "uuid" NOT NULL,
    "docket_matter_id" "uuid" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "called_at" timestamp with time zone,
    "outcome" "text",
    "next_date" "date",
    "notes" "text",
    "created_by" "uuid",
    "last_updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."docket_callover_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_callover_items" IS 'One matter called at one callover. outcome is free text with a curated client vocabulary; next_date mirrors what set_docket_matter_next_date() scheduled and is never authoritative.';



CREATE TABLE IF NOT EXISTS "public"."docket_callovers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "court_id" "uuid" NOT NULL,
    "callover_date" "date" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "title" "text",
    "notes" "text",
    "created_by" "uuid",
    "last_updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "docket_callovers_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'in_progress'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."docket_callovers" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_callovers" IS 'One callover sitting: a court, a date, and the list of matters called. A record of what happened, not a scheduling mechanism -- next dates are always written through set_docket_matter_next_date().';



CREATE TABLE IF NOT EXISTS "public"."docket_capacity_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "docket_event_id" "uuid",
    "docket_matter_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "magistrate_profile_id" "uuid" NOT NULL,
    "scheduled_date" "date" NOT NULL,
    "configured_capacity" integer NOT NULL,
    "scheduled_count_at_override" integer NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "overridden_by" "uuid"
);


ALTER TABLE "public"."docket_capacity_overrides" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_capacity_overrides" IS 'Append-only record of every deliberate over-capacity Docket Event booking -- who, when, which category/date, what the configured capacity and resulting count were, and an optional free-text reason. Writable ONLY through schedule_docket_event_with_capacity() (SECURITY DEFINER) -- no direct client INSERT/UPDATE/DELETE path exists, giving this table the same practical tamper-resistance as a generic audit trigger without needing one (see migration header). docket_event_id is ON DELETE SET NULL (there is no hard-delete UI path for events today, but history must survive regardless) and docket_matter_id is retained independently as the durable anchor.';



COMMENT ON COLUMN "public"."docket_capacity_overrides"."magistrate_profile_id" IS 'The magistrate whose capacity was exceeded: the hearing''s presiding magistrate.';



COMMENT ON COLUMN "public"."docket_capacity_overrides"."overridden_by" IS 'Who acknowledged the override (0163): the magistrate themselves, or the clerk who listed the hearing for them. Backfilled from magistrate_profile_id for earlier rows, which only magistrates could make.';



CREATE TABLE IF NOT EXISTS "public"."docket_capacity_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "category_id" "uuid" NOT NULL,
    "daily_capacity" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "docket_capacity_settings_positive_check" CHECK (("daily_capacity" > 0))
);


ALTER TABLE "public"."docket_capacity_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_capacity_settings" IS 'Personal, per-magistrate daily capacity configuration -- how many hearings of a given docket_matter_categories type this magistrate can reasonably take in one day. Owner-only RLS, no admin bypass, mirroring quick_codes (0031): capacity settings must never be universal/shared. Absence of a row for a given (owner_id, category_id) means "not configured" (schedule normally, no warning) -- distinct from a configured 0, which means the magistrate has deliberately set the category to always require an override. ON DELETE CASCADE on owner_id (unlike quick_codes'' RESTRICT) is deliberate: this is disposable personal configuration, not content whose loss would be a real loss the way a Quick Code or Judgment would be -- a deleted profile should not be blocked on this table.';



COMMENT ON COLUMN "public"."docket_capacity_settings"."daily_capacity" IS 'Positive whole number only (CHECK). Zero is not permitted here -- a magistrate who wants "always warn" for a category should not configure it, since 0 vs "not configured" must remain distinguishable (0 would still validly mean "always over capacity", which the CHECK deliberately still allows if ever desired by removing this comment''s constraint in a future migration; for now the spec requires positive whole numbers, so 0 is rejected).';



CREATE TABLE IF NOT EXISTS "public"."docket_event_calendar_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "docket_event_id" "uuid" NOT NULL,
    "profile_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "provider" "text" NOT NULL,
    "external_calendar_id" "text" NOT NULL,
    "external_event_id" "text" NOT NULL,
    "etag" "text",
    "synced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "docket_event_calendar_links_provider_check" CHECK (("provider" = 'google'::"text"))
);


ALTER TABLE "public"."docket_event_calendar_links" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_event_calendar_links" IS 'Per-user Google Calendar mapping for a Docket Event. OAuth tokens are device-local, never stored here. Leave unused the docket_events.external_calendar_* placeholder columns.';



COMMENT ON COLUMN "public"."docket_event_calendar_links"."profile_id" IS 'The signed-in magistrate who owns this Google mapping. Forced to auth.uid().';



COMMENT ON COLUMN "public"."docket_event_calendar_links"."external_event_id" IS 'Google Calendar event id on that user''s dedicated Magistrate Wizard calendar.';



CREATE TABLE IF NOT EXISTS "public"."docket_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "docket_matter_id" "uuid" NOT NULL,
    "scheduled_date" "date" NOT NULL,
    "scheduled_time" time without time zone,
    "event_type" "text",
    "stage_at_event" "text",
    "outcome_at_event" "text",
    "orders_made_at_event" "text",
    "notes" "text",
    "presiding_magistrate_id" "uuid" DEFAULT "auth"."uid"(),
    "event_status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "external_calendar_provider" "text",
    "external_calendar_event_id" "text",
    "external_calendar_synced_at" timestamp with time zone,
    "location" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "last_updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category_id" "uuid",
    "witnesses_called" integer,
    "witnesses_completed" integer,
    "witnesses_partly_heard" integer,
    "witnesses_remaining" integer,
    CONSTRAINT "docket_events_event_status_check" CHECK (("event_status" = ANY (ARRAY['scheduled'::"text", 'completed'::"text", 'cancelled'::"text", 'entered_in_error'::"text", 'past'::"text"]))),
    CONSTRAINT "docket_events_external_calendar_pair_check" CHECK (((("external_calendar_provider" IS NULL) AND ("external_calendar_event_id" IS NULL)) OR (("external_calendar_provider" IS NOT NULL) AND ("external_calendar_event_id" IS NOT NULL)))),
    CONSTRAINT "docket_events_witness_counts_non_negative" CHECK (((("witnesses_called" IS NULL) OR ("witnesses_called" >= 0)) AND (("witnesses_completed" IS NULL) OR ("witnesses_completed" >= 0)) AND (("witnesses_partly_heard" IS NULL) OR ("witnesses_partly_heard" >= 0)) AND (("witnesses_remaining" IS NULL) OR ("witnesses_remaining" >= 0))))
);


ALTER TABLE "public"."docket_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_events" IS 'One Court appearance/hearing occurrence per Docket Matter. Court/District are obtained exclusively through the parent docket_matters row and are never duplicated here. Access is fully inherited from the parent Docket Matter via can_access_court()/has_retained_assignment(). Adjournments create a new row; historical appearances are never overwritten or hard-deleted.';



COMMENT ON COLUMN "public"."docket_events"."docket_matter_id" IS 'Immutable after creation — an event can never be moved to another Docket Matter. Enforced by docket_events_guard().';



COMMENT ON COLUMN "public"."docket_events"."event_type" IS 'Deliberately unconstrained free text in this migration — no vocabulary/enum imposed. The Addendum 2 criminal-specific enum was never confirmed in the FINAL specification and is not built.';



COMMENT ON COLUMN "public"."docket_events"."presiding_magistrate_id" IS 'Judicial provenance only, never access control. Set by docket_events_guard() (0163): the lister when a magistrate lists, the sitting magistrate (new_docket_event_presiding_magistrate) when a clerk does, null when no single magistrate can be determined. Never removed or reassigned by a client; an unassigned hearing can be taken by a magistrate with court or retained authority, for themselves. The profile''s own ON DELETE SET NULL is permitted.';



COMMENT ON COLUMN "public"."docket_events"."event_status" IS 'scheduled/completed/cancelled/entered_in_error/past. past means the Guyana sitting date elapsed while still scheduled; it is not a finding that the appearance occurred.';



COMMENT ON COLUMN "public"."docket_events"."category_id" IS 'The matter-category type of this specific hearing occurrence (docket_matter_categories), used to compute daily capacity utilisation. Nullable: an event with no category set never counts toward any capacity. Independent of event_type (free text) -- a Trial-category event and an event_type of "Trial" are not the same field and are not kept in sync automatically.';



COMMENT ON COLUMN "public"."docket_events"."witnesses_called" IS 'Optional hearing-progress field (0077): number of witnesses called at this specific appearance. NULL means not recorded -- never coerced to 0. Independent of event_type/category; relevant mainly at Trial stage but not restricted to it.';



COMMENT ON COLUMN "public"."docket_events"."witnesses_completed" IS 'Optional hearing-progress field (0077): number of witnesses who completed their evidence at this appearance. NULL means not recorded.';



COMMENT ON COLUMN "public"."docket_events"."witnesses_partly_heard" IS 'Optional hearing-progress field (0077): number of witnesses only partly heard at this appearance (evidence started but not finished). NULL means not recorded.';



COMMENT ON COLUMN "public"."docket_events"."witnesses_remaining" IS 'Optional hearing-progress field (0077): number of witnesses still to be heard, as understood at this appearance -- a running total, not a per-appearance delta. NULL means not recorded, distinct from a deliberate 0.';



CREATE TABLE IF NOT EXISTS "public"."docket_matter_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "docket_matter_id" "uuid" NOT NULL,
    "profile_id" "uuid" DEFAULT "auth"."uid"(),
    "reason" "text" DEFAULT 'retained_part_heard'::"text" NOT NULL,
    "granted_by" "uuid" DEFAULT "auth"."uid"(),
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "docket_matter_assignments_ended_after_started" CHECK ((("ended_at" IS NULL) OR ("ended_at" >= "started_at"))),
    CONSTRAINT "docket_matter_assignments_reason_check" CHECK (("reason" = 'retained_part_heard'::"text"))
);


ALTER TABLE "public"."docket_matter_assignments" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_matter_assignments" IS 'Exceptional, matter-specific Docket access: a magistrate preserving access to one specific Docket Matter they are already legitimately handling, typically after their broader Court assignment ends. NOT the ordinary access mechanism (that is magistrate_courts/can_access_court()), and NOT a way to grant access to another person — profile_id and granted_by must always be the creating magistrate themselves at creation time. No admin bypass anywhere on this table. profile_id/granted_by may later become NULL only via profile deletion (ON DELETE SET NULL), preserving the historical record — see the history-protection trigger.';



COMMENT ON COLUMN "public"."docket_matter_assignments"."profile_id" IS 'The magistrate holding the retained access. RLS requires this equal auth.uid() at creation — self-grant only, never on behalf of another magistrate. NULL after creation means only that the referenced profile was later deleted (offboarding); a NULL profile_id can never represent a live grant — see has_retained_assignment().';



COMMENT ON COLUMN "public"."docket_matter_assignments"."reason" IS 'Constrained to retained_part_heard only, for now. Constrained text (not an enum) so future legitimate reasons can be added without a type change — none are invented here.';



COMMENT ON COLUMN "public"."docket_matter_assignments"."granted_by" IS 'Provenance only. Per the authorization model, always equals profile_id in practice (self-grant only) — enforced by RLS at creation, not by this FK.';



COMMENT ON COLUMN "public"."docket_matter_assignments"."ended_at" IS 'NULL = current/active. Sole source of truth for assignment state, matching magistrate_courts. A magistrate may end their own current row (set ended_at) but never reactivate one (clear ended_at) or touch a historical row — see the history-protection trigger below.';



CREATE TABLE IF NOT EXISTS "public"."docket_matter_case_law" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "docket_matter_id" "uuid" NOT NULL,
    "case_law_id" "uuid" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."docket_matter_case_law" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_matter_case_law" IS 'Docket Matter <-> Case Law association only -- never confers access in either direction. SELECT requires independent lawful access to BOTH the Docket Matter and the Case Law record (AND, never OR), preventing the join row itself from becoming a metadata side-channel. INSERT/DELETE require lawful Docket access AND Case Law READ access only (NOT ownership -- deliberate difference from docket_matter_judgments, since Case Law is reusable reference authority). No admin bypass. No descriptive metadata beyond the two foreign keys and creation provenance. Built against the current live/legacy case_law model; the Case-Law-side RLS check is a live existence check against case_law itself so it will automatically respect the future case_law personal/canonical refactor (0035) without requiring this table to change.';



COMMENT ON COLUMN "public"."docket_matter_case_law"."docket_matter_id" IS 'ON DELETE RESTRICT, matching the Court-Anchored Docket judicial-history convention and docket_matter_judgments -- Docket Matters are not intended to be hard-deleted, and this association defensively prevents privileged/database-level deletion of a referenced Docket Matter while a link exists.';



COMMENT ON COLUMN "public"."docket_matter_case_law"."case_law_id" IS 'ON DELETE RESTRICT -- deliberately NOT the CASCADE used for judgment_id in docket_matter_judgments (0029). Case Law is administratively curated canonical/reference material intended to be cited across many Docket Matters, and its DELETE is currently admin-only and expected to be rare/deliberate -- unlike an individually-owned, still-provisionally-deletable Judgment. An admin who wants to delete a Case Law record that is actively cited by one or more Docket Matters must explicitly unlink it first (or take a deliberate privileged action), rather than having citations silently disappear out from under magistrates who rely on them.';



COMMENT ON COLUMN "public"."docket_matter_case_law"."created_by" IS 'Provenance only -- the creator of the association does not "own" the link. created_by never determines ongoing SELECT or DELETE access; both depend solely on independently satisfying the Docket-access and Case-Law-read-access predicates at the time of the request. Forced to auth.uid() at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the established provenance-preservation convention.';



CREATE TABLE IF NOT EXISTS "public"."docket_matter_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."docket_matter_categories" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_matter_categories" IS 'The TYPE OF HEARING a Docket Event represents for daily capacity-planning purposes (e.g. "Trials", "Maintenance", "Liability", "Protection Order / Family Violence") -- a flat, admin-curated classification distinct from legal_case_categories (0073, legal subject-matter for Case Law/Judgment research) and distinct from docket_events.event_type (0024, unconstrained free text with its own UI vocabulary). Data-driven: adding a new category is an INSERT, never a code change -- never hard-code the starting four anywhere that would need a code change to add a fifth.';



CREATE TABLE IF NOT EXISTS "public"."docket_matter_judgments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "docket_matter_id" "uuid" NOT NULL,
    "judgment_id" "uuid" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."docket_matter_judgments" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_matter_judgments" IS 'Docket Matter <-> Judgment association only -- never confers access in either direction. SELECT requires independent lawful access to BOTH the Docket Matter and the Judgment (AND, never OR), preventing the join row itself from becoming a metadata side-channel. INSERT/DELETE require lawful Docket access AND Judgment ownership specifically (is_discoverable alone is never sufficient). No admin bypass. No descriptive metadata beyond the two foreign keys and creation provenance.';



COMMENT ON COLUMN "public"."docket_matter_judgments"."docket_matter_id" IS 'ON DELETE RESTRICT, matching the Court-Anchored Docket judicial-history convention -- Docket Matters are not intended to be hard-deleted, and this association defensively prevents privileged/database-level deletion of a referenced Docket Matter while a link exists.';



COMMENT ON COLUMN "public"."docket_matter_judgments"."judgment_id" IS 'ON DELETE CASCADE, matching judgment_tags -- Judgment owner DELETE remains provisionally permitted under 0027; if a Judgment is lawfully deleted, its purely associative link rows are removed automatically rather than blocking deletion or leaving orphaned associations. Does not alter or resolve the future Judgment lifecycle-locking design.';



COMMENT ON COLUMN "public"."docket_matter_judgments"."created_by" IS 'Provenance only -- the creator of the association does not "own" the link. created_by never determines ongoing SELECT or DELETE access; both depend solely on independently satisfying the Docket-access and Judgment-ownership predicates at the time of the request. Forced to auth.uid() at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the established provenance-preservation convention.';



CREATE TABLE IF NOT EXISTS "public"."docket_matter_parties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "docket_matter_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "party_type" "text" DEFAULT 'individual'::"text" NOT NULL,
    "role" "text" NOT NULL,
    "attorney_name" "text",
    "contact_info" "text",
    "party_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "last_updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "identification_photo_path" "text",
    CONSTRAINT "docket_matter_parties_party_status_check" CHECK (("party_status" = ANY (ARRAY['active'::"text", 'entered_in_error'::"text"]))),
    CONSTRAINT "docket_matter_parties_party_type_check" CHECK (("party_type" = ANY (ARRAY['individual'::"text", 'organization'::"text", 'government_body'::"text", 'estate'::"text", 'other'::"text"]))),
    CONSTRAINT "docket_matter_parties_role_check" CHECK (("role" = ANY (ARRAY['accused'::"text", 'complainant'::"text", 'applicant'::"text", 'respondent'::"text", 'plaintiff'::"text", 'defendant'::"text", 'petitioner'::"text", 'appellant'::"text", 'appellee'::"text", 'landlord'::"text", 'tenant'::"text", 'child'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."docket_matter_parties" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_matter_parties" IS 'Structured party/participant identity for a Docket Matter. Does not replace or generate docket_matters.matter_title. No separate persons/contact registry; no cross-matter identity matching; no uniqueness on (docket_matter_id, full_name[, role]) since names are not reliable unique identifiers and one party may legitimately hold more than one role. Access fully inherited from the parent Docket Matter via can_access_court()/has_retained_assignment(). No hard DELETE — entered_in_error preserves bad/duplicate entries for history.';



COMMENT ON COLUMN "public"."docket_matter_parties"."docket_matter_id" IS 'Immutable after creation — a party row can never be moved to another Docket Matter. Enforced by docket_matter_parties_guard().';



COMMENT ON COLUMN "public"."docket_matter_parties"."party_type" IS 'What the party/entity is (individual/organization/government_body/estate/other) — independent of role, which describes their procedural position.';



COMMENT ON COLUMN "public"."docket_matter_parties"."role" IS 'Procedural role in the proceeding. Deliberately excludes witness (not ordinarily a party) and any prosecution/police/counsel role (deferred, not invented here). No default — must be explicitly supplied.';



COMMENT ON COLUMN "public"."docket_matter_parties"."party_status" IS 'active or entered_in_error. entered_in_error retains a bad/duplicate entry for judicial/data history rather than hard-deleting it. Not tied to the parent matter''s own status/lifecycle.';



COMMENT ON COLUMN "public"."docket_matter_parties"."identification_photo_path" IS 'Storage object name in the documents bucket for this party''s identification photograph. Visible to callers who can already SELECT the parent Docket Matter. contact_info remains dialog-only; this photo is intentionally shown on the party list and may be reused as the matter cover.';



CREATE TABLE IF NOT EXISTS "public"."docket_matter_tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "docket_matter_id" "uuid" NOT NULL,
    "tag_name" "text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "docket_matter_tags_tag_name_not_blank" CHECK (("btrim"("tag_name") <> ''::"text"))
);


ALTER TABLE "public"."docket_matter_tags" OWNER TO "postgres";


COMMENT ON TABLE "public"."docket_matter_tags" IS 'Institutional Docket tags: operational/workflow labels belonging to the Docket Matter itself, visible to every magistrate with lawful (current or retained) access to the parent matter. Deliberately NOT the global tags table (see migration header for rationale). Distinct from a future, separate, user-owned personal-label feature, which is not implemented here.';



COMMENT ON COLUMN "public"."docket_matter_tags"."docket_matter_id" IS 'Effectively immutable: this table has no UPDATE policy at all, so a tag can never be moved between Docket Matters after creation. No court_id/district_id duplication -- both are obtained exclusively through the parent Docket Matter.';



COMMENT ON COLUMN "public"."docket_matter_tags"."tag_name" IS 'Free-form text, no controlled vocabulary/enum. Must not be blank after trimming whitespace (CHECK). Entered/display casing is preserved as typed; the stored value is whitespace-trimmed for storage hygiene. Case-insensitive, whitespace-trimmed uniqueness is enforced per Docket Matter only (see docket_matter_tags_matter_tag_unique_idx) -- the same tag text on a different Docket Matter is explicitly not a duplicate.';



COMMENT ON COLUMN "public"."docket_matter_tags"."created_by" IS 'Provenance only -- who added this institutional tag. Never used for access control. Forced to the authenticated user at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the docket_matters/docket_events/docket_matter_parties provenance convention.';



CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_size" bigint NOT NULL,
    "mime_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "purpose" "text" DEFAULT 'attachment'::"text" NOT NULL,
    "source_document_id" "uuid",
    CONSTRAINT "documents_entity_pair_check" CHECK (((("entity_type" IS NULL) AND ("entity_id" IS NULL)) OR (("entity_type" IS NOT NULL) AND ("entity_id" IS NOT NULL)))),
    CONSTRAINT "documents_entity_type_check" CHECK ((("entity_type" IS NULL) OR ("entity_type" = ANY (ARRAY['docket_matter'::"text", 'judgment'::"text", 'case_law'::"text", 'quick_code'::"text", 'bench_note'::"text", 'case'::"text", 'statute'::"text"])))),
    CONSTRAINT "documents_file_size_check" CHECK (("file_size" >= 0)),
    CONSTRAINT "documents_preview_derivative_pair_check" CHECK (((("purpose" <> 'preview_derivative'::"text") AND ("source_document_id" IS NULL)) OR (("purpose" = 'preview_derivative'::"text") AND ("source_document_id" IS NOT NULL)))),
    CONSTRAINT "documents_purpose_check" CHECK (("purpose" = ANY (ARRAY['attachment'::"text", 'cover'::"text", 'identification_photo'::"text", 'ruling'::"text", 'judgment'::"text", 'preview_derivative'::"text"])))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."documents" IS 'Metadata for files stored in the "documents" Storage bucket; file_path matches storage.objects.name.';



COMMENT ON COLUMN "public"."documents"."uploaded_by" IS 'ON DELETE RESTRICT preserves attachment provenance; deactivate the profile instead of deleting it.';



COMMENT ON COLUMN "public"."documents"."entity_type" IS 'Polymorphic parent discriminator -- docket_matter | judgment | case_law | quick_code | bench_note | case (legacy), or NULL for a standalone document (preserved from the original case_id/bench_note_id-both-null design). Access dispatches to whichever target table entity_type names, via SECURITY-INVOKER nested EXISTS in this table''s own RLS -- if the caller cannot SELECT the parent, they cannot see or attach a document to it, matching §3''s "documents follows the parent entity''s access rules."';



COMMENT ON COLUMN "public"."documents"."entity_id" IS 'Polymorphic parent id. No declarative FK is possible across six target tables; unlike bench_notes (0038/0039), no separate existence-validation trigger is needed here, because the RLS access check and the existence check are the same nested-EXISTS query -- a document referencing a real-but-invisible-to-the-caller parent is correctly rejected as if the parent did not exist, which is the intended behavior for this table (see migration header).';



COMMENT ON COLUMN "public"."documents"."purpose" IS 'attachment (default, generic) | cover | identification_photo | ruling | judgment | preview_derivative. preview_derivative (0083) is a cached, generated preview of another documents row (source_document_id) -- never itself a user-facing "document" (excluded from DocumentsPanel'' visible list, same pattern already used there for cover/identification_photo).';



COMMENT ON COLUMN "public"."documents"."source_document_id" IS 'Set only on a preview-derivative row (purpose=''preview_derivative''): the original documents.id this is a cached, generated preview OF. NULL for every ordinary uploaded document. on delete cascade -- deleting the source document row removes its derivative''s metadata row automatically (the derivative''s own Storage blob is removed client-side first, same as any other document delete -- see use-documents.ts).';



CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
    "key" "text" NOT NULL,
    "description" "text",
    "enabled" boolean DEFAULT false NOT NULL,
    "rollout_percentage" integer DEFAULT 100 NOT NULL,
    "court_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "roles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "feature_flags_rollout_percentage_check" CHECK ((("rollout_percentage" >= 0) AND ("rollout_percentage" <= 100)))
);


ALTER TABLE "public"."feature_flags" OWNER TO "postgres";


COMMENT ON TABLE "public"."feature_flags" IS 'Named feature gates. Empty court_ids and roles mean every court and every role. Percentage rollout is applied in the client.';



CREATE TABLE IF NOT EXISTS "public"."import_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expected_file_count" integer,
    CONSTRAINT "import_batches_content_type_check" CHECK (("content_type" = ANY (ARRAY['case_law'::"text", 'legislation'::"text"])))
);


ALTER TABLE "public"."import_batches" OWNER TO "postgres";


COMMENT ON COLUMN "public"."import_batches"."expected_file_count" IS 'Number of files the curator originally selected for this batch, recorded once at creation (0064). NULL on any batch created before this column existed -- those predate the persistent bare-job-row architecture (0063) and their true original selection size cannot be reconstructed, so the UI must label them as legacy/incomplete history rather than compare against a fabricated number. For every batch created after 0063+0064 together, the product invariant is: expected_file_count = count(import_jobs where batch_id = this batch) once processing completes -- every selected file, including ones rejected by client-side validation before processing began, produces exactly one persisted import_jobs row (see recordBulkRejectedJobs/recordBulkNonDraftJob in use-import-jobs.ts).';



CREATE TABLE IF NOT EXISTS "public"."import_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid",
    "content_type" "text" NOT NULL,
    "source_id" "uuid",
    "source_url" "text",
    "uploaded_document_id" "uuid",
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "target_case_law_id" "uuid",
    "target_statute_id" "uuid",
    "extracted_metadata" "jsonb",
    "extracted_text" "text",
    "proposed_tags" "text"[],
    "duplicate_warning" "text",
    "error_summary" "text",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid" NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "import_jobs_content_type_check" CHECK (("content_type" = ANY (ARRAY['case_law'::"text", 'legislation'::"text"]))),
    CONSTRAINT "import_jobs_single_target" CHECK ((NOT (("target_case_law_id" IS NOT NULL) AND ("target_statute_id" IS NOT NULL)))),
    CONSTRAINT "import_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'fetching'::"text", 'extracting'::"text", 'structuring'::"text", 'needs_review'::"text", 'ready'::"text", 'published'::"text", 'failed'::"text", 'duplicate'::"text"])))
);


ALTER TABLE "public"."import_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_jobs" IS 'One row per document/URL being ingested. error_summary is a short human-readable failure reason shown to the curator -- never a raw stack trace. extracted_text/extracted_metadata/proposed_tags are DERIVED, pre-publication working data; they are copied into the real case_law/statutes(+statute_provisions) row only when a curator approves the job in the Review Queue (Publish action), at which point target_case_law_id/target_statute_id is set.';



COMMENT ON COLUMN "public"."import_jobs"."status" IS 'Job processing status. ''duplicate'' (added 0063) means no new canonical record was created because an identical file (by content hash) or an identical citation (case_law_citation_canonical_unique_idx) already exists -- this is NOT a failure and must be counted/displayed separately from ''failed'' in any batch summary. See extracted_metadata for _duplicateOfId/_originalFilename on a bare (non-draft-creating) job row of this kind.';



CREATE TABLE IF NOT EXISTS "public"."issue_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "page_path" "text",
    "app_version" "text",
    "reporter_role" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "admin_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    CONSTRAINT "issue_reports_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 5000))),
    CONSTRAINT "issue_reports_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'resolved'::"text", 'wont_fix'::"text"]))),
    CONSTRAINT "issue_reports_title_check" CHECK ((("char_length"("title") >= 1) AND ("char_length"("title") <= 200))),
    CONSTRAINT "issue_reports_type_check" CHECK (("type" = ANY (ARRAY['bug'::"text", 'suggestion'::"text"])))
);


ALTER TABLE "public"."issue_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."judgment_ownership_transfers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "judgment_id" "uuid" NOT NULL,
    "from_owner_id" "uuid" NOT NULL,
    "to_owner_id" "uuid" NOT NULL,
    "original_author_id" "uuid" NOT NULL,
    "transferred_by" "uuid" NOT NULL,
    "court_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "judgment_ownership_transfers_other_owner" CHECK (("from_owner_id" <> "to_owner_id")),
    CONSTRAINT "judgment_ownership_transfers_reason_length" CHECK ((("char_length"("btrim"("reason")) >= 1) AND ("char_length"("btrim"("reason")) <= 500)))
);


ALTER TABLE "public"."judgment_ownership_transfers" OWNER TO "postgres";


COMMENT ON TABLE "public"."judgment_ownership_transfers" IS 'Append-only record of judgment ownership transfers (0220, BE-26, ADR 0011). Written only by transfer_judgment_ownership. original_author_id is the judgment''s first owner, carried on every transfer, so authorship survives any number of hand-overs. Ids and the administrator''s reason only, never judgment content. A judgment''s owner may still delete it while it is a draft; its transfer rows go with it, and audit_log keeps the event.';



CREATE TABLE IF NOT EXISTS "public"."judgment_tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "judgment_id" "uuid" NOT NULL,
    "tag_name" "text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "judgment_tags_tag_name_not_blank" CHECK (("btrim"("tag_name") <> ''::"text"))
);


ALTER TABLE "public"."judgment_tags" OWNER TO "postgres";


COMMENT ON TABLE "public"."judgment_tags" IS 'Judgment-specific tags: organizational labels belonging directly to a Judgment. Deliberately NOT the global tags table (see migration header for rationale). SELECT inherits the parent Judgment''s own access model (owner OR is_discoverable); INSERT/DELETE are owner-only, even for a discoverable reader. No Court/Docket access rule applies. No admin bypass.';



COMMENT ON COLUMN "public"."judgment_tags"."judgment_id" IS 'ON DELETE CASCADE (deliberately the opposite of the Docket child-table RESTRICT convention) -- tag rows are purely organizational metadata and are removed automatically if the owner deletes the still-provisionally-deletable parent Judgment. Effectively immutable otherwise: this table has no UPDATE policy at all, so a tag can never be moved between Judgments after creation.';



COMMENT ON COLUMN "public"."judgment_tags"."tag_name" IS 'Free-form text, no controlled vocabulary/enum. Must not be blank after trimming whitespace (CHECK). Entered/display casing is preserved as typed; the stored value is whitespace-trimmed for storage hygiene. Case-insensitive, whitespace-trimmed uniqueness is enforced per Judgment only (see judgment_tags_judgment_tag_unique_idx) -- the same tag text on a different Judgment is explicitly not a duplicate.';



COMMENT ON COLUMN "public"."judgment_tags"."created_by" IS 'Provenance only -- who added this tag. Never used for access control. Forced to the authenticated user at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the judgments.owner_id provenance convention.';



CREATE TABLE IF NOT EXISTS "public"."judgment_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "judgment_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "title" "text" NOT NULL,
    "case_number" "text",
    "citation" "text",
    "court_name" "text",
    "judgment_date" "date",
    "content" "jsonb",
    "content_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."judgment_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."judgment_versions" IS 'Append-only snapshots of a Judgment''s substantive fields, taken immediately before those fields change.';



CREATE TABLE IF NOT EXISTS "public"."judgments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "title" "text" NOT NULL,
    "case_number" "text",
    "court_name" "text",
    "judgment_date" "date",
    "citation" "text",
    "content" "jsonb",
    "content_text" "text",
    "is_discoverable" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "finalized_at" timestamp with time zone,
    "finalized_by" "uuid",
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", ((((((((COALESCE("title", ''::"text") || ' '::"text") || COALESCE("case_number", ''::"text")) || ' '::"text") || COALESCE("court_name", ''::"text")) || ' '::"text") || COALESCE("citation", ''::"text")) || ' '::"text") || COALESCE("content_text", ''::"text")))) STORED,
    "category_id" "uuid",
    CONSTRAINT "judgments_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'final'::"text"]))),
    CONSTRAINT "judgments_title_length" CHECK (("char_length"("title") <= 300))
);


ALTER TABLE "public"."judgments" OWNER TO "postgres";


COMMENT ON TABLE "public"."judgments" IS 'Individually owned Judgment records. Never Court-owned. Private to owner by default; is_discoverable (owner-controlled) grants other magistrates read-only access, never edit. No admin bypass: an administrator can transfer ownership (transfer_judgment_ownership, 0220, ADR 0011) but never read the content. Fully independent from Docket/Court access -- linking to a Docket Matter (docket_matter_judgments) is association only and never confers access.';



COMMENT ON COLUMN "public"."judgments"."owner_id" IS 'The current owner. Forced to auth.uid() at creation by a guard trigger (cannot be forged). Changes only through transfer_judgment_ownership (0220, ADR 0011): an administrator moves it to an active magistrate of a court the owner sat at, and judgment_ownership_transfers keeps the original author. ON DELETE RESTRICT matches the docket_matters.created_by provenance convention.';



COMMENT ON COLUMN "public"."judgments"."case_number" IS 'Optional official case/reference number for display and future search metadata. No global uniqueness imposed.';



COMMENT ON COLUMN "public"."judgments"."court_name" IS 'Optional free text, deliberately NOT an FK to courts. A Judgment is independent authored work product and may concern a historical or external Court not represented in the active Magistrate Wizard Court reference structure.';



COMMENT ON COLUMN "public"."judgments"."citation" IS 'Optional citation/reference identifier. No uniqueness imposed.';



COMMENT ON COLUMN "public"."judgments"."content" IS 'Structured rich-text/editor representation. Editor implementation not designed in this migration.';



COMMENT ON COLUMN "public"."judgments"."content_text" IS 'Plain-text mirror intended for later search/indexing. Not auto-derived from content in this migration -- no approved conversion mechanism exists yet; synchronization is left to a future application/editor implementation.';



COMMENT ON COLUMN "public"."judgments"."is_discoverable" IS 'Owner-controlled. false = only the owner may access this Judgment at all. true = other authenticated magistrates may SELECT/read only -- never edit, never delete, never admin-managed, never public, never automatically attached to a Docket Matter, never canonical authority. A discoverable Judgment remains individually owned.';



COMMENT ON COLUMN "public"."judgments"."status" IS 'Judgment lifecycle state: draft (default) or final. Draft is fully editable by the owner (title/case_number/court_name/judgment_date/citation/content/content_text), including hard DELETE. Final locks those seven substantive fields and blocks hard DELETE, but is_discoverable remains owner-toggleable in both states and the owner may always unlock (final -> draft). Enforced by protect_judgment_lifecycle() (BEFORE INSERT OR UPDATE) and this table''s DELETE policy -- deliberately NOT folded into can_view_judgment()/can_edit_judgment(), which remain pure ownership/mutation-authority checks reused by association, tag, and document policies that must keep working on a final Judgment.';



COMMENT ON COLUMN "public"."judgments"."finalized_at" IS 'Timestamp of the most recent draft -> final transition only -- not a full lifecycle history. Force-set by protect_judgment_lifecycle(); client-supplied values are always overwritten/ignored. Preserved (never nulled) across an unlock (final -> draft). Overwritten on re-finalization. NULL for a Judgment that has never been finalized.';



COMMENT ON COLUMN "public"."judgments"."finalized_by" IS 'Owner profile that performed the most recent draft -> final transition only -- not a full lifecycle history. Force-set to auth.uid() by protect_judgment_lifecycle(); client-supplied values are always overwritten/ignored. Always equal to owner_id today, since finalization is owner-only with no admin/Court/Docket/share bypass and ownership is immutable -- see the FK note above regarding ON DELETE SET NULL currently being unreachable given owner_id''s existing ON DELETE RESTRICT.';



COMMENT ON COLUMN "public"."judgments"."category_id" IS 'The type of matter/offence this judgment concerns (legal_case_categories, shared with case_law.category_id, 0073). Nullable: unset until the magistrate confirms it (auto-suggested from an automatic tag scan of the judgment text/uploaded document, frontend-only, never silently applied over an existing value). NOT locked by protect_judgment_lifecycle() (0045) -- editable even when status = ''final'', like is_discoverable.';



CREATE TABLE IF NOT EXISTS "public"."legal_authority_courts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "canonical_name" "text" NOT NULL,
    "short_name" "text",
    "jurisdiction_id" "uuid",
    "regional_group_id" "uuid",
    "court_level" "text",
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."legal_authority_courts" OWNER TO "postgres";


COMMENT ON TABLE "public"."legal_authority_courts" IS 'Canonical deciding-court catalogue. jurisdiction_id is NULL for a supranational/apex court with no single home jurisdiction (CCJ, Privy Council, Eastern Caribbean Court of Appeal -- the last serves multiple OECS member jurisdictions, so it is NOT tied to one; the specific case''s jurisdiction is recorded separately on case_law.jurisdiction_id). aliases exists specifically to prevent taxonomy pollution -- "CCJ"/"Caribbean Court Justice"/"Caribbean Court of Justice" must resolve to ONE row, not three. Data-driven: adding a new court is an INSERT, never a code change.';



CREATE TABLE IF NOT EXISTS "public"."legal_case_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."legal_case_categories" OWNER TO "postgres";


COMMENT ON TABLE "public"."legal_case_categories" IS 'The TYPE OF MATTER a Case Law record relates to (e.g. "Murder", "Narcotics", "Sexual Offences") -- a single, flat, curator-controlled classification used for Browse/filter navigation. Distinct from `tags` (0006), which is free-text, multi-valued, and shared across several unrelated entity types. Data-driven: adding a new Category is an INSERT, never a code change.';



CREATE TABLE IF NOT EXISTS "public"."legal_jurisdictions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "regional_group_id" "uuid" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."legal_jurisdictions" OWNER TO "postgres";


COMMENT ON TABLE "public"."legal_jurisdictions" IS 'The country/territory a Case Law record is FROM (e.g. "Guyana", "Saint Lucia", "Canada") -- distinct from the DECIDING COURT (legal_authority_courts) and distinct again from the SOURCE REPOSITORY (legal_sources). The same jurisdiction can be served by more than one court, and the same court (e.g. the Eastern Caribbean Court of Appeal) can serve more than one jurisdiction -- do not conflate these three concepts anywhere in the frontend.';



CREATE TABLE IF NOT EXISTS "public"."legal_regional_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."legal_regional_groups" OWNER TO "postgres";


COMMENT ON TABLE "public"."legal_regional_groups" IS 'Coarse grouping used for Case Law browse/filter UI (e.g. "Guyana", "Regional", "Commonwealth Caribbean", "Eastern Caribbean / OECS", "Persuasive Commonwealth"). A jurisdiction belongs to exactly one; a supranational/apex court (CCJ, Privy Council) may also reference one directly when it has no single home jurisdiction.';



CREATE TABLE IF NOT EXISTS "public"."legal_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "jurisdiction" "text" NOT NULL,
    "base_url" "text",
    "source_type" "text" NOT NULL,
    "connector_type" "text" NOT NULL,
    "status" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "canonical_trusted" boolean DEFAULT false NOT NULL,
    "notes" "text",
    "last_checked_at" timestamp with time zone,
    "last_successful_import_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "legal_sources_connector_type_check" CHECK (("connector_type" = ANY (ARRAY['manual'::"text", 'direct_document'::"text", 'html_document'::"text", 'index_page'::"text", 'structured_feed'::"text", 'custom_adapter'::"text"]))),
    CONSTRAINT "legal_sources_source_type_check" CHECK (("source_type" = ANY (ARRAY['case_law'::"text", 'legislation'::"text", 'mixed'::"text"]))),
    CONSTRAINT "legal_sources_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'testing'::"text", 'approved'::"text", 'disabled'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."legal_sources" OWNER TO "postgres";


COMMENT ON TABLE "public"."legal_sources" IS 'Reusable legal-source registry (Guyana/CCJ/Privy Council/Commonwealth, etc). Adding a future source is a new row, never a schema change. New sources start "proposed" and must be moved to "approved" (admin judgment call) before use in an import job -- enforced at the application layer in the curation UI, not by a DB constraint, since "is this source reliable" is not a mechanically checkable property.';



CREATE TABLE IF NOT EXISTS "public"."magisterial_districts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."magisterial_districts" OWNER TO "postgres";


COMMENT ON TABLE "public"."magisterial_districts" IS 'The Magisterial Districts of Guyana (e.g. "East Demerara"). Each Magistrates'' Court belongs to exactly one district via courts.district_id, added in migration 0014. Administrative/reference data — not private judicial content.';



COMMENT ON COLUMN "public"."magisterial_districts"."is_active" IS 'Governs whether this district is normally offered for new court assignments and new Docket entry. Not a historical-access control — existing references remain valid regardless of this flag.';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "link" "text",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['share_granted'::"text", 'share_revoked'::"text", 'judgment_final'::"text", 'court_assigned'::"text", 'court_ended'::"text", 'clerk_request'::"text", 'clerk_request_decided'::"text", 'court_request'::"text", 'court_request_decided'::"text", 'account_type_corrected'::"text", 'hearing_tomorrow'::"text", 'stale_draft'::"text", 'issue_report_decided'::"text", 'docket_matter_binned'::"text", 'docket_matter_purged'::"text", 'maintenance_failed'::"text", 'judgment_transferred'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications" IS 'Per-user in-app notices. Inserts are DEFINER-only; users may mark their own rows read/unread (0123) and dismiss them (0143). Published to supabase_realtime, RLS-filtered per subscriber.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "role" "public"."user_role" DEFAULT 'magistrate'::"public"."user_role" NOT NULL,
    "jurisdiction" "text",
    "court_name" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "court_id" "uuid"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'One row per authenticated user; holds role and court metadata used for authorization throughout Magistrate Wizard.';



CREATE TABLE IF NOT EXISTS "public"."quick_code_case_law" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quick_code_id" "uuid" NOT NULL,
    "case_law_id" "uuid" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quick_code_case_law" OWNER TO "postgres";


COMMENT ON TABLE "public"."quick_code_case_law" IS 'Quick Code <-> Case Law association only -- never confers access in either direction. SELECT requires independent lawful access to BOTH the Quick Code and the Case Law record (QuickCodeOwnership AND CaseLawReadAccess, never OR), preventing the join row itself from becoming a metadata side-channel. INSERT/DELETE require the identical predicate -- deliberately Case Law READ access only, not ownership/authorship, since Case Law is reusable reference authority (mirrors docket_matter_case_law/0030) and the Quick Code is the linking user''s own private metadata (mirrors quick_code_judgments/0033). No admin bypass. No descriptive metadata beyond the two foreign keys and creation provenance. Built against the current live/legacy case_law model; the Case-Law-side RLS check is a live existence check against case_law itself (reusing 0030''s nested-RLS design unmodified) so it will automatically respect the future case_law personal/canonical refactor (0035) without requiring this table to change -- 0035 must regression-test this table alongside docket_matter_case_law.';



COMMENT ON COLUMN "public"."quick_code_case_law"."quick_code_id" IS 'ON DELETE CASCADE -- Quick Code owner hard DELETE is already approved (0031); deleting a Quick Code removes its purely associative Case Law links automatically, independent of current Case Law read access (referential cleanup of the owner''s own authorized deletion, not an RLS unlink operation).';



COMMENT ON COLUMN "public"."quick_code_case_law"."case_law_id" IS 'ON DELETE RESTRICT -- matches docket_matter_case_law''s (0030) Case Law lifecycle design exactly, and is deliberately NOT the CASCADE used for quick_code_id on this same table. Case Law is administratively curated canonical/reference material intended to be cited across many Quick Codes and Docket Matters alike, and its DELETE is currently admin-only and expected to be rare/deliberate. An admin who wants to delete a Case Law record that is actively linked from one or more Quick Codes must explicitly unlink it first (or take a deliberate privileged action), rather than having magistrates'' personal citations silently disappear out from under them.';



COMMENT ON COLUMN "public"."quick_code_case_law"."created_by" IS 'Provenance only -- the creator of the association does not "own" the link. created_by never determines ongoing SELECT or DELETE access; both depend solely on independently satisfying the Quick-Code-ownership and Case-Law-read-access predicates at the time of the request. Forced to auth.uid() at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the established provenance-preservation convention.';



CREATE TABLE IF NOT EXISTS "public"."quick_code_docket_matters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quick_code_id" "uuid" NOT NULL,
    "docket_matter_id" "uuid" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quick_code_docket_matters" OWNER TO "postgres";


COMMENT ON TABLE "public"."quick_code_docket_matters" IS 'Quick Code <-> Docket Matter association only -- never confers access in either direction. SELECT requires independent lawful access to BOTH the Docket Matter and the Quick Code (AND, never OR), preventing the join row itself from becoming a metadata side-channel. INSERT/DELETE require the identical Docket-access-AND-Quick-Code-ownership predicate as SELECT, since Quick Codes have no discoverability tier -- owner_id = auth.uid() is the only Quick-Code access path that exists. No admin bypass. No descriptive metadata beyond the two foreign keys and creation provenance.';



COMMENT ON COLUMN "public"."quick_code_docket_matters"."quick_code_id" IS 'ON DELETE CASCADE -- Quick Code owner hard DELETE is already approved (0031); deleting a Quick Code removes its purely associative Docket links automatically. This is database referential cleanup of the owner''s own authorized deletion, not an RLS unlink operation, so it applies even if the owner has since lost Docket access to a linked matter.';



COMMENT ON COLUMN "public"."quick_code_docket_matters"."docket_matter_id" IS 'ON DELETE RESTRICT, matching the Court-Anchored Docket judicial-history convention and docket_matter_judgments/docket_matter_case_law -- Docket Matters are not intended to be hard-deleted, and this association defensively prevents privileged/database-level deletion of a referenced Docket Matter while a link exists.';



COMMENT ON COLUMN "public"."quick_code_docket_matters"."created_by" IS 'Provenance only -- the creator of the association does not "own" the link. created_by never determines ongoing SELECT or DELETE access; both depend solely on independently satisfying the Docket-access and Quick-Code-ownership predicates at the time of the request. Forced to auth.uid() at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the established provenance-preservation convention.';



CREATE TABLE IF NOT EXISTS "public"."quick_code_judgments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quick_code_id" "uuid" NOT NULL,
    "judgment_id" "uuid" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quick_code_judgments" OWNER TO "postgres";


COMMENT ON TABLE "public"."quick_code_judgments" IS 'Quick Code <-> Judgment association only -- never confers access in either direction. SELECT requires independent lawful access to BOTH the Quick Code and the Judgment (QuickCodeOwnership AND JudgmentReadAccess, never OR), preventing the join row itself from becoming a metadata side-channel. INSERT/DELETE require the identical predicate -- deliberately Judgment READ access only, not ownership (unlike quick_code_docket_matters/docket_matter_judgments), since the Quick Code is the linking user''s own private metadata and the association grants nobody else access. Visibility follows Judgment discoverability dynamically, without the association row ever being touched. No admin bypass. No descriptive metadata beyond the two foreign keys and creation provenance.';



COMMENT ON COLUMN "public"."quick_code_judgments"."quick_code_id" IS 'ON DELETE CASCADE -- Quick Code owner hard DELETE is already approved (0031); deleting a Quick Code removes its purely associative Judgment links automatically, independent of current Judgment read access.';



COMMENT ON COLUMN "public"."quick_code_judgments"."judgment_id" IS 'ON DELETE CASCADE -- Judgment owner DELETE remains provisionally permitted pre-lifecycle-locking (0027); these personal organizational link rows must not block lawful Judgment deletion. A Judgment may be deleted by its owner even while another magistrate has privately linked one of their own Quick Codes to it -- CASCADE removes only the association row, never the Quick Code itself, and the association never created a property/ownership interest in the Judgment. If a future judgment_lifecycle_locking migration restricts Judgment DELETE, that migration controls the parent lifecycle, not this one.';



COMMENT ON COLUMN "public"."quick_code_judgments"."created_by" IS 'Provenance only -- the creator of the association does not "own" the link. created_by never determines ongoing SELECT or DELETE access; both depend solely on independently satisfying the Quick-Code-ownership and Judgment-read-access predicates at the time of the request. Forced to auth.uid() at creation by a guard trigger (cannot be forged). ON DELETE RESTRICT matches the established provenance-preservation convention.';



CREATE TABLE IF NOT EXISTS "public"."quick_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "code_word" "text" NOT NULL,
    "title" "text",
    "content" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", ((((((COALESCE("code_word", ''::"text") || ' '::"text") || COALESCE("title", ''::"text")) || ' '::"text") || COALESCE("content", ''::"text")) || ' '::"text") || COALESCE("description", ''::"text")))) STORED,
    "category" "text",
    CONSTRAINT "quick_codes_code_word_not_blank" CHECK (("btrim"("code_word") <> ''::"text")),
    CONSTRAINT "quick_codes_content_length" CHECK (("char_length"("content") <= 20000)),
    CONSTRAINT "quick_codes_content_not_blank" CHECK (("btrim"("content") <> ''::"text"))
);


ALTER TABLE "public"."quick_codes" OWNER TO "postgres";


COMMENT ON TABLE "public"."quick_codes" IS 'Individually owned Quick Code records -- private, reusable text-expansion/snippets. Personal productivity tooling, never Court/Docket-related, never discoverable, never admin-accessible. SELECT/INSERT/UPDATE/DELETE are all owner-only with no exceptions. code_word uniqueness is case-insensitive/whitespace-trimmed and scoped per owner, never global. Owner hard DELETE is approved (personal productivity data, not judicial history). No quick_code_docket_matters/quick_code_judgments/quick_code_case_law join tables are created here -- a Quick Code must exist independently of all of them, and any future link must never itself grant access to the Quick Code.';



COMMENT ON COLUMN "public"."quick_codes"."owner_id" IS 'Forced to auth.uid() at creation by a guard trigger (cannot be forged) and immutable thereafter -- an owner cannot transfer a Quick Code to another profile by UPDATE, mirroring the judgments.owner_id pattern from 0027. ON DELETE RESTRICT makes a Quick-Code-owning profile impossible to hard-delete. Quick Codes never transfer to a successor magistrate merely because that successor takes over the former owner''s Court -- there is no Court/Docket relationship here at all.';



COMMENT ON COLUMN "public"."quick_codes"."code_word" IS 'Short shorthand/token the owner uses to identify/invoke the snippet (e.g. "bail1"). Must not be blank after trimming (CHECK). Trimmed before storage; entered/display casing preserved. Case-insensitive, whitespace-trimmed uniqueness is enforced PER OWNER only (see quick_codes_owner_code_word_unique_idx) -- the same code word used by a different owner is explicitly not a duplicate. No restrictive character grammar is imposed in this migration.';



COMMENT ON COLUMN "public"."quick_codes"."title" IS 'Optional human-readable name for browsing (e.g. "Standard bail conditions"). Not required -- some owners may identify snippets by code_word alone.';



COMMENT ON COLUMN "public"."quick_codes"."content" IS 'The reusable expanded text itself. Plain text only in this foundational migration -- no JSONB/rich-text/editor schema yet. Must not be blank after trimming (CHECK). Never auto-rewritten/reformatted by the guard trigger -- only validated.';



COMMENT ON COLUMN "public"."quick_codes"."description" IS 'Optional owner-facing explanation of what the Quick Code is for. Distinct from content -- never treated as the expansion text itself.';



COMMENT ON COLUMN "public"."quick_codes"."category" IS 'Optional lightweight grouping label chosen by the owner (e.g. Adjournments, Bail, Sentencing). Free text, not a controlled taxonomy.';



CREATE TABLE IF NOT EXISTS "public"."rpc_rate_limit_buckets" (
    "user_id" "uuid" NOT NULL,
    "rpc_name" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "hit_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."rpc_rate_limit_buckets" OWNER TO "postgres";


COMMENT ON TABLE "public"."rpc_rate_limit_buckets" IS 'Per-user, per-RPC fixed windows for enforce_rpc_rate_limit. No client policies; definer writes only.';



CREATE TABLE IF NOT EXISTS "public"."shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "item_type" "text" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "recipient_id" "uuid",
    "granted_by" "uuid",
    "permission" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "shares_item_type_check" CHECK (("item_type" = ANY (ARRAY['docket_matter'::"text", 'judgment'::"text", 'case_law'::"text"]))),
    CONSTRAINT "shares_no_self_share" CHECK ((("recipient_id" IS NULL) OR ("granted_by" IS NULL) OR ("recipient_id" <> "granted_by"))),
    CONSTRAINT "shares_permission_check" CHECK (("permission" = ANY (ARRAY['view'::"text", 'edit'::"text"]))),
    CONSTRAINT "shares_revoked_after_created" CHECK ((("revoked_at" IS NULL) OR ("revoked_at" >= "created_at")))
);


ALTER TABLE "public"."shares" OWNER TO "postgres";


COMMENT ON TABLE "public"."shares" IS 'Explicit view/edit sharing -- an additional, independent access path to one Docket Matter for a named, registered recipient, extending to the institutional Docket children (docket_events/docket_matter_parties/docket_matter_tags) and the Docket side of three association tables'' SELECT predicates. Exceptional consultation only, never ordinary succession, never a replacement for Court/retained assignment. item_type is constrained to ''docket_matter'' only in this migration (a deliberate, disclosed scope boundary -- see migration header); item_id is a genuine FK to docket_matters. permission is ''view'' (read-only, per each table''s existing SELECT-equivalent access) or ''edit'' (also satisfies each table''s existing mutation rights, subject to that table''s own unchanged lifecycle -- no DELETE where none existed, no UPDATE where none existed). No resharing. No admin bypass anywhere. Soft-revocation only via revoked_at (no DELETE policy). At most one ACTIVE share per (item_type, item_id, recipient_id). SELECT on this table is granter-or-recipient-or-current-Docket-access-holder (see has_docket_matter_authority()) -- widened from an earlier draft after confirming, by direct testing against live PostgreSQL, that a narrower SELECT policy would silently make the revocation UPDATE policy unreachable for anyone but the recipient.';



COMMENT ON COLUMN "public"."shares"."item_type" IS 'docket_matter, judgment, or case_law. Canonical Case Law (owner_id IS NULL) is rejected by shares_item_must_exist().';



COMMENT ON COLUMN "public"."shares"."item_id" IS 'Polymorphic id of the shared row. Existence is enforced by shares_item_must_exist(); there is no single-table FK.';



COMMENT ON COLUMN "public"."shares"."recipient_id" IS 'Registered profile receiving the additional access path. RLS requires a real, non-null, non-self recipient at creation. ON DELETE SET NULL preserves the historical grant record through profile deletion -- see shares_guard() for the auto-revocation-on-null-recipient behavior.';



COMMENT ON COLUMN "public"."shares"."granted_by" IS 'Provenance only. Never a source of special revocation privilege beyond being an ordinary current Docket-access holder. ON DELETE SET NULL preserves history; does NOT auto-revoke the share (see shares_guard()).';



COMMENT ON COLUMN "public"."shares"."permission" IS '''view'' or ''edit''. edit implies view everywhere it is checked (has_docket_share()); view never implies edit. Immutable after creation.';



COMMENT ON COLUMN "public"."shares"."revoked_at" IS 'NULL = active. Set once, never cleared. Mirrors docket_matter_assignments.ended_at exactly.';



CREATE TABLE IF NOT EXISTS "public"."stale_draft_notices" (
    "item_type" "text" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "notified_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stale_draft_notices_item_type_check" CHECK (("item_type" = ANY (ARRAY['judgment'::"text", 'case_law'::"text"])))
);


ALTER TABLE "public"."stale_draft_notices" OWNER TO "postgres";


COMMENT ON TABLE "public"."stale_draft_notices" IS 'When each draft was last flagged stale. Written only by flag_stale_drafts(); never read by clients. Keeps the daily cron from re-notifying more than once per 30 days, independently of whether the user dismissed the notice.';



CREATE TABLE IF NOT EXISTS "public"."statute_provisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "statute_id" "uuid" NOT NULL,
    "parent_provision_id" "uuid",
    "level" "text" NOT NULL,
    "number" "text",
    "heading" "text",
    "body_text" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", ((COALESCE("heading", ''::"text") || ' '::"text") || COALESCE("body_text", ''::"text")))) STORED,
    CONSTRAINT "statute_provisions_level_check" CHECK (("level" = ANY (ARRAY['part'::"text", 'chapter'::"text", 'section'::"text", 'subsection'::"text", 'paragraph'::"text", 'schedule'::"text"])))
);


ALTER TABLE "public"."statute_provisions" OWNER TO "postgres";


COMMENT ON TABLE "public"."statute_provisions" IS 'Numbering/headings are preserved EXACTLY as sourced (e.g. "4", "4(1)", "4(1)(a)") -- never re-derived or flattened. A Part/Chapter node may have heading only and null body_text; a Section/Subsection typically has body_text. sort_order preserves document order among siblings (numbering alone is not always sortable, e.g. "4A").';



CREATE TABLE IF NOT EXISTS "public"."statute_tags" (
    "statute_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."statute_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."statutes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "title" "text" NOT NULL,
    "jurisdiction" "text" NOT NULL,
    "summary" "text",
    "full_text" "text",
    "source_url" "text",
    "effective_date" "date",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", ((((((((COALESCE("code", ''::"text") || ' '::"text") || COALESCE("title", ''::"text")) || ' '::"text") || COALESCE("jurisdiction", ''::"text")) || ' '::"text") || COALESCE("summary", ''::"text")) || ' '::"text") || COALESCE("full_text", ''::"text")))) STORED,
    "short_title" "text",
    "instrument_type" "text",
    "act_number" "text",
    "chapter_number" "text",
    "enactment_year" integer,
    "commencement_note" "text",
    "amendment_note" "text",
    "is_current_version" boolean DEFAULT true NOT NULL,
    "supersedes_statute_id" "uuid",
    "review_status" "text" DEFAULT 'published'::"text" NOT NULL,
    "source_id" "uuid",
    "retrieved_at" timestamp with time zone,
    "document_hash" "text",
    "import_job_id" "uuid",
    "original_filename" "text",
    "jurisdiction_id" "uuid",
    "content_quality_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "primary_document_id" "uuid",
    "page_count" integer,
    "has_text_layer" boolean,
    CONSTRAINT "statutes_content_quality_status_check" CHECK (("content_quality_status" = ANY (ARRAY['good'::"text", 'fair'::"text", 'poor'::"text", 'failed'::"text", 'unknown'::"text"]))),
    CONSTRAINT "statutes_review_status_check" CHECK (("review_status" = ANY (ARRAY['draft'::"text", 'needs_review'::"text", 'ready'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."statutes" OWNER TO "postgres";


COMMENT ON TABLE "public"."statutes" IS 'Canonical statute/law reference library shared across all courts.';



COMMENT ON COLUMN "public"."statutes"."amendment_note" IS 'Free-text summary of amendment history. This is deliberately NOT a full versioning engine -- supersedes_statute_id/is_current_version give room for a superseded-version chain without inventing one now, per the explicit instruction not to overbuild.';



COMMENT ON COLUMN "public"."statutes"."review_status" IS 'Same workflow-state principle as case_law.review_status. statutes has no owner_id/personal concept -- ALL rows are canonical, so this is the ONLY visibility gate for a draft import (see the updated SELECT policy below). Existing row(s) default to ''published'', unaffected.';



COMMENT ON COLUMN "public"."statutes"."content_quality_status" IS 'Deterministic content-quality signal computed client-side (deriveContentQualityStatus, extraction-quality.ts) from the real ExtractionEnvelope at creation/reassessment time. ''failed'' blocks publish -- see publish_legislation_import (0072). Never derived server-side from extracted_metadata jsonb, to avoid coupling this column to a TypeScript-owned shape.';



COMMENT ON COLUMN "public"."statutes"."primary_document_id" IS 'The single canonical viewing PDF for this Act (file-first upload flow, 0098) -- distinct from ad hoc supplementary attachments via DocumentsPanel (entity_type=''statute''). Null means no PDF has been linked yet (legacy record or a failed/incomplete upload) -- the detail page must show a re-upload state, never fabricate content.';



COMMENT ON COLUMN "public"."statutes"."page_count" IS 'Client-computed via pdfjs at upload time (0098). Optional display metadata only -- never authoritative, never blocks anything if null.';



COMMENT ON COLUMN "public"."statutes"."has_text_layer" IS 'Client-computed hint (0098): whether the uploaded PDF had a meaningful text layer at upload time. The viewer independently re-derives this at open time and never trusts this column alone -- it is a UI hint (e.g. a library "not searchable" badge), not a security or correctness boundary.';



CREATE TABLE IF NOT EXISTS "public"."storage_cleanup_queue" (
    "bucket_id" "text" NOT NULL,
    "object_name" "text" NOT NULL,
    "queued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dead_lettered_at" timestamp with time zone
);


ALTER TABLE "public"."storage_cleanup_queue" OWNER TO "postgres";


COMMENT ON TABLE "public"."storage_cleanup_queue" IS 'Storage objects whose documents row was deleted while the file was still stored (0165). Written only by documents_queue_storage_cleanup(); drained by the storage-cleanup Edge Function with the service role, because SQL cannot delete a Storage object. No client role can read or write it.';



COMMENT ON COLUMN "public"."storage_cleanup_queue"."next_attempt_at" IS 'When the storage-cleanup function next takes this row (0167). now() when queued; pushed back after each failed removal.';



COMMENT ON COLUMN "public"."storage_cleanup_queue"."dead_lettered_at" IS 'Set by the storage-cleanup function when the row has failed too many times (0167). A dead-lettered row is kept for an operator and never retried automatically.';



CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#64748b'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tags" OWNER TO "postgres";


COMMENT ON TABLE "public"."tags" IS 'User-defined labels applied to cases, bench notes, statutes, and case law.';



CREATE TABLE IF NOT EXISTS "public"."webhook_endpoints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "url" "text" NOT NULL,
    "secret" "text" NOT NULL,
    "events" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "court_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "webhook_endpoints_url_allowed" CHECK ((("url" ~ '^https://[^/?#@[:space:]]+(/[^[:space:]]*)?$'::"text") OR ("url" ~ '^http://(localhost|127\.0\.0\.1|host\.docker\.internal)(:[0-9]{1,5})?(/[^[:space:]]*)?$'::"text")))
);


ALTER TABLE "public"."webhook_endpoints" OWNER TO "postgres";


COMMENT ON TABLE "public"."webhook_endpoints" IS 'Admin-managed outbound endpoints. HMAC-SHA256 over the JSON body; header X-Magistrate-Wizard-Signature.';



CREATE TABLE IF NOT EXISTS "public"."webhook_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "endpoint_id" "uuid" NOT NULL,
    "event" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delivered_at" timestamp with time zone,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "dead_lettered_at" timestamp with time zone,
    "last_attempt_at" timestamp with time zone,
    "last_status_code" integer,
    CONSTRAINT "webhook_outbox_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sending'::"text", 'sent'::"text", 'delivered'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."webhook_outbox" OWNER TO "postgres";


COMMENT ON COLUMN "public"."webhook_outbox"."status" IS 'pending = queued, due at next_attempt_at. sending = claimed by a webhook-dispatch run (locked_at). delivered = a 2xx was received. failed = dead-lettered after the last attempt, or a URL the delivery rule refuses; retry_webhook_delivery() re-queues it. skipped = the endpoint was inactive when the row fell due. sent = legacy (before 0180): handed to pg_net, HTTP result unknown.';



COMMENT ON COLUMN "public"."webhook_outbox"."next_attempt_at" IS 'When the row is next due (0180). now() when queued; pushed back after each failed attempt.';



COMMENT ON COLUMN "public"."webhook_outbox"."locked_at" IS 'When a webhook-dispatch run claimed the row (0180). A row still sending five minutes later is claimed again.';



COMMENT ON COLUMN "public"."webhook_outbox"."dead_lettered_at" IS 'When the row failed its last attempt (0180). Never retried automatically.';



COMMENT ON COLUMN "public"."webhook_outbox"."last_attempt_at" IS 'When the last delivery attempt finished (0180).';



COMMENT ON COLUMN "public"."webhook_outbox"."last_status_code" IS 'HTTP status of the last attempt (0180); null when no response came back.';



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auth_event_log"
    ADD CONSTRAINT "auth_event_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bench_note_tags"
    ADD CONSTRAINT "bench_note_tags_pkey" PRIMARY KEY ("bench_note_id", "tag_id");



ALTER TABLE ONLY "public"."bench_notes"
    ADD CONSTRAINT "bench_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_user_id_entity_type_entity_id_key" UNIQUE ("user_id", "entity_type", "entity_id");



ALTER TABLE ONLY "public"."case_law_annotations"
    ADD CONSTRAINT "case_law_annotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_law"
    ADD CONSTRAINT "case_law_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."case_law"
    ADD CONSTRAINT "case_law_source_url_scheme_check" CHECK ((("source_url" IS NULL) OR ("source_url" ~* '^https?://'::"text"))) NOT VALID;



ALTER TABLE ONLY "public"."case_law_tags"
    ADD CONSTRAINT "case_law_tags_pkey" PRIMARY KEY ("case_law_id", "tag_id");



ALTER TABLE ONLY "public"."case_parties"
    ADD CONSTRAINT "case_parties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_tags"
    ADD CONSTRAINT "case_tags_pkey" PRIMARY KEY ("case_id", "tag_id");



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clerk_access_requests"
    ADD CONSTRAINT "clerk_access_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clerk_courts"
    ADD CONSTRAINT "clerk_courts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."court_non_sitting_days"
    ADD CONSTRAINT "court_non_sitting_days_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."courts"
    ADD CONSTRAINT "courts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."data_retention_policies"
    ADD CONSTRAINT "data_retention_policies_pkey" PRIMARY KEY ("table_name");



ALTER TABLE ONLY "public"."docket_callover_items"
    ADD CONSTRAINT "docket_callover_items_callover_id_docket_matter_id_key" UNIQUE ("callover_id", "docket_matter_id");



ALTER TABLE ONLY "public"."docket_callover_items"
    ADD CONSTRAINT "docket_callover_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_callovers"
    ADD CONSTRAINT "docket_callovers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_capacity_overrides"
    ADD CONSTRAINT "docket_capacity_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_capacity_settings"
    ADD CONSTRAINT "docket_capacity_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_event_calendar_links"
    ADD CONSTRAINT "docket_event_calendar_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_event_calendar_links"
    ADD CONSTRAINT "docket_event_calendar_links_profile_id_docket_event_id_prov_key" UNIQUE ("profile_id", "docket_event_id", "provider");



ALTER TABLE ONLY "public"."docket_event_calendar_links"
    ADD CONSTRAINT "docket_event_calendar_links_provider_external_event_id_key" UNIQUE ("provider", "external_event_id");



ALTER TABLE ONLY "public"."docket_events"
    ADD CONSTRAINT "docket_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_matter_assignments"
    ADD CONSTRAINT "docket_matter_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_matter_case_law"
    ADD CONSTRAINT "docket_matter_case_law_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_matter_case_law"
    ADD CONSTRAINT "docket_matter_case_law_unique" UNIQUE ("docket_matter_id", "case_law_id");



ALTER TABLE ONLY "public"."docket_matter_categories"
    ADD CONSTRAINT "docket_matter_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."docket_matter_categories"
    ADD CONSTRAINT "docket_matter_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_matter_judgments"
    ADD CONSTRAINT "docket_matter_judgments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_matter_judgments"
    ADD CONSTRAINT "docket_matter_judgments_unique" UNIQUE ("docket_matter_id", "judgment_id");



ALTER TABLE ONLY "public"."docket_matter_parties"
    ADD CONSTRAINT "docket_matter_parties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_matter_tags"
    ADD CONSTRAINT "docket_matter_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docket_matters"
    ADD CONSTRAINT "docket_matters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_file_path_key" UNIQUE ("file_path");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."import_batches"
    ADD CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."issue_reports"
    ADD CONSTRAINT "issue_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."judgment_ownership_transfers"
    ADD CONSTRAINT "judgment_ownership_transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."judgment_tags"
    ADD CONSTRAINT "judgment_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."judgment_versions"
    ADD CONSTRAINT "judgment_versions_judgment_id_version_number_key" UNIQUE ("judgment_id", "version_number");



ALTER TABLE ONLY "public"."judgment_versions"
    ADD CONSTRAINT "judgment_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."judgments"
    ADD CONSTRAINT "judgments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_authority_courts"
    ADD CONSTRAINT "legal_authority_courts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_case_categories"
    ADD CONSTRAINT "legal_case_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."legal_case_categories"
    ADD CONSTRAINT "legal_case_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_jurisdictions"
    ADD CONSTRAINT "legal_jurisdictions_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."legal_jurisdictions"
    ADD CONSTRAINT "legal_jurisdictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_regional_groups"
    ADD CONSTRAINT "legal_regional_groups_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."legal_regional_groups"
    ADD CONSTRAINT "legal_regional_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_sources"
    ADD CONSTRAINT "legal_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."magisterial_districts"
    ADD CONSTRAINT "magisterial_districts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."magistrate_court_requests"
    ADD CONSTRAINT "magistrate_court_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."magistrate_courts"
    ADD CONSTRAINT "magistrate_courts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quick_code_case_law"
    ADD CONSTRAINT "quick_code_case_law_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quick_code_case_law"
    ADD CONSTRAINT "quick_code_case_law_unique" UNIQUE ("quick_code_id", "case_law_id");



ALTER TABLE ONLY "public"."quick_code_docket_matters"
    ADD CONSTRAINT "quick_code_docket_matters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quick_code_docket_matters"
    ADD CONSTRAINT "quick_code_docket_matters_unique" UNIQUE ("quick_code_id", "docket_matter_id");



ALTER TABLE ONLY "public"."quick_code_judgments"
    ADD CONSTRAINT "quick_code_judgments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quick_code_judgments"
    ADD CONSTRAINT "quick_code_judgments_unique" UNIQUE ("quick_code_id", "judgment_id");



ALTER TABLE ONLY "public"."quick_codes"
    ADD CONSTRAINT "quick_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rpc_rate_limit_buckets"
    ADD CONSTRAINT "rpc_rate_limit_buckets_pkey" PRIMARY KEY ("user_id", "rpc_name", "window_start");



ALTER TABLE ONLY "public"."shares"
    ADD CONSTRAINT "shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stale_draft_notices"
    ADD CONSTRAINT "stale_draft_notices_pkey" PRIMARY KEY ("item_type", "item_id");



ALTER TABLE ONLY "public"."statute_provisions"
    ADD CONSTRAINT "statute_provisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."statute_tags"
    ADD CONSTRAINT "statute_tags_pkey" PRIMARY KEY ("statute_id", "tag_id");



ALTER TABLE ONLY "public"."statutes"
    ADD CONSTRAINT "statutes_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."statutes"
    ADD CONSTRAINT "statutes_source_url_scheme_check" CHECK ((("source_url" IS NULL) OR ("source_url" ~* '^https?://'::"text"))) NOT VALID;



ALTER TABLE ONLY "public"."storage_cleanup_queue"
    ADD CONSTRAINT "storage_cleanup_queue_pkey" PRIMARY KEY ("bucket_id", "object_name");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_endpoints"
    ADD CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_outbox"
    ADD CONSTRAINT "webhook_outbox_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_log_actor_id_idx" ON "public"."audit_log" USING "btree" ("actor_id");



CREATE INDEX "audit_log_created_at_idx" ON "public"."audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "audit_log_table_record_idx" ON "public"."audit_log" USING "btree" ("table_name", "record_id");



CREATE INDEX "auth_event_log_actor_id_idx" ON "public"."auth_event_log" USING "btree" ("actor_id");



CREATE INDEX "auth_event_log_created_at_idx" ON "public"."auth_event_log" USING "btree" ("created_at" DESC);



CREATE INDEX "auth_event_log_email_recent_idx" ON "public"."auth_event_log" USING "btree" ("event_type", "email", "created_at" DESC);



CREATE INDEX "bench_note_tags_tag_id_idx" ON "public"."bench_note_tags" USING "btree" ("tag_id");



CREATE INDEX "bench_notes_author_updated_at_idx" ON "public"."bench_notes" USING "btree" ("author_id", "updated_at" DESC, "id" DESC);



CREATE INDEX "bench_notes_entity_idx" ON "public"."bench_notes" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "bench_notes_search_vector_idx" ON "public"."bench_notes" USING "gin" ("search_vector");



CREATE INDEX "bench_notes_status_idx" ON "public"."bench_notes" USING "btree" ("status");



CREATE INDEX "bookmarks_entity_idx" ON "public"."bookmarks" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "bookmarks_user_id_idx" ON "public"."bookmarks" USING "btree" ("user_id");



CREATE INDEX "case_law_annotations_case_law_id_idx" ON "public"."case_law_annotations" USING "btree" ("case_law_id");



CREATE INDEX "case_law_annotations_owner_case_law_idx" ON "public"."case_law_annotations" USING "btree" ("owner_id", "case_law_id");



CREATE INDEX "case_law_case_name_trgm_idx" ON "public"."case_law" USING "gin" ("case_name" "extensions"."gin_trgm_ops");



CREATE INDEX "case_law_category_id_idx" ON "public"."case_law" USING "btree" ("category_id");



CREATE UNIQUE INDEX "case_law_citation_canonical_unique_idx" ON "public"."case_law" USING "btree" ("citation") WHERE (("owner_id" IS NULL) AND ("citation" <> ''::"text"));



COMMENT ON INDEX "public"."case_law_citation_canonical_unique_idx" IS 'Canonical (owner_id IS NULL) case law rows must have a unique citation -- but a blank citation (common for an early-stage draft before a citation has been extracted or entered) is deliberately excluded from this uniqueness check (0065), since many such drafts may legitimately coexist with citation = '''' at once. Publish-time validation (0061) independently requires a non-blank citation before a record can ever be published.';



CREATE INDEX "case_law_citation_trgm_idx" ON "public"."case_law" USING "gin" ("citation" "extensions"."gin_trgm_ops");



CREATE INDEX "case_law_content_quality_status_idx" ON "public"."case_law" USING "btree" ("content_quality_status");



CREATE INDEX "case_law_court_id_idx" ON "public"."case_law" USING "btree" ("court_id");



CREATE INDEX "case_law_created_by_idx" ON "public"."case_law" USING "btree" ("created_by");



CREATE INDEX "case_law_discoverable_decided_date_idx" ON "public"."case_law" USING "btree" ("decided_date" DESC) WHERE (("owner_id" IS NOT NULL) AND ("is_discoverable" = true));



CREATE INDEX "case_law_document_hash_idx" ON "public"."case_law" USING "btree" ("document_hash") WHERE ("document_hash" IS NOT NULL);



CREATE INDEX "case_law_import_job_id_idx" ON "public"."case_law" USING "btree" ("import_job_id");



CREATE INDEX "case_law_jurisdiction_id_idx" ON "public"."case_law" USING "btree" ("jurisdiction_id");



CREATE INDEX "case_law_jurisdiction_idx" ON "public"."case_law" USING "btree" ("jurisdiction");



CREATE INDEX "case_law_owner_id_idx" ON "public"."case_law" USING "btree" ("owner_id");



CREATE INDEX "case_law_published_updated_at_idx" ON "public"."case_law" USING "btree" ("updated_at" DESC, "id" DESC) WHERE ("review_status" = 'published'::"text");



CREATE INDEX "case_law_review_status_idx" ON "public"."case_law" USING "btree" ("review_status");



CREATE INDEX "case_law_search_vector_idx" ON "public"."case_law" USING "gin" ("search_vector");



CREATE INDEX "case_law_source_id_idx" ON "public"."case_law" USING "btree" ("source_id");



CREATE INDEX "case_law_tags_tag_id_idx" ON "public"."case_law_tags" USING "btree" ("tag_id");



CREATE INDEX "case_parties_case_id_idx" ON "public"."case_parties" USING "btree" ("case_id");



CREATE INDEX "case_parties_role_idx" ON "public"."case_parties" USING "btree" ("role");



CREATE INDEX "case_tags_tag_id_idx" ON "public"."case_tags" USING "btree" ("tag_id");



CREATE INDEX "cases_assigned_magistrate_idx" ON "public"."cases" USING "btree" ("assigned_magistrate_id");



CREATE UNIQUE INDEX "cases_court_case_number_idx" ON "public"."cases" USING "btree" ("court_id", "case_number");



CREATE INDEX "cases_court_id_idx" ON "public"."cases" USING "btree" ("court_id");



CREATE INDEX "cases_created_by_idx" ON "public"."cases" USING "btree" ("created_by");



CREATE INDEX "cases_search_vector_idx" ON "public"."cases" USING "gin" ("search_vector");



CREATE INDEX "cases_status_idx" ON "public"."cases" USING "btree" ("status");



CREATE INDEX "clerk_access_requests_court_id_idx" ON "public"."clerk_access_requests" USING "btree" ("court_id");



CREATE INDEX "clerk_access_requests_pending_court_idx" ON "public"."clerk_access_requests" USING "btree" ("court_id") WHERE ("status" = 'pending'::"public"."clerk_access_request_status");



CREATE UNIQUE INDEX "clerk_access_requests_pending_pair_idx" ON "public"."clerk_access_requests" USING "btree" ("profile_id", "court_id") WHERE ("status" = 'pending'::"public"."clerk_access_request_status");



CREATE INDEX "clerk_access_requests_profile_id_idx" ON "public"."clerk_access_requests" USING "btree" ("profile_id");



CREATE INDEX "clerk_access_requests_status_idx" ON "public"."clerk_access_requests" USING "btree" ("status");



CREATE INDEX "clerk_courts_court_id_idx" ON "public"."clerk_courts" USING "btree" ("court_id");



CREATE INDEX "clerk_courts_current_idx" ON "public"."clerk_courts" USING "btree" ("court_id") WHERE ("ended_at" IS NULL);



CREATE UNIQUE INDEX "clerk_courts_current_pair_idx" ON "public"."clerk_courts" USING "btree" ("profile_id", "court_id") WHERE ("ended_at" IS NULL);



CREATE INDEX "clerk_courts_profile_id_idx" ON "public"."clerk_courts" USING "btree" ("profile_id");



CREATE INDEX "comments_author_id_idx" ON "public"."comments" USING "btree" ("author_id");



CREATE INDEX "comments_bench_note_id_idx" ON "public"."comments" USING "btree" ("bench_note_id");



CREATE INDEX "comments_case_id_idx" ON "public"."comments" USING "btree" ("case_id");



CREATE UNIQUE INDEX "court_non_sitting_days_court_idx" ON "public"."court_non_sitting_days" USING "btree" ("holiday_date", "name", "court_id") WHERE ("court_id" IS NOT NULL);



CREATE INDEX "court_non_sitting_days_date_idx" ON "public"."court_non_sitting_days" USING "btree" ("holiday_date");



CREATE UNIQUE INDEX "court_non_sitting_days_district_idx" ON "public"."court_non_sitting_days" USING "btree" ("holiday_date", "name", "district_id") WHERE ("district_id" IS NOT NULL);



CREATE UNIQUE INDEX "court_non_sitting_days_national_idx" ON "public"."court_non_sitting_days" USING "btree" ("holiday_date", "name") WHERE (("court_id" IS NULL) AND ("district_id" IS NULL));



CREATE INDEX "courts_district_id_idx" ON "public"."courts" USING "btree" ("district_id");



CREATE INDEX "courts_is_active_idx" ON "public"."courts" USING "btree" ("is_active");



CREATE UNIQUE INDEX "courts_name_jurisdiction_idx" ON "public"."courts" USING "btree" ("name", "jurisdiction");



CREATE INDEX "docket_callover_items_callover_idx" ON "public"."docket_callover_items" USING "btree" ("callover_id", "sort_order", "created_at");



CREATE INDEX "docket_callover_items_created_by_idx" ON "public"."docket_callover_items" USING "btree" ("created_by");



CREATE INDEX "docket_callover_items_matter_idx" ON "public"."docket_callover_items" USING "btree" ("docket_matter_id");



CREATE INDEX "docket_callovers_court_date_idx" ON "public"."docket_callovers" USING "btree" ("court_id", "callover_date" DESC);



CREATE UNIQUE INDEX "docket_callovers_open_per_court_date_idx" ON "public"."docket_callovers" USING "btree" ("court_id", "callover_date") WHERE ("status" <> 'completed'::"text");



CREATE INDEX "docket_capacity_overrides_magistrate_date_idx" ON "public"."docket_capacity_overrides" USING "btree" ("magistrate_profile_id", "scheduled_date");



CREATE INDEX "docket_capacity_overrides_matter_id_idx" ON "public"."docket_capacity_overrides" USING "btree" ("docket_matter_id");



CREATE INDEX "docket_capacity_overrides_overridden_by_idx" ON "public"."docket_capacity_overrides" USING "btree" ("overridden_by");



CREATE UNIQUE INDEX "docket_capacity_settings_owner_category_unique_idx" ON "public"."docket_capacity_settings" USING "btree" ("owner_id", "category_id");



CREATE INDEX "docket_event_calendar_links_event_idx" ON "public"."docket_event_calendar_links" USING "btree" ("docket_event_id");



CREATE INDEX "docket_event_calendar_links_profile_idx" ON "public"."docket_event_calendar_links" USING "btree" ("profile_id");



CREATE INDEX "docket_events_category_id_idx" ON "public"."docket_events" USING "btree" ("category_id");



CREATE INDEX "docket_events_created_by_idx" ON "public"."docket_events" USING "btree" ("created_by");



CREATE INDEX "docket_events_docket_matter_id_idx" ON "public"."docket_events" USING "btree" ("docket_matter_id");



CREATE UNIQUE INDEX "docket_events_external_calendar_unique_idx" ON "public"."docket_events" USING "btree" ("external_calendar_provider", "external_calendar_event_id") WHERE (("external_calendar_provider" IS NOT NULL) AND ("external_calendar_event_id" IS NOT NULL));



CREATE INDEX "docket_events_last_updated_by_idx" ON "public"."docket_events" USING "btree" ("last_updated_by");



CREATE INDEX "docket_events_presiding_magistrate_id_idx" ON "public"."docket_events" USING "btree" ("presiding_magistrate_id");



CREATE INDEX "docket_events_scheduled_date_category_idx" ON "public"."docket_events" USING "btree" ("scheduled_date", "category_id") WHERE ("event_status" = 'scheduled'::"text");



CREATE INDEX "docket_events_scheduled_idx" ON "public"."docket_events" USING "btree" ("scheduled_date", "scheduled_time" NULLS FIRST, "id");



CREATE INDEX "docket_matter_assignments_current_idx" ON "public"."docket_matter_assignments" USING "btree" ("docket_matter_id") WHERE ("ended_at" IS NULL);



CREATE UNIQUE INDEX "docket_matter_assignments_current_pair_idx" ON "public"."docket_matter_assignments" USING "btree" ("docket_matter_id", "profile_id") WHERE ("ended_at" IS NULL);



CREATE INDEX "docket_matter_assignments_docket_matter_id_idx" ON "public"."docket_matter_assignments" USING "btree" ("docket_matter_id");



CREATE INDEX "docket_matter_assignments_granted_by_idx" ON "public"."docket_matter_assignments" USING "btree" ("granted_by");



CREATE INDEX "docket_matter_assignments_profile_id_idx" ON "public"."docket_matter_assignments" USING "btree" ("profile_id");



CREATE INDEX "docket_matter_case_law_case_law_id_idx" ON "public"."docket_matter_case_law" USING "btree" ("case_law_id");



CREATE INDEX "docket_matter_case_law_created_by_idx" ON "public"."docket_matter_case_law" USING "btree" ("created_by");



CREATE INDEX "docket_matter_judgments_created_by_idx" ON "public"."docket_matter_judgments" USING "btree" ("created_by");



CREATE INDEX "docket_matter_judgments_judgment_id_idx" ON "public"."docket_matter_judgments" USING "btree" ("judgment_id");



CREATE INDEX "docket_matter_parties_attorney_name_trgm_idx" ON "public"."docket_matter_parties" USING "gin" ("attorney_name" "extensions"."gin_trgm_ops");



CREATE INDEX "docket_matter_parties_created_by_idx" ON "public"."docket_matter_parties" USING "btree" ("created_by");



CREATE INDEX "docket_matter_parties_docket_matter_id_idx" ON "public"."docket_matter_parties" USING "btree" ("docket_matter_id");



CREATE INDEX "docket_matter_parties_full_name_trgm_idx" ON "public"."docket_matter_parties" USING "gin" ("full_name" "extensions"."gin_trgm_ops");



CREATE INDEX "docket_matter_parties_last_updated_by_idx" ON "public"."docket_matter_parties" USING "btree" ("last_updated_by");



CREATE INDEX "docket_matter_tags_created_by_idx" ON "public"."docket_matter_tags" USING "btree" ("created_by");



CREATE UNIQUE INDEX "docket_matter_tags_matter_tag_unique_idx" ON "public"."docket_matter_tags" USING "btree" ("docket_matter_id", "lower"("btrim"("tag_name")));



CREATE INDEX "docket_matters_case_number_trgm_idx" ON "public"."docket_matters" USING "gin" ("case_number" "extensions"."gin_trgm_ops");



CREATE INDEX "docket_matters_category_id_idx" ON "public"."docket_matters" USING "btree" ("category_id");



CREATE INDEX "docket_matters_charge_or_issue_trgm_idx" ON "public"."docket_matters" USING "gin" ("charge_or_issue" "extensions"."gin_trgm_ops");



CREATE INDEX "docket_matters_court_id_idx" ON "public"."docket_matters" USING "btree" ("court_id");



CREATE INDEX "docket_matters_created_by_idx" ON "public"."docket_matters" USING "btree" ("created_by");



CREATE INDEX "docket_matters_deleted_at_idx" ON "public"."docket_matters" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE UNIQUE INDEX "docket_matters_district_case_number_unique" ON "public"."docket_matters" USING "btree" ("district_id", "upper"("public"."btrim_whitespace"("case_number")));



COMMENT ON INDEX "public"."docket_matters_district_case_number_unique" IS 'One case number per Magisterial District, ignoring letter case and surrounding whitespace (0166; was a raw-text UNIQUE constraint since 0020). Binned matters still hold their number.';



CREATE INDEX "docket_matters_last_updated_by_idx" ON "public"."docket_matters" USING "btree" ("last_updated_by");



CREATE INDEX "docket_matters_matter_title_trgm_idx" ON "public"."docket_matters" USING "gin" ("matter_title" "extensions"."gin_trgm_ops");



CREATE INDEX "docket_matters_procedure_stage_idx" ON "public"."docket_matters" USING "btree" ("procedure_stage");



CREATE INDEX "docket_matters_search_vector_idx" ON "public"."docket_matters" USING "gin" ("search_vector");



CREATE INDEX "docket_matters_status_idx" ON "public"."docket_matters" USING "btree" ("status");



CREATE INDEX "docket_matters_workflow_protocol_idx" ON "public"."docket_matters" USING "btree" ("workflow_protocol");



CREATE INDEX "documents_entity_idx" ON "public"."documents" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "documents_source_document_id_idx" ON "public"."documents" USING "btree" ("source_document_id") WHERE ("source_document_id" IS NOT NULL);



CREATE UNIQUE INDEX "documents_source_document_id_preview_unique_idx" ON "public"."documents" USING "btree" ("source_document_id") WHERE ("purpose" = 'preview_derivative'::"text");



CREATE INDEX "documents_uploaded_by_idx" ON "public"."documents" USING "btree" ("uploaded_by");



CREATE INDEX "import_batches_created_by_idx" ON "public"."import_batches" USING "btree" ("created_by");



CREATE INDEX "import_jobs_batch_id_idx" ON "public"."import_jobs" USING "btree" ("batch_id");



CREATE INDEX "import_jobs_content_type_idx" ON "public"."import_jobs" USING "btree" ("content_type");



CREATE INDEX "import_jobs_created_at_idx" ON "public"."import_jobs" USING "btree" ("created_at" DESC, "id" DESC);



CREATE INDEX "import_jobs_created_by_idx" ON "public"."import_jobs" USING "btree" ("created_by");



CREATE INDEX "import_jobs_source_id_idx" ON "public"."import_jobs" USING "btree" ("source_id");



CREATE INDEX "import_jobs_status_idx" ON "public"."import_jobs" USING "btree" ("status");



CREATE INDEX "import_jobs_target_case_law_id_idx" ON "public"."import_jobs" USING "btree" ("target_case_law_id");



CREATE INDEX "import_jobs_target_statute_id_idx" ON "public"."import_jobs" USING "btree" ("target_statute_id");



CREATE INDEX "import_jobs_uploaded_document_id_idx" ON "public"."import_jobs" USING "btree" ("uploaded_document_id");



CREATE INDEX "issue_reports_reporter_idx" ON "public"."issue_reports" USING "btree" ("reporter_id");



CREATE INDEX "issue_reports_status_idx" ON "public"."issue_reports" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "judgment_ownership_transfers_court_id_idx" ON "public"."judgment_ownership_transfers" USING "btree" ("court_id");



CREATE INDEX "judgment_ownership_transfers_from_owner_id_idx" ON "public"."judgment_ownership_transfers" USING "btree" ("from_owner_id");



CREATE INDEX "judgment_ownership_transfers_judgment_id_idx" ON "public"."judgment_ownership_transfers" USING "btree" ("judgment_id", "created_at");



CREATE INDEX "judgment_ownership_transfers_original_author_id_idx" ON "public"."judgment_ownership_transfers" USING "btree" ("original_author_id");



CREATE INDEX "judgment_ownership_transfers_to_owner_id_idx" ON "public"."judgment_ownership_transfers" USING "btree" ("to_owner_id");



CREATE INDEX "judgment_ownership_transfers_transferred_by_idx" ON "public"."judgment_ownership_transfers" USING "btree" ("transferred_by");



CREATE INDEX "judgment_tags_created_by_idx" ON "public"."judgment_tags" USING "btree" ("created_by");



CREATE UNIQUE INDEX "judgment_tags_judgment_tag_unique_idx" ON "public"."judgment_tags" USING "btree" ("judgment_id", "lower"("btrim"("tag_name")));



CREATE INDEX "judgment_versions_judgment_id_idx" ON "public"."judgment_versions" USING "btree" ("judgment_id", "version_number" DESC);



CREATE INDEX "judgments_category_id_idx" ON "public"."judgments" USING "btree" ("category_id");



CREATE INDEX "judgments_discoverable_date_idx" ON "public"."judgments" USING "btree" ("judgment_date" DESC) WHERE ("is_discoverable" = true);



CREATE INDEX "judgments_finalized_by_idx" ON "public"."judgments" USING "btree" ("finalized_by");



CREATE INDEX "judgments_judgment_date_idx" ON "public"."judgments" USING "btree" ("judgment_date");



CREATE INDEX "judgments_owner_id_idx" ON "public"."judgments" USING "btree" ("owner_id");



CREATE INDEX "judgments_search_vector_idx" ON "public"."judgments" USING "gin" ("search_vector");



CREATE INDEX "judgments_updated_at_idx" ON "public"."judgments" USING "btree" ("updated_at" DESC, "id" DESC);



CREATE INDEX "legal_authority_courts_aliases_gin_idx" ON "public"."legal_authority_courts" USING "gin" ("aliases");



CREATE UNIQUE INDEX "legal_authority_courts_canonical_name_unique_idx" ON "public"."legal_authority_courts" USING "btree" ("canonical_name");



CREATE INDEX "legal_authority_courts_jurisdiction_idx" ON "public"."legal_authority_courts" USING "btree" ("jurisdiction_id");



CREATE INDEX "legal_authority_courts_regional_group_idx" ON "public"."legal_authority_courts" USING "btree" ("regional_group_id");



CREATE INDEX "legal_jurisdictions_regional_group_idx" ON "public"."legal_jurisdictions" USING "btree" ("regional_group_id");



CREATE INDEX "legal_sources_created_by_idx" ON "public"."legal_sources" USING "btree" ("created_by");



CREATE INDEX "legal_sources_status_idx" ON "public"."legal_sources" USING "btree" ("status");



CREATE INDEX "magisterial_districts_is_active_idx" ON "public"."magisterial_districts" USING "btree" ("is_active");



CREATE UNIQUE INDEX "magisterial_districts_name_idx" ON "public"."magisterial_districts" USING "btree" ("lower"("name"));



CREATE INDEX "magistrate_court_requests_court_id_idx" ON "public"."magistrate_court_requests" USING "btree" ("court_id");



CREATE INDEX "magistrate_court_requests_pending_idx" ON "public"."magistrate_court_requests" USING "btree" ("court_id") WHERE ("status" = 'pending'::"public"."magistrate_court_request_status");



CREATE UNIQUE INDEX "magistrate_court_requests_pending_pair_idx" ON "public"."magistrate_court_requests" USING "btree" ("profile_id", "court_id") WHERE ("status" = 'pending'::"public"."magistrate_court_request_status");



CREATE INDEX "magistrate_court_requests_profile_id_idx" ON "public"."magistrate_court_requests" USING "btree" ("profile_id");



CREATE INDEX "magistrate_court_requests_status_idx" ON "public"."magistrate_court_requests" USING "btree" ("status");



CREATE INDEX "magistrate_courts_active_regular_by_court_idx" ON "public"."magistrate_courts" USING "btree" ("court_id") WHERE (("assignment_type" = 'regular'::"text") AND ("ended_at" IS NULL));



CREATE INDEX "magistrate_courts_court_id_idx" ON "public"."magistrate_courts" USING "btree" ("court_id");



CREATE INDEX "magistrate_courts_current_idx" ON "public"."magistrate_courts" USING "btree" ("court_id") WHERE ("ended_at" IS NULL);



CREATE UNIQUE INDEX "magistrate_courts_current_pair_idx" ON "public"."magistrate_courts" USING "btree" ("profile_id", "court_id") WHERE ("ended_at" IS NULL);



CREATE UNIQUE INDEX "magistrate_courts_occupying_primary_per_court_idx" ON "public"."magistrate_courts" USING "btree" ("court_id") WHERE (("assignment_type" = 'regular'::"text") AND ("ended_at" IS NULL) AND "occupies_primary_slot");



COMMENT ON INDEX "public"."magistrate_courts_occupying_primary_per_court_idx" IS 'At most one occupying (signed-in) primary magistrate per court. Never-logged-in regulars do not take this slot.';



CREATE INDEX "magistrate_courts_profile_id_idx" ON "public"."magistrate_courts" USING "btree" ("profile_id");



CREATE INDEX "notifications_user_created_idx" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "notifications_user_unread_idx" ON "public"."notifications" USING "btree" ("user_id") WHERE ("read_at" IS NULL);



CREATE INDEX "profiles_court_id_idx" ON "public"."profiles" USING "btree" ("court_id");



CREATE INDEX "profiles_jurisdiction_idx" ON "public"."profiles" USING "btree" ("jurisdiction");



CREATE INDEX "profiles_role_idx" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "quick_code_case_law_case_law_id_idx" ON "public"."quick_code_case_law" USING "btree" ("case_law_id");



CREATE INDEX "quick_code_case_law_created_by_idx" ON "public"."quick_code_case_law" USING "btree" ("created_by");



CREATE INDEX "quick_code_docket_matters_created_by_idx" ON "public"."quick_code_docket_matters" USING "btree" ("created_by");



CREATE INDEX "quick_code_docket_matters_docket_matter_id_idx" ON "public"."quick_code_docket_matters" USING "btree" ("docket_matter_id");



CREATE INDEX "quick_code_judgments_created_by_idx" ON "public"."quick_code_judgments" USING "btree" ("created_by");



CREATE INDEX "quick_code_judgments_judgment_id_idx" ON "public"."quick_code_judgments" USING "btree" ("judgment_id");



CREATE UNIQUE INDEX "quick_codes_owner_code_word_unique_idx" ON "public"."quick_codes" USING "btree" ("owner_id", "lower"("btrim"("code_word")));



CREATE INDEX "quick_codes_search_vector_idx" ON "public"."quick_codes" USING "gin" ("search_vector");



CREATE INDEX "rpc_rate_limit_buckets_window_idx" ON "public"."rpc_rate_limit_buckets" USING "btree" ("window_start");



CREATE UNIQUE INDEX "shares_active_unique_idx" ON "public"."shares" USING "btree" ("item_type", "item_id", "recipient_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "shares_granted_by_idx" ON "public"."shares" USING "btree" ("granted_by");



CREATE INDEX "shares_item_idx" ON "public"."shares" USING "btree" ("item_type", "item_id");



CREATE INDEX "shares_recipient_active_idx" ON "public"."shares" USING "btree" ("recipient_id", "item_type", "item_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "shares_recipient_id_idx" ON "public"."shares" USING "btree" ("recipient_id");



CREATE INDEX "statute_provisions_parent_idx" ON "public"."statute_provisions" USING "btree" ("parent_provision_id");



CREATE INDEX "statute_provisions_search_vector_idx" ON "public"."statute_provisions" USING "gin" ("search_vector");



CREATE INDEX "statute_provisions_statute_id_idx" ON "public"."statute_provisions" USING "btree" ("statute_id", "sort_order");



CREATE INDEX "statute_tags_tag_id_idx" ON "public"."statute_tags" USING "btree" ("tag_id");



CREATE UNIQUE INDEX "statutes_code_jurisdiction_current_idx" ON "public"."statutes" USING "btree" ("code", "jurisdiction") WHERE ("is_current_version" = true);



COMMENT ON INDEX "public"."statutes_code_jurisdiction_current_idx" IS 'Replaces the old blanket unique(code, jurisdiction) (0005). A version-chain replacement (supersedes_statute_id, 0055/0098) legitimately shares code+jurisdiction with the row it supersedes; only one CURRENT version per code+jurisdiction may exist at a time.';



CREATE INDEX "statutes_content_quality_status_idx" ON "public"."statutes" USING "btree" ("content_quality_status");



CREATE INDEX "statutes_created_by_idx" ON "public"."statutes" USING "btree" ("created_by");



CREATE INDEX "statutes_document_hash_idx" ON "public"."statutes" USING "btree" ("document_hash") WHERE ("document_hash" IS NOT NULL);



CREATE INDEX "statutes_import_job_id_idx" ON "public"."statutes" USING "btree" ("import_job_id");



CREATE INDEX "statutes_jurisdiction_id_idx" ON "public"."statutes" USING "btree" ("jurisdiction_id");



CREATE INDEX "statutes_jurisdiction_idx" ON "public"."statutes" USING "btree" ("jurisdiction");



CREATE INDEX "statutes_published_current_title_idx" ON "public"."statutes" USING "btree" ("title", "id") WHERE (("review_status" = 'published'::"text") AND ("is_current_version" = true));



CREATE INDEX "statutes_review_status_idx" ON "public"."statutes" USING "btree" ("review_status");



CREATE INDEX "statutes_search_vector_idx" ON "public"."statutes" USING "gin" ("search_vector");



CREATE INDEX "statutes_source_id_idx" ON "public"."statutes" USING "btree" ("source_id");



CREATE INDEX "statutes_supersedes_statute_id_idx" ON "public"."statutes" USING "btree" ("supersedes_statute_id");



CREATE INDEX "storage_cleanup_queue_due_idx" ON "public"."storage_cleanup_queue" USING "btree" ("next_attempt_at") WHERE ("dead_lettered_at" IS NULL);



CREATE INDEX "tags_created_by_idx" ON "public"."tags" USING "btree" ("created_by");



CREATE UNIQUE INDEX "tags_name_idx" ON "public"."tags" USING "btree" ("lower"("name"));



CREATE INDEX "webhook_outbox_due_idx" ON "public"."webhook_outbox" USING "btree" ("next_attempt_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "webhook_outbox_endpoint_id_idx" ON "public"."webhook_outbox" USING "btree" ("endpoint_id");



CREATE INDEX "webhook_outbox_sending_idx" ON "public"."webhook_outbox" USING "btree" ("locked_at") WHERE ("status" = 'sending'::"text");



CREATE OR REPLACE TRIGGER "a_sync_magistrate_court_occupies_primary_slot_trigger" BEFORE INSERT OR UPDATE ON "public"."magistrate_courts" FOR EACH ROW EXECUTE FUNCTION "public"."sync_magistrate_court_occupies_primary_slot"();



CREATE OR REPLACE TRIGGER "audit_bench_notes" AFTER INSERT OR DELETE OR UPDATE ON "public"."bench_notes" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_case_law" AFTER INSERT OR DELETE OR UPDATE ON "public"."case_law" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_case_law_annotations" AFTER INSERT OR DELETE OR UPDATE ON "public"."case_law_annotations" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_cases" AFTER INSERT OR DELETE OR UPDATE ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_clerk_access_requests" AFTER INSERT OR DELETE OR UPDATE ON "public"."clerk_access_requests" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_clerk_courts" AFTER INSERT OR DELETE OR UPDATE ON "public"."clerk_courts" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_court_non_sitting_days" AFTER INSERT OR DELETE OR UPDATE ON "public"."court_non_sitting_days" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_docket_callover_items" AFTER INSERT OR DELETE OR UPDATE ON "public"."docket_callover_items" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_docket_callovers" AFTER INSERT OR DELETE OR UPDATE ON "public"."docket_callovers" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_docket_capacity_settings" AFTER INSERT OR DELETE OR UPDATE ON "public"."docket_capacity_settings" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_docket_events" AFTER INSERT OR DELETE OR UPDATE ON "public"."docket_events" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_docket_matter_assignments" AFTER INSERT OR DELETE OR UPDATE ON "public"."docket_matter_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_docket_matter_parties" AFTER INSERT OR DELETE OR UPDATE ON "public"."docket_matter_parties" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_docket_matters" AFTER INSERT OR DELETE OR UPDATE ON "public"."docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_documents" AFTER INSERT OR DELETE OR UPDATE ON "public"."documents" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_judgments" AFTER INSERT OR DELETE OR UPDATE ON "public"."judgments" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_log_assign_hash_trigger" AFTER INSERT ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_assign_hash"();



CREATE OR REPLACE TRIGGER "audit_log_immutable_trigger" BEFORE DELETE OR UPDATE ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_immutable"();



CREATE OR REPLACE TRIGGER "audit_magistrate_court_requests" AFTER INSERT OR DELETE OR UPDATE ON "public"."magistrate_court_requests" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_magistrate_courts" AFTER INSERT OR DELETE OR UPDATE ON "public"."magistrate_courts" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_profiles" AFTER INSERT OR DELETE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_profiles_privilege" AFTER UPDATE ON "public"."profiles" FOR EACH ROW WHEN ((("old"."role" IS DISTINCT FROM "new"."role") OR ("old"."is_active" IS DISTINCT FROM "new"."is_active") OR ("old"."email" IS DISTINCT FROM "new"."email") OR ("old"."court_id" IS DISTINCT FROM "new"."court_id"))) EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_quick_codes" AFTER INSERT OR DELETE OR UPDATE ON "public"."quick_codes" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_shares" AFTER INSERT OR DELETE OR UPDATE ON "public"."shares" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "audit_statutes" AFTER INSERT OR DELETE OR UPDATE ON "public"."statutes" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_fn"();



CREATE OR REPLACE TRIGGER "bench_notes_entity_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."bench_notes" FOR EACH ROW EXECUTE FUNCTION "public"."bench_notes_entity_guard"();



CREATE OR REPLACE TRIGGER "callover_item_provenance_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."docket_callover_items" FOR EACH ROW EXECUTE FUNCTION "public"."callover_provenance_guard"();



CREATE OR REPLACE TRIGGER "callover_provenance_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."docket_callovers" FOR EACH ROW EXECUTE FUNCTION "public"."callover_provenance_guard"();



CREATE OR REPLACE TRIGGER "capture_judgment_version_trigger" BEFORE UPDATE ON "public"."judgments" FOR EACH ROW EXECUTE FUNCTION "public"."capture_judgment_version"();



CREATE OR REPLACE TRIGGER "case_law_annotations_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."case_law_annotations" FOR EACH ROW EXECUTE FUNCTION "public"."case_law_annotations_guard"();



CREATE OR REPLACE TRIGGER "case_law_ownership_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."case_law" FOR EACH ROW EXECUTE FUNCTION "public"."case_law_ownership_guard"();



CREATE OR REPLACE TRIGGER "case_law_title_guard_trigger" BEFORE INSERT OR UPDATE OF "case_name" ON "public"."case_law" FOR EACH ROW EXECUTE FUNCTION "public"."case_law_title_guard"();



CREATE OR REPLACE TRIGGER "check_court_active_before_assignment" BEFORE INSERT OR UPDATE OF "court_id", "ended_at" ON "public"."magistrate_courts" FOR EACH ROW EXECUTE FUNCTION "public"."check_court_active_for_assignment"();



CREATE OR REPLACE TRIGGER "check_primary_magistrate_exclusivity_trigger" BEFORE INSERT OR UPDATE OF "court_id", "assignment_type", "ended_at", "profile_id" ON "public"."magistrate_courts" FOR EACH ROW EXECUTE FUNCTION "public"."check_primary_magistrate_exclusivity"();



CREATE OR REPLACE TRIGGER "claim_primary_slot_on_first_sign_in_trigger" AFTER INSERT ON "public"."auth_event_log" FOR EACH ROW EXECUTE FUNCTION "public"."claim_primary_slot_on_first_sign_in"();



CREATE OR REPLACE TRIGGER "clerk_access_requests_notify_trigger" AFTER INSERT OR UPDATE ON "public"."clerk_access_requests" FOR EACH ROW EXECUTE FUNCTION "public"."clerk_access_requests_notify"();



CREATE OR REPLACE TRIGGER "docket_callover_items_record_guard_trigger" BEFORE INSERT OR DELETE OR UPDATE ON "public"."docket_callover_items" FOR EACH ROW EXECUTE FUNCTION "public"."docket_callover_items_record_guard"();



CREATE OR REPLACE TRIGGER "docket_callovers_record_guard_trigger" BEFORE DELETE OR UPDATE ON "public"."docket_callovers" FOR EACH ROW EXECUTE FUNCTION "public"."docket_callovers_record_guard"();



CREATE OR REPLACE TRIGGER "docket_capacity_settings_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."docket_capacity_settings" FOR EACH ROW EXECUTE FUNCTION "public"."docket_capacity_settings_guard"();



CREATE OR REPLACE TRIGGER "docket_event_calendar_links_guard" BEFORE INSERT OR UPDATE ON "public"."docket_event_calendar_links" FOR EACH ROW EXECUTE FUNCTION "public"."docket_event_calendar_links_guard"();



CREATE OR REPLACE TRIGGER "docket_events_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."docket_events" FOR EACH ROW EXECUTE FUNCTION "public"."docket_events_guard"();



CREATE OR REPLACE TRIGGER "docket_matter_assignments_unlink_orphaned_judgment_pins" AFTER UPDATE OF "ended_at" ON "public"."docket_matter_assignments" FOR EACH ROW WHEN ((("old"."ended_at" IS NULL) AND ("new"."ended_at" IS NOT NULL))) EXECUTE FUNCTION "public"."unlink_judgment_pins_on_retained_end"();



CREATE OR REPLACE TRIGGER "docket_matter_case_law_guard_trigger" BEFORE INSERT ON "public"."docket_matter_case_law" FOR EACH ROW EXECUTE FUNCTION "public"."docket_matter_case_law_guard"();



CREATE OR REPLACE TRIGGER "docket_matter_judgments_guard_trigger" BEFORE INSERT ON "public"."docket_matter_judgments" FOR EACH ROW EXECUTE FUNCTION "public"."docket_matter_judgments_guard"();



CREATE OR REPLACE TRIGGER "docket_matter_parties_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."docket_matter_parties" FOR EACH ROW EXECUTE FUNCTION "public"."docket_matter_parties_guard"();



CREATE OR REPLACE TRIGGER "docket_matter_tags_guard_trigger" BEFORE INSERT ON "public"."docket_matter_tags" FOR EACH ROW EXECUTE FUNCTION "public"."docket_matter_tags_guard"();



CREATE OR REPLACE TRIGGER "docket_matters_category_guard_trigger" BEFORE INSERT OR UPDATE OF "category_id", "category_other" ON "public"."docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."docket_matters_category_guard"();



CREATE OR REPLACE TRIGGER "docket_matters_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."docket_matters_guard"();



CREATE OR REPLACE TRIGGER "docket_matters_outcome_sync_trigger" BEFORE INSERT OR UPDATE ON "public"."docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."docket_matters_outcome_sync"();



CREATE OR REPLACE TRIGGER "docket_matters_trim_text_trigger" BEFORE INSERT OR UPDATE OF "case_number", "matter_title", "charge_or_issue" ON "public"."docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."docket_matters_trim_text"();



CREATE OR REPLACE TRIGGER "docket_matters_workflow_protocol_trigger" BEFORE INSERT OR UPDATE ON "public"."docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."docket_matters_set_workflow_protocol"();



CREATE OR REPLACE TRIGGER "documents_cascade_delete" AFTER DELETE ON "public"."bench_notes" FOR EACH ROW EXECUTE FUNCTION "public"."documents_parent_cascade_delete"();



CREATE OR REPLACE TRIGGER "documents_cascade_delete" AFTER DELETE ON "public"."case_law" FOR EACH ROW EXECUTE FUNCTION "public"."documents_parent_cascade_delete"();



CREATE OR REPLACE TRIGGER "documents_cascade_delete" AFTER DELETE ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."documents_parent_cascade_delete"();



CREATE OR REPLACE TRIGGER "documents_cascade_delete" AFTER DELETE ON "public"."docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."documents_parent_cascade_delete"();



CREATE OR REPLACE TRIGGER "documents_cascade_delete" AFTER DELETE ON "public"."judgments" FOR EACH ROW EXECUTE FUNCTION "public"."documents_parent_cascade_delete"();



CREATE OR REPLACE TRIGGER "documents_cascade_delete" AFTER DELETE ON "public"."quick_codes" FOR EACH ROW EXECUTE FUNCTION "public"."documents_parent_cascade_delete"();



CREATE OR REPLACE TRIGGER "documents_cascade_delete_statutes" AFTER DELETE ON "public"."statutes" FOR EACH ROW EXECUTE FUNCTION "public"."documents_parent_cascade_delete"();



CREATE OR REPLACE TRIGGER "documents_queue_storage_cleanup_trigger" AFTER DELETE ON "public"."documents" FOR EACH ROW EXECUTE FUNCTION "public"."documents_queue_storage_cleanup"();



CREATE OR REPLACE TRIGGER "feature_flags_admin_mfa_guard" BEFORE INSERT OR UPDATE ON "public"."feature_flags" FOR EACH ROW EXECUTE FUNCTION "public"."feature_flags_admin_mfa_guard"();



CREATE OR REPLACE TRIGGER "issue_reports_notify_status_trigger" AFTER UPDATE OF "status" ON "public"."issue_reports" FOR EACH ROW EXECUTE FUNCTION "public"."issue_reports_notify_status"();



CREATE OR REPLACE TRIGGER "judgment_tags_guard_trigger" BEFORE INSERT ON "public"."judgment_tags" FOR EACH ROW EXECUTE FUNCTION "public"."judgment_tags_guard"();



CREATE OR REPLACE TRIGGER "judgments_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."judgments" FOR EACH ROW EXECUTE FUNCTION "public"."judgments_guard"();



CREATE OR REPLACE TRIGGER "judgments_lifecycle_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."judgments" FOR EACH ROW EXECUTE FUNCTION "public"."protect_judgment_lifecycle"();



CREATE OR REPLACE TRIGGER "judgments_notify_final_trigger" AFTER UPDATE ON "public"."judgments" FOR EACH ROW EXECUTE FUNCTION "public"."judgments_notify_final"();



CREATE OR REPLACE TRIGGER "magistrate_court_requests_notify_trigger" AFTER INSERT OR UPDATE ON "public"."magistrate_court_requests" FOR EACH ROW EXECUTE FUNCTION "public"."magistrate_court_requests_notify"();



CREATE OR REPLACE TRIGGER "magistrate_courts_notify_trigger" AFTER INSERT ON "public"."magistrate_courts" FOR EACH ROW EXECUTE FUNCTION "public"."magistrate_courts_notify"();



CREATE OR REPLACE TRIGGER "magistrate_courts_unlink_orphaned_judgment_pins" AFTER UPDATE OF "ended_at" ON "public"."magistrate_courts" FOR EACH ROW WHEN ((("old"."ended_at" IS NULL) AND ("new"."ended_at" IS NOT NULL))) EXECUTE FUNCTION "public"."unlink_judgment_pins_on_court_end"();



CREATE OR REPLACE TRIGGER "notifications_enqueue_webhook_trigger" AFTER INSERT ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."notifications_enqueue_webhook"();



CREATE OR REPLACE TRIGGER "notifications_protect_trigger" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."notifications_protect"();



CREATE OR REPLACE TRIGGER "profiles_identity_columns_guard" BEFORE UPDATE OF "role", "court_id", "email" ON "public"."profiles" FOR EACH ROW WHEN ((("old"."role" IS DISTINCT FROM "new"."role") OR ("old"."court_id" IS DISTINCT FROM "new"."court_id") OR ("old"."email" IS DISTINCT FROM "new"."email"))) EXECUTE FUNCTION "public"."profiles_identity_columns_guard"();



CREATE OR REPLACE TRIGGER "profiles_is_active_guard" BEFORE UPDATE OF "is_active" ON "public"."profiles" FOR EACH ROW WHEN (("old"."is_active" IS DISTINCT FROM "new"."is_active")) EXECUTE FUNCTION "public"."profiles_is_active_guard"();



CREATE OR REPLACE TRIGGER "protect_clerk_court_history_trigger" BEFORE UPDATE ON "public"."clerk_courts" FOR EACH ROW EXECUTE FUNCTION "public"."protect_clerk_court_history"();



CREATE OR REPLACE TRIGGER "protect_court_district_once_referenced_trigger" BEFORE UPDATE OF "district_id" ON "public"."courts" FOR EACH ROW EXECUTE FUNCTION "public"."protect_court_district_once_referenced"();



CREATE OR REPLACE TRIGGER "protect_docket_matter_assignment_history_trigger" BEFORE UPDATE ON "public"."docket_matter_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."protect_docket_matter_assignment_history"();



CREATE OR REPLACE TRIGGER "protect_magistrate_court_history_trigger" BEFORE UPDATE ON "public"."magistrate_courts" FOR EACH ROW EXECUTE FUNCTION "public"."protect_magistrate_court_history"();



CREATE OR REPLACE TRIGGER "quick_code_case_law_guard_trigger" BEFORE INSERT ON "public"."quick_code_case_law" FOR EACH ROW EXECUTE FUNCTION "public"."quick_code_case_law_guard"();



CREATE OR REPLACE TRIGGER "quick_code_docket_matters_guard_trigger" BEFORE INSERT ON "public"."quick_code_docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."quick_code_docket_matters_guard"();



CREATE OR REPLACE TRIGGER "quick_code_judgments_guard_trigger" BEFORE INSERT ON "public"."quick_code_judgments" FOR EACH ROW EXECUTE FUNCTION "public"."quick_code_judgments_guard"();



CREATE OR REPLACE TRIGGER "quick_codes_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."quick_codes" FOR EACH ROW EXECUTE FUNCTION "public"."quick_codes_guard"();



CREATE OR REPLACE TRIGGER "release_retained_assignments_on_matter_close_trigger" AFTER UPDATE OF "status" ON "public"."docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."release_retained_assignments_on_matter_close"();



CREATE OR REPLACE TRIGGER "set_bench_notes_updated_at" BEFORE UPDATE ON "public"."bench_notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_case_law_annotations_updated_at" BEFORE UPDATE ON "public"."case_law_annotations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_case_law_updated_at" BEFORE UPDATE ON "public"."case_law" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_cases_updated_at" BEFORE UPDATE ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_clerk_access_requests_updated_at" BEFORE UPDATE ON "public"."clerk_access_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_clerk_courts_updated_at" BEFORE UPDATE ON "public"."clerk_courts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_comments_updated_at" BEFORE UPDATE ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_court_non_sitting_days_updated_at" BEFORE UPDATE ON "public"."court_non_sitting_days" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_courts_updated_at" BEFORE UPDATE ON "public"."courts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_data_retention_policies_updated_at" BEFORE UPDATE ON "public"."data_retention_policies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_docket_callover_items_updated_at" BEFORE UPDATE ON "public"."docket_callover_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_docket_callovers_updated_at" BEFORE UPDATE ON "public"."docket_callovers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_docket_capacity_settings_updated_at" BEFORE UPDATE ON "public"."docket_capacity_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_docket_events_updated_at" BEFORE UPDATE ON "public"."docket_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_docket_matter_assignments_updated_at" BEFORE UPDATE ON "public"."docket_matter_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_docket_matter_parties_updated_at" BEFORE UPDATE ON "public"."docket_matter_parties" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_docket_matters_updated_at" BEFORE UPDATE ON "public"."docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_feature_flags_updated_at" BEFORE UPDATE ON "public"."feature_flags" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_import_jobs_updated_at" BEFORE UPDATE ON "public"."import_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_judgments_updated_at" BEFORE UPDATE ON "public"."judgments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_legal_authority_courts_updated_at" BEFORE UPDATE ON "public"."legal_authority_courts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_legal_jurisdictions_updated_at" BEFORE UPDATE ON "public"."legal_jurisdictions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_legal_sources_updated_at" BEFORE UPDATE ON "public"."legal_sources" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_magisterial_districts_updated_at" BEFORE UPDATE ON "public"."magisterial_districts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_magistrate_court_requests_updated_at" BEFORE UPDATE ON "public"."magistrate_court_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_magistrate_courts_updated_at" BEFORE UPDATE ON "public"."magistrate_courts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_quick_codes_updated_at" BEFORE UPDATE ON "public"."quick_codes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_statute_provisions_updated_at" BEFORE UPDATE ON "public"."statute_provisions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_statutes_updated_at" BEFORE UPDATE ON "public"."statutes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_webhook_endpoints_updated_at" BEFORE UPDATE ON "public"."webhook_endpoints" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "shares_delete_for_case_law_trigger" BEFORE DELETE ON "public"."case_law" FOR EACH ROW EXECUTE FUNCTION "public"."shares_delete_for_parent"('case_law');



CREATE OR REPLACE TRIGGER "shares_delete_for_judgment_trigger" BEFORE DELETE ON "public"."judgments" FOR EACH ROW EXECUTE FUNCTION "public"."shares_delete_for_parent"('judgment');



CREATE OR REPLACE TRIGGER "shares_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."shares" FOR EACH ROW EXECUTE FUNCTION "public"."shares_guard"();



CREATE OR REPLACE TRIGGER "shares_item_must_exist_trigger" BEFORE INSERT ON "public"."shares" FOR EACH ROW EXECUTE FUNCTION "public"."shares_item_must_exist"();



CREATE OR REPLACE TRIGGER "shares_notify_trigger" AFTER INSERT OR UPDATE ON "public"."shares" FOR EACH ROW EXECUTE FUNCTION "public"."shares_notify"();



CREATE OR REPLACE TRIGGER "shares_prevent_docket_parent_delete_trigger" BEFORE DELETE ON "public"."docket_matters" FOR EACH ROW EXECUTE FUNCTION "public"."shares_prevent_docket_parent_delete"();



CREATE OR REPLACE TRIGGER "shares_recipient_guard_trigger" BEFORE INSERT ON "public"."shares" FOR EACH ROW EXECUTE FUNCTION "public"."shares_recipient_guard"();



CREATE OR REPLACE TRIGGER "statutes_created_by_guard" BEFORE INSERT OR UPDATE ON "public"."statutes" FOR EACH ROW EXECUTE FUNCTION "public"."statutes_created_by_guard"();



CREATE OR REPLACE TRIGGER "validate_bookmark_entity_trigger" BEFORE INSERT OR UPDATE ON "public"."bookmarks" FOR EACH ROW EXECUTE FUNCTION "public"."validate_bookmark_entity"();



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."auth_event_log"
    ADD CONSTRAINT "auth_event_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bench_note_tags"
    ADD CONSTRAINT "bench_note_tags_bench_note_id_fkey" FOREIGN KEY ("bench_note_id") REFERENCES "public"."bench_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bench_note_tags"
    ADD CONSTRAINT "bench_note_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bench_notes"
    ADD CONSTRAINT "bench_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_law_annotations"
    ADD CONSTRAINT "case_law_annotations_case_law_id_fkey" FOREIGN KEY ("case_law_id") REFERENCES "public"."case_law"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_law_annotations"
    ADD CONSTRAINT "case_law_annotations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_law"
    ADD CONSTRAINT "case_law_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."legal_case_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_law"
    ADD CONSTRAINT "case_law_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."legal_authority_courts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_law"
    ADD CONSTRAINT "case_law_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_law"
    ADD CONSTRAINT "case_law_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_law"
    ADD CONSTRAINT "case_law_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."legal_jurisdictions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_law"
    ADD CONSTRAINT "case_law_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_law"
    ADD CONSTRAINT "case_law_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."legal_sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_law_tags"
    ADD CONSTRAINT "case_law_tags_case_law_id_fkey" FOREIGN KEY ("case_law_id") REFERENCES "public"."case_law"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_law_tags"
    ADD CONSTRAINT "case_law_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_parties"
    ADD CONSTRAINT "case_parties_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_tags"
    ADD CONSTRAINT "case_tags_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_tags"
    ADD CONSTRAINT "case_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_assigned_magistrate_id_fkey" FOREIGN KEY ("assigned_magistrate_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."clerk_access_requests"
    ADD CONSTRAINT "clerk_access_requests_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."clerk_access_requests"
    ADD CONSTRAINT "clerk_access_requests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clerk_access_requests"
    ADD CONSTRAINT "clerk_access_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clerk_courts"
    ADD CONSTRAINT "clerk_courts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."clerk_courts"
    ADD CONSTRAINT "clerk_courts_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."clerk_courts"
    ADD CONSTRAINT "clerk_courts_ended_by_fkey" FOREIGN KEY ("ended_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clerk_courts"
    ADD CONSTRAINT "clerk_courts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_bench_note_id_fkey" FOREIGN KEY ("bench_note_id") REFERENCES "public"."bench_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."court_non_sitting_days"
    ADD CONSTRAINT "court_non_sitting_days_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."court_non_sitting_days"
    ADD CONSTRAINT "court_non_sitting_days_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."court_non_sitting_days"
    ADD CONSTRAINT "court_non_sitting_days_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "public"."magisterial_districts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."court_non_sitting_days"
    ADD CONSTRAINT "court_non_sitting_days_last_updated_by_fkey" FOREIGN KEY ("last_updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."courts"
    ADD CONSTRAINT "courts_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "public"."magisterial_districts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."data_retention_policies"
    ADD CONSTRAINT "data_retention_policies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_callover_items"
    ADD CONSTRAINT "docket_callover_items_callover_id_fkey" FOREIGN KEY ("callover_id") REFERENCES "public"."docket_callovers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."docket_callover_items"
    ADD CONSTRAINT "docket_callover_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_callover_items"
    ADD CONSTRAINT "docket_callover_items_docket_matter_id_fkey" FOREIGN KEY ("docket_matter_id") REFERENCES "public"."docket_matters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_callover_items"
    ADD CONSTRAINT "docket_callover_items_last_updated_by_fkey" FOREIGN KEY ("last_updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_callovers"
    ADD CONSTRAINT "docket_callovers_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_callovers"
    ADD CONSTRAINT "docket_callovers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_callovers"
    ADD CONSTRAINT "docket_callovers_last_updated_by_fkey" FOREIGN KEY ("last_updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_capacity_overrides"
    ADD CONSTRAINT "docket_capacity_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."docket_matter_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_capacity_overrides"
    ADD CONSTRAINT "docket_capacity_overrides_docket_event_id_fkey" FOREIGN KEY ("docket_event_id") REFERENCES "public"."docket_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_capacity_overrides"
    ADD CONSTRAINT "docket_capacity_overrides_docket_matter_id_fkey" FOREIGN KEY ("docket_matter_id") REFERENCES "public"."docket_matters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."docket_capacity_overrides"
    ADD CONSTRAINT "docket_capacity_overrides_magistrate_profile_id_fkey" FOREIGN KEY ("magistrate_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."docket_capacity_overrides"
    ADD CONSTRAINT "docket_capacity_overrides_overridden_by_fkey" FOREIGN KEY ("overridden_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_capacity_settings"
    ADD CONSTRAINT "docket_capacity_settings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."docket_matter_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."docket_capacity_settings"
    ADD CONSTRAINT "docket_capacity_settings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."docket_event_calendar_links"
    ADD CONSTRAINT "docket_event_calendar_links_docket_event_id_fkey" FOREIGN KEY ("docket_event_id") REFERENCES "public"."docket_events"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_event_calendar_links"
    ADD CONSTRAINT "docket_event_calendar_links_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."docket_events"
    ADD CONSTRAINT "docket_events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."docket_matter_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_events"
    ADD CONSTRAINT "docket_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_events"
    ADD CONSTRAINT "docket_events_docket_matter_id_fkey" FOREIGN KEY ("docket_matter_id") REFERENCES "public"."docket_matters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_events"
    ADD CONSTRAINT "docket_events_last_updated_by_fkey" FOREIGN KEY ("last_updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_events"
    ADD CONSTRAINT "docket_events_presiding_magistrate_id_fkey" FOREIGN KEY ("presiding_magistrate_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_matter_assignments"
    ADD CONSTRAINT "docket_matter_assignments_docket_matter_id_fkey" FOREIGN KEY ("docket_matter_id") REFERENCES "public"."docket_matters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matter_assignments"
    ADD CONSTRAINT "docket_matter_assignments_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_matter_assignments"
    ADD CONSTRAINT "docket_matter_assignments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_matter_case_law"
    ADD CONSTRAINT "docket_matter_case_law_case_law_id_fkey" FOREIGN KEY ("case_law_id") REFERENCES "public"."case_law"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matter_case_law"
    ADD CONSTRAINT "docket_matter_case_law_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matter_case_law"
    ADD CONSTRAINT "docket_matter_case_law_docket_matter_id_fkey" FOREIGN KEY ("docket_matter_id") REFERENCES "public"."docket_matters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matter_judgments"
    ADD CONSTRAINT "docket_matter_judgments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matter_judgments"
    ADD CONSTRAINT "docket_matter_judgments_docket_matter_id_fkey" FOREIGN KEY ("docket_matter_id") REFERENCES "public"."docket_matters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matter_judgments"
    ADD CONSTRAINT "docket_matter_judgments_judgment_id_fkey" FOREIGN KEY ("judgment_id") REFERENCES "public"."judgments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."docket_matter_parties"
    ADD CONSTRAINT "docket_matter_parties_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matter_parties"
    ADD CONSTRAINT "docket_matter_parties_docket_matter_id_fkey" FOREIGN KEY ("docket_matter_id") REFERENCES "public"."docket_matters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matter_parties"
    ADD CONSTRAINT "docket_matter_parties_last_updated_by_fkey" FOREIGN KEY ("last_updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_matter_tags"
    ADD CONSTRAINT "docket_matter_tags_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matter_tags"
    ADD CONSTRAINT "docket_matter_tags_docket_matter_id_fkey" FOREIGN KEY ("docket_matter_id") REFERENCES "public"."docket_matters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matters"
    ADD CONSTRAINT "docket_matters_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."docket_matter_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_matters"
    ADD CONSTRAINT "docket_matters_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matters"
    ADD CONSTRAINT "docket_matters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matters"
    ADD CONSTRAINT "docket_matters_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."docket_matters"
    ADD CONSTRAINT "docket_matters_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "public"."magisterial_districts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."docket_matters"
    ADD CONSTRAINT "docket_matters_last_updated_by_fkey" FOREIGN KEY ("last_updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_batches"
    ADD CONSTRAINT "import_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."legal_sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_target_case_law_id_fkey" FOREIGN KEY ("target_case_law_id") REFERENCES "public"."case_law"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_target_statute_id_fkey" FOREIGN KEY ("target_statute_id") REFERENCES "public"."statutes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_uploaded_document_id_fkey" FOREIGN KEY ("uploaded_document_id") REFERENCES "public"."documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."issue_reports"
    ADD CONSTRAINT "issue_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."issue_reports"
    ADD CONSTRAINT "issue_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."judgment_ownership_transfers"
    ADD CONSTRAINT "judgment_ownership_transfers_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."judgment_ownership_transfers"
    ADD CONSTRAINT "judgment_ownership_transfers_from_owner_id_fkey" FOREIGN KEY ("from_owner_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."judgment_ownership_transfers"
    ADD CONSTRAINT "judgment_ownership_transfers_judgment_id_fkey" FOREIGN KEY ("judgment_id") REFERENCES "public"."judgments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."judgment_ownership_transfers"
    ADD CONSTRAINT "judgment_ownership_transfers_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."judgment_ownership_transfers"
    ADD CONSTRAINT "judgment_ownership_transfers_to_owner_id_fkey" FOREIGN KEY ("to_owner_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."judgment_ownership_transfers"
    ADD CONSTRAINT "judgment_ownership_transfers_transferred_by_fkey" FOREIGN KEY ("transferred_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."judgment_tags"
    ADD CONSTRAINT "judgment_tags_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."judgment_tags"
    ADD CONSTRAINT "judgment_tags_judgment_id_fkey" FOREIGN KEY ("judgment_id") REFERENCES "public"."judgments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."judgment_versions"
    ADD CONSTRAINT "judgment_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."judgment_versions"
    ADD CONSTRAINT "judgment_versions_judgment_id_fkey" FOREIGN KEY ("judgment_id") REFERENCES "public"."judgments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."judgments"
    ADD CONSTRAINT "judgments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."legal_case_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."judgments"
    ADD CONSTRAINT "judgments_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."judgments"
    ADD CONSTRAINT "judgments_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."legal_authority_courts"
    ADD CONSTRAINT "legal_authority_courts_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."legal_jurisdictions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."legal_authority_courts"
    ADD CONSTRAINT "legal_authority_courts_regional_group_id_fkey" FOREIGN KEY ("regional_group_id") REFERENCES "public"."legal_regional_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."legal_jurisdictions"
    ADD CONSTRAINT "legal_jurisdictions_regional_group_id_fkey" FOREIGN KEY ("regional_group_id") REFERENCES "public"."legal_regional_groups"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."legal_sources"
    ADD CONSTRAINT "legal_sources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."magistrate_court_requests"
    ADD CONSTRAINT "magistrate_court_requests_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."magistrate_court_requests"
    ADD CONSTRAINT "magistrate_court_requests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."magistrate_court_requests"
    ADD CONSTRAINT "magistrate_court_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."magistrate_courts"
    ADD CONSTRAINT "magistrate_courts_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."magistrate_courts"
    ADD CONSTRAINT "magistrate_courts_ended_by_fkey" FOREIGN KEY ("ended_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."magistrate_courts"
    ADD CONSTRAINT "magistrate_courts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quick_code_case_law"
    ADD CONSTRAINT "quick_code_case_law_case_law_id_fkey" FOREIGN KEY ("case_law_id") REFERENCES "public"."case_law"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."quick_code_case_law"
    ADD CONSTRAINT "quick_code_case_law_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."quick_code_case_law"
    ADD CONSTRAINT "quick_code_case_law_quick_code_id_fkey" FOREIGN KEY ("quick_code_id") REFERENCES "public"."quick_codes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quick_code_docket_matters"
    ADD CONSTRAINT "quick_code_docket_matters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."quick_code_docket_matters"
    ADD CONSTRAINT "quick_code_docket_matters_docket_matter_id_fkey" FOREIGN KEY ("docket_matter_id") REFERENCES "public"."docket_matters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."quick_code_docket_matters"
    ADD CONSTRAINT "quick_code_docket_matters_quick_code_id_fkey" FOREIGN KEY ("quick_code_id") REFERENCES "public"."quick_codes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quick_code_judgments"
    ADD CONSTRAINT "quick_code_judgments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."quick_code_judgments"
    ADD CONSTRAINT "quick_code_judgments_judgment_id_fkey" FOREIGN KEY ("judgment_id") REFERENCES "public"."judgments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quick_code_judgments"
    ADD CONSTRAINT "quick_code_judgments_quick_code_id_fkey" FOREIGN KEY ("quick_code_id") REFERENCES "public"."quick_codes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quick_codes"
    ADD CONSTRAINT "quick_codes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shares"
    ADD CONSTRAINT "shares_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shares"
    ADD CONSTRAINT "shares_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."statute_provisions"
    ADD CONSTRAINT "statute_provisions_parent_provision_id_fkey" FOREIGN KEY ("parent_provision_id") REFERENCES "public"."statute_provisions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."statute_provisions"
    ADD CONSTRAINT "statute_provisions_statute_id_fkey" FOREIGN KEY ("statute_id") REFERENCES "public"."statutes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."statute_tags"
    ADD CONSTRAINT "statute_tags_statute_id_fkey" FOREIGN KEY ("statute_id") REFERENCES "public"."statutes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."statute_tags"
    ADD CONSTRAINT "statute_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."statutes"
    ADD CONSTRAINT "statutes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."statutes"
    ADD CONSTRAINT "statutes_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."statutes"
    ADD CONSTRAINT "statutes_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."legal_jurisdictions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."statutes"
    ADD CONSTRAINT "statutes_primary_document_id_fkey" FOREIGN KEY ("primary_document_id") REFERENCES "public"."documents"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."statutes"
    ADD CONSTRAINT "statutes_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."legal_sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."statutes"
    ADD CONSTRAINT "statutes_supersedes_statute_id_fkey" FOREIGN KEY ("supersedes_statute_id") REFERENCES "public"."statutes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."webhook_endpoints"
    ADD CONSTRAINT "webhook_endpoints_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."webhook_endpoints"
    ADD CONSTRAINT "webhook_endpoints_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."webhook_outbox"
    ADD CONSTRAINT "webhook_outbox_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE CASCADE;



CREATE POLICY "Admins and magistrates can insert statutes" ON "public"."statutes" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR (( SELECT "public"."is_magistrate"() AS "is_magistrate") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("review_status" = 'draft'::"text") AND ("supersedes_statute_id" IS NULL))));



CREATE POLICY "Admins can correct clerk access requests" ON "public"."clerk_access_requests" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can correct magistrate court requests" ON "public"."magistrate_court_requests" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can create Court assignments" ON "public"."magistrate_courts" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can create clerk court assignments" ON "public"."clerk_courts" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can create import batches" ON "public"."import_batches" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can create import jobs" ON "public"."import_jobs" FOR INSERT WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Admins can create legal sources" ON "public"."legal_sources" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can create provisions" ON "public"."statute_provisions" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can create tags" ON "public"."tags" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Admins can delete cases" ON "public"."cases" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can delete courts" ON "public"."courts" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can delete feature flags" ON "public"."feature_flags" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can delete import batches" ON "public"."import_batches" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can delete import jobs" ON "public"."import_jobs" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can delete issue reports" ON "public"."issue_reports" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "Admins can delete legal sources" ON "public"."legal_sources" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can delete magisterial districts" ON "public"."magisterial_districts" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can delete provisions" ON "public"."statute_provisions" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can delete statutes" ON "public"."statutes" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can delete tags" ON "public"."tags" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can delete webhook endpoints" ON "public"."webhook_endpoints" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can insert courts" ON "public"."courts" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can insert feature flags" ON "public"."feature_flags" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can insert magisterial districts" ON "public"."magisterial_districts" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can insert retention policies" ON "public"."data_retention_policies" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can insert webhook endpoints" ON "public"."webhook_endpoints" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage Court assignments" ON "public"."magistrate_courts" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can read retention policies" ON "public"."data_retention_policies" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can select webhook endpoints" ON "public"."webhook_endpoints" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can select webhook outbox" ON "public"."webhook_outbox" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can tag canonical case law" ON "public"."case_law_tags" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") AND (EXISTS ( SELECT 1
   FROM "public"."case_law" "cl"
  WHERE (("cl"."id" = "case_law_tags"."case_law_id") AND ("cl"."owner_id" IS NULL))))));



CREATE POLICY "Admins can tag statutes" ON "public"."statute_tags" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can untag canonical case law" ON "public"."case_law_tags" FOR DELETE TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") AND (EXISTS ( SELECT 1
   FROM "public"."case_law" "cl"
  WHERE (("cl"."id" = "case_law_tags"."case_law_id") AND ("cl"."owner_id" IS NULL))))));



CREATE POLICY "Admins can untag statutes" ON "public"."statute_tags" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can update courts" ON "public"."courts" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can update feature flags" ON "public"."feature_flags" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update import jobs" ON "public"."import_jobs" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can update issue reports" ON "public"."issue_reports" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update legal sources" ON "public"."legal_sources" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can update magisterial districts" ON "public"."magisterial_districts" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can update provisions" ON "public"."statute_provisions" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can update retention policies" ON "public"."data_retention_policies" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update statutes" ON "public"."statutes" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can update tags" ON "public"."tags" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can update webhook endpoints" ON "public"."webhook_endpoints" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can view all issue reports" ON "public"."issue_reports" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can view auth events" ON "public"."auth_event_log" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can view import batches" ON "public"."import_batches" FOR SELECT USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can view import jobs" ON "public"."import_jobs" FOR SELECT USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can view legal sources" ON "public"."legal_sources" FOR SELECT USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can view the audit log" ON "public"."audit_log" FOR SELECT USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins create canonical Case Law; magistrates create personal C" ON "public"."case_law" FOR INSERT WITH CHECK (((("owner_id" IS NULL) AND ( SELECT "public"."is_admin"() AS "is_admin")) OR (("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (NOT ( SELECT "public"."is_clerk"() AS "is_clerk")))));



CREATE POLICY "Admins delete authority courts" ON "public"."legal_authority_courts" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins delete canonical Case Law; owners delete their personal " ON "public"."case_law" FOR DELETE TO "authenticated" USING (((NOT ( SELECT "public"."is_clerk"() AS "is_clerk")) AND ((("owner_id" IS NULL) AND ( SELECT "public"."is_admin"() AS "is_admin")) OR ("owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Admins delete case categories" ON "public"."legal_case_categories" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins delete court non-sitting days" ON "public"."court_non_sitting_days" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins delete docket matter categories" ON "public"."docket_matter_categories" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins delete jurisdictions" ON "public"."legal_jurisdictions" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins delete regional groups" ON "public"."legal_regional_groups" FOR DELETE USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins manage authority courts" ON "public"."legal_authority_courts" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins manage case categories" ON "public"."legal_case_categories" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins manage court non-sitting days" ON "public"."court_non_sitting_days" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins manage docket matter categories" ON "public"."docket_matter_categories" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins manage jurisdictions" ON "public"."legal_jurisdictions" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins manage regional groups" ON "public"."legal_regional_groups" FOR INSERT WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins update authority courts" ON "public"."legal_authority_courts" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins update canonical Case Law; owners update their personal " ON "public"."case_law" FOR UPDATE USING (((NOT ( SELECT "public"."is_clerk"() AS "is_clerk")) AND ((NOT ( SELECT "public"."is_magistrate"() AS "is_magistrate")) OR ( SELECT "public"."has_active_magistrate_court"() AS "has_active_magistrate_court")) AND ((("owner_id" IS NULL) AND ( SELECT "public"."is_admin"() AS "is_admin")) OR ("owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_item_share"('case_law'::"text", "id", 'edit'::"text")))) WITH CHECK (((NOT ( SELECT "public"."is_clerk"() AS "is_clerk")) AND ((NOT ( SELECT "public"."is_magistrate"() AS "is_magistrate")) OR ( SELECT "public"."has_active_magistrate_court"() AS "has_active_magistrate_court")) AND ((("owner_id" IS NULL) AND ( SELECT "public"."is_admin"() AS "is_admin")) OR ("owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_item_share"('case_law'::"text", "id", 'edit'::"text"))));



CREATE POLICY "Admins update case categories" ON "public"."legal_case_categories" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins update court non-sitting days" ON "public"."court_non_sitting_days" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins update docket matter categories" ON "public"."docket_matter_categories" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins update jurisdictions" ON "public"."legal_jurisdictions" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins update regional groups" ON "public"."legal_regional_groups" FOR UPDATE USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Authenticated users can read feature flags" ON "public"."feature_flags" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authority courts are viewable by all authenticated users" ON "public"."legal_authority_courts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authorized magistrates and admins can end clerk court assignmen" ON "public"."clerk_courts" FOR UPDATE USING ((( SELECT "public"."can_manage_clerk_access"("clerk_courts"."court_id") AS "can_manage_clerk_access") OR ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK ((( SELECT "public"."can_manage_clerk_access"("clerk_courts"."court_id") AS "can_manage_clerk_access") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Authors and admins can delete comments" ON "public"."comments" FOR DELETE USING ((( SELECT "public"."is_admin"() AS "is_admin") OR ("author_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Authors and admins can update comments" ON "public"."comments" FOR UPDATE USING ((( SELECT "public"."is_admin"() AS "is_admin") OR ("author_id" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR ("author_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Authors can create their own bench notes" ON "public"."bench_notes" FOR INSERT WITH CHECK ((("author_id" = ( SELECT "auth"."uid"() AS "uid")) AND (NOT ( SELECT "public"."is_clerk"() AS "is_clerk"))));



CREATE POLICY "Authors can delete their own bench notes" ON "public"."bench_notes" FOR DELETE USING (("author_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Authors can update their own bench notes" ON "public"."bench_notes" FOR UPDATE USING (("author_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("author_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Authors can view their own bench notes" ON "public"."bench_notes" FOR SELECT USING (("author_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Canonical, own, and discoverable Case Law is viewable" ON "public"."case_law" FOR SELECT TO "authenticated" USING (((NOT ( SELECT "public"."is_clerk"() AS "is_clerk")) AND ((NOT ( SELECT "public"."is_magistrate"() AS "is_magistrate")) OR ( SELECT "public"."has_active_magistrate_court"() AS "has_active_magistrate_court")) AND ((("owner_id" IS NULL) AND (("review_status" = 'published'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin"))) OR ("owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("owner_id" IS NOT NULL) AND ("is_discoverable" = true)) OR "public"."has_item_share"('case_law'::"text", "id", 'view'::"text"))));



CREATE POLICY "Case categories are viewable by all authenticated users" ON "public"."legal_case_categories" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Case law tags are viewable with their Case Law" ON "public"."case_law_tags" FOR SELECT TO "authenticated" USING ("public"."can_view_case_law"("case_law_id"));



CREATE POLICY "Clerks can view their own access requests" ON "public"."clerk_access_requests" FOR SELECT USING ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR (( SELECT "public"."can_manage_clerk_access"("clerk_access_requests"."court_id") AS "can_manage_clerk_access") AND ( SELECT "public"."clerk_access_request_email_confirmed"("clerk_access_requests"."id") AS "clerk_access_request_email_confirmed")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Clerks can view their own court assignments" ON "public"."clerk_courts" FOR SELECT USING ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."can_manage_clerk_access"("clerk_courts"."court_id") AS "can_manage_clerk_access") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Court non-sitting days are viewable by all authenticated users" ON "public"."court_non_sitting_days" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Court staff can add callover items" ON "public"."docket_callover_items" FOR INSERT WITH CHECK ((( SELECT "public"."can_access_callover"("docket_callover_items"."callover_id") AS "can_access_callover") AND ( SELECT "public"."can_edit_docket_matter"("docket_callover_items"."docket_matter_id") AS "can_edit_docket_matter")));



CREATE POLICY "Court staff can create callovers" ON "public"."docket_callovers" FOR INSERT WITH CHECK ((( SELECT "public"."can_access_court"("docket_callovers"."court_id") AS "can_access_court") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Court staff can delete a draft callover" ON "public"."docket_callovers" FOR DELETE USING ((("status" = 'draft'::"text") AND (( SELECT "public"."can_access_court"("docket_callovers"."court_id") AS "can_access_court") OR ( SELECT "public"."is_admin"() AS "is_admin"))));



CREATE POLICY "Court staff can remove an uncalled item" ON "public"."docket_callover_items" FOR DELETE USING ((("called_at" IS NULL) AND ( SELECT "public"."can_access_callover"("docket_callover_items"."callover_id") AS "can_access_callover")));



CREATE POLICY "Court staff can update callover items" ON "public"."docket_callover_items" FOR UPDATE USING (( SELECT "public"."can_access_callover"("docket_callover_items"."callover_id") AS "can_access_callover")) WITH CHECK (( SELECT "public"."can_access_callover"("docket_callover_items"."callover_id") AS "can_access_callover"));



CREATE POLICY "Court staff can update callovers" ON "public"."docket_callovers" FOR UPDATE USING ((( SELECT "public"."can_access_court"("docket_callovers"."court_id") AS "can_access_court") OR ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK ((( SELECT "public"."can_access_court"("docket_callovers"."court_id") AS "can_access_court") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Court staff can view callover items" ON "public"."docket_callover_items" FOR SELECT USING (( SELECT "public"."can_access_callover"("docket_callover_items"."callover_id") AS "can_access_callover"));



CREATE POLICY "Court staff can view callovers" ON "public"."docket_callovers" FOR SELECT USING ((( SELECT "public"."can_access_court"("docket_callovers"."court_id") AS "can_access_court") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Courts are viewable by all authenticated users" ON "public"."courts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Current Docket-access holders and recipients can revoke Shares" ON "public"."shares" FOR UPDATE USING ((( SELECT "public"."has_item_share_authority"("shares"."item_type", "shares"."item_id") AS "has_item_share_authority") OR ("recipient_id" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((( SELECT "public"."has_item_share_authority"("shares"."item_type", "shares"."item_id") AS "has_item_share_authority") OR ("recipient_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Current Docket-access holders can create Shares" ON "public"."shares" FOR INSERT WITH CHECK ((( SELECT "public"."has_item_share_authority"("shares"."item_type", "shares"."item_id") AS "has_item_share_authority") AND ("granted_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("recipient_id" IS NOT NULL) AND ("recipient_id" IS DISTINCT FROM ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Deactivated accounts cannot add profiles" ON "public"."profiles" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts cannot change profiles" ON "public"."profiles" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts cannot delete profiles" ON "public"."profiles" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."audit_log" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."auth_event_log" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."bench_note_tags" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."bench_notes" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."bookmarks" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."case_law" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."case_law_annotations" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."case_law_tags" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."case_parties" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."case_tags" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."cases" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."clerk_access_requests" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."clerk_courts" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."comments" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."court_non_sitting_days" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."courts" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."data_retention_policies" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_callover_items" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_callovers" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_capacity_overrides" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_capacity_settings" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_event_calendar_links" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_events" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_matter_assignments" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_matter_case_law" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_matter_categories" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_matter_judgments" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_matter_parties" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_matter_tags" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."docket_matters" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."documents" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."feature_flags" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."import_batches" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."import_jobs" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."issue_reports" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."judgment_ownership_transfers" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."judgment_tags" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."judgment_versions" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."judgments" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."legal_authority_courts" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."legal_case_categories" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."legal_jurisdictions" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."legal_regional_groups" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."legal_sources" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."magisterial_districts" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."magistrate_court_requests" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."magistrate_courts" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."notifications" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."quick_code_case_law" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."quick_code_docket_matters" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."quick_code_judgments" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."quick_codes" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."rpc_rate_limit_buckets" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."shares" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."stale_draft_notices" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."statute_provisions" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."statute_tags" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."statutes" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."storage_cleanup_queue" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."tags" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."webhook_endpoints" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts have no access" ON "public"."webhook_outbox" AS RESTRICTIVE TO "authenticated" USING ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL)) WITH CHECK ((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL));



CREATE POLICY "Deactivated accounts see only their own profile" ON "public"."profiles" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (((( SELECT "public"."active_account_id"() AS "active_account_id") IS NOT NULL) OR ("id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Docket matter categories are viewable by all authenticated user" ON "public"."docket_matter_categories" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Judgment owners can link accessible Docket Matters" ON "public"."docket_matter_judgments" FOR INSERT WITH CHECK (("public"."has_docket_matter_authority"("docket_matter_id") AND "public"."can_edit_judgment"("judgment_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Judgment owners can unlink accessible Docket Matters" ON "public"."docket_matter_judgments" FOR DELETE USING (("public"."has_docket_matter_authority"("docket_matter_id") AND "public"."can_edit_judgment"("judgment_id")));



CREATE POLICY "Jurisdictions are viewable by all authenticated users" ON "public"."legal_jurisdictions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Magisterial districts are viewable by all authenticated users" ON "public"."magisterial_districts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Magistrates can add Docket Matter Tags" ON "public"."docket_matter_tags" FOR INSERT WITH CHECK (("public"."can_edit_docket_matter"("docket_matter_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Magistrates can create Docket Events for accessible Docket Matt" ON "public"."docket_events" FOR INSERT WITH CHECK (("public"."can_edit_docket_matter"("docket_matter_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND (("presiding_magistrate_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_clerk"() AS "is_clerk"))));



CREATE POLICY "Magistrates can create Docket Matter Parties" ON "public"."docket_matter_parties" FOR INSERT WITH CHECK (("public"."can_edit_docket_matter"("docket_matter_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Magistrates can create Docket Matters at their current courts" ON "public"."docket_matters" FOR INSERT WITH CHECK (((( SELECT "public"."can_access_court"("docket_matters"."court_id") AS "can_access_court") OR ( SELECT "public"."has_active_clerk_assignment"("docket_matters"."court_id") AS "has_active_clerk_assignment")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Magistrates can create their own Docket Matter Assignments" ON "public"."docket_matter_assignments" FOR INSERT WITH CHECK ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("granted_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("ended_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."docket_matters" "dm"
  WHERE (("dm"."id" = "docket_matter_assignments"."docket_matter_id") AND ( SELECT "public"."can_access_court"("dm"."court_id") AS "can_access_court"))))));



CREATE POLICY "Magistrates can delete own draft statutes" ON "public"."statutes" FOR DELETE USING ((( SELECT "public"."is_magistrate"() AS "is_magistrate") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("review_status" = 'draft'::"text")));



CREATE POLICY "Magistrates can end their own Docket Matter Assignments" ON "public"."docket_matter_assignments" FOR UPDATE USING (("profile_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("profile_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Magistrates can link readable Case Law to accessible Docket Mat" ON "public"."docket_matter_case_law" FOR INSERT WITH CHECK (("public"."has_docket_matter_authority"("docket_matter_id") AND "public"."can_view_case_law"("case_law_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Magistrates can remove Docket Matter Tags" ON "public"."docket_matter_tags" FOR DELETE USING ("public"."can_edit_docket_matter"("docket_matter_id"));



CREATE POLICY "Magistrates can unlink Case Law from accessible Docket Matters" ON "public"."docket_matter_case_law" FOR DELETE USING (("public"."has_docket_matter_authority"("docket_matter_id") AND "public"."can_view_case_law"("case_law_id")));



CREATE POLICY "Magistrates can update Docket Events for accessible Docket Matt" ON "public"."docket_events" FOR UPDATE USING ("public"."can_edit_docket_matter"("docket_matter_id")) WITH CHECK ("public"."can_edit_docket_matter"("docket_matter_id"));



CREATE POLICY "Magistrates can update Docket Matter Parties" ON "public"."docket_matter_parties" FOR UPDATE USING ("public"."can_edit_docket_matter"("docket_matter_id")) WITH CHECK ("public"."can_edit_docket_matter"("docket_matter_id"));



CREATE POLICY "Magistrates can update Docket Matters at their current courts" ON "public"."docket_matters" FOR UPDATE USING ((( SELECT "public"."can_access_court"("docket_matters"."court_id") AS "can_access_court") OR ( SELECT "public"."has_retained_assignment"("docket_matters"."id") AS "has_retained_assignment") OR ( SELECT "public"."has_docket_share"("docket_matters"."id", 'edit'::"text") AS "has_docket_share") OR ( SELECT "public"."has_active_clerk_assignment"("docket_matters"."court_id") AS "has_active_clerk_assignment"))) WITH CHECK ((( SELECT "public"."can_access_court"("docket_matters"."court_id") AS "can_access_court") OR ( SELECT "public"."has_retained_assignment"("docket_matters"."id") AS "has_retained_assignment") OR ( SELECT "public"."has_docket_share"("docket_matters"."id", 'edit'::"text") AS "has_docket_share") OR ( SELECT "public"."has_active_clerk_assignment"("docket_matters"."court_id") AS "has_active_clerk_assignment")));



CREATE POLICY "Magistrates can view Docket Events for accessible Docket Matter" ON "public"."docket_events" FOR SELECT USING ("public"."can_view_docket_matter"("docket_matter_id"));



CREATE POLICY "Magistrates can view Docket Matter Parties" ON "public"."docket_matter_parties" FOR SELECT USING ("public"."can_view_docket_matter"("docket_matter_id"));



CREATE POLICY "Magistrates can view Docket Matter Tags" ON "public"."docket_matter_tags" FOR SELECT USING ("public"."can_view_docket_matter"("docket_matter_id"));



CREATE POLICY "Magistrates can view Docket Matters at their current courts" ON "public"."docket_matters" FOR SELECT USING ((( SELECT "public"."can_access_court"("docket_matters"."court_id") AS "can_access_court") OR ( SELECT "public"."has_retained_assignment"("docket_matters"."id") AS "has_retained_assignment") OR ( SELECT "public"."has_docket_share"("docket_matters"."id", 'view'::"text") AS "has_docket_share") OR ( SELECT "public"."has_active_clerk_assignment"("docket_matters"."court_id") AS "has_active_clerk_assignment")));



CREATE POLICY "Magistrates can view accessible Docket Matter Case Law" ON "public"."docket_matter_case_law" FOR SELECT USING (("public"."can_view_docket_matter"("docket_matter_id") AND "public"."can_view_case_law"("case_law_id")));



CREATE POLICY "Magistrates can view accessible Docket Matter Judgments" ON "public"."docket_matter_judgments" FOR SELECT USING (("public"."can_view_docket_matter"("docket_matter_id") AND "public"."can_view_judgment"("judgment_id")));



CREATE POLICY "Magistrates can view own draft statutes" ON "public"."statutes" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_magistrate"() AS "is_magistrate") AND ( SELECT "public"."has_active_magistrate_court"() AS "has_active_magistrate_court") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("review_status" = 'draft'::"text")));



COMMENT ON POLICY "Magistrates can view own draft statutes" ON "public"."statutes" IS 'Additive to the published-read envelope: the magistrate who inserted a draft Act (0114) can read it back -- INSERT ... RETURNING and the Add flow depend on this -- while they still sit an active Court (0117). Never clerks, never other people''s drafts, never published rows (those stay with the 0055/0118 policy).';



CREATE POLICY "Magistrates can view their own Docket Capacity Overrides" ON "public"."docket_capacity_overrides" FOR SELECT USING ((("magistrate_profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("overridden_by" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Magistrates can view their own Docket Matter Assignments" ON "public"."docket_matter_assignments" FOR SELECT USING (("profile_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Magistrates can view their own court assignments" ON "public"."magistrate_courts" FOR SELECT USING ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Magistrates can view their own court requests" ON "public"."magistrate_court_requests" FOR SELECT USING ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



COMMENT ON POLICY "Magistrates can view their own court requests" ON "public"."magistrate_court_requests" IS 'Own rows for the requester at any verification status. is_admin() sees every row, including unconfirmed signups (0115). Docket access is still only granted by decide_magistrate_court_request() (0107).';



CREATE POLICY "Owners and discoverable readers can view Judgment Tags" ON "public"."judgment_tags" FOR SELECT TO "authenticated" USING ("public"."can_view_judgment"("judgment_id"));



CREATE POLICY "Owners and discoverable readers can view Judgments" ON "public"."judgments" FOR SELECT TO "authenticated" USING (((NOT ( SELECT "public"."is_clerk"() AS "is_clerk")) AND ((NOT ( SELECT "public"."is_magistrate"() AS "is_magistrate")) OR ( SELECT "public"."has_active_magistrate_court"() AS "has_active_magistrate_court")) AND (("owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("is_discoverable" = true) OR "public"."has_item_share"('judgment'::"text", "id", 'view'::"text"))));



CREATE POLICY "Owners can add Judgment Tags" ON "public"."judgment_tags" FOR INSERT WITH CHECK (("public"."can_edit_judgment"("judgment_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Owners can create Case Law Annotations on readable Case Law" ON "public"."case_law_annotations" FOR INSERT WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."can_view_case_law"("case_law_id")));



CREATE POLICY "Owners can create Docket Capacity Settings" ON "public"."docket_capacity_settings" FOR INSERT WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners can create Judgments" ON "public"."judgments" FOR INSERT WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (NOT ( SELECT "public"."is_clerk"() AS "is_clerk"))));



CREATE POLICY "Owners can create Quick Codes" ON "public"."quick_codes" FOR INSERT WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners can delete Judgments" ON "public"."judgments" FOR DELETE USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = 'draft'::"text")));



CREATE POLICY "Owners can delete their Docket Capacity Settings" ON "public"."docket_capacity_settings" FOR DELETE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners can delete their Quick Codes" ON "public"."quick_codes" FOR DELETE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners can delete their own Case Law Annotations" ON "public"."case_law_annotations" FOR DELETE USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."can_view_case_law"("case_law_id")));



CREATE POLICY "Owners can link their Quick Codes to accessible Docket Matters" ON "public"."quick_code_docket_matters" FOR INSERT WITH CHECK (("public"."can_edit_docket_matter"("docket_matter_id") AND (EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "quick_code_docket_matters"."quick_code_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Owners can link their Quick Codes to readable Case Law" ON "public"."quick_code_case_law" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "quick_code_case_law"."quick_code_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND "public"."can_view_case_law"("case_law_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Owners can link their Quick Codes to readable Judgments" ON "public"."quick_code_judgments" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "quick_code_judgments"."quick_code_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND "public"."can_view_judgment"("judgment_id") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Owners can remove Judgment Tags" ON "public"."judgment_tags" FOR DELETE USING ("public"."can_edit_judgment"("judgment_id"));



CREATE POLICY "Owners can unlink their Quick Codes from Case Law" ON "public"."quick_code_case_law" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "quick_code_case_law"."quick_code_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND "public"."can_view_case_law"("case_law_id")));



CREATE POLICY "Owners can unlink their Quick Codes from Judgments" ON "public"."quick_code_judgments" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "quick_code_judgments"."quick_code_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND "public"."can_view_judgment"("judgment_id")));



CREATE POLICY "Owners can unlink their Quick Codes from accessible Docket Matt" ON "public"."quick_code_docket_matters" FOR DELETE USING (("public"."can_edit_docket_matter"("docket_matter_id") AND (EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "quick_code_docket_matters"."quick_code_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Owners can update Judgments" ON "public"."judgments" FOR UPDATE USING (((NOT ( SELECT "public"."is_clerk"() AS "is_clerk")) AND ((NOT ( SELECT "public"."is_magistrate"() AS "is_magistrate")) OR ( SELECT "public"."has_active_magistrate_court"() AS "has_active_magistrate_court")) AND (("owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_item_share"('judgment'::"text", "id", 'edit'::"text")))) WITH CHECK (((NOT ( SELECT "public"."is_clerk"() AS "is_clerk")) AND ((NOT ( SELECT "public"."is_magistrate"() AS "is_magistrate")) OR ( SELECT "public"."has_active_magistrate_court"() AS "has_active_magistrate_court")) AND (("owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_item_share"('judgment'::"text", "id", 'edit'::"text"))));



CREATE POLICY "Owners can update their Docket Capacity Settings" ON "public"."docket_capacity_settings" FOR UPDATE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners can update their Quick Codes" ON "public"."quick_codes" FOR UPDATE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners can update their own Case Law Annotations" ON "public"."case_law_annotations" FOR UPDATE USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."can_view_case_law"("case_law_id"))) WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."can_view_case_law"("case_law_id")));



CREATE POLICY "Owners can view Judgment versions" ON "public"."judgment_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."judgments" "j"
  WHERE (("j"."id" = "judgment_versions"."judgment_id") AND ("j"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Owners can view accessible Quick Code Docket Matter links" ON "public"."quick_code_docket_matters" FOR SELECT USING (("public"."can_view_docket_matter"("docket_matter_id") AND (EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "quick_code_docket_matters"."quick_code_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Owners can view their Docket Capacity Settings" ON "public"."docket_capacity_settings" FOR SELECT USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners can view their Quick Code Case Law links" ON "public"."quick_code_case_law" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "quick_code_case_law"."quick_code_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND "public"."can_view_case_law"("case_law_id")));



CREATE POLICY "Owners can view their Quick Code Judgment links" ON "public"."quick_code_judgments" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "quick_code_judgments"."quick_code_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND "public"."can_view_judgment"("judgment_id")));



CREATE POLICY "Owners can view their Quick Codes" ON "public"."quick_codes" FOR SELECT USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners can view their own Case Law Annotations" ON "public"."case_law_annotations" FOR SELECT USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."can_view_case_law"("case_law_id")));



CREATE POLICY "Parties to a transfer and administrators can view it" ON "public"."judgment_ownership_transfers" FOR SELECT TO "authenticated" USING (((((( SELECT "auth"."uid"() AS "uid") = "from_owner_id") OR (( SELECT "auth"."uid"() AS "uid") = "to_owner_id")) OR (( SELECT "auth"."uid"() AS "uid") = "original_author_id")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Profiles are editable by owner or admin" ON "public"."profiles" FOR UPDATE USING (((( SELECT "auth"."uid"() AS "uid") = "id") OR ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK ((((( SELECT "auth"."uid"() AS "uid") = "id") AND ("role" = ( SELECT "public"."current_profile_role"() AS "current_profile_role")) AND (NOT ("court_id" IS DISTINCT FROM ( SELECT "public"."current_profile_court_id"() AS "current_profile_court_id"))) AND (NOT ("is_active" IS DISTINCT FROM ( SELECT "public"."current_profile_is_active"() AS "current_profile_is_active"))) AND (NOT ("email" IS DISTINCT FROM ( SELECT "public"."current_profile_email"() AS "current_profile_email")))) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Profiles are viewable by owner or admin" ON "public"."profiles" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "id") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Provisions are viewable when the parent statute is" ON "public"."statute_provisions" FOR SELECT TO "authenticated" USING ("public"."can_view_statute"("statute_id"));



CREATE POLICY "Published statutes are viewable by all authenticated users; adm" ON "public"."statutes" FOR SELECT TO "authenticated" USING (((NOT ( SELECT "public"."is_clerk"() AS "is_clerk")) AND ((NOT ( SELECT "public"."is_magistrate"() AS "is_magistrate")) OR ( SELECT "public"."has_active_magistrate_court"() AS "has_active_magistrate_court")) AND (("review_status" = 'published'::"text") OR ( SELECT "public"."is_admin"() AS "is_admin"))));



CREATE POLICY "Regional groups are viewable by all authenticated users" ON "public"."legal_regional_groups" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Reporters can submit issue reports" ON "public"."issue_reports" FOR INSERT WITH CHECK (("reporter_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Reporters can view their own issue reports" ON "public"."issue_reports" FOR SELECT USING (("reporter_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Share visibility for management" ON "public"."shares" FOR SELECT USING ((("granted_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("recipient_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_item_share_authority"("shares"."item_type", "shares"."item_id") AS "has_item_share_authority")));



CREATE POLICY "Statute tags are viewable by all authenticated users" ON "public"."statute_tags" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Tags are viewable by all authenticated users" ON "public"."tags" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Uploaders and admins can delete documents" ON "public"."documents" FOR DELETE USING ((( SELECT "public"."is_admin"() AS "is_admin") OR ("uploaded_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can add case parties to accessible cases" ON "public"."case_parties" FOR INSERT WITH CHECK (( SELECT "public"."user_can_access_case"("case_parties"."case_id") AS "user_can_access_case"));



CREATE POLICY "Users can attach a preview derivative to a document they can vi" ON "public"."documents" FOR INSERT WITH CHECK ((("purpose" = 'preview_derivative'::"text") AND ("uploaded_by" = ( SELECT "auth"."uid"() AS "uid")) AND (("storage"."foldername"("file_path"))[1] = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("source_document_id" IS NOT NULL) AND "public"."can_attach_preview_derivative"("source_document_id", "entity_type", "entity_id")));



CREATE POLICY "Users can attach documents to accessible parents" ON "public"."documents" FOR INSERT WITH CHECK ((("uploaded_by" = ( SELECT "auth"."uid"() AS "uid")) AND (("storage"."foldername"("file_path"))[1] = (( SELECT "auth"."uid"() AS "uid"))::"text") AND (("entity_type" IS NULL) OR (("entity_type" = 'docket_matter'::"text") AND "public"."can_edit_docket_matter"("entity_id")) OR (("entity_type" = 'judgment'::"text") AND "public"."can_edit_judgment"("entity_id")) OR (("entity_type" = 'case_law'::"text") AND "public"."can_edit_case_law"("entity_id")) OR (("entity_type" = 'quick_code'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "documents"."entity_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR (("entity_type" = 'bench_note'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."bench_notes" "bn"
  WHERE (("bn"."id" = "documents"."entity_id") AND ("bn"."author_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR (("entity_type" = 'case'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "documents"."entity_id") AND (( SELECT "public"."is_admin"() AS "is_admin") OR ("c"."court_id" = ( SELECT "public"."my_court_id"() AS "my_court_id"))))))) OR (("entity_type" = 'statute'::"text") AND (( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."statutes" "s"
  WHERE (("s"."id" = "documents"."entity_id") AND ("s"."review_status" = 'draft'::"text") AND ("s"."created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "public"."is_magistrate"() AS "is_magistrate")))))))));



CREATE POLICY "Users can comment on accessible parents" ON "public"."comments" FOR INSERT WITH CHECK ((("author_id" = ( SELECT "auth"."uid"() AS "uid")) AND ((("case_id" IS NOT NULL) AND ( SELECT "public"."user_can_access_case"("comments"."case_id") AS "user_can_access_case")) OR (("bench_note_id" IS NOT NULL) AND ( SELECT "public"."user_can_access_bench_note"("comments"."bench_note_id") AS "user_can_access_bench_note")))));



CREATE POLICY "Users can create cases in their own court" ON "public"."cases" FOR INSERT WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR (("court_id" = ( SELECT "public"."my_court_id"() AS "my_court_id")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Users can create their own bookmarks" ON "public"."bookmarks" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete their own bookmarks" ON "public"."bookmarks" FOR DELETE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can dismiss their own notifications" ON "public"."notifications" FOR DELETE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can mark their own notifications read" ON "public"."notifications" FOR UPDATE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can remove case parties from accessible cases" ON "public"."case_parties" FOR DELETE USING (( SELECT "public"."user_can_access_case"("case_parties"."case_id") AS "user_can_access_case"));



CREATE POLICY "Users can tag accessible bench notes" ON "public"."bench_note_tags" FOR INSERT WITH CHECK (( SELECT "public"."user_can_access_bench_note"("bench_note_tags"."bench_note_id") AS "user_can_access_bench_note"));



CREATE POLICY "Users can tag accessible cases" ON "public"."case_tags" FOR INSERT WITH CHECK (( SELECT "public"."user_can_access_case"("case_tags"."case_id") AS "user_can_access_case"));



CREATE POLICY "Users can untag accessible bench notes" ON "public"."bench_note_tags" FOR DELETE USING (( SELECT "public"."user_can_access_bench_note"("bench_note_tags"."bench_note_id") AS "user_can_access_bench_note"));



CREATE POLICY "Users can untag accessible cases" ON "public"."case_tags" FOR DELETE USING (( SELECT "public"."user_can_access_case"("case_tags"."case_id") AS "user_can_access_case"));



CREATE POLICY "Users can update case parties on accessible cases" ON "public"."case_parties" FOR UPDATE USING (( SELECT "public"."user_can_access_case"("case_parties"."case_id") AS "user_can_access_case")) WITH CHECK (( SELECT "public"."user_can_access_case"("case_parties"."case_id") AS "user_can_access_case"));



CREATE POLICY "Users can update cases in their court" ON "public"."cases" FOR UPDATE USING ((( SELECT "public"."is_admin"() AS "is_admin") OR ("court_id" = ( SELECT "public"."my_court_id"() AS "my_court_id")))) WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR ("court_id" = ( SELECT "public"."my_court_id"() AS "my_court_id"))));



CREATE POLICY "Users can view bench note tags for accessible notes" ON "public"."bench_note_tags" FOR SELECT USING (( SELECT "public"."user_can_access_bench_note"("bench_note_tags"."bench_note_id") AS "user_can_access_bench_note"));



CREATE POLICY "Users can view case parties for accessible cases" ON "public"."case_parties" FOR SELECT USING (( SELECT "public"."user_can_access_case"("case_parties"."case_id") AS "user_can_access_case"));



CREATE POLICY "Users can view case tags for accessible cases" ON "public"."case_tags" FOR SELECT USING (( SELECT "public"."user_can_access_case"("case_tags"."case_id") AS "user_can_access_case"));



CREATE POLICY "Users can view cases in their court" ON "public"."cases" FOR SELECT USING ((( SELECT "public"."is_admin"() AS "is_admin") OR ("court_id" = ( SELECT "public"."my_court_id"() AS "my_court_id"))));



CREATE POLICY "Users can view comments on accessible parents" ON "public"."comments" FOR SELECT USING (((("case_id" IS NOT NULL) AND ( SELECT "public"."user_can_access_case"("comments"."case_id") AS "user_can_access_case")) OR (("bench_note_id" IS NOT NULL) AND ( SELECT "public"."user_can_access_bench_note"("comments"."bench_note_id") AS "user_can_access_bench_note"))));



CREATE POLICY "Users can view documents they have access to" ON "public"."documents" FOR SELECT USING ((("uploaded_by" = ( SELECT "auth"."uid"() AS "uid")) OR (("entity_type" = 'docket_matter'::"text") AND "public"."can_view_docket_matter"("entity_id")) OR (("entity_type" = 'judgment'::"text") AND "public"."can_view_judgment"("entity_id")) OR (("entity_type" = 'case_law'::"text") AND "public"."can_view_case_law"("entity_id")) OR (("entity_type" = 'quick_code'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."quick_codes" "qc"
  WHERE (("qc"."id" = "documents"."entity_id") AND ("qc"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR (("entity_type" = 'bench_note'::"text") AND "public"."user_can_access_bench_note"("entity_id")) OR (("entity_type" = 'case'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."cases" "c"
  WHERE (("c"."id" = "documents"."entity_id") AND (( SELECT "public"."is_admin"() AS "is_admin") OR ("c"."court_id" = ( SELECT "public"."my_court_id"() AS "my_court_id"))))))) OR (("entity_type" = 'statute'::"text") AND "public"."can_view_statute"("entity_id"))));



CREATE POLICY "Users can view their own bookmarks" ON "public"."bookmarks" FOR SELECT USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users delete own calendar links" ON "public"."docket_event_calendar_links" FOR DELETE USING (("profile_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users insert own calendar links for readable events" ON "public"."docket_event_calendar_links" FOR INSERT WITH CHECK ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."docket_events" "e"
  WHERE (("e"."id" = "docket_event_calendar_links"."docket_event_id") AND "public"."can_view_docket_matter"("e"."docket_matter_id"))))));



CREATE POLICY "Users select own calendar links for readable events" ON "public"."docket_event_calendar_links" FOR SELECT USING ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."docket_events" "e"
  WHERE (("e"."id" = "docket_event_calendar_links"."docket_event_id") AND "public"."can_view_docket_matter"("e"."docket_matter_id"))))));



CREATE POLICY "Users update own calendar links for readable events" ON "public"."docket_event_calendar_links" FOR UPDATE USING (("profile_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."docket_events" "e"
  WHERE (("e"."id" = "docket_event_calendar_links"."docket_event_id") AND "public"."can_view_docket_matter"("e"."docket_matter_id"))))));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auth_event_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bench_note_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bench_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookmarks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_law" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_law_annotations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_law_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_parties" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clerk_access_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clerk_courts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."court_non_sitting_days" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."courts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."data_retention_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_callover_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_callovers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_capacity_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_capacity_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_event_calendar_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_matter_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_matter_case_law" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_matter_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_matter_judgments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_matter_parties" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_matter_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."docket_matters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feature_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."issue_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."judgment_ownership_transfers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."judgment_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."judgment_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."judgments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legal_authority_courts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legal_case_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legal_jurisdictions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legal_regional_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legal_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."magisterial_districts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."magistrate_court_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."magistrate_courts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quick_code_case_law" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quick_code_docket_matters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quick_code_judgments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quick_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rpc_rate_limit_buckets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shares" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stale_draft_notices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."statute_provisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."statute_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."statutes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."storage_cleanup_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_endpoints" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_outbox" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."active_account_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."active_account_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."active_account_id"() TO "service_role";



GRANT ALL ON TABLE "public"."magistrate_courts" TO "anon";
GRANT ALL ON TABLE "public"."magistrate_courts" TO "authenticated";
GRANT ALL ON TABLE "public"."magistrate_courts" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_assign_magistrate_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_assign_magistrate_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_assign_magistrate_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text") TO "service_role";



GRANT ALL ON TABLE "public"."magistrate_court_requests" TO "anon";
GRANT ALL ON TABLE "public"."magistrate_court_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."magistrate_court_requests" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_bootstrap_self_approve_magistrate_court_request"("p_request_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_bootstrap_self_approve_magistrate_court_request"("p_request_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_bootstrap_self_approve_magistrate_court_request"("p_request_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_seat_magistrate_at_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text", "p_if_occupied" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_seat_magistrate_at_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text", "p_if_occupied" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_seat_magistrate_at_court"("p_profile_id" "uuid", "p_court_id" "uuid", "p_assignment_type" "text", "p_if_occupied" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_transfer_magistrate_court"("p_assignment_id" "uuid", "p_new_court_id" "uuid", "p_if_occupied" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_transfer_magistrate_court"("p_assignment_id" "uuid", "p_new_court_id" "uuid", "p_if_occupied" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_transfer_magistrate_court"("p_assignment_id" "uuid", "p_new_court_id" "uuid", "p_if_occupied" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."anon_executable_definer_functions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."anon_executable_definer_functions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_case_law_tags"("p_case_law_id" "uuid", "p_tag_names" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_case_law_tags"("p_case_law_id" "uuid", "p_tag_names" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_case_law_tags"("p_case_law_id" "uuid", "p_tag_names" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_data_retention"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_data_retention"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_statute_tags"("p_statute_id" "uuid", "p_tag_names" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_statute_tags"("p_statute_id" "uuid", "p_tag_names" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_statute_tags"("p_statute_id" "uuid", "p_tag_names" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_log_assign_hash"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_log_assign_hash"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_log_assign_hash"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_log_digest"("p_payload" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."audit_log_digest"("p_payload" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_log_digest"("p_payload" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_log_immutable"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_log_immutable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_log_immutable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_log_payload"("p_prev_hash" "text", "p_id" bigint, "p_action" "public"."audit_action", "p_table_name" "text", "p_record_id" "uuid", "p_actor_id" "uuid", "p_created_at" timestamp with time zone, "p_old_data" "jsonb", "p_new_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."audit_log_payload"("p_prev_hash" "text", "p_id" bigint, "p_action" "public"."audit_action", "p_table_name" "text", "p_record_id" "uuid", "p_actor_id" "uuid", "p_created_at" timestamp with time zone, "p_old_data" "jsonb", "p_new_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_log_payload"("p_prev_hash" "text", "p_id" bigint, "p_action" "public"."audit_action", "p_table_name" "text", "p_record_id" "uuid", "p_actor_id" "uuid", "p_created_at" timestamp with time zone, "p_old_data" "jsonb", "p_new_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_trigger_fn"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_trigger_fn"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bench_notes_entity_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."bench_notes_entity_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bench_notes_entity_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."btrim_whitespace"("p_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."btrim_whitespace"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."btrim_whitespace"("p_text" "text") TO "service_role";



GRANT ALL ON TABLE "public"."docket_matters" TO "anon";
GRANT ALL ON TABLE "public"."docket_matters" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_matters" TO "service_role";



REVOKE ALL ON FUNCTION "public"."bin_docket_matter"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bin_docket_matter"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bin_docket_matter"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."callover_provenance_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."callover_provenance_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."callover_provenance_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_callover"("p_callover_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_callover"("p_callover_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_callover"("p_callover_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."can_access_callover"("p_callover_id" "uuid") TO "anon";



GRANT ALL ON FUNCTION "public"."can_access_court"("p_court_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_court"("p_court_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_court"("p_court_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_attach_preview_derivative"("p_source_document_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_attach_preview_derivative"("p_source_document_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_attach_preview_derivative"("p_source_document_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_edit_case_law"("p_case_law_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_case_law"("p_case_law_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_case_law"("p_case_law_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_edit_docket_matter"("p_docket_matter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_docket_matter"("p_docket_matter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_docket_matter"("p_docket_matter_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_edit_judgment"("p_judgment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_judgment"("p_judgment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_judgment"("p_judgment_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_clerk_access"("p_court_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_clerk_access"("p_court_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_clerk_access"("p_court_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_receive_research_share"("p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_receive_research_share"("p_profile_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_case_law"("p_case_law_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_case_law"("p_case_law_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_case_law"("p_case_law_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_docket_matter"("p_docket_matter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_docket_matter"("p_docket_matter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_docket_matter"("p_docket_matter_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_judgment"("p_judgment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_judgment"("p_judgment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_judgment"("p_judgment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_statute"("p_statute_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_statute"("p_statute_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_statute"("p_statute_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."clerk_access_requests" TO "anon";
GRANT ALL ON TABLE "public"."clerk_access_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."clerk_access_requests" TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_clerk_access_request"("p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_clerk_access_request"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_clerk_access_request"("p_request_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_magistrate_court_request"("p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_magistrate_court_request"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_magistrate_court_request"("p_request_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."capture_judgment_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."capture_judgment_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."capture_judgment_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."case_law_annotations_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."case_law_annotations_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."case_law_annotations_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."case_law_counts_by_category"("p_query" "text", "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_tag_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."case_law_counts_by_category"("p_query" "text", "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_tag_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."case_law_counts_by_category"("p_query" "text", "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_tag_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."case_law_counts_by_court"("p_query" "text", "p_jurisdiction_id" "uuid", "p_category_id" "uuid", "p_tag_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."case_law_counts_by_court"("p_query" "text", "p_jurisdiction_id" "uuid", "p_category_id" "uuid", "p_tag_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."case_law_counts_by_court"("p_query" "text", "p_jurisdiction_id" "uuid", "p_category_id" "uuid", "p_tag_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."case_law_counts_by_jurisdiction"("p_query" "text", "p_court_id" "uuid", "p_category_id" "uuid", "p_tag_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."case_law_counts_by_jurisdiction"("p_query" "text", "p_court_id" "uuid", "p_category_id" "uuid", "p_tag_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."case_law_counts_by_jurisdiction"("p_query" "text", "p_court_id" "uuid", "p_category_id" "uuid", "p_tag_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."case_law_matches_query"("p_case_name" "text", "p_citation" "text", "p_search_vector" "tsvector", "p_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."case_law_matches_query"("p_case_name" "text", "p_citation" "text", "p_search_vector" "tsvector", "p_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."case_law_matches_query"("p_case_name" "text", "p_citation" "text", "p_search_vector" "tsvector", "p_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."case_law_ownership_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."case_law_ownership_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."case_law_ownership_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."case_law_search_rank"("p_case_name" "text", "p_search_vector" "tsvector", "p_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."case_law_search_rank"("p_case_name" "text", "p_search_vector" "tsvector", "p_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."case_law_search_rank"("p_case_name" "text", "p_search_vector" "tsvector", "p_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."case_law_title_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."case_law_title_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."case_law_title_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_court_active_for_assignment"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_court_active_for_assignment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_court_active_for_assignment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_primary_magistrate_exclusivity"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_primary_magistrate_exclusivity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_primary_magistrate_exclusivity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_primary_slot_on_first_sign_in"() TO "anon";
GRANT ALL ON FUNCTION "public"."claim_primary_slot_on_first_sign_in"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_primary_slot_on_first_sign_in"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_webhook_deliveries"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_webhook_deliveries"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."clerk_access_request_email_confirmed"("p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."clerk_access_request_email_confirmed"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clerk_access_request_email_confirmed"("p_request_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."clerk_access_requests_notify"() TO "anon";
GRANT ALL ON FUNCTION "public"."clerk_access_requests_notify"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clerk_access_requests_notify"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."clerk_profiles_for_review"("p_profile_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clerk_profiles_for_review"("p_profile_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."clerk_profiles_for_review"("p_profile_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."correct_unassigned_account_type"("p_profile_id" "uuid", "p_new_role" "public"."user_role", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."correct_unassigned_account_type"("p_profile_id" "uuid", "p_new_role" "public"."user_role", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."correct_unassigned_account_type"("p_profile_id" "uuid", "p_new_role" "public"."user_role", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."court_has_active_primary_magistrate"("p_court_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."court_has_active_primary_magistrate"("p_court_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."court_has_active_primary_magistrate"("p_court_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."court_has_active_primary_magistrate"("p_court_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."court_has_no_clerk_approver"("p_court_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."court_has_no_clerk_approver"("p_court_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."court_has_no_clerk_approver"("p_court_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_case_law_import"("p_case_name" "text", "p_citation" "text", "p_court" "text", "p_jurisdiction" "text", "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_neutral_citation" "text", "p_reported_citation" "text", "p_decided_date" "date", "p_full_text" "text", "p_source_url" "text", "p_source_id" "uuid", "p_original_filename" "text", "p_document_hash" "text", "p_batch_id" "uuid", "p_extracted_metadata" "jsonb", "p_proposed_tags" "text"[], "p_duplicate_warning" "text", "p_content_quality_status" "text", "p_category_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_case_law_import"("p_case_name" "text", "p_citation" "text", "p_court" "text", "p_jurisdiction" "text", "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_neutral_citation" "text", "p_reported_citation" "text", "p_decided_date" "date", "p_full_text" "text", "p_source_url" "text", "p_source_id" "uuid", "p_original_filename" "text", "p_document_hash" "text", "p_batch_id" "uuid", "p_extracted_metadata" "jsonb", "p_proposed_tags" "text"[], "p_duplicate_warning" "text", "p_content_quality_status" "text", "p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_case_law_import"("p_case_name" "text", "p_citation" "text", "p_court" "text", "p_jurisdiction" "text", "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_neutral_citation" "text", "p_reported_citation" "text", "p_decided_date" "date", "p_full_text" "text", "p_source_url" "text", "p_source_id" "uuid", "p_original_filename" "text", "p_document_hash" "text", "p_batch_id" "uuid", "p_extracted_metadata" "jsonb", "p_proposed_tags" "text"[], "p_duplicate_warning" "text", "p_content_quality_status" "text", "p_category_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_legislation_import"("p_code" "text", "p_title" "text", "p_jurisdiction" "text", "p_jurisdiction_id" "uuid", "p_short_title" "text", "p_full_text" "text", "p_source_url" "text", "p_source_id" "uuid", "p_original_filename" "text", "p_document_hash" "text", "p_batch_id" "uuid", "p_extracted_metadata" "jsonb", "p_proposed_tags" "text"[], "p_duplicate_warning" "text", "p_provisions" "jsonb", "p_act_number" "text", "p_enactment_year" integer, "p_instrument_type" "text", "p_chapter_number" "text", "p_effective_date" "date", "p_content_quality_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_legislation_import"("p_code" "text", "p_title" "text", "p_jurisdiction" "text", "p_jurisdiction_id" "uuid", "p_short_title" "text", "p_full_text" "text", "p_source_url" "text", "p_source_id" "uuid", "p_original_filename" "text", "p_document_hash" "text", "p_batch_id" "uuid", "p_extracted_metadata" "jsonb", "p_proposed_tags" "text"[], "p_duplicate_warning" "text", "p_provisions" "jsonb", "p_act_number" "text", "p_enactment_year" integer, "p_instrument_type" "text", "p_chapter_number" "text", "p_effective_date" "date", "p_content_quality_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_legislation_import"("p_code" "text", "p_title" "text", "p_jurisdiction" "text", "p_jurisdiction_id" "uuid", "p_short_title" "text", "p_full_text" "text", "p_source_url" "text", "p_source_id" "uuid", "p_original_filename" "text", "p_document_hash" "text", "p_batch_id" "uuid", "p_extracted_metadata" "jsonb", "p_proposed_tags" "text"[], "p_duplicate_warning" "text", "p_provisions" "jsonb", "p_act_number" "text", "p_enactment_year" integer, "p_instrument_type" "text", "p_chapter_number" "text", "p_effective_date" "date", "p_content_quality_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_profile_court_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_court_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_profile_court_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_profile_email"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_profile_email"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_profile_is_active"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_is_active"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_profile_is_active"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_profile_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_profile_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."decide_clerk_access_request"("p_request_id" "uuid", "p_decision" "public"."clerk_access_decision", "p_rejection_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_clerk_access_request"("p_request_id" "uuid", "p_decision" "public"."clerk_access_decision", "p_rejection_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decide_clerk_access_request"("p_request_id" "uuid", "p_decision" "public"."clerk_access_decision", "p_rejection_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."decide_magistrate_court_request"("p_request_id" "uuid", "p_decision" "public"."magistrate_court_decision", "p_rejection_reason" "text", "p_occupied_resolution" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_magistrate_court_request"("p_request_id" "uuid", "p_decision" "public"."magistrate_court_decision", "p_rejection_reason" "text", "p_occupied_resolution" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decide_magistrate_court_request"("p_request_id" "uuid", "p_decision" "public"."magistrate_court_decision", "p_rejection_reason" "text", "p_occupied_resolution" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."dispatch_pending_webhooks"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dispatch_pending_webhooks"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."docket_booked_count"("p_magistrate_id" "uuid", "p_category_id" "uuid", "p_scheduled_date" "date", "p_exclude_matter_id" "uuid", "p_court_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."docket_booked_count"("p_magistrate_id" "uuid", "p_category_id" "uuid", "p_scheduled_date" "date", "p_exclude_matter_id" "uuid", "p_court_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_booked_count"("p_magistrate_id" "uuid", "p_category_id" "uuid", "p_scheduled_date" "date", "p_exclude_matter_id" "uuid", "p_court_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_callover_items_record_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_callover_items_record_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_callover_items_record_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_callovers_record_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_callovers_record_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_callovers_record_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_capacity_settings_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_capacity_settings_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_capacity_settings_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_event_calendar_links_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_event_calendar_links_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_event_calendar_links_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_events_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_events_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_events_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."docket_magistrate_can_hear"("p_profile_id" "uuid", "p_docket_matter_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."docket_magistrate_can_hear"("p_profile_id" "uuid", "p_docket_matter_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_matter_case_law_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_matter_case_law_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_matter_case_law_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_matter_judgments_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_matter_judgments_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_matter_judgments_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."docket_matter_matches_query"("p_case_number" "text", "p_matter_title" "text", "p_charge_or_issue" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."docket_matter_matches_query"("p_case_number" "text", "p_matter_title" "text", "p_charge_or_issue" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_matter_matches_query"("p_case_number" "text", "p_matter_title" "text", "p_charge_or_issue" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_matter_parties_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_matter_parties_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_matter_parties_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."docket_matter_search_rank"("p_case_number" "text", "p_matter_title" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."docket_matter_search_rank"("p_case_number" "text", "p_matter_title" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_matter_search_rank"("p_case_number" "text", "p_matter_title" "text", "p_search_vector" "tsvector", "p_docket_matter_id" "uuid", "p_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_matter_tags_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_matter_tags_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_matter_tags_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_matters_category_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_matters_category_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_matters_category_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_matters_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_matters_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_matters_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_matters_outcome_sync"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_matters_outcome_sync"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_matters_outcome_sync"() TO "service_role";



GRANT ALL ON FUNCTION "public"."docket_matters_set_workflow_protocol"() TO "anon";
GRANT ALL ON FUNCTION "public"."docket_matters_set_workflow_protocol"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."docket_matters_set_workflow_protocol"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."docket_matters_trim_text"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."docket_matters_trim_text"() TO "service_role";



GRANT ALL ON FUNCTION "public"."documents_parent_cascade_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."documents_parent_cascade_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."documents_parent_cascade_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."documents_queue_storage_cleanup"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."documents_queue_storage_cleanup"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."download_my_data"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."download_my_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."download_my_data"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."end_other_regular_assignments_at_court"("p_court_id" "uuid", "p_keep_profile_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."end_other_regular_assignments_at_court"("p_court_id" "uuid", "p_keep_profile_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_rpc_rate_limit"("p_rpc" "text", "p_max" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_rpc_rate_limit"("p_rpc" "text", "p_max" integer, "p_window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_rpc_rate_limit"("p_rpc" "text", "p_max" integer, "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_webhook_event"("p_event" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_webhook_event"("p_event" "text", "p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."escape_like_pattern"("p_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."escape_like_pattern"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."escape_like_pattern"("p_text" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."export_audit_log"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_tables" "text"[], "p_export_id" bigint, "p_after_id" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."export_audit_log"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_tables" "text"[], "p_export_id" bigint, "p_after_id" bigint, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."export_audit_log"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_tables" "text"[], "p_export_id" bigint, "p_after_id" bigint, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."feature_flags_admin_mfa_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feature_flags_admin_mfa_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_legislation_document"("p_statute_id" "uuid", "p_document_id" "uuid", "p_page_count" integer, "p_has_text_layer" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_legislation_document"("p_statute_id" "uuid", "p_document_id" "uuid", "p_page_count" integer, "p_has_text_layer" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_legislation_document"("p_statute_id" "uuid", "p_document_id" "uuid", "p_page_count" integer, "p_has_text_layer" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_next_available_docket_date"("p_category_id" "uuid", "p_start_date" "date", "p_max_days_ahead" integer, "p_docket_matter_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_next_available_docket_date"("p_category_id" "uuid", "p_start_date" "date", "p_max_days_ahead" integer, "p_docket_matter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_next_available_docket_date"("p_category_id" "uuid", "p_start_date" "date", "p_max_days_ahead" integer, "p_docket_matter_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."flag_stale_drafts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."flag_stale_drafts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."format_case_law_title"("p_input" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."format_case_law_title"("p_input" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."format_case_law_title"("p_input" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."format_case_law_title_atom"("p_word" "text", "p_force_cap" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."format_case_law_title_atom"("p_word" "text", "p_force_cap" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."format_case_law_title_atom"("p_word" "text", "p_force_cap" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."format_case_law_title_word"("p_word" "text", "p_force_cap" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."format_case_law_title_word"("p_word" "text", "p_force_cap" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."format_case_law_title_word"("p_word" "text", "p_force_cap" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_daily_docket_report_data"("p_date" "date", "p_court_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_daily_docket_report_data"("p_date" "date", "p_court_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_daily_docket_report_data"("p_date" "date", "p_court_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_docket_report_data"("p_date" "date", "p_court_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_docket_capacity_snapshot"("p_scheduled_date" "date", "p_category_id" "uuid", "p_court_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_docket_capacity_snapshot"("p_scheduled_date" "date", "p_category_id" "uuid", "p_court_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_docket_capacity_snapshot"("p_scheduled_date" "date", "p_category_id" "uuid", "p_court_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_docket_capacity_snapshot"("p_scheduled_date" "date", "p_category_id" "uuid", "p_court_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."global_search"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."global_search"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."global_search"("p_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."guyana_today"() TO "anon";
GRANT ALL ON FUNCTION "public"."guyana_today"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guyana_today"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_active_clerk_assignment"("p_court_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_active_clerk_assignment"("p_court_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_active_clerk_assignment"("p_court_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_active_magistrate_court"() TO "anon";
GRANT ALL ON FUNCTION "public"."has_active_magistrate_court"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_active_magistrate_court"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_docket_matter_authority"("p_docket_matter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_docket_matter_authority"("p_docket_matter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_docket_matter_authority"("p_docket_matter_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_docket_share"("p_docket_matter_id" "uuid", "p_required_permission" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_docket_share"("p_docket_matter_id" "uuid", "p_required_permission" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_docket_share"("p_docket_matter_id" "uuid", "p_required_permission" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_item_share"("p_item_type" "text", "p_item_id" "uuid", "p_required_permission" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_item_share"("p_item_type" "text", "p_item_id" "uuid", "p_required_permission" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."has_item_share"("p_item_type" "text", "p_item_id" "uuid", "p_required_permission" "text") TO "anon";



GRANT ALL ON FUNCTION "public"."has_item_share_authority"("p_item_type" "text", "p_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_item_share_authority"("p_item_type" "text", "p_item_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."has_item_share_authority"("p_item_type" "text", "p_item_id" "uuid") TO "anon";



GRANT ALL ON FUNCTION "public"."has_retained_assignment"("p_docket_matter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_retained_assignment"("p_docket_matter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_retained_assignment"("p_docket_matter_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_active_account"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active_account"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_account"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_clerk"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_clerk"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_clerk"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_court_sitting_day"("p_date" "date", "p_court_id" "uuid", "p_district_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_court_sitting_day"("p_date" "date", "p_court_id" "uuid", "p_district_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_court_sitting_day"("p_date" "date", "p_court_id" "uuid", "p_district_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_magistrate"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_magistrate"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_magistrate"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_sole_admin_bootstrap_available"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_sole_admin_bootstrap_available"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_sole_admin_bootstrap_available"() TO "service_role";



GRANT ALL ON FUNCTION "public"."issue_reports_notify_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."issue_reports_notify_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."issue_reports_notify_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."judgment_tags_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."judgment_tags_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."judgment_tags_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."judgments_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."judgments_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."judgments_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."judgments_notify_final"() TO "anon";
GRANT ALL ON FUNCTION "public"."judgments_notify_final"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."judgments_notify_final"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_active_courts_for_magistrate_signup"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_active_courts_for_magistrate_signup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_active_courts_for_magistrate_signup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_active_courts_for_signup"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_active_courts_for_signup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_active_courts_for_signup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_active_magisterial_districts_for_signup"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_active_magisterial_districts_for_signup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_active_magisterial_districts_for_signup"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_binned_docket_matters"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_binned_docket_matters"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_binned_docket_matters"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_clerk_access_requests_needing_admin_attention"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_clerk_access_requests_needing_admin_attention"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_clerk_access_requests_needing_admin_attention"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_courts_for_magistrate_request"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_courts_for_magistrate_request"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_courts_for_magistrate_request"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_docket_matters"("p_query" "text", "p_limit" integer, "p_procedure_stages" "text"[], "p_custody" "text"[], "p_disclosure" "text"[], "p_trial" "text"[], "p_next_date" "text"[], "p_exact_date" "date", "p_court_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_docket_matters"("p_query" "text", "p_limit" integer, "p_procedure_stages" "text"[], "p_custody" "text"[], "p_disclosure" "text"[], "p_trial" "text"[], "p_next_date" "text"[], "p_exact_date" "date", "p_court_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."list_docket_matters"("p_query" "text", "p_limit" integer, "p_procedure_stages" "text"[], "p_custody" "text"[], "p_disclosure" "text"[], "p_trial" "text"[], "p_next_date" "text"[], "p_exact_date" "date", "p_court_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_docket_matters"("p_query" "text", "p_limit" integer, "p_procedure_stages" "text"[], "p_custody" "text"[], "p_disclosure" "text"[], "p_trial" "text"[], "p_next_date" "text"[], "p_exact_date" "date", "p_court_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_magistrate_court_request_email_confirmation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_magistrate_court_request_email_confirmation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_magistrate_court_request_email_confirmation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."magistrate_court_request_email_confirmed"("p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."magistrate_court_request_email_confirmed"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."magistrate_court_request_email_confirmed"("p_request_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."magistrate_court_requests_notify"() TO "anon";
GRANT ALL ON FUNCTION "public"."magistrate_court_requests_notify"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."magistrate_court_requests_notify"() TO "service_role";



GRANT ALL ON FUNCTION "public"."magistrate_courts_notify"() TO "anon";
GRANT ALL ON FUNCTION "public"."magistrate_courts_notify"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."magistrate_courts_notify"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_past_hearings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_past_hearings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."matter_current_stage_label"("p_docket_matter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."matter_current_stage_label"("p_docket_matter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."matter_current_stage_label"("p_docket_matter_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."my_court_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_court_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_court_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."new_docket_event_presiding_magistrate"("p_docket_matter_id" "uuid", "p_prior_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."new_docket_event_presiding_magistrate"("p_docket_matter_id" "uuid", "p_prior_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."new_docket_event_presiding_magistrate"("p_docket_matter_id" "uuid", "p_prior_event_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."notifications_enqueue_webhook"() TO "anon";
GRANT ALL ON FUNCTION "public"."notifications_enqueue_webhook"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notifications_enqueue_webhook"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notifications_protect"() TO "anon";
GRANT ALL ON FUNCTION "public"."notifications_protect"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notifications_protect"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_admins"("p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_admins"("p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_court_staff"("p_court_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_court_staff"("p_court_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_court_staff_except"("p_court_id" "uuid", "p_except_profile_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_court_staff_except"("p_court_id" "uuid", "p_except_profile_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_tomorrows_hearings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_tomorrows_hearings"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_user"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_user"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."populate_callover_from_date"("p_callover_id" "uuid", "p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."populate_callover_from_date"("p_callover_id" "uuid", "p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."populate_callover_from_date"("p_callover_id" "uuid", "p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."profile_has_completed_first_sign_in"("p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profile_has_completed_first_sign_in"("p_profile_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."profiles_identity_columns_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profiles_identity_columns_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."profiles_is_active_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profiles_is_active_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_clerk_court_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_clerk_court_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_clerk_court_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_court_district_once_referenced"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_court_district_once_referenced"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_court_district_once_referenced"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_docket_matter_assignment_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_docket_matter_assignment_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_docket_matter_assignment_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_judgment_lifecycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_judgment_lifecycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_judgment_lifecycle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_magistrate_court_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_magistrate_court_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_magistrate_court_history"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_case_law_import"("p_case_law_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_case_law_import"("p_case_law_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."publish_case_law_import"("p_case_law_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_legislation_import"("p_statute_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_legislation_import"("p_statute_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."publish_legislation_import"("p_statute_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_docket_matter"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_docket_matter"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."purge_docket_matter"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_docket_matter_row"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_docket_matter_row"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_expired_docket_matters"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_expired_docket_matters"() TO "service_role";



GRANT ALL ON FUNCTION "public"."quick_code_case_law_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."quick_code_case_law_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."quick_code_case_law_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."quick_code_docket_matters_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."quick_code_docket_matters_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."quick_code_docket_matters_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."quick_code_judgments_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."quick_code_judgments_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."quick_code_judgments_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."quick_codes_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."quick_codes_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."quick_codes_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_auth_event"("p_event" "text", "p_email" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_auth_event"("p_event" "text", "p_email" "text", "p_user_agent" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."record_auth_event"("p_event" "text", "p_email" "text", "p_user_agent" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_auth_event"("p_event" "text", "p_email" "text", "p_user_agent" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_maintenance_failure"("p_step" "text", "p_sqlstate" "text", "p_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_maintenance_failure"("p_step" "text", "p_sqlstate" "text", "p_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reject_case_law_import"("p_case_law_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_case_law_import"("p_case_law_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_case_law_import"("p_case_law_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reject_legislation_import"("p_statute_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_legislation_import"("p_statute_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_legislation_import"("p_statute_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."release_retained_assignments_on_matter_close"() TO "anon";
GRANT ALL ON FUNCTION "public"."release_retained_assignments_on_matter_close"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_retained_assignments_on_matter_close"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."relinquish_magistrate_court"("p_assignment_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."relinquish_magistrate_court"("p_assignment_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."relinquish_magistrate_court"("p_assignment_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."relinquish_preflight"("p_assignment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."relinquish_preflight"("p_assignment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."relinquish_preflight"("p_assignment_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_edge_function_run"("p_function" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_edge_function_run"("p_function" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_storage_cleanup_run"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_storage_cleanup_run"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_webhook_dispatch_run"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_webhook_dispatch_run"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_docket_assignment_identities"("p_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_docket_assignment_identities"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_docket_assignment_identities"("p_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_docket_assignment_identity"("p_assignment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_docket_assignment_identity"("p_assignment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_docket_assignment_identity"("p_assignment_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_docket_share_identities"("p_share_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_docket_share_identities"("p_share_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_docket_share_identities"("p_share_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_docket_share_identity"("p_share_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_docket_share_identity"("p_share_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_docket_share_identity"("p_share_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_docket_share_recipient"("p_docket_matter_id" "uuid", "p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_docket_share_recipient"("p_docket_matter_id" "uuid", "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_docket_share_recipient"("p_docket_matter_id" "uuid", "p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_item_share_recipient"("p_item_type" "text", "p_item_id" "uuid", "p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_item_share_recipient"("p_item_type" "text", "p_item_id" "uuid", "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_item_share_recipient"("p_item_type" "text", "p_item_id" "uuid", "p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."restore_docket_matter"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_docket_matter"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_docket_matter"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."retry_webhook_delivery"("p_outbox_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."retry_webhook_delivery"("p_outbox_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."retry_webhook_delivery"("p_outbox_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."return_unassigned_magistrate_to_requester"("p_profile_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."return_unassigned_magistrate_to_requester"("p_profile_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."return_unassigned_magistrate_to_requester"("p_profile_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reveal_webhook_secret"("p_endpoint_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reveal_webhook_secret"("p_endpoint_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reveal_webhook_secret"("p_endpoint_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."clerk_courts" TO "anon";
GRANT ALL ON TABLE "public"."clerk_courts" TO "authenticated";
GRANT ALL ON TABLE "public"."clerk_courts" TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_clerk_court_access"("p_assignment_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_clerk_court_access"("p_assignment_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_clerk_court_access"("p_assignment_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_scheduled_maintenance"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_scheduled_maintenance"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."schedule_docket_event_with_capacity"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_event_id" "uuid", "p_scheduled_time" time without time zone, "p_event_type" "text", "p_stage_at_event" "text", "p_outcome_at_event" "text", "p_orders_made_at_event" "text", "p_notes" "text", "p_location" "text", "p_event_status" "text", "p_category_id" "uuid", "p_acknowledge_override" boolean, "p_override_reason" "text", "p_expected_updated_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."schedule_docket_event_with_capacity"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_event_id" "uuid", "p_scheduled_time" time without time zone, "p_event_type" "text", "p_stage_at_event" "text", "p_outcome_at_event" "text", "p_orders_made_at_event" "text", "p_notes" "text", "p_location" "text", "p_event_status" "text", "p_category_id" "uuid", "p_acknowledge_override" boolean, "p_override_reason" "text", "p_expected_updated_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."schedule_docket_event_with_capacity"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_event_id" "uuid", "p_scheduled_time" time without time zone, "p_event_type" "text", "p_stage_at_event" "text", "p_outcome_at_event" "text", "p_orders_made_at_event" "text", "p_notes" "text", "p_location" "text", "p_event_status" "text", "p_category_id" "uuid", "p_acknowledge_override" boolean, "p_override_reason" "text", "p_expected_updated_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_bench_notes"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_bench_notes"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_bench_notes"("p_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_case_law"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_case_law"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_case_law"("p_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_case_law_scoped"("p_query" "text", "p_limit" integer, "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_tag_id" "uuid", "p_category_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_case_law_scoped"("p_query" "text", "p_limit" integer, "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_tag_id" "uuid", "p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_case_law_scoped"("p_query" "text", "p_limit" integer, "p_court_id" "uuid", "p_jurisdiction_id" "uuid", "p_tag_id" "uuid", "p_category_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_cases"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_cases"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_cases"("p_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_docket_matters"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_docket_matters"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_docket_matters"("p_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_judgments"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_judgments"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_judgments"("p_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_quick_codes"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_quick_codes"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_quick_codes"("p_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_statutes"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_statutes"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_statutes"("p_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_case_law_review_status"("p_case_law_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_case_law_review_status"("p_case_law_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_case_law_review_status"("p_case_law_id" "uuid", "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_docket_matter_next_date"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_category_id" "uuid", "p_acknowledge_override" boolean, "p_override_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_docket_matter_next_date"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_category_id" "uuid", "p_acknowledge_override" boolean, "p_override_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_docket_matter_next_date"("p_docket_matter_id" "uuid", "p_scheduled_date" "date", "p_category_id" "uuid", "p_acknowledge_override" boolean, "p_override_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_legislation_review_status"("p_statute_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_legislation_review_status"("p_statute_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_legislation_review_status"("p_statute_id" "uuid", "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_profile_active"("p_profile_id" "uuid", "p_active" boolean, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_profile_active"("p_profile_id" "uuid", "p_active" boolean, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_profile_active"("p_profile_id" "uuid", "p_active" boolean, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."shares_delete_for_parent"() TO "anon";
GRANT ALL ON FUNCTION "public"."shares_delete_for_parent"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."shares_delete_for_parent"() TO "service_role";



GRANT ALL ON FUNCTION "public"."shares_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."shares_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."shares_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."shares_item_must_exist"() TO "anon";
GRANT ALL ON FUNCTION "public"."shares_item_must_exist"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."shares_item_must_exist"() TO "service_role";



GRANT ALL ON FUNCTION "public"."shares_notify"() TO "anon";
GRANT ALL ON FUNCTION "public"."shares_notify"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."shares_notify"() TO "service_role";



GRANT ALL ON FUNCTION "public"."shares_prevent_docket_parent_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."shares_prevent_docket_parent_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."shares_prevent_docket_parent_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."shares_recipient_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."shares_recipient_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."statutes_created_by_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."statutes_created_by_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."statutes_created_by_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_clerk_access_request"("p_court_id" "uuid", "p_staff_id" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_clerk_access_request"("p_court_id" "uuid", "p_staff_id" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_clerk_access_request"("p_court_id" "uuid", "p_staff_id" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_magistrate_court_request"("p_court_id" "uuid", "p_staff_id" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_magistrate_court_request"("p_court_id" "uuid", "p_staff_id" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_magistrate_court_request"("p_court_id" "uuid", "p_staff_id" "text", "p_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_magistrate_court_occupies_primary_slot"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_magistrate_court_occupies_primary_slot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_magistrate_court_occupies_primary_slot"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."transfer_judgment_ownership"("p_judgment_id" "uuid", "p_to_profile_id" "uuid", "p_court_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_judgment_ownership"("p_judgment_id" "uuid", "p_to_profile_id" "uuid", "p_court_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_judgment_ownership"("p_judgment_id" "uuid", "p_to_profile_id" "uuid", "p_court_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."unlink_judgment_pins_on_court_end"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unlink_judgment_pins_on_court_end"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."unlink_judgment_pins_on_retained_end"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unlink_judgment_pins_on_retained_end"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."unlink_my_orphaned_judgment_pins"("p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unlink_my_orphaned_judgment_pins"("p_dry_run" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."unlink_my_orphaned_judgment_pins"("p_dry_run" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."unlink_orphaned_judgment_pins"("p_owner_id" "uuid", "p_court_id" "uuid", "p_docket_matter_id" "uuid", "p_reason" "text", "p_dry_run" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unlink_orphaned_judgment_pins"("p_owner_id" "uuid", "p_court_id" "uuid", "p_docket_matter_id" "uuid", "p_reason" "text", "p_dry_run" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."user_can_access_bench_note"("p_note_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_can_access_bench_note"("p_note_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_can_access_bench_note"("p_note_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_can_access_case"("p_case_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_can_access_case"("p_case_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_can_access_case"("p_case_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_bookmark_entity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_bookmark_entity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_audit_hash_chain"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_audit_hash_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_audit_hash_chain"() TO "service_role";



GRANT ALL ON FUNCTION "public"."webhook_signature"("p_secret" "text", "p_body" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."webhook_signature"("p_secret" "text", "p_body" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."webhook_signature"("p_secret" "text", "p_body" "text") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."audit_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."auth_event_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."auth_event_log" TO "authenticated";
GRANT ALL ON TABLE "public"."auth_event_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."auth_event_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."auth_event_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."auth_event_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."bench_note_tags" TO "anon";
GRANT ALL ON TABLE "public"."bench_note_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."bench_note_tags" TO "service_role";



GRANT ALL ON TABLE "public"."bench_notes" TO "anon";
GRANT ALL ON TABLE "public"."bench_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."bench_notes" TO "service_role";



GRANT ALL ON TABLE "public"."bookmarks" TO "anon";
GRANT ALL ON TABLE "public"."bookmarks" TO "authenticated";
GRANT ALL ON TABLE "public"."bookmarks" TO "service_role";



GRANT ALL ON TABLE "public"."case_law" TO "anon";
GRANT ALL ON TABLE "public"."case_law" TO "authenticated";
GRANT ALL ON TABLE "public"."case_law" TO "service_role";



GRANT ALL ON TABLE "public"."case_law_annotations" TO "anon";
GRANT ALL ON TABLE "public"."case_law_annotations" TO "authenticated";
GRANT ALL ON TABLE "public"."case_law_annotations" TO "service_role";



GRANT ALL ON TABLE "public"."case_law_tags" TO "anon";
GRANT ALL ON TABLE "public"."case_law_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."case_law_tags" TO "service_role";



GRANT ALL ON TABLE "public"."case_parties" TO "anon";
GRANT ALL ON TABLE "public"."case_parties" TO "authenticated";
GRANT ALL ON TABLE "public"."case_parties" TO "service_role";



GRANT ALL ON TABLE "public"."case_tags" TO "anon";
GRANT ALL ON TABLE "public"."case_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."case_tags" TO "service_role";



GRANT ALL ON TABLE "public"."cases" TO "anon";
GRANT ALL ON TABLE "public"."cases" TO "authenticated";
GRANT ALL ON TABLE "public"."cases" TO "service_role";



GRANT ALL ON TABLE "public"."comments" TO "anon";
GRANT ALL ON TABLE "public"."comments" TO "authenticated";
GRANT ALL ON TABLE "public"."comments" TO "service_role";



GRANT ALL ON TABLE "public"."court_non_sitting_days" TO "anon";
GRANT ALL ON TABLE "public"."court_non_sitting_days" TO "authenticated";
GRANT ALL ON TABLE "public"."court_non_sitting_days" TO "service_role";



GRANT ALL ON TABLE "public"."courts" TO "anon";
GRANT ALL ON TABLE "public"."courts" TO "authenticated";
GRANT ALL ON TABLE "public"."courts" TO "service_role";



GRANT ALL ON TABLE "public"."data_retention_policies" TO "anon";
GRANT ALL ON TABLE "public"."data_retention_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."data_retention_policies" TO "service_role";



GRANT ALL ON TABLE "public"."docket_callover_items" TO "anon";
GRANT ALL ON TABLE "public"."docket_callover_items" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_callover_items" TO "service_role";



GRANT ALL ON TABLE "public"."docket_callovers" TO "anon";
GRANT ALL ON TABLE "public"."docket_callovers" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_callovers" TO "service_role";



GRANT ALL ON TABLE "public"."docket_capacity_overrides" TO "anon";
GRANT ALL ON TABLE "public"."docket_capacity_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_capacity_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."docket_capacity_settings" TO "anon";
GRANT ALL ON TABLE "public"."docket_capacity_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_capacity_settings" TO "service_role";



GRANT ALL ON TABLE "public"."docket_event_calendar_links" TO "anon";
GRANT ALL ON TABLE "public"."docket_event_calendar_links" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_event_calendar_links" TO "service_role";



GRANT ALL ON TABLE "public"."docket_events" TO "anon";
GRANT ALL ON TABLE "public"."docket_events" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_events" TO "service_role";



GRANT ALL ON TABLE "public"."docket_matter_assignments" TO "anon";
GRANT ALL ON TABLE "public"."docket_matter_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_matter_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."docket_matter_case_law" TO "anon";
GRANT ALL ON TABLE "public"."docket_matter_case_law" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_matter_case_law" TO "service_role";



GRANT ALL ON TABLE "public"."docket_matter_categories" TO "anon";
GRANT ALL ON TABLE "public"."docket_matter_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_matter_categories" TO "service_role";



GRANT ALL ON TABLE "public"."docket_matter_judgments" TO "anon";
GRANT ALL ON TABLE "public"."docket_matter_judgments" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_matter_judgments" TO "service_role";



GRANT ALL ON TABLE "public"."docket_matter_parties" TO "anon";
GRANT ALL ON TABLE "public"."docket_matter_parties" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_matter_parties" TO "service_role";



GRANT ALL ON TABLE "public"."docket_matter_tags" TO "anon";
GRANT ALL ON TABLE "public"."docket_matter_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."docket_matter_tags" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."feature_flags" TO "anon";
GRANT ALL ON TABLE "public"."feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_flags" TO "service_role";



GRANT ALL ON TABLE "public"."import_batches" TO "anon";
GRANT ALL ON TABLE "public"."import_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."import_batches" TO "service_role";



GRANT ALL ON TABLE "public"."import_jobs" TO "anon";
GRANT ALL ON TABLE "public"."import_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."issue_reports" TO "anon";
GRANT ALL ON TABLE "public"."issue_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."issue_reports" TO "service_role";



GRANT ALL ON TABLE "public"."judgment_ownership_transfers" TO "service_role";
GRANT SELECT ON TABLE "public"."judgment_ownership_transfers" TO "authenticated";



GRANT ALL ON TABLE "public"."judgment_tags" TO "anon";
GRANT ALL ON TABLE "public"."judgment_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."judgment_tags" TO "service_role";



GRANT ALL ON TABLE "public"."judgment_versions" TO "anon";
GRANT ALL ON TABLE "public"."judgment_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."judgment_versions" TO "service_role";



GRANT ALL ON TABLE "public"."judgments" TO "anon";
GRANT ALL ON TABLE "public"."judgments" TO "authenticated";
GRANT ALL ON TABLE "public"."judgments" TO "service_role";



GRANT ALL ON TABLE "public"."legal_authority_courts" TO "anon";
GRANT ALL ON TABLE "public"."legal_authority_courts" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_authority_courts" TO "service_role";



GRANT ALL ON TABLE "public"."legal_case_categories" TO "anon";
GRANT ALL ON TABLE "public"."legal_case_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_case_categories" TO "service_role";



GRANT ALL ON TABLE "public"."legal_jurisdictions" TO "anon";
GRANT ALL ON TABLE "public"."legal_jurisdictions" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_jurisdictions" TO "service_role";



GRANT ALL ON TABLE "public"."legal_regional_groups" TO "anon";
GRANT ALL ON TABLE "public"."legal_regional_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_regional_groups" TO "service_role";



GRANT ALL ON TABLE "public"."legal_sources" TO "anon";
GRANT ALL ON TABLE "public"."legal_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_sources" TO "service_role";



GRANT ALL ON TABLE "public"."magisterial_districts" TO "anon";
GRANT ALL ON TABLE "public"."magisterial_districts" TO "authenticated";
GRANT ALL ON TABLE "public"."magisterial_districts" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."quick_code_case_law" TO "anon";
GRANT ALL ON TABLE "public"."quick_code_case_law" TO "authenticated";
GRANT ALL ON TABLE "public"."quick_code_case_law" TO "service_role";



GRANT ALL ON TABLE "public"."quick_code_docket_matters" TO "anon";
GRANT ALL ON TABLE "public"."quick_code_docket_matters" TO "authenticated";
GRANT ALL ON TABLE "public"."quick_code_docket_matters" TO "service_role";



GRANT ALL ON TABLE "public"."quick_code_judgments" TO "anon";
GRANT ALL ON TABLE "public"."quick_code_judgments" TO "authenticated";
GRANT ALL ON TABLE "public"."quick_code_judgments" TO "service_role";



GRANT ALL ON TABLE "public"."quick_codes" TO "anon";
GRANT ALL ON TABLE "public"."quick_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."quick_codes" TO "service_role";



GRANT ALL ON TABLE "public"."rpc_rate_limit_buckets" TO "service_role";



GRANT ALL ON TABLE "public"."shares" TO "anon";
GRANT ALL ON TABLE "public"."shares" TO "authenticated";
GRANT ALL ON TABLE "public"."shares" TO "service_role";



GRANT ALL ON TABLE "public"."stale_draft_notices" TO "service_role";



GRANT ALL ON TABLE "public"."statute_provisions" TO "anon";
GRANT ALL ON TABLE "public"."statute_provisions" TO "authenticated";
GRANT ALL ON TABLE "public"."statute_provisions" TO "service_role";



GRANT ALL ON TABLE "public"."statute_tags" TO "anon";
GRANT ALL ON TABLE "public"."statute_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."statute_tags" TO "service_role";



GRANT ALL ON TABLE "public"."statutes" TO "anon";
GRANT ALL ON TABLE "public"."statutes" TO "authenticated";
GRANT ALL ON TABLE "public"."statutes" TO "service_role";



GRANT ALL ON TABLE "public"."storage_cleanup_queue" TO "service_role";



GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_endpoints" TO "anon";
GRANT ALL ON TABLE "public"."webhook_endpoints" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_endpoints" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_outbox" TO "anon";
GRANT ALL ON TABLE "public"."webhook_outbox" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_outbox" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







