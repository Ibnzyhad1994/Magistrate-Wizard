import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import { uploadDocumentToEntity } from "@/hooks/use-documents";
import { assertFileContentMatchesKind } from "@/lib/ingest-source";
import { docketMattersKeys } from "@/hooks/docket/use-docket-matters";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

export const IDENTIFICATION_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

export async function assertIdentificationImage(file: File) {
  if (!IMAGE_TYPES.has(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error("Use a JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Images must be 5 MB or smaller.");
  }
  await assertFileContentMatchesKind(file);
}

const partiesKey = (matterId: string) => ["docket-parties", matterId] as const;

function invalidateMatterImagery(queryClient: ReturnType<typeof useQueryClient>, matterId: string) {
  void queryClient.invalidateQueries({ queryKey: docketMattersKeys.all });
  void queryClient.invalidateQueries({ queryKey: docketMattersKeys.detail(matterId) });
  void queryClient.invalidateQueries({ queryKey: partiesKey(matterId) });
  void queryClient.invalidateQueries({ queryKey: ["documents", "docket_matter", matterId] });
  void queryClient.invalidateQueries({ queryKey: ["signed-urls"] });
}

export function useSetMatterCover(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      assertIdentificationImage(file);
      const doc = await uploadDocumentToEntity("docket_matter", matterId, file, "cover");
      const { error } = await supabase
        .from("docket_matters")
        .update({ cover_image_path: doc.file_path })
        .eq("id", matterId);
      if (error) throw error;
      return doc;
    },
    onSuccess: () => {
      toast.success("Cover image saved.");
      invalidateMatterImagery(queryClient, matterId);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useClearMatterCover(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("docket_matters")
        .update({ cover_image_path: null })
        .eq("id", matterId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cover image removed.");
      invalidateMatterImagery(queryClient, matterId);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useSetPartyPhoto(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ partyId, file }: { partyId: string; file: File }) => {
      assertIdentificationImage(file);
      const doc = await uploadDocumentToEntity(
        "docket_matter",
        matterId,
        file,
        "identification_photo",
      );
      const { error: partyError } = await supabase
        .from("docket_matter_parties")
        .update({ identification_photo_path: doc.file_path })
        .eq("id", partyId);
      if (partyError) throw partyError;

      const { data: matter, error: matterError } = await supabase
        .from("docket_matters")
        .select("cover_image_path")
        .eq("id", matterId)
        .maybeSingle();
      if (matterError) throw matterError;
      if (!matter?.cover_image_path) {
        await supabase
          .from("docket_matters")
          .update({ cover_image_path: doc.file_path })
          .eq("id", matterId);
      }
      return doc;
    },
    onSuccess: () => {
      toast.success("Identification photo saved.");
      invalidateMatterImagery(queryClient, matterId);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useClearPartyPhoto(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (partyId: string) => {
      const { error } = await supabase
        .from("docket_matter_parties")
        .update({ identification_photo_path: null })
        .eq("id", partyId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Identification photo removed.");
      invalidateMatterImagery(queryClient, matterId);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}
