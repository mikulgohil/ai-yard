import { describe, expect, it } from 'vitest';
import { buildMcpContentsApiUrl, buildMcpRawUrl, isMcpDomain, MCP_DOMAINS, parseMcpServerEntry } from './mcp-config';

describe('mcp-config URL builders', () => {
  it('buildMcpContentsApiUrl points at the configured repo path', () => {
    const url = buildMcpContentsApiUrl();
    expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/[^?]+\?ref=/);
  });

  it('buildMcpRawUrl includes the filename', () => {
    expect(buildMcpRawUrl('github.json')).toMatch(/\/github\.json$/);
  });
});

describe('isMcpDomain', () => {
  it('accepts known domains', () => {
    for (const d of MCP_DOMAINS) {
      expect(isMcpDomain(d)).toBe(true);
    }
  });
  it('rejects unknown values', () => {
    expect(isMcpDomain('made-up')).toBe(false);
    expect(isMcpDomain(null)).toBe(false);
    expect(isMcpDomain(42)).toBe(false);
  });
});

describe('parseMcpServerEntry', () => {
  it('parses a valid stdio entry', () => {
    const out = parseMcpServerEntry({
      id: 'github',
      name: 'GitHub',
      description: 'GitHub MCP server',
      domain: 'dev-tools',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: '' },
      setupUrl: 'https://example.com',
    }, 'fallback');
    expect(out).toEqual({
      id: 'github',
      name: 'GitHub',
      description: 'GitHub MCP server',
      domain: 'dev-tools',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: '' },
      url: undefined,
      setupUrl: 'https://example.com',
    });
  });

  it('parses a valid sse entry', () => {
    const out = parseMcpServerEntry({
      name: 'Remote SSE',
      description: 'Hosted SSE',
      url: 'https://example.com/sse',
    }, 'remote-sse');
    expect(out).toEqual({
      id: 'remote-sse',
      name: 'Remote SSE',
      description: 'Hosted SSE',
      domain: undefined,
      command: undefined,
      args: undefined,
      url: 'https://example.com/sse',
      env: undefined,
      setupUrl: undefined,
    });
  });

  it('rejects entries with both command and url', () => {
    expect(parseMcpServerEntry({ name: 'X', description: 'y', command: 'foo', url: 'http://e' }, 'x')).toBeNull();
  });

  it('rejects entries with neither command nor url', () => {
    expect(parseMcpServerEntry({ name: 'X', description: 'y' }, 'x')).toBeNull();
  });

  it('rejects entries missing name or description', () => {
    expect(parseMcpServerEntry({ name: '', description: 'y', command: 'x' }, 'x')).toBeNull();
    expect(parseMcpServerEntry({ name: 'A', description: '', command: 'x' }, 'x')).toBeNull();
  });

  it('falls back to the supplied id when none provided', () => {
    const out = parseMcpServerEntry({ name: 'X', description: 'y', command: 'foo' }, 'fallback');
    expect(out?.id).toBe('fallback');
  });

  it('drops unknown domain values silently', () => {
    const out = parseMcpServerEntry({ name: 'X', description: 'y', command: 'foo', domain: 'made-up' }, 'x');
    expect(out?.domain).toBeUndefined();
  });

  it('filters non-string args entries', () => {
    const out = parseMcpServerEntry({ name: 'X', description: 'y', command: 'foo', args: ['ok', 42, null, 'also-ok'] }, 'x');
    expect(out?.args).toEqual(['ok', 'also-ok']);
  });
});
