# ai-yard-mcp-servers — seed

Staging directory for the curated MCP server registry consumed by AI-yard's marketplace UI. The contents below are intended to become a separate public repo at `mikulgohil/ai-yard-mcp-servers`. Until that repo exists the marketplace fetch returns 404 and the Browse modal shows an empty state.

## Why a separate repo

`src/shared/mcp-config.ts:1` documents the rationale: curated registry content (entries, descriptions, install instructions) should evolve independently of app releases. The four config fields (`owner`/`repo`/`branch`/`path`) point at the published location, and the marketplace fetcher hits the GitHub Contents API at runtime with a 1-hour cache TTL.

If the registry needs to move (a new owner, a fork, a different branch), only `src/shared/mcp-config.ts` changes — no marketplace refactor required.

## Layout

```
mcp-servers-seed/
├── README.md          ← this file (becomes the published repo's README)
└── servers/           ← matches MCP_SERVERS_REPO.path = 'servers'
    ├── filesystem.json
    ├── github.json
    ├── postgres.json
    └── fetch.json
```

The fetcher only enumerates `.json` files at `servers/` (top-level, not recursive). Filenames must match each entry's `id` field. Anything else in the repo is ignored.

## Publishing the repo

The seed lives inside the AI-yard repo so it ships under version control with the code. To create the public registry:

```bash
# 1. Copy the seed out of the AI-yard tree
cp -R mcp-servers-seed /tmp/ai-yard-mcp-servers

# 2. Initialize and publish as a new public repo
cd /tmp/ai-yard-mcp-servers
git init
git add .
git commit -m "init: seed registry with 4 example MCP servers"
gh repo create mikulgohil/ai-yard-mcp-servers --public --source=. --push

# 3. Verify the marketplace fetch resolves
curl -s https://api.github.com/repos/mikulgohil/ai-yard-mcp-servers/contents/servers?ref=main \
  | jq '.[].name'
```

After this, the AI-yard marketplace's Browse modal will populate from the live registry on next launch (or after the 1-hour cache expires).

## Entry schema

Validated by `parseMcpServerEntry` in `src/shared/mcp-config.ts:78`. The fetcher silently drops entries that fail validation, so a partially-curated registry stays usable.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Must match the JSON filename without extension. Lowercase + kebab-case. |
| `name` | string | yes | Display name in the card header. |
| `description` | string | yes | One-paragraph blurb. Plain text. |
| `domain` | enum | no | One of `dev-tools` / `productivity` / `data` / `cloud` / `communication` / `other`. Falls back to `other` if missing or unknown. |
| `command` | string | one-of | stdio launch command (e.g. `npx`, `uvx`, `node`). Mutually exclusive with `url`. |
| `args` | string[] | no | Args for `command`. Use placeholders like `<path>` or `<token>` for user-supplied values. |
| `url` | string | one-of | SSE/HTTP endpoint. Mutually exclusive with `command`. |
| `env` | `Record<string,string>` | no | Environment variables the server needs. **Values are templates** (`"<your-token>"`), never real secrets. |
| `setupUrl` | string | no | Link to the server's homepage or setup docs. |

Required: `id`, `name`, `description`, **and exactly one** of (`command`, `url`).

Both → entry rejected. Neither → entry rejected.

## Worked example

`servers/github.json`:

```json
{
  "id": "github",
  "name": "GitHub",
  "description": "Browse repositories, read and write issues and pull requests, and search code across GitHub. Requires a personal access token.",
  "domain": "cloud",
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-github"
  ],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-github-pat>"
  },
  "setupUrl": "https://github.com/modelcontextprotocol/servers/tree/main/src/github"
}
```

When a user clicks Install in the marketplace, AI-yard writes this entry into the active provider's MCP config (Claude / Codex / etc.) with the templated `env` values exposed in a form for the user to fill in.

## Adding new entries

1. Pick a stable `id` (lowercase, kebab-case, no spaces). It will become the JSON filename and the URL slug.
2. Verify the launch command works in a clean shell: `npx -y @modelcontextprotocol/server-X` (or `uvx`, etc.) should start the server and respond to MCP `initialize`.
3. Add a `setupUrl` pointing at canonical docs — the maintainer's GitHub README is best.
4. Use `<placeholder>` syntax for any value the user must supply (paths, tokens, connection strings).
5. Open a PR. CI should validate the JSON shape against the schema (validation script not yet shipped — track as follow-up).

## Caveats for the seed entries

The four example entries below are **seed content** — verify each before treating the registry as canonical:

- **`filesystem.json`** — official `@modelcontextprotocol/server-filesystem`. Args expect at least one allowed directory; the placeholder must be replaced before launch.
- **`github.json`** — official `@modelcontextprotocol/server-github`. Personal access token must have `repo` and `read:org` scopes for full functionality.
- **`postgres.json`** — official `@modelcontextprotocol/server-postgres`. Connection string must be replaced; the server is read-only by design.
- **`fetch.json`** — Python-based, run via `uvx` (Astral's `uv` tool). Users without `uv` installed will see a runtime error, not a registry error — surfacing setup prerequisites is a marketplace UI concern, not a registry concern.

The MCP server ecosystem is still moving fast — package names and command-line semantics drift. Re-verify each entry against the upstream README at the linked `setupUrl` before publishing.

## Cache behavior

`isMcpCacheFresh` in `src/renderer/components/mcp/marketplace-fetcher.ts:45` uses a 1-hour TTL. Editing entries here won't be visible in a running AI-yard instance until either (a) the cache expires or (b) the user closes and reopens the marketplace modal *after* the cache window. For first-time publishes the modal updates as soon as the GitHub API serves the new content.

## Follow-ups

- **Validation CI** — a GitHub Action that runs `parseMcpServerEntry` over every JSON in `servers/` on PR. Today validation only happens client-side at fetch time, which means a broken JSON gets merged silently and only surfaces when a user opens the marketplace.
- **Domain rebalancing** — the `productivity` and `other` buckets are catch-alls. As the registry grows, splitting them into more specific domains may improve discovery.
- **Install telemetry** — surface `feature.used:mcp-install:<id>` so popular entries can be promoted in the UI. Wire through the existing `feature-telemetry.ts` helper once the registry is live.
