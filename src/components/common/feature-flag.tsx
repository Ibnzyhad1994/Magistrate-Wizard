import type { ReactNode } from "react"
import { useFeatureFlag } from "@/hooks/use-feature-flags"

export function FeatureFlag({
  flag,
  children,
  fallback = null,
}: {
  flag: string
  children: ReactNode
  fallback?: ReactNode
}) {
  const { enabled, isPending } = useFeatureFlag(flag)
  if (isPending) return null
  if (!enabled) return fallback
  return children
}
