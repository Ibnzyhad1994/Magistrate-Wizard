import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import {
  extractCaseLawMetadata,
  extractLegislationHierarchy,
  findCaseLawDuplicates,
  findStatuteDuplicates,
  normalizeWhitespace,
  proposeTags,
  sha256File,
  sha256Text,
} from "@/lib/legal-extraction";
import { uploadDocumentToEntity } from "@/hooks/use-documents";
import { caseLawKeys } from "@/hooks/case-law/use-case-law";
import { legislationKeys } from "@/hooks/legislation/use-legislation";
import type { Json } from "@/types/database.types";

/**
 * Admin-only CRUD + orchestration over `import_jobs`/`import_batches`
 * (0055) and the transactional ingestion RPCs added in 0058
 * (`create_case_law_import`/`create_legislation_import`).
 *
 * Ingestion design (0058 repair of the 725045c "draft-row-first" flow):
 * the canonical `case_law`/`statutes` draft row, its `statute_provisions`
 * (Legislation only), and the audit `import_jobs` row -- INCLUDING the
 * bidirectional `import_job_id` back-link -- are created by ONE
 * transactional SECURITY DEFINER RPC call, not a sequence of independent
 * `supabase.from(...).insert()` calls. If the RPC raises, nothing is
 * written; there is no partial-draft-without-a-job or job-without-a-
 * backlink state possible from this flow.
 *
 * The ORIGINAL FILE (when supplied) is uploaded through the existing
 * secure `documents` Storage architecture (`uploadDocumentToEntity`,
 * private bucket, signed URLs only) as a SEPARATE step immediately after
 * the RPC returns a real id -- Storage cannot participate in a Postgres
 * transaction, so this is an honest, disclosed two-step boundary, not a
 * false claim of end-to-end atomicity. If the RPC succeeds but the
 * upload fails, the draft/job still exist (nothing is silently lost) and
 * the failure is surfaced to the caller/toast rather than swallowed; the
 * curator can attach the original from the Review Queue afterward.
 *
 * No AI is involved anywhere in this file. Automatic PDF/DOCX TEXT
 * extraction is NOT implemented -- see legal-extraction.ts header. The
 * curator supplies document text (pasted, or auto-read for .txt uploads)
 * separately from the original file upload; the two are never conflated.
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
        uploaded_document_id: string | null;
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
  file: File | null;
  source_url: string | null;
  source_id: string | null;
  original_filename: string | null;
  batch_id: string | null;
  /** Curator-supplied minimum fields; extraction proposes the rest but never overwrites what the curator explicitly typed. */
  known: {
    case_name?: string;
    citation: string;
    court: string;
    jurisdiction: string;
    court_id?: string | null;
    jurisdiction_id?: string | null;
  };
}

/**
 * Runs deterministic extraction + duplicate detection over supplied Case
 * Law text, then creates the canonical draft row + import_jobs row +
 * bidirectional link atomically via `create_case_law_import` (0058).
 * Uploads the original file (if supplied) to the secure documents Storage
 * architecture as a follow-up step. Returns the new case_law id so the
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
      // Prefer hashing the original file's bytes when one is attached (the
      // authoritative source); fall back to the pasted/typed text hash so a
      // PDF with no text yet still gets a real duplicate-detection signal
      // instead of silently having none.
      const hash = input.file ? await sha256File(input.file) : text ? await sha256Text(text) : null;

      const duplicates = hash || text
        ? await findCaseLawDuplicates({
            documentHash: hash ?? undefined,
            neutralCitation: proposed.neutral_citation,
            caseName: input.known.case_name ?? proposed.case_name,
            court: input.known.court,
          })
        : [];

      const { data, error } = await supabase.rpc("create_case_law_import", {
        p_case_name: input.known.case_name ?? proposed.case_name ?? "Untitled (pending review)",
        p_citation: input.known.citation,
        p_court: input.known.court,
        p_jurisdiction: input.known.jurisdiction,
        p_court_id: input.known.court_id ?? null,
        p_jurisdiction_id: input.known.jurisdiction_id ?? null,
        p_neutral_citation: proposed.neutral_citation ?? null,
        p_reported_citation: proposed.reported_citation ?? null,
        p_decided_date: proposed.decided_date_guess ?? null,
        p_full_text: text || null,
        p_source_url: input.source_url,
        p_source_id: input.source_id,
        p_original_filename: input.original_filename,
        p_document_hash: hash,
        p_batch_id: input.batch_id,
        p_extracted_metadata: proposed as unknown as Json,
        p_proposed_tags: tags,
        p_duplicate_warning:
          duplicates.length > 0
            ? duplicates.map((d) => `${d.strength}: ${d.reason} (${d.existingLabel})`).join(" | ")
            : null,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("create_case_law_import did not return an id.");

      let uploadError: string | null = null;
      if (input.file) {
        try {
          const doc = await uploadDocumentToEntity("case_law", row.case_law_id, input.file);
          const { error: linkError } = await supabase
            .from("import_jobs")
            .update({ uploaded_document_id: doc.id })
            .eq("id", row.import_job_id);
          if (linkError) throw linkError;
        } catch (e) {
          uploadError = getErrorMessage(e);
        }
      }

      return {
        caseLawId: row.case_law_id as string,
        duplicates,
        proposedTags: tags,
        uploadError,
      };
    },
    onSuccess: (result) => {
      if (result.uploadError) {
        toast.warning(
          `Draft created, but the original file could not be uploaded: ${result.uploadError}. Attach it again from the Review Queue.`,
        );
      } else if (result.duplicates.length > 0) {
        toast.warning(
          `Draft created with ${result.duplicates.length} possible duplicate warning(s) — review before publishing.`,
        );
      } else {
        toast.success("Draft created — sent to Review Queue.");
      }
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

interface IngestLegislationInput {
  text: string;
  file: File | null;
  source_url: string | null;
  source_id: string | null;
  original_filename: string | null;
  batch_id: string | null;
  known: {
    code: string;
    title: string;
    jurisdiction: string;
    short_title?: string;
    jurisdiction_id?: string | null;
  };
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
      const provisions = text ? extractLegislationHierarchy(text) : [];
      const tags = proposeTags(text);
      const hash = input.file ? await sha256File(input.file) : text ? await sha256Text(text) : null;

      const duplicates = hash || text
        ? await findStatuteDuplicates({
            documentHash: hash ?? undefined,
            title: input.known.title,
            jurisdiction: input.known.jurisdiction,
          })
        : [];

      const { data, error } = await supabase.rpc("create_legislation_import", {
        p_code: input.known.code,
        p_title: input.known.title,
        p_jurisdiction: input.known.jurisdiction,
        p_jurisdiction_id: input.known.jurisdiction_id ?? null,
        p_short_title: input.known.short_title ?? null,
        p_full_text: text || null,
        p_source_url: input.source_url,
        p_source_id: input.source_id,
        p_original_filename: input.original_filename,
        p_document_hash: hash,
        p_batch_id: input.batch_id,
        p_extracted_metadata: { provisionCount: provisions.length } as unknown as Json,
        p_proposed_tags: tags,
        p_duplicate_warning:
          duplicates.length > 0
            ? duplicates.map((d) => `${d.strength}: ${d.reason} (${d.existingLabel})`).join(" | ")
            : null,
        p_provisions: provisions.map((p) => ({
          level: p.level,
          number: p.number,
          heading: p.heading,
          body_text: p.body_text,
          sort_order: p.sort_order,
        })) as unknown as Json,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("create_legislation_import did not return an id.");

      let uploadError: string | null = null;
      if (input.file) {
        try {
          const doc = await uploadDocumentToEntity("statute", row.statute_id, input.file);
          const { error: linkError } = await supabase
            .from("import_jobs")
            .update({ uploaded_document_id: doc.id })
            .eq("id", row.import_job_id);
          if (linkError) throw linkError;
        } catch (e) {
          uploadError = getErrorMessage(e);
        }
      }

      return {
        statuteId: row.statute_id as string,
        duplicates,
        proposedTags: tags,
        provisionCount: row.provision_count as number,
        uploadError,
      };
    },
    onSuccess: (result) => {
      if (result.uploadError) {
        toast.warning(
          `Draft created (${result.provisionCount} provisions), but the original file could not be uploaded: ${result.uploadError}. Attach it again from the Review Queue.`,
        );
      } else if (result.duplicates.length > 0) {
        toast.warning(
          `Draft created (${result.provisionCount} provisions) with ${result.duplicates.length} possible duplicate warning(s) — review before publishing.`,
        );
      } else {
        toast.success(`Draft created with ${result.provisionCount} provisions — sent to Review Queue.`);
      }
      void queryClient.invalidateQueries({ queryKey: legislationKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}
