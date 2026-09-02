/** Matches `purge_expired_docket_matters`: hard-delete 7 days after binning. */
export const DOCKET_BIN_RETENTION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isDocketMatterBinned(matter: {
  deleted_at?: string | null;
}): boolean {
  return matter.deleted_at != null && matter.deleted_at !== "";
}

export function docketBinPurgeAt(deletedAt: string): Date {
  return new Date(new Date(deletedAt).getTime() + DOCKET_BIN_RETENTION_DAYS * DAY_MS);
}

export function docketBinDaysRemaining(deletedAt: string, now = new Date()): number {
  const ms = docketBinPurgeAt(deletedAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

export function docketBinDaysLabel(deletedAt: string, now = new Date()): string {
  const days = docketBinDaysRemaining(deletedAt, now);
  if (days <= 0) return "Purge pending";
  if (days === 1) return "Last day";
  return `${days} days left`;
}
