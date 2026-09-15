import { describe, expect, it } from 'vitest';
import { canCommit } from './git-loop';

describe('canCommit', () => {
  it('requires a non-empty subject', () => {
    expect(canCommit('', 3, false)).toBe(false);
    expect(canCommit('   ', 3, false)).toBe(false);
  });

  it('requires staged files when not amending', () => {
    expect(canCommit('feat: add login', 0, false)).toBe(false);
    expect(canCommit('feat: add login', 1, false)).toBe(true);
  });

  it('allows a message-only amend with nothing staged', () => {
    expect(canCommit('fix: typo', 0, true)).toBe(true);
  });

  it('trims the subject line before checking', () => {
    expect(canCommit('  feat: add login  ', 2, false)).toBe(true);
  });
});
