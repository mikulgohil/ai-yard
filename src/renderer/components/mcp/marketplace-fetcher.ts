import { buildMcpContentsApiUrl, type McpServerEntry, parseMcpServerEntry } from '../../../shared/mcp-config.js';

interface GithubContentEntry {
  name: string;
  type: string;
  download_url: string | null;
}

const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Fetch curated MCP server entries from the configured GitHub repo.
 * Each entry is a JSON file at `<repo>/<path>/<id>.json`.
 *
 * Skipped entries (validation failures, network errors per file) are filtered
 * out silently — a partially-curated marketplace is better than no marketplace.
 */
export async function fetchMcpServerEntries(): Promise<McpServerEntry[]> {
  const apiUrl = buildMcpContentsApiUrl();
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  const listResp = await fetch(apiUrl, { headers });
  if (!listResp.ok) {
    throw new Error(`GitHub API returned ${listResp.status}: ${await listResp.text().catch(() => '')}`);
  }
  const entries = (await listResp.json()) as GithubContentEntry[];
  const jsonEntries = entries.filter((e) => e.type === 'file' && e.name.toLowerCase().endsWith('.json'));

  const results = await Promise.all(
    jsonEntries.map(async (entry): Promise<McpServerEntry | null> => {
      if (!entry.download_url) return null;
      try {
        const resp = await fetch(entry.download_url);
        if (!resp.ok) return null;
        const raw = await resp.json();
        return parseMcpServerEntry(raw, entry.name.replace(/\.json$/i, ''));
      } catch {
        return null;
      }
    }),
  );

  return results.filter((e): e is McpServerEntry => e !== null);
}

export function isMcpCacheFresh(cache?: { fetchedAt: number }): boolean {
  if (!cache) return false;
  return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}
