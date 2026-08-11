import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  extractCaseLawMetadata,
  extractLegislationHierarchy,
  findCaseLawDuplicates,
  findStatuteDuplicates,
  normalizeWhitespace,
  proposeTags,
  sha256Text,
} from "@/lib/legal-extraction";
import { caseLawKeys } from "@/hooks/case-law/use-case-law";
import { legislationKeys } from "@/hooks/legislation/use-legislation";
import type { Json } from "@/types/database.types";

/**
 * Admin-only CRUD + orchestration over `import_jobs`/`import_batches`
 * (0055). The orchestration hooks (`useIngestCaseLaw`/`useIngestLegislation`)
 * implement the "draft-row-first" ingestion design: the real canonical
 * `case_law`/`statutes` row is created immediately as review_status='draft',
 * deterministic extraction (src/lib/legal-extraction.ts) runs against the
 * supplied text, and the results are written onto that SAME draft row plus
 * an audit `import_jobs` row pointing at it via target_case_law_id /
 * target_statute_id. "Publish" (see use-case-law.ts / use-legislation.ts
 * useSetCaseLawReviewStatus / useSetStatuteReviewStatus) is then a plain
 * review_status flip on the already-complete row -- there is no separate
 * copy-from-staging step.
 *
 * No AI is involved anywhere in this file. Text extraction from PDF/DOCX
 * is NOT automatic (see legal-extraction.ts header) -- the curator supplies
 * document text (pasted, or auto-read for .txt uploads) before calling
 * these hooks.
 */
export const importJobKeys = {
  all: ["import-jobs"] as const,
};

export function useImportJobs() {
  return useQuery({
    queryKey: importJobKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string;
      values: Partial<{
        status: string;
        error_summary: string | null;
        retry_count: number;
        completed_at: string | null;
      }>;
    }) => {
      const { error } = await supabase.from("import_jobs").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
  });
}

export function useDeleteImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("import_jobs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Import job removed.");
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
  });
}

interface IngestCaseLawInput {
  text: string;
  source_url: string | null;
  source_id: string | null;
  original_filename: string | null;
  batch_id: string | null;
  /** Curator-supplied minimum fields; extraction proposes the rest but never overwrites what the curator explicitly typed. */
  known: { case_name?: string; citation: string; court: string; jurisdiction: string };
}

/**
 * Runs deterministic extraction + duplicate detection over supplied Case
 * Law text, creates the canonical draft row, and records an audit
 * import_jobs row pointing at it. Returns the new case_law id so the
 * caller can navigate straight to the Review Queue detail for that item.
 */
export function useIngestCaseLaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: IngestCaseLawInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const text = normalizeWhitespace(input.text);
      const proposed = extractCaseLawMetadata(text);
      const tags = proposeTags(text);
      const hash = await sha256Text(text);

      const duplicates = await findCaseLawDuplicates({
        documentHash: hash,
        neutralCitation: proposed.neutral_citation,
        caseName: input.known.case_name ?? proposed.case_name,
        court: input.known.court,
      });

      const { data: draft, error: draftError } = await supabase
        .from("case_law")
        .insert({
          case_name: input.known.case_name ?? proposed.case_name ?? "Untitled (pending review)",
          citation: input.known.citation,
          neutral_citation: proposed.neutral_citation ?? null,
          reported_citation: proposed.reported_citation ?? null,
          court: input.known.court,
          jurisdiction: input.known.jurisdiction,
          decided_date: proposed.decided_date_guess ?? null,
          full_text: text,
          source_url: input.source_url,
          source_id: input.source_id,
          original_filename: input.original_filename,
          document_hash: hash,
          retrieved_at: new Date().toISOString(),
          owner_id: null,
          review_status: "needs_review",
        })
        .select()
        .single();
      if (draftError) throw draftError;

      const { error: jobError } = await supabase.from("import_jobs").insert({
        batch_id: input.batch_id,
        content_type: "case_law",
        source_id: input.source_id,
        source_url: input.source_url,
        status: "needs_review",
        target_case_law_id: draft.id,
        extracted_text: text,
        extracted_metadata: proposed as unknown as Json,
        proposed_tags: tags,
        duplicate_warning:
          duplicates.length > 0
            ? duplicates.map((d) => `${d.strength}: ${d.reason} (${d.existingLabel})`).join(" | ")
            : null,
        created_by: user.id,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      if (jobError) throw jobError;

      return { caseLawId: draft.id as string, duplicates, proposedTags: tags };
    },
    onSuccess: (result) => {
      if (result.duplicates.length > 0) {
        toast.warning(
          `Draft created with ${result.duplicates.length} possible duplicate warning(s) — review before publishing.`,
        );
      } else {
        toast.success("Draft created — sent to Review Queue.");
      }
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
  });
}

interface IngestLegislationInput {
  text: string;
  source_url: string | null;
  source_id: string | null;
  original_filename: string | null;
  batch_id: string | null;
  known: { code: string; title: string; jurisdiction: string; short_title?: string };
}

export function useIngestLegislation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: IngestLegislationInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const text = normalizeWhitespace(input.text);
      const provisions = extractLegislationHierarchy(text);
      const tags = proposeTags(text);
      const hash = await sha256Text(text);

      const duplicates = await findStatuteDuplicates({
        documentHash: hash,
        title: input.known.title,
        jurisdiction: input.known.jurisdiction,
      });

      const { data: draft, error: draftError } = await supabase
        .from("statutes")
        .insert({
          code: input.known.code,
          title: input.known.title,
          short_title: input.known.short_title ?? null,
          jurisdiction: input.known.jurisdiction,
          full_text: text,
          source_url: input.source_url,
          source_id: input.source_id,
          original_filename: input.original_filename,
          document_hash: hash,
          retrieved_at: new Date().toISOString(),
          review_status: "needs_review",
        })
        .select()
        .single();
      if (draftError) throw draftError;

      if (provisions.length > 0) {
        // Flat insert first (parent_provision_id left null — a line-based
        // parser cannot reliably infer nesting depth from indentation
        // alone across arbitrary source formatting). The curator can
        // re-parent provisions in the structured reader/editor if the
        // source has real Part > Section nesting; body text and numbering
        // are preserved exactly either way.
        const { error: provisionsError } = await supabase.from("statute_provisions").insert(
          provisions.map((p) => ({
            statute_id: draft.id,
            level: p.level,
            number: p.number,
            heading: p.heading,
            body_text: p.body_text,
            sort_order: p.sort_order,
          })),
        );
        if (provisionsError) throw provisionsError;
      }

      const { error: jobError } = await supabase.from("import_jobs").insert({
        batch_id: input.batch_id,
        content_type: "legislation",
        source_id: input.source_id,
        source_url: input.source_url,
        status: "needs_review",
        target_statute_id: draft.id,
        extracted_text: text,
        extracted_metadata: { provisionCount: provisions.length },
        proposed_tags: tags,
        duplicate_warning:
          duplicates.length > 0
            ? duplicates.map((d) => `${d.strength}: ${d.reason} (${d.existingLabel})`).join(" | ")
            : null,
        created_by: user.id,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      if (jobError) throw jobError;

      return {
        statuteId: draft.id as string,
        duplicates,
        proposedTags: tags,
        provisionCount: provisions.length,
      };
    },
    onSuccess: (result) => {
      if (result.duplicates.length > 0) {
        toast.warning(
          `Draft created (${result.provisionCount} provisions) with ${result.duplicates.length} possible duplicate warning(s) — review before publishing.`,
        );
      } else {
        toast.success(`Draft created with ${result.provisionCount} provisions — sent to Review Queue.`);
      }
      void queryClient.invalidateQueries({ queryKey: legislationKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
  });
}
