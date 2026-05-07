// Source of curated MCP server entries. The marketplace fetches this directory
// at runtime via the GitHub Contents API. Entries live in this repo's top-level
// `servers/` folder so curated content can be updated independently of app
// releases — flip the four fields below to retarget.

export const MCP_SERVERS_REPO = {
  owner: 'mikulgohil',
  repo: 'ai-yard-mcp-servers',
  branch: 'main',
  path: 'servers',
} as const;

export function buildMcpContentsApiUrl(): string {
  const { owner, repo, path, branch } = MCP_SERVERS_REPO;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
}

export function buildMcpRawUrl(filename: string): string {
  const { owner, repo, branch, path } = MCP_SERVERS_REPO;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/${filename}`;
}

export const MCP_DOMAINS = [
  'dev-tools',
  'productivity',
  'data',
  'cloud',
  'communication',
  'other',
] as const;

export type McpDomain = (typeof MCP_DOMAINS)[number];

export const MCP_DOMAIN_LABELS: Record<McpDomain, string> = {
  'dev-tools': 'Developer Tools',
  productivity: 'Productivity',
  data: 'Data & Storage',
  cloud: 'Cloud Services',
  communication: 'Communication',
  other: 'Other',
};

export function isMcpDomain(value: unknown): value is McpDomain {
  return typeof value === 'string' && (MCP_DOMAINS as readonly string[]).includes(value);
}

/**
 * Manifest entry for a curated MCP server. Each entry is one JSON file at
 * `<repo>/<path>/<id>.json` in the marketplace repo. The marketplace fetcher
 * validates incoming entries against this shape — unknown fields are ignored,
 * required ones missing → entry skipped.
 */
export interface McpServerEntry {
  /** Unique identifier (matches the JSON filename without extension). */
  id: string;
  /** Display name shown in the card header. */
  name: string;
  /** One-paragraph description shown on the card. */
  description: string;
  /** Domain bucket for grouping. Defaults to "other" if absent or unknown. */
  domain?: McpDomain;
  /** stdio launch command (mutually exclusive with `url`). */
  command?: string;
  /** stdio launch args. */
  args?: string[];
  /** SSE/HTTP endpoint (mutually exclusive with `command`). */
  url?: string;
  /** Optional environment variables the server needs (KEY=template, no values). */
  env?: Record<string, string>;
  /** Optional URL pointing to setup docs / homepage. */
  setupUrl?: string;
}

/**
 * Validate a raw JSON entry. Returns the typed entry on success, null on failure.
 * Required fields: id, name, description, AND exactly one of (command, url).
 */
export function parseMcpServerEntry(raw: unknown, fallbackId: string): McpServerEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : fallbackId;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  const description = typeof obj.description === 'string' ? obj.description.trim() : '';
  if (!name || !description) return null;

  const command = typeof obj.command === 'string' ? obj.command.trim() : undefined;
  const url = typeof obj.url === 'string' ? obj.url.trim() : undefined;
  if (!command && !url) return null;
  if (command && url) return null;

  const domain = isMcpDomain(obj.domain) ? obj.domain : undefined;

  let args: string[] | undefined;
  if (Array.isArray(obj.args)) {
    args = obj.args.filter((a): a is string => typeof a === 'string');
  }

  let env: Record<string, string> | undefined;
  if (obj.env && typeof obj.env === 'object' && !Array.isArray(obj.env)) {
    const entries = Object.entries(obj.env as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string') as [string, string][];
    if (entries.length > 0) env = Object.fromEntries(entries);
  }

  const setupUrl = typeof obj.setupUrl === 'string' ? obj.setupUrl.trim() : undefined;

  return { id, name, description, domain, command, args, url, env, setupUrl };
}
