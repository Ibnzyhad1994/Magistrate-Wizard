import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

export const caseLawKeys = {
  all: ["case-law"] as const,
  detail: (id: string) => ["case-law", "detail", id] as const,
  reviewQueue: ["case-law", "review-queue"] as const,
};

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
        .select("*, import_jobs!case_law_import_job_id_fkey(duplicate_warning)")
        .in("review_status", ["draft", "needs_review"])
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        duplicate_warning:
          (row.import_jobs as unknown as { duplicate_warning: string | null } | null)
            ?.duplicate_warning ?? null,
      }));
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

/** Admin-only: moves a draft/needs_review row through the review workflow, or rejects it (delete). */
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
      const { error } = await supabase
        .from("case_law")
        .update({ review_status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.review_status === "published" ? "Published." : "Status updated.",
      );
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.detail(variables.id) });
    },
  });
}

/** Admin-only: rejects (permanently deletes) a draft import that should not become canonical. */
export function useRejectCanonicalCaseLaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("case_law").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Draft rejected and removed.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.reviewQueue });
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
