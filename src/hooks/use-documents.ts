import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import { resolveStoredMimeType } from "@/lib/ingest-source";

const key = (entityType: string, entityId: string) =>
  ["documents", entityType, entityId] as const;

const DOCUMENTS_BUCKET = "documents";

/**
 * Shared attachment layer for every polymorphic Document parent
 * (`entity_type`/`entity_id` — docket_matter, judgment, case_law,
 * quick_code, bench_note). One implementation instead of duplicating
 * upload/list/delete logic per feature area. Deletion order is
 * Storage-API-first, then the `public.documents` metadata row — per the
 * 0049 resolution, direct SQL deletion of a storage object orphans the
 * physical blob, so the Storage API call must happen first and the
 * metadata row is only removed once that succeeds. If Storage removal
 * fails, the metadata row is deliberately left in place (the document
 * stays visible/re-deletable) rather than silently orphaning it.
 */
export function useDocuments(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: key(entityType, entityId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!entityId,
  });
}

/**
 * Core upload implementation, extracted so it can be called from contexts
 * that don't know the target `entityId` until runtime (e.g. the Legal
 * Library "draft-row-first" ingestion flow, which must create the
 * `case_law`/`statutes` row via a transactional RPC FIRST to obtain a real
 * id, then attach the original file to that real id) as well as from the
 * `useUploadDocument` hook below, which is used everywhere the entityId is
 * already known at render time. Same upload-then-insert-then-cleanup-on-
 * failure behavior in both cases -- no divergence between the two paths.
 */
export async function uploadDocumentToEntity(
  entityType: string,
  entityId: string,
  file: File,
  purpose: "attachment" | "cover" | "identification_photo" = "attachment",
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${user.id}/${entityType}/${entityId}/${Date.now()}-${safeName}`;

  const mimeType = await resolveStoredMimeType(file)
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { upsert: false, contentType: mimeType });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("documents")
    .insert({
      uploaded_by: user.id,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: mimeType,
      entity_type: entityType,
      entity_id: entityId,
      purpose,
    })
    .select()
    .single();
  if (error) {
    // Metadata insert failed after a successful storage upload — clean
    // up the now-unreferenced blob rather than leaving it orphaned.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    throw error;
  }
  return data;
}

export function useUploadDocument(entityType: string, entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => uploadDocumentToEntity(entityType, entityId, file),
    onSuccess: () => {
      toast.success("Document uploaded.");
      void queryClient.invalidateQueries({
        queryKey: key(entityType, entityId),
      });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

/**
 * Download through the authenticated Storage API so RLS is re-checked on
 * every request. Callers that need a URL should create a blob: object URL
 * and revoke it when finished — signed URLs stay valid after access is
 * revoked, which this path avoids.
 */
export async function downloadDocumentBlob(filePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(filePath);
  if (error || !data) throw error ?? new Error("Could not download this file.");
  return data;
}

/** Object URL for a one-shot download. Caller must revoke the URL. */
export async function getDocumentDownloadUrl(filePath: string): Promise<string> {
  const blob = await downloadDocumentBlob(filePath);
  return URL.createObjectURL(blob);
}

/** Download the stored original as a File (Review Queue reprocess). */
export async function downloadDocumentAsFile(documentId: string): Promise<File> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("file_name, file_path, mime_type")
    .eq("id", documentId)
    .single();
  if (error) throw error;
  if (!doc?.file_path) throw new Error("Original file is missing from storage.");
  const { data: blob, error: downloadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(doc.file_path);
  if (downloadError || !blob) throw downloadError ?? new Error("Could not download the original file.");
  return new File([blob], doc.file_name || "original.pdf", {
    type: doc.mime_type || blob.type || "application/pdf",
  });
}

/**
 * In-app view URL. Uses an authenticated download + blob: URL so the
 * bytes are not handed out as a shareable signed URL that outlives RLS.
 * Caller must revoke the object URL when the viewer closes.
 */
export async function getDocumentViewUrl(filePath: string): Promise<string> {
  return getDocumentDownloadUrl(filePath);
}

export function useDeleteDocument(entityType: string, entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: { id: string; file_path: string }) => {
      const { error: storageError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove([doc.file_path]);
      if (storageError) {
        // Deliberately does not interpolate storageError.message -- that's
        // raw Supabase Storage API text, not something a user should ever
        // see (Section 38: no raw internals in user-facing errors).
        console.error("Storage removal failed while deleting document:", storageError);
        throw new Error(
          "Could not remove the file from storage. The document record was left in place — please retry.",
        );
      }
      const { error } = await supabase
        .from("documents")
        .delete()
        .eq("id", doc.id);
      if (error) {
        // The blob is already gone from Storage at this point — don't let
        // the UI imply nothing happened. This is a genuine partial
        // failure, not a full success or a full no-op.
        throw new Error(
          `The file was removed from storage, but its record couldn't be cleaned up (${getErrorMessage(error)}). Refresh — if it still appears, it's now a broken link and can be safely deleted again.`,
        );
      }
    },
    onSuccess: () => {
      toast.success("Document deleted.");
      void queryClient.invalidateQueries({
        queryKey: key(entityType, entityId),
      });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}
