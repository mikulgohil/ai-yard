import * as fs from 'fs';
import * as path from 'path';
import { formatPmRun, pickPackageManager, pickRunScript } from '../shared/run-command';
import type { PackageManager, RunCandidate } from '../shared/types';

/**
 * Detect how to run a project's dev server.
 *
 * Resolution order:
 *   1. `package.json` with a "dev", "start", or "serve" script (in that order)
 *      → pick the first match, run via the inferred package manager
 *   2. No matching script + an `index.html` exists at the root
 *      → fall back to `npx http-server`
 *   3. Otherwise → `source: 'none'`
 *
 * Pure helpers for priority + pm + format live in `shared/run-command.ts` so
 * the renderer can reuse them when the user overrides the picked script in
 * the confirmation modal. This file owns only the io.
 */

function detectPackageManager(cwd: string): PackageManager {
  return pickPackageManager({
    pnpm: fs.existsSync(path.join(cwd, 'pnpm-lock.yaml')),
    yarn: fs.existsSync(path.join(cwd, 'yarn.lock')),
    npm: fs.existsSync(path.join(cwd, 'package-lock.json')),
  });
}

interface PackageJsonReadResult {
  scripts: Record<string, string> | null;
  exists: boolean;
}

function readPackageJsonScripts(cwd: string): PackageJsonReadResult {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return { scripts: null, exists: false };
  try {
    const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as unknown;
    if (raw && typeof raw === 'object' && 'scripts' in raw) {
      const scripts = (raw as { scripts?: unknown }).scripts;
      if (scripts && typeof scripts === 'object') {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(scripts as Record<string, unknown>)) {
          if (typeof v === 'string') out[k] = v;
        }
        return { scripts: out, exists: true };
      }
    }
    return { scripts: {}, exists: true };
  } catch {
    return { scripts: null, exists: true };
  }
}

function fileExists(cwd: string, name: string): boolean {
  return fs.existsSync(path.join(cwd, name));
}

export function detectRunCommand(cwd: string): RunCandidate {
  const { scripts } = readPackageJsonScripts(cwd);
  const allScripts = scripts ? Object.keys(scripts) : undefined;

  if (scripts) {
    const picked = pickRunScript(scripts);
    if (picked) {
      const pm = detectPackageManager(cwd);
      return {
        source: 'package.json',
        command: formatPmRun(pm, picked),
        script: picked,
        packageManager: pm,
        allScripts,
      };
    }
  }

  if (fileExists(cwd, 'index.html')) {
    return {
      source: 'http-server',
      command: 'npx http-server -p 0',
      ...(allScripts ? { allScripts } : {}),
    };
  }

  return {
    source: 'none',
    command: '',
    ...(allScripts ? { allScripts } : {}),
  };
}
