import type { UserRole } from "@/lib/constants"

export interface FeatureFlagRecord {
  key: string
  enabled: boolean
  rolloutPercentage: number
  courtIds: string[]
  roles: string[]
}

export interface FeatureFlagContext {
  userId: string
  role: UserRole | null
  courtIds: string[]
}

export const rolloutBucket = (userId: string, key: string) => {
  const seed = `${userId}:${key}`
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return hash % 100
}

export const isFeatureEnabled = (
  flag: FeatureFlagRecord | undefined,
  ctx: FeatureFlagContext,
) => {
  if (!flag || !flag.enabled) return false
  if (flag.roles.length > 0 && (ctx.role == null || !flag.roles.includes(ctx.role))) {
    return false
  }
  if (flag.courtIds.length > 0 && !ctx.courtIds.some((id) => flag.courtIds.includes(id))) {
    return false
  }
  if (flag.rolloutPercentage <= 0) return false
  if (flag.rolloutPercentage >= 100) return true
  return rolloutBucket(ctx.userId, flag.key) < flag.rolloutPercentage
}
