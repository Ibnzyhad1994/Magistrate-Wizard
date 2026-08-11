import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";

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

export function useUploadDocument(entityType: string, entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${user.id}/${entityType}/${entityId}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("documents")
        .insert({
          uploaded_by: user.id,
          file_name: file.name,
          file_path: path,
          file_size: file.size,
          mime_type: file.type || "application/octet-stream",
          entity_type: entityType,
          entity_id: entityId,
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
    },
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

/** Signed URL for reading/downloading a document (private bucket). */
export async function getDocumentDownloadUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

export function useDeleteDocument(entityType: string, entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: { id: string; file_path: string }) => {
      const { error: storageError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove([doc.file_path]);
      if (storageError) {
        throw new Error(
          `Could not remove the file from storage (${storageError.message}). ` +
            "The document record was left in place — please retry.",
        );
      }
      const { error } = await supabase
        .from("documents")
        .delete()
        .eq("id", doc.id);
      if (error) throw error;
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
