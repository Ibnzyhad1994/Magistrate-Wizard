export const RETENTION_ACTIONS = ["flag", "purge"] as const
export type RetentionAction = (typeof RETENTION_ACTIONS)[number]

export const PURGEABLE_RETENTION_TABLES = ["notifications"] as const

export const isPurgeableRetentionTable = (tableName: string) =>
  (PURGEABLE_RETENTION_TABLES as readonly string[]).includes(tableName)

export const isRetentionAction = (value: string): value is RetentionAction =>
  (RETENTION_ACTIONS as readonly string[]).includes(value)

export const retentionAllowsPurge = (tableName: string, action: string) =>
  action === "purge" && isPurgeableRetentionTable(tableName)
