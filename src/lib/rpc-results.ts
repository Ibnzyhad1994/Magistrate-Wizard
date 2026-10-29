import { z } from "@/lib/zod";
import { reportError } from "@/lib/sentry";
import { Constants, type Database } from "@/types/database.types";

/**
 * Runtime checks on what an RPC returns, at the data-access boundary.
 *
 * The generated types say what a function returned when the types were last
 * generated, and they call every RETURNS TABLE column non-null. Neither is
 * checked at run time, so a renamed or retyped column surfaced as an
 * `undefined` deep inside a component. Each schema below states the shape
 * the app relies on, with the nullability the SQL really has.
 *
 * A mismatch throws an RpcResultError in development and in tests, so it is
 * caught where it starts. In a production build it is reported (Sentry, or
 * the console) and the rows are passed through unchanged, so the screen
 * behaves exactly as it did before the check existed.
 */

type Functions = Database["public"]["Functions"];
type RpcName = keyof Functions;
type RpcReturns<N extends RpcName> = Functions[N]["Returns"];
type RowOf<N extends RpcName> = RpcReturns<N> extends (infer Row)[] ? Row : never;

/** One schema per returned column: a column added to or dropped from the
 * generated type without updating its schema fails to compile. */
type RowShape<N extends RpcName> = { [K in keyof RowOf<N>]-?: z.ZodType };

const rows = <N extends RpcName>(shape: RowShape<N>) => z.array(z.object(shape));

const env = (import.meta.env ?? {}) as Record<string, unknown>;

export class RpcResultError extends Error {
  readonly rpc: string;
  readonly issues: z.core.$ZodIssue[];

  constructor(rpc: string, issues: z.core.$ZodIssue[]) {
    const first = issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(result)"}: ${issue.message}`)
      .join("; ");
    super(`${rpc} returned an unexpected result (${issues.length} problem(s)): ${first}`);
    this.name = "RpcResultError";
    this.rpc = rpc;
    this.issues = issues;
  }
}

export interface CheckOptions {
  /** Throw on a mismatch. Defaults to true everywhere but a production build. */
  strict?: boolean;
}

/**
 * Checks `data` against `schema`. Returns `data` itself (never zod's copy),
 * so a passing check changes nothing.
 */
export function checkRpcResult<T>(
  rpc: string,
  schema: z.ZodType,
  data: T,
  options: CheckOptions = {},
): T {
  const result = schema.safeParse(data);
  if (result.success) return data;
  const error = new RpcResultError(rpc, result.error.issues);
  if (options.strict ?? env.PROD !== true) throw error;
  reportError(error, { source: "rpc-result", key: rpc, issues: result.error.issues.slice(0, 10) });
  return data;
}

// Any 8-4-4-4-12 hex id, as before; z.uuid() would also insist on RFC 9562 version bits.
const uuid = z.guid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date");
const timestamp = z.string().min(1);
const text = z.string();
const count = z.number().int();

const docketMatterStatus = z.enum(Constants.public.Enums.docket_matter_status);

export const RPC_RESULT_SCHEMAS = {
  // The docket board and the offline copy of it (0146).
  list_docket_matters: rows<"list_docket_matters">({
    id: uuid,
    case_number: text,
    matter_title: text,
    status: docketMatterStatus,
    charge_or_issue: text.nullable(),
    cover_image_path: text.nullable(),
    court_id: uuid,
    district_id: uuid,
    created_at: timestamp,
    updated_at: timestamp,
    court_name: text.nullable(),
    arraignment_status: text,
    custody_status: text,
    disclosure_status: text,
    trial_status: text,
    paper_committal_status: text,
    ruling_status: text,
    judgment_status: text,
    sentence_status: text,
    appeal_status: text,
    information_sworn_status: text,
    summons_served: text,
    returns_of_summons: text,
    civil_trial_held: text,
    decision_granted: text.nullable(),
    decision_amount: z.number().nullable(),
    stage_adjournments: z.unknown(),
    outcome_status: text.nullable(),
    outcome_adjourned: z.boolean(),
    workflow_protocol: text,
    procedure_stage: text,
    next_appearance: date.nullable(),
    can_edit: z.boolean(),
    has_ruling_document: z.boolean(),
    has_judgment_document: z.boolean(),
    appearance_status: text.nullable(),
    appearance_stage: text.nullable(),
    appearance_outcome: text.nullable(),
    category_id: uuid.nullable(),
    category_name: text.nullable(),
    category_other: text.nullable(),
    rank: z.number(),
    headline: text.nullable(),
  }),
  // Docket search (0145, 0171).
  search_docket_matters: rows<"search_docket_matters">({
    id: uuid,
    case_number: text,
    matter_title: text,
    status: docketMatterStatus,
    rank: z.number(),
    headline: text.nullable(),
    cover_image_path: text.nullable(),
    charge_or_issue: text.nullable(),
    arraignment_status: text,
    custody_status: text,
    disclosure_status: text,
    trial_status: text,
    ruling_status: text,
    judgment_status: text,
    sentence_status: text,
    appeal_status: text,
    procedure_stage: text,
  }),
  // The board's capacity tiles (0163).
  get_docket_capacity_snapshot: rows<"get_docket_capacity_snapshot">({
    category_id: uuid.nullable(),
    category_name: text.nullable(),
    daily_capacity: count.nullable(),
    scheduled_count: count.nullable(),
    status: text.nullable(),
    total_matters_count: count.nullable(),
  }),
  // Next date (0163): the booking result, and the suggested day (null when
  // nothing is free in range).
  set_docket_matter_next_date: rows<"set_docket_matter_next_date">({
    status: text,
    event_id: uuid.nullable(),
    category_id: uuid.nullable(),
    category_name: text.nullable(),
    configured_capacity: count.nullable(),
    scheduled_count: count.nullable(),
    is_over_capacity: z.boolean().nullable(),
  }),
  find_next_available_docket_date: date.nullable(),
  // The search page (0172): the search_result composite.
  global_search: z.array(
    z.object({
      entity_type: z.enum([
        "case",
        "bench_note",
        "statute",
        "case_law",
        "docket_matter",
        "judgment",
        "quick_code",
      ]),
      id: uuid,
      title: text.nullable(),
      subtitle: text.nullable(),
      headline: text.nullable(),
      rank: z.number(),
    } satisfies Record<keyof RowOf<"global_search">, z.ZodType>),
  ),
  // Case Law browse (0171).
  search_case_law_scoped: rows<"search_case_law_scoped">({
    id: uuid,
    case_name: text,
    citation: text,
    court: text,
    jurisdiction: text,
    summary: text.nullable(),
    rank: z.number(),
    headline: text.nullable(),
  }),
} satisfies Partial<Record<RpcName, z.ZodType>>;

export type CheckedRpc = keyof typeof RPC_RESULT_SCHEMAS;

/** `checkRpcResult` with the schema registered for `rpc`. */
export function checkRpc<N extends CheckedRpc, T>(rpc: N, data: T, options?: CheckOptions): T {
  return checkRpcResult(rpc, RPC_RESULT_SCHEMAS[rpc], data, options);
}

/** The module-scoped search RPCs (use-scoped-search.ts) only use each row's id. */
export const searchIdRowsSchema = z.array(z.object({ id: uuid }));
