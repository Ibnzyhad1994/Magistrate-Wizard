import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { checkRpc } from "@/lib/rpc-results";
import type { JudgmentTransfer, RelinquishPreflight } from "@/lib/court-handover";
import { getErrorMessage } from "@/lib/utils";

export const courtHandoverKeys = {
  preflight: (assignmentId: string) => ["court-handover", "preflight", assignmentId] as const,
  bench: (courtId: string) => ["court-handover", "bench", courtId] as const,
  orphanPins: ["court-handover", "my-orphan-pins"] as const,
};

/**
 * What ending a court assignment leaves behind (relinquish_preflight, 0220):
 * part-heard matters not yet retained, and the judgment pins there, with
 * the ones that will be unlinked. Read-only; open to the assignment's
 * magistrate and to administrators, who get ids, statuses and dates only.
 * Errors are shown in the dialog (preflightErrorMessage), not toasted.
 */
export function useRelinquishPreflight(assignmentId: string | null) {
  return useQuery({
    queryKey: courtHandoverKeys.preflight(assignmentId ?? ""),
    queryFn: async (): Promise<RelinquishPreflight> => {
      const { data, error } = await supabase.rpc("relinquish_preflight", {
        p_assignment_id: assignmentId as string,
      });
      if (error) throw error;
      return checkRpc("relinquish_preflight", data) as RelinquishPreflight;
    },
    enabled: !!assignmentId,
    retry: false,
    meta: { silent: true },
  });
}

/**
 * Retain one part-heard matter from the pre-flight: the caller's own
 * retained assignment (the self-only `docket_matter_assignments` insert,
 * 0022), so they keep access after the court assignment ends.
 */
export function useRetainPartHeardMatter(assignmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (matterId: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { error } = await supabase.from("docket_matter_assignments").insert({
        docket_matter_id: matterId,
        profile_id: user.id,
        granted_by: user.id,
        reason: "retained_part_heard",
        notes: null,
      });
      if (error) throw error;
    },
    onSuccess: (_result, matterId) => {
      toast.success("Matter retained.");
      void queryClient.invalidateQueries({ queryKey: courtHandoverKeys.preflight(assignmentId) });
      void queryClient.invalidateQueries({ queryKey: ["docket-assignments", matterId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "my-retained-matters"] });
      void queryClient.invalidateQueries({ queryKey: ["docket-matters"] });
      void queryClient.invalidateQueries({ queryKey: ["docket-matter-access", matterId] });
    },
    meta: { silent: true },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export interface BenchMember {
  profileId: string;
  fullName: string;
}

/**
 * The court's bench now: active people with an open magistrate assignment
 * there, the only valid targets of a judgment transfer. Administrator-only
 * (it reads other people's assignments and names).
 */
export function useCourtBench(courtId: string | null) {
  return useQuery({
    queryKey: courtHandoverKeys.bench(courtId ?? ""),
    queryFn: async (): Promise<BenchMember[]> => {
      const { data: seats, error } = await supabase
        .from("magistrate_courts")
        .select("profile_id")
        .eq("court_id", courtId as string)
        .is("ended_at", null);
      if (error) throw error;
      const ids = [...new Set((seats ?? []).map((seat) => seat.profile_id))];
      if (ids.length === 0) return [];
      const { data: people, error: peopleError } = await supabase
        .from("profiles")
        .select("id, full_name, is_active")
        .in("id", ids)
        .eq("is_active", true)
        .order("full_name");
      if (peopleError) throw peopleError;
      return (people ?? []).map((person) => ({
        profileId: person.id,
        fullName: person.full_name || "Unnamed magistrate",
      }));
    },
    enabled: !!courtId,
  });
}

export interface TransferJudgmentInput {
  judgmentId: string;
  toProfileId: string;
  courtId: string;
  reason: string;
}

/**
 * An administrator moves a judgment to a magistrate sitting at the court
 * now (transfer_judgment_ownership, ADR 0011). Only `owner_id` changes; the
 * result holds ids only.
 */
export function useTransferJudgmentOwnership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TransferJudgmentInput): Promise<JudgmentTransfer> => {
      const { data, error } = await supabase.rpc("transfer_judgment_ownership", {
        p_judgment_id: input.judgmentId,
        p_to_profile_id: input.toProfileId,
        p_court_id: input.courtId,
        p_reason: input.reason.trim(),
      });
      if (error) throw error;
      return checkRpc("transfer_judgment_ownership", data) as JudgmentTransfer;
    },
    // The dialog shows the result and any refusal itself, so no toast.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["court-handover", "preflight"] });
    },
    meta: { silent: true },
  });
}

/**
 * The caller's judgment pins left on matters they can no longer open by
 * hand-overs before 0220. A dry run counts them; nothing changes.
 */
export function useMyOrphanPinCount(enabled = true) {
  return useQuery({
    queryKey: courtHandoverKeys.orphanPins,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("unlink_my_orphaned_judgment_pins", {
        p_dry_run: true,
      });
      if (error) throw error;
      return checkRpc("unlink_my_orphaned_judgment_pins", data);
    },
    enabled,
  });
}

/** Clear those pins; returns how many were removed. */
export function useUnlinkMyOrphanPins() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("unlink_my_orphaned_judgment_pins", {
        p_dry_run: false,
      });
      if (error) throw error;
      return checkRpc("unlink_my_orphaned_judgment_pins", data);
    },
    onSuccess: (removed) => {
      toast.success(removed === 1 ? "1 link removed." : `${removed} links removed.`);
      void queryClient.invalidateQueries({ queryKey: courtHandoverKeys.orphanPins });
    },
    meta: { silent: true },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}
