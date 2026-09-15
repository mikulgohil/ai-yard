/**
 * Pure rules for the daily-driver git loop (review → commit → push).
 * See docs/GIT_FEATURES.md.
 */

export function canCommit(subject: string, stagedCount: number, amend: boolean): boolean {
  if (!subject.trim()) return false;
  if (amend) return true;
  return stagedCount > 0;
}
