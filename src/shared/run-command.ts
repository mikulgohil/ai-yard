import type { PackageManager } from './types';

/**
 * Pure helpers for resolving a project's dev-run command. Lives in `shared/`
 * because both the main-process detector (`src/main/dev-runner.ts`) and the
 * renderer-side confirmation modal need to map (packageManager, script) → command
 * — and we want exactly one definition to avoid drift.
 */

export const RUN_SCRIPT_PRIORITY = ['dev', 'start', 'serve'] as const;

export function pickRunScript(scripts: Record<string, unknown>): string | null {
  for (const candidate of RUN_SCRIPT_PRIORITY) {
    const value = scripts[candidate];
    if (typeof value === 'string' && value.trim().length > 0) return candidate;
  }
  return null;
}

export function formatPmRun(pm: PackageManager, script: string): string {
  if (pm === 'pnpm') return `pnpm ${script}`;
  if (pm === 'yarn') return `yarn ${script}`;
  return `npm run ${script}`;
}

export function pickPackageManager(lockfiles: { pnpm: boolean; yarn: boolean; npm: boolean }): PackageManager {
  if (lockfiles.pnpm) return 'pnpm';
  if (lockfiles.yarn) return 'yarn';
  return 'npm';
}
