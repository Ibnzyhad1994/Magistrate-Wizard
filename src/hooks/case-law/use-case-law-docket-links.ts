import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

/**
 * Case-Law-initiated side of the existing `docket_matter_case_law`
 * association table (0030) — the Docket-initiated read side already
 * lived in `src/hooks/docket/use-docket-links.ts` (`useLinkedCaseLaw`),
 * but there was previously no way to CREATE a link from the Case Law
 * entry itself, and no way to see which Docket Matters cite this
 * authority. No schema/RLS change: the live INSERT policy already
 * requires lawful Docket access (current Court assignment OR retained
 * assignment) AND Case-Law read access, and the live DELETE policy uses
 * the identical predicate — both enforced entirely server-side. This
 * file only adds the missing frontend read/write surface for the
 * Case-Law side of that already-applied table.
 */

export interface LinkedDocketMatter {
  id: string;
  created_at: string;
  docket_matter_id: string;
  docket_matters: {
    id: string;
    matter_title: string;
    case_number: string;
    status: string | null;
  } | null;
}

const key = (caseLawId: string) => ["case-law-linked-matters", caseLawId] as const;

/** Every Docket Matter currently linked to this Case Law entry as authority. */
export function useCaseLawLinkedMatters(caseLawId: string | undefined) {
  return useQuery({
    queryKey: key(caseLawId ?? ""),
    queryFn: async (): Promise<LinkedDocketMatter[]> => {
      const { data, error } = await supabase
        .from("docket_matter_case_law")
        .select(
          "id, created_at, docket_matter_id, docket_matters(id, matter_title, case_number, status)",
        )
        .eq("case_law_id", caseLawId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!caseLawId,
  });
}

/**
 * Link this Case Law entry to a Docket Matter as authority. The actual
 * authority is the live `docket_matter_case_law` INSERT policy — lawful
 * Docket access (Court or retained) on the chosen matter AND Case-Law
 * read access on this entry, both re-checked server-side regardless of
 * what the picker offered.
 */
export function useCreateCaseLawDocketLink(caseLawId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (docketMatterId: string) => {
      const { error } = await supabase.from("docket_matter_case_law").insert({
        case_law_id: caseLawId,
        docket_matter_id: docketMatterId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, docketMatterId) => {
      toast.success("Linked to Docket Matter.");
      void queryClient.invalidateQueries({ queryKey: key(caseLawId) });
      // Lets the Docket Matter's own Case Law tab (a separate query key,
      // `docket-linked-case-law`) reflect this immediately if the user
      // has that matter cached/open rather than waiting for its own
      // next natural refetch.
      void queryClient.invalidateQueries({
        queryKey: ["docket-linked-case-law", docketMatterId],
      });
    },
  });
}

/**
 * Unlink a Docket Matter from this Case Law entry — deletes only the
 * association row. Neither the Docket Matter nor the Case Law record is
 * touched. Same predicate as creation (Docket access AND Case-Law read
 * access) governs who may unlink, per the live DELETE policy.
 */
export function useDeleteCaseLawDocketLink(caseLawId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { linkId: string; docketMatterId: string }) => {
      const { error } = await supabase
        .from("docket_matter_case_law")
        .delete()
        .eq("id", input.linkId);
      if (error) throw error;
      return input;
    },
    onSuccess: ({ docketMatterId }) => {
      toast.success("Unlinked from Docket Matter.");
      void queryClient.invalidateQueries({ queryKey: key(caseLawId) });
      void queryClient.invalidateQueries({
        queryKey: ["docket-linked-case-law", docketMatterId],
      });
    },
  });
}
