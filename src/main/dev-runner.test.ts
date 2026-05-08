import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectRunCommand } from './dev-runner';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

/**
 * Helper: stage a project root with a curated set of files.
 * Anything passed in `files` is "exists"; everything else returns false.
 * Use `pkg` to set the package.json contents (parsed from JSON).
 */
function stageProject(opts: {
  cwd: string;
  files: string[];
  pkg?: Record<string, unknown>;
}): void {
  const present = new Set(opts.files.map((f) => path.join(opts.cwd, f)));
  mockExistsSync.mockImplementation((p) => present.has(p as string));
  if (opts.pkg) {
    mockReadFileSync.mockImplementation((p) => {
      if (p === path.join(opts.cwd, 'package.json')) return JSON.stringify(opts.pkg);
      throw new Error(`unexpected read: ${String(p)}`);
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
});

describe('detectRunCommand', () => {
  const CWD = '/repo/app';

  it('picks "dev" via pnpm when pnpm-lock.yaml is present', () => {
    stageProject({
      cwd: CWD,
      files: ['package.json', 'pnpm-lock.yaml'],
      pkg: { scripts: { dev: 'vite', build: 'vite build' } },
    });

    expect(detectRunCommand(CWD)).toEqual({
      source: 'package.json',
      command: 'pnpm dev',
      script: 'dev',
      packageManager: 'pnpm',
      allScripts: ['dev', 'build'],
    });
  });

  it('falls back to "start" when "dev" is absent, with yarn lockfile', () => {
    stageProject({
      cwd: CWD,
      files: ['package.json', 'yarn.lock'],
      pkg: { scripts: { start: 'next start', test: 'jest' } },
    });

    expect(detectRunCommand(CWD)).toMatchObject({
      source: 'package.json',
      command: 'yarn start',
      script: 'start',
      packageManager: 'yarn',
    });
  });

  it('falls back to "serve" when only it is present, with npm as default pm', () => {
    stageProject({
      cwd: CWD,
      files: ['package.json'],
      pkg: { scripts: { serve: 'http-server' } },
    });

    expect(detectRunCommand(CWD)).toMatchObject({
      source: 'package.json',
      command: 'npm run serve',
      script: 'serve',
      packageManager: 'npm',
    });
  });

  it('uses npm when only package-lock.json is present', () => {
    stageProject({
      cwd: CWD,
      files: ['package.json', 'package-lock.json'],
      pkg: { scripts: { dev: 'next dev' } },
    });

    expect(detectRunCommand(CWD).packageManager).toBe('npm');
  });

  it('falls back to http-server when package.json has no recognized scripts but index.html exists', () => {
    stageProject({
      cwd: CWD,
      files: ['package.json', 'index.html'],
      pkg: { scripts: { build: 'tsc', test: 'vitest' } },
    });

    expect(detectRunCommand(CWD)).toEqual({
      source: 'http-server',
      command: 'npx http-server -p 0',
      allScripts: ['build', 'test'],
    });
  });

  it('returns "none" when package.json exists with no recognized script and no index.html', () => {
    stageProject({
      cwd: CWD,
      files: ['package.json'],
      pkg: { scripts: { build: 'tsc' } },
    });

    expect(detectRunCommand(CWD)).toEqual({
      source: 'none',
      command: '',
      allScripts: ['build'],
    });
  });

  it('falls back to http-server when there is no package.json but an index.html', () => {
    stageProject({ cwd: CWD, files: ['index.html'] });

    expect(detectRunCommand(CWD)).toEqual({
      source: 'http-server',
      command: 'npx http-server -p 0',
    });
  });

  it('returns "none" when neither package.json nor index.html exist', () => {
    stageProject({ cwd: CWD, files: [] });

    expect(detectRunCommand(CWD)).toEqual({ source: 'none', command: '' });
  });

  it('handles malformed package.json by treating it as missing', () => {
    const present = new Set([path.join(CWD, 'package.json'), path.join(CWD, 'index.html')]);
    mockExistsSync.mockImplementation((p) => present.has(p as string));
    mockReadFileSync.mockReturnValue('{not valid json' as unknown as Buffer);

    // Falls through to the html branch.
    expect(detectRunCommand(CWD)).toEqual({
      source: 'http-server',
      command: 'npx http-server -p 0',
    });
  });

  it('handles package.json without a scripts field', () => {
    stageProject({
      cwd: CWD,
      files: ['package.json'],
      pkg: { name: 'foo', version: '1.0.0' },
    });

    expect(detectRunCommand(CWD)).toEqual({
      source: 'none',
      command: '',
      allScripts: [],
    });
  });
});
