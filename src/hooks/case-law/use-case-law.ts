import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";

export const caseLawKeys = {
  all: ["case-law"] as const,
  detail: (id: string) => ["case-law", "detail", id] as const,
  reviewQueue: ["case-law", "review-queue"] as const,
};

// Mirrors importJobKeys.all in use-import-jobs.ts (not imported directly --
// that module imports caseLawKeys FROM this one, and a circular import back
// here for one literal array isn't worth the fragility).
const importJobsQueryKey = ["import-jobs"] as const;

/**
 * Every Case Law row the caller can currently see — canonical (owner_id
 * IS NULL), their own personal research, and other magistrates' research
 * marked discoverable. RLS enforces this transparently; split into
 * Canonical / My Research / Discoverable tabs client-side, same pattern
 * as `useJudgments`.
 *
 * Canonical rows still being ingested (review_status is 'draft' or
 * 'needs_review') are deliberately excluded here — an admin's in-progress
 * import must not appear in the ordinary browse/search experience before
 * it is published. Those rows are surfaced separately via
 * `useCaseLawReviewQueue`. Personal research rows have review_status
 * 'published' by column default and are unaffected by this filter.
 */
/**
 * Court/Jurisdiction/Tag-scoped browse+search (0058 `search_case_law_scoped`)
 * — used by the Case Law Browse UI (§12/§25): "Case Law → Privy Council"
 * scopes results, then a text search within that scope stays scoped, and a
 * Tag filter combines with both. SECURITY INVOKER, so this only ever
 * returns rows the caller's own RLS already permits (same privacy
 * boundary as every other Case Law read) — filtering happens in the
 * database, not by fetching everything and filtering client-side.
 */
export function useCaseLawScopedSearch(params: {
  query: string;
  courtId: string | null;
  jurisdictionId: string | null;
  tagId: string | null;
}) {
  const active = !!params.query.trim() || !!params.courtId || !!params.jurisdictionId || !!params.tagId;
  return useQuery({
    queryKey: [
      "case-law-scoped-search",
      params.query.trim(),
      params.courtId,
      params.jurisdictionId,
      params.tagId,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_case_law_scoped", {
        p_query: params.query.trim() || null,
        p_court_id: params.courtId,
        p_jurisdiction_id: params.jurisdictionId,
        p_tag_id: params.tagId,
        p_limit: 200,
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled: active,
  });
}

export function useCaseLawList() {
  return useQuery({
    queryKey: caseLawKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_law")
        .select(
          "id, case_name, citation, court, jurisdiction, decided_date, is_discoverable, owner_id, review_status, updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).filter((row) => row.review_status === "published");
    },
  });
}

/**
 * Admin-only: canonical Case Law rows still in the ingestion pipeline
 * (draft or needs_review). RLS already restricts draft-row visibility to
 * admins (`can_view_case_law`), so this query naturally returns nothing
 * for a non-admin caller rather than erroring.
 *
 * `duplicate_warning` lives on `import_jobs`, not on `case_law` itself
 * (see 0055) — joined here via the `case_law.import_job_id` FK in a
 * single query (embedded select), not a second N+1 round trip per row.
 */
export function useCaseLawReviewQueue() {
  return useQuery({
    queryKey: caseLawKeys.reviewQueue,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_law")
        .select(
          "*, import_jobs!case_law_import_job_id_fkey(duplicate_warning, proposed_tags, uploaded_document_id, status, extracted_metadata, error_summary)",
        )
        .in("review_status", ["draft", "needs_review"])
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const job = row.import_jobs as unknown as {
          duplicate_warning: string | null;
          proposed_tags: string[] | null;
          uploaded_document_id: string | null;
          status: string;
          extracted_metadata: unknown;
          error_summary: string | null;
        } | null;
        return {
          ...row,
          duplicate_warning: job?.duplicate_warning ?? null,
          proposed_tags: job?.proposed_tags ?? [],
          uploaded_document_id: job?.uploaded_document_id ?? null,
          job_status: job?.status ?? null,
          extracted_metadata: job?.extracted_metadata ?? null,
          job_error_summary: job?.error_summary ?? null,
        };
      });
    },
  });
}

export function useCaseLawItem(id: string | undefined) {
  return useQuery({
    queryKey: caseLawKeys.detail(id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_law")
        .select("*")
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

interface CaseLawInput {
  case_name: string;
  citation: string;
  court: string;
  jurisdiction: string;
  decided_date: string | null;
  source_url: string | null;
  summary: string | null;
  full_text: string | null;
}

/** Always creates PERSONAL research (owner_id = caller) — see validations/case-law.ts. */
export function useCreatePersonalCaseLaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: CaseLawInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { data, error } = await supabase
        .from("case_law")
        .insert({ ...values, owner_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Research entry created.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
    },
  });
}

interface CanonicalCaseLawInput {
  case_name: string;
  citation: string;
  neutral_citation: string | null;
  reported_citation: string | null;
  court: string;
  jurisdiction: string;
  /** Canonical deciding-court/jurisdiction relationships (0058) — nullable, additive; `court`/`jurisdiction` free text above remains the display fallback whenever these are unset. Distinct from `source_id` (the SOURCE REPOSITORY the document came from, not the deciding court) -- never conflate the three. */
  court_id: string | null;
  jurisdiction_id: string | null;
  decided_date: string | null;
  judges: string | null;
  parties: string | null;
  issues: string | null;
  principles: string | null;
  key_passages: string | null;
  disposition: string | null;
  source_url: string | null;
  summary: string | null;
  full_text: string | null;
  source_id: string | null;
  original_filename: string | null;
  document_hash: string | null;
  retrieved_at: string | null;
  import_job_id: string | null;
}

/**
 * Admin-only: creates a CANONICAL (owner_id = null) Case Law row as a
 * draft, per the "draft-row-first" ingestion design — the real record is
 * created immediately so a source document can be attached to its actual
 * id via the existing `useDocuments`/`useUploadDocument` hooks unmodified,
 * with no later re-parenting step. Authorization is enforced by the
 * `case_law_ownership_guard` trigger (admin-only for owner_id IS NULL),
 * not merely by a client-side role check.
 */
export function useCreateCanonicalCaseLaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      values: Partial<CanonicalCaseLawInput> &
        Pick<CanonicalCaseLawInput, "case_name" | "citation" | "court" | "jurisdiction">,
    ) => {
      const { data, error } = await supabase
        .from("case_law")
        .insert({ ...values, owner_id: null, review_status: "draft" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Draft canonical Case Law record created.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.reviewQueue });
    },
  });
}

/** Admin-only: partial field edits during review (metadata correction before publish). */
export function useUpdateCanonicalCaseLaw(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<CanonicalCaseLawInput>) => {
      const { data, error } = await supabase
        .from("case_law")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Saved.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
    },
  });
}

/**
 * Admin-only: moves a draft/needs_review row through the review workflow.
 * 'published' is routed through the dedicated `publish_case_law_import`
 * RPC (0058), which atomically flips both case_law.review_status AND its
 * linked import_jobs.status -- previously these drifted independently
 * (the audit-confirmed §5 defect). The other three (draft/needs_review/
 * ready) go through `set_case_law_review_status` (0059), which keeps the
 * job's status in lockstep wherever the vocabularies overlap.
 */
export function useSetCaseLawReviewStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      review_status,
    }: {
      id: string;
      review_status: "draft" | "needs_review" | "ready" | "published";
    }) => {
      if (review_status === "published") {
        const { error } = await supabase.rpc("publish_case_law_import", {
          p_case_law_id: id,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc("set_case_law_review_status", {
        p_case_law_id: id,
        p_status: review_status,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.review_status === "published" ? "Published." : "Status updated.",
      );
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: importJobsQueryKey });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

/**
 * Admin-only: rejects a draft import via `reject_case_law_import` (0058),
 * which atomically reconciles the linked import_jobs row (status='failed',
 * error_summary set, target_case_law_id cleared) BEFORE deleting the
 * case_law row itself -- the previous implementation deleted the row
 * directly and never touched import_jobs, leaving it silently dangling
 * (the audit-confirmed §5/§3 defect). The caller must remove any attached
 * Storage object(s) FIRST (SQL cannot delete a Storage blob, only the
 * `documents` metadata row, which cascades automatically on this delete).
 */
export function useRejectCanonicalCaseLaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string | null }) => {
      // Remove any attached documents' Storage objects first -- the RPC's
      // cascade only removes the `documents` metadata row, never the
      // underlying blob (SQL cannot touch Storage; see use-documents.ts).
      const { data: docs, error: docsError } = await supabase
        .from("documents")
        .select("file_path")
        .eq("entity_type", "case_law")
        .eq("entity_id", id);
      if (docsError) throw docsError;
      if (docs && docs.length > 0) {
        const { error: removeError } = await supabase.storage
          .from("documents")
          .remove(docs.map((d) => d.file_path));
        if (removeError) {
          // Deliberately does not interpolate removeError.message -- that's
          // raw Supabase Storage API text, not something a curator should
          // ever see (Section 38: no raw internals in user-facing errors).
          console.error("Storage cleanup failed during case law rejection:", removeError);
          throw new Error(
            `Could not remove ${docs.length} attached file(s) from storage. The draft was left in place so nothing is silently lost -- retry rejection once storage cleanup succeeds.`,
          );
        }
      }

      const { error } = await supabase.rpc("reject_case_law_import", {
        p_case_law_id: id,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Draft rejected and removed.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: importJobsQueryKey });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

export function useUpdateCaseLawFields(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<CaseLawInput>) => {
      const { data, error } = await supabase
        .from("case_law")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Saved.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
    },
  });
}

export function useSetCaseLawDiscoverable(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (is_discoverable: boolean) => {
      const { error } = await supabase
        .from("case_law")
        .update({ is_discoverable })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Discoverability updated.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
    },
  });
}

/** Owner-only per RLS (canonical rows have no Delete control in this frontend — admin-only, out of scope here). */
export function useDeleteCaseLaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("case_law").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Research entry deleted.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
    },
  });
}
