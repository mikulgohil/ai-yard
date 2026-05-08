# AI-yard — Project Notes & Improvement Backlog

Personal fork of Vibeyard ([elirantutia/vibeyard](https://github.com/elirantutia/vibeyard), MIT) renamed to **AI-yard** for personal use. Sibling to Mikul Gohil's `AI-kit` product.

## 2026-05-07 — Vibeyard → AI-yard rename

### Identity
| Field | Value |
|---|---|
| npm name | `@mikulgohil/ai-yard` (scoped, public) |
| Display name | `AI-yard` |
| CLI command | `ai-yard` |
| IPC namespace | `window.aiyard` |
| Electron `appId` | `com.aiyard.app` |
| State dir | `~/.ai-yard/` |
| Hook tmp dir | `/tmp/ai-yard/` |
| Author | Mikul Gohil `<mikulgohil@outlook.com>` |
| GitHub | `mikulgohil/ai-yard` (URL set in `package.json`; **repo not yet created**) |

### Decisions taken during rename
- **Full rename**: ~140 files, 449 occurrences of "Vibeyard"/"vibeyard" replaced.
- **No state migration**: fresh start in `~/.ai-yard/`. Old `~/.vibeyard/` is left untouched if it ever existed.
- **`TEAM_MEMBERS_REPO` preserved upstream** (`elirantutia/vibeyard/personas`) — keeps consuming curated personas from the original repo without forking.
- **`electron-builder` `publish` block removed** — no auto-release pipeline yet.
- **`CHANGELOG.md` historical entries left untouched** — they document the project's actual release history.
- **String-literal discriminator convention**:
  - JS-side IPC/discriminator tags use no hyphen: `'aiyard'`
  - Filesystem paths and npm names use kebab: `ai-yard`, `~/.ai-yard`
  - JS identifiers (interface names, function names) use PascalCase with no hyphen: `AIYardApi`, `isAIYardStatusLine`

### Files renamed on disk
- `bin/vibeyard.js` → `bin/ai-yard.js`
- `.vibeyardignore` → `.ai-yardignore`
- `build/vibeyard-black.png` → `build/ai-yard-black.png` *(image content still depicts Vibeyard branding — needs new logo)*

### Verification (run before any structural change)
- `npm run build` — clean (`@mikulgohil/ai-yard@0.2.35`)
- `npm test` — **1524 / 1524 passing across 112 files**
- Runtime: app launches, state persists to `~/.ai-yard/state.json`, hooks dir at `~/.ai-yard/run/`

### Known accepted debt
1. ~~App icons display **Vibeyard branding**~~ — *Resolved 2026-05-08 (commit `8982658`): new AY monogram mark in terracotta on midnight. `ai-yard-black.png` is orphaned but kept on disk to keep the change small.*
2. `mikulgohil/ai-yard` GitHub repo doesn't exist yet (URLs in `package.json` are 404).
3. `bin/ai-yard.js` launcher is **inert** without a release pipeline (no `electron-builder` publish target).
4. `.github/workflows/*.yml` not audited for vibeyard-specific behaviors.

## 2026-05-07 — Follow-up cleanup pass

After re-auditing the rename, three additional consistency fixes landed:

- **`VIBEYARD_SESSION_ID` env var → `AIYARD_SESSION_ID`** across `copilot-hooks.ts`, `codex-hooks.ts`, `gemini-hooks.ts` and 6 test files (25 occurrences total). This env var is the contract between the main process and the hook subprocesses it spawns — it's purely internal, no external scripts depend on it, no state migration needed.
- **`VIBEYARDIGNORE_HEADER` constant → `AIYARDIGNORE_HEADER`** in `src/main/readiness/checkers/context-optimization.ts`. Internal-only constant; the file written is correctly `.ai-yardignore`.
- **Identity regression test added** at `src/main/identity.test.ts`. Static-source-parses `main.ts` for `title: 'AI-yard'` and asserts `package.json` `name` / `build.appId` / `build.productName` / `bin['ai-yard']` are all consistent. Catches future name drift loudly. Test count: 1524 → 1526.

### Audit finding: the "localhost:3000 seed" item was wrong
The original Tier 4 entry "Remove the default `localhost:3000` browser tab seed from initial state" was based on a misread. There is **no auto-seeded browser tab** in `state.ts`. `buildBrowserTabSession` is only called when the user explicitly enters a URL. What was likely confused for a seed: `pane.ts:182` shows a list of clickable suggestion buttons (`localhost:3000`, `localhost:5173`, `localhost:8080`, `localhost:4200`) on the **new-tab page** of an empty browser tab. Those are intentional quick-launch shortcuts, not a seed — they only navigate when clicked.

---

## Improvement backlog for next session

Tiered by impact + effort. Pick a tier and execute; don't try to span multiple tiers in one session.

### Tier 1 — Identity / branding (~1–2 hours)
- [x] **Generate new icon set** — AY monogram ligature in terracotta on midnight. Master at `build/icon.svg`; `scripts/generate-icons.js` regenerates `icon.png` (1024), `icon.ico` (multi-res Win), `icon.icns` (mac retina). *(Done 2026-05-08, commit `8982658`)*
- [x] **Replace `build/ai-yard-black.png`** — README hero image now points at `build/icon.png` (the new branded mark). The legacy `build/ai-yard-black.png` is orphaned with no remaining references; leave in place or delete in a future cleanup pass. *(Done 2026-05-08)*
- [ ] **Visual smoke test**: open every dialog (About, Preferences, Help, Star prompt, What's New, Update banner) — confirm zero "Vibeyard" strings remain in UI.
- [ ] Decide whether to keep the Vibeyard demo GIFs (`assets/vibyard_720.gif`, `assets/web-ui-short.gif`, `assets/kanban.gif`) in README or remove until you record AI-yard equivalents.

### Tier 2 — Distribution & release (~2–3 hours)
- [ ] Create `mikulgohil/ai-yard` on GitHub (private or public — your call).
- [ ] First commit, push to `main` (currently 1 commit ahead of upstream's last `7f44076`; the rename diff is staged).
- [ ] Decide if `@mikulgohil/ai-yard` should actually be published to npm (probably not for personal use; the launcher in `bin/ai-yard.js` only matters if it is).
- [ ] If publishing: re-add the `publish` block to `package.json` `build` field (was removed during rename) and set up GitHub Actions release pipeline based on the existing `.github/workflows/release.yml`.
- [ ] Audit and update `.github/workflows/*.yml` for the new repo name (PR comments, release tag formats, asset naming).

### Tier 3 — Personalization for your workflow (~2–4 hours)
- [ ] Author **personal personas** in your own repo (e.g. `mikulgohil/ai-yard-personas`) and flip `TEAM_MEMBERS_REPO` in `src/shared/team-config.ts`. Candidates: `xm-cloud-architect`, `nextjs-app-router-specialist`, `ai-kit-product-engineer`, `sitecore-jss-dev`.
- [ ] Add **custom slash commands** for your daily flows (already have `~/.claude/commands/`; the AI-yard agent files mirror those).
- [ ] Drop unused providers from prerequisites checks (Copilot, Gemini) if you only use Claude — see `src/main/providers/registry.ts`.
- [ ] **Custom Overview widget**: if there's a recurring view you want (e.g. "AI-kit product status", "Sitecore work tracker"), author one in `src/renderer/components/project-tab/widgets/`. Pattern is documented in `CLAUDE.md` lines 76–80.
- [x] **One-click "Run dev server" for projects** — sidebar Run button auto-detects from `package.json` (priority: dev > start > serve), falls back to `npx http-server` for static HTML, remembers the chosen command per project. New `dev-server` SessionType wraps a generic shell PTY so it shares xterm rendering with the rest of the app. *(Done 2026-05-08)*

### Tier 4 — Code health & rebrand cleanup (~1–2 hours)
- [x] **Add a regression test** that asserts the window title and `appId` — guards against future name drift. *(Done 2026-05-07: `src/main/identity.test.ts`)*
- [x] **Rename `VIBEYARD_SESSION_ID` → `AIYARD_SESSION_ID`** across hook files (codex/copilot/gemini). *(Done 2026-05-07)*
- [x] **Rename `VIBEYARDIGNORE_HEADER` constant** in `context-optimization.ts`. *(Done 2026-05-07)*
- [ ] **Audit `CHANGELOG.md`** — decide whether to fork the changelog (start fresh from this rename) or keep the full Vibeyard history with a "Renamed to AI-yard on 2026-05-07" entry at the top.
- [ ] Review `.ai-yardignore` patterns — still appropriate for AI readiness scans on AI-yard's own codebase?
- [ ] Search for stale references in code comments (e.g. `// previously-installed ai-yard hooks` reads slightly oddly because the original was about Vibeyard's own hooks).

### Tier 5 — Optional polish
- [ ] Rename the local checkout directory: `~/Developer/personal/ai-research/vibeyard/` → `ai-yard/`. Affects shell history but nothing functional.
- [ ] Add a `docs/ARCHITECTURE.md` distilling the dense `CLAUDE.md` for human readers.
- [ ] Tighten the bundle (`dist/renderer/index.js` is 1.8 MB) — esbuild has reasonable defaults but you could try minify + analyze for low-hanging fruit.
- [ ] Add personal preferences as defaults: theme, sidebar width, preferred provider — wherever you'd otherwise reset them on first run.

---

## Quick-start for next Claude session

1. `cat docs/RENAME.md` — this file.
2. `cat CLAUDE.md` — architecture (already reflects AI-yard).
3. `npm install && npm test` — confirm 1524-test baseline still green.
4. Pick a tier above. Don't span multiple tiers per session.
5. Before committing: `npm run build && npm test`.
