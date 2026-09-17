import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

const key = (matterId: string) => ["docket-assignments", matterId] as const;

interface AssignmentIdentityRow {
  assignment_id: string;
  profile_id: string | null;
  display_name: string | null;
}

/**
 * `resolve_docket_assignment_identities` (0155): one round trip for every
 * assignment on a matter instead of one RPC per row. Same SECURITY DEFINER
 * envelope and per-row docket-read predicate as the singular RPC.
 *
 * `src/types/database.types.ts` is generated from the live schema and does
 * not yet carry 0155, so the call is typed here; collapse this back to a
 * plain `supabase.rpc(...)` once `supabase gen types` is re-run.
 */
const resolveAssignmentIdentities = (ids: string[]) =>
  (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: AssignmentIdentityRow[] | null; error: { message: string } | null }>
  )("resolve_docket_assignment_identities", { p_ids: ids });

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
 * resolved via `resolve_docket_assignment_identities()` rather than a
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

      const { data: identities, error: identityError } = await resolveAssignmentIdentities(
        assignments.map((a) => a.id),
      );
      if (identityError) throw identityError;
      const byAssignment = new Map((identities ?? []).map((row) => [row.assignment_id, row]));
      return assignments.map((a) => ({
        ...a,
        display_name: byAssignment.get(a.id)?.display_name ?? null,
      }));
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
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "my-retained-matters"] });
      void queryClient.invalidateQueries({ queryKey: ["docket-matters"] });
      void queryClient.invalidateQueries({ queryKey: ["docket-matter-access", matterId] });
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
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "my-retained-matters"] });
      void queryClient.invalidateQueries({ queryKey: ["docket-matters"] });
      void queryClient.invalidateQueries({ queryKey: ["docket-matter-access", matterId] });
    },
  });
}
