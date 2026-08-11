import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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
 * Retained/current-assignment context for a Docket Matter, read-only.
 * Identity is resolved via `resolve_docket_assignment_identity()` rather
 * than a broad `profiles` SELECT. Granting a new retained assignment is a
 * judicial-workflow action with its own authority rules that were not
 * specified for this milestone — display only for now.
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
