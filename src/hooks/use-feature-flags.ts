import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups"
import {
  isFeatureEnabled,
  type FeatureFlagRecord,
} from "@/lib/feature-flags"
import type { UserRole } from "@/lib/constants"
import type { Tables } from "@/types/database.types"

export const featureFlagKeys = {
  all: ["feature-flags"] as const,
}

const asFlag = (row: Tables<"feature_flags">): FeatureFlagRecord => ({
  key: row.key,
  enabled: row.enabled,
  rolloutPercentage: row.rollout_percentage,
  courtIds: row.court_ids ?? [],
  roles: row.roles ?? [],
})

export function useFeatureFlags() {
  return useQuery({
    queryKey: featureFlagKeys.all,
    queryFn: async (): Promise<FeatureFlagRecord[]> => {
      const { data, error } = await supabase
        .from("feature_flags")
        .select("key, enabled, rollout_percentage, court_ids, roles, description")
        .order("key")
      if (error) throw error
      return (data ?? []).map((row) => asFlag(row as Tables<"feature_flags">))
    },
    staleTime: 60_000,
  })
}

export function useFeatureFlag(key: string) {
  const { user, profile } = useAuth()
  const { data: courts } = useMyCurrentCourts()
  const flags = useFeatureFlags()
  const flag = flags.data?.find((item) => item.key === key)
  const enabled = isFeatureEnabled(flag, {
    userId: user?.id ?? "",
    role: (profile?.role as UserRole | undefined) ?? null,
    courtIds: (courts ?? []).map((court) => court.court_id),
  })
  return { ...flags, enabled, flag }
}

export function useUpdateFeatureFlag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { key: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("feature_flags")
        .update({ enabled: input.enabled })
        .eq("key", input.key)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: featureFlagKeys.all })
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not update that flag")
    },
  })
}
