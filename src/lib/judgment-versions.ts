export function canRestoreJudgmentVersion(status: string): boolean {
  return status === "draft";
}
