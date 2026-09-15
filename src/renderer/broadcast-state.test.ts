import { describe, expect, it } from 'vitest';
import { formatBroadcastPayload } from './broadcast-state';

describe('formatBroadcastPayload', () => {
  it('returns null for empty or whitespace-only input', () => {
    expect(formatBroadcastPayload('')).toBeNull();
    expect(formatBroadcastPayload('   ')).toBeNull();
  });

  it('trims and appends a carriage return for Claude CLI submit', () => {
    expect(formatBroadcastPayload('  refactor login  ')).toBe('refactor login\r');
  });

  it('does not double the trailing carriage return', () => {
    expect(formatBroadcastPayload('done\r')).toBe('done\r');
  });
});
