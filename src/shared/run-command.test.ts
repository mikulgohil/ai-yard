import { describe, expect, it } from 'vitest';
import { formatPmRun, pickPackageManager, pickRunScript } from './run-command';

describe('pickRunScript', () => {
  it('prefers "dev" when present', () => {
    expect(pickRunScript({ dev: 'vite', start: 'next start', serve: 'http-server' })).toBe('dev');
  });

  it('falls back to "start" when "dev" is missing', () => {
    expect(pickRunScript({ start: 'next start', serve: 'http-server' })).toBe('start');
  });

  it('falls back to "serve" when "dev" and "start" are missing', () => {
    expect(pickRunScript({ serve: 'http-server', test: 'jest' })).toBe('serve');
  });

  it('returns null when no priority script matches', () => {
    expect(pickRunScript({ test: 'jest', build: 'tsc' })).toBeNull();
  });

  it('returns null for empty scripts object', () => {
    expect(pickRunScript({})).toBeNull();
  });

  it('skips scripts whose value is not a non-empty string', () => {
    // Defensive: malformed package.json could surface non-string entries through JSON.parse.
    expect(pickRunScript({ dev: '', start: 'node server.js' })).toBe('start');
    expect(pickRunScript({ dev: '   ', start: 'node server.js' })).toBe('start');
    expect(pickRunScript({ dev: 42 as unknown as string, start: 'node server.js' })).toBe('start');
  });
});

describe('pickPackageManager', () => {
  it('prefers pnpm when its lockfile is present', () => {
    expect(pickPackageManager({ pnpm: true, yarn: true, npm: true })).toBe('pnpm');
  });

  it('prefers yarn over npm when only those two are present', () => {
    expect(pickPackageManager({ pnpm: false, yarn: true, npm: true })).toBe('yarn');
  });

  it('falls back to npm when no lockfile is present', () => {
    expect(pickPackageManager({ pnpm: false, yarn: false, npm: false })).toBe('npm');
  });

  it('returns npm when only its lockfile is present', () => {
    expect(pickPackageManager({ pnpm: false, yarn: false, npm: true })).toBe('npm');
  });
});

describe('formatPmRun', () => {
  it('formats pnpm without "run"', () => {
    expect(formatPmRun('pnpm', 'dev')).toBe('pnpm dev');
  });

  it('formats yarn without "run"', () => {
    expect(formatPmRun('yarn', 'serve')).toBe('yarn serve');
  });

  it('formats npm with "run"', () => {
    expect(formatPmRun('npm', 'start')).toBe('npm run start');
  });
});
