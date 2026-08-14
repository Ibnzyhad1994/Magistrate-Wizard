import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const docketMatterAccessKeys = {
  detail: (matterId: string) => ["docket-matter-access", matterId] as const,
};

export interface DocketMatterAccess {
  /** Court assignment or retained/part-heard — never share. Gates retain, new shares, and pinning judgments/case law. */
  canManage: boolean;
  /** Court, retained, or an active edit share. Gates ordinary matter mutations. */
  canEdit: boolean;
}

/**
 * Live authority for one Docket Matter, from the same RPCs the RLS
 * policies use. Defaults to neither capability until the query resolves,
 * so view-share chrome never flashes write controls.
 */
export function useDocketMatterAccess(matterId: string | undefined) {
  return useQuery({
    queryKey: docketMatterAccessKeys.detail(matterId ?? ""),
    queryFn: async (): Promise<DocketMatterAccess> => {
      const id = matterId as string;
      const [authority, canEdit] = await Promise.all([
        supabase.rpc("has_docket_matter_authority", { p_docket_matter_id: id }),
        supabase.rpc("can_edit_docket_matter", { p_docket_matter_id: id }),
      ]);
      if (authority.error) throw authority.error;
      if (canEdit.error) throw canEdit.error;
      return {
        canManage: Boolean(authority.data),
        canEdit: Boolean(canEdit.data),
      };
    },
    enabled: !!matterId,
  });
}
