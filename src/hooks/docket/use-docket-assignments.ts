import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

const key = (matterId: string) => ["docket-assignments", matterId] as const;

export interface ResolvedAssignment {
  id: string;
  reason: string;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  profile_id: string | null;
  display_name: string | null;
}

/**
 * Retained-assignment context for a Docket Matter. Per the live
 * `docket_matter_assignments` INSERT policy (0022, unchanged): this is
 * SELF-retention only — `profile_id = auth.uid() AND granted_by =
 * auth.uid()`, and only while the caller currently has ordinary Court
 * access to the matter's court. There is no "grant retained access to
 * someone else" workflow in the backend, so none is built here.
 * `reason` is fixed to `'retained_part_heard'` by a live CHECK
 * constraint (the only value the column currently allows). Identity is
 * resolved via `resolve_docket_assignment_identity()` rather than a
 * broad `profiles` SELECT.
 */
export function useDocketAssignments(matterId: string | undefined) {
  return useQuery({
    queryKey: key(matterId ?? ""),
    queryFn: async (): Promise<ResolvedAssignment[]> => {
      const { data: assignments, error } = await supabase
        .from("docket_matter_assignments")
        .select("id, reason, started_at, ended_at, notes, profile_id")
        .eq("docket_matter_id", matterId as string)
        .order("started_at", { ascending: false });
      if (error) throw error;
      if (!assignments || assignments.length === 0) return [];

      const resolved = await Promise.all(
        assignments.map(async (a) => {
          const { data: identity, error: identityError } = await supabase.rpc(
            "resolve_docket_assignment_identity",
            { p_assignment_id: a.id },
          );
          if (identityError) throw identityError;
          return {
            ...a,
            display_name: identity?.[0]?.display_name ?? null,
          };
        }),
      );
      return resolved;
    },
    enabled: !!matterId,
  });
}

/** Self-retain: create the caller's own retained assignment on this matter. */
export function useCreateRetainedAssignment(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notes: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { error } = await supabase.from("docket_matter_assignments").insert({
        docket_matter_id: matterId,
        profile_id: user.id,
        granted_by: user.id,
        reason: "retained_part_heard",
        notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Matter retained.");
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
  });
}

/** End the caller's own retained assignment (RLS permits ending only your own). */
export function useEndRetainedAssignment(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from("docket_matter_assignments")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Retained assignment ended.");
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
  });
}
