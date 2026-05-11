# AI-yard — Feature Roadmap

Generated 2026-05-08. Companion to `docs/IMPROVEMENTS.md` (engineering/refactor backlog) — this file tracks **new product features** for developers. Each feature includes an implementation plan tied to the existing codebase patterns.

**How to use this file**

- Pick one feature per session. Start with Tier 1 (lowest effort, highest ROI).
- Each feature has a status checkbox, implementation sketch, and affected files.
- When you finish a feature, tick the box and append a dated outcome note.
- Read `CLAUDE.md` before starting any session — it documents all patterns referenced here.

---

## Priority Map (quick reference)

| # | Feature | Tier | Effort | Differentiator | Key Prerequisite |
|---|---|---|---|---|---|
| F1 | Session Transcript Search + Bookmarks | 1 | Low | Medium | B8 SQLite (FTS5 schema ready) |
| F2 | Prompt Template Library | 1 | Low | High | Team personas pattern |
| F3 | Context Window Visualizer ✅ | 1 | Low | High | `session-cost.ts` |
| F4 | Environment Variables Manager | 1 | Medium | High | PTY spawn env injection |
| F5 | Multi-Session Broadcast | 1 | Medium | High | None |
| F6 | Network Traffic Monitor | 2 | Medium | Very High | C11 CDP (depends on A5) |
| F7 | Git Visual Panel | 2 | Medium | Medium | `git.ts` 12 handlers exist |
| F8 | Responsive Design Tester | 2 | Medium | High | A5 WebContentsView |
| F9 | Dependency Vulnerability Widget | 2 | Low | Medium | Overview widget pattern |
| F10 | AI Session Summary + Changelog | 2 | Low | High | `ArchivedSession` data |
| F11 | AI Code Review Panel | 2 | Low | High | `github-cli.ts` + sessions |
| F12 | CLAUDE.md / Agent Config Editor | 2 | Low | Medium | Team agent file pattern |
| F13 | Pomodoro / Focus Timer | 3 | Low | Medium | `session-cost.ts` header |
| F14 | Linear Integration | 3 | Medium | High | Mirrors C17 Jira pattern |
| F15 | Session Sharing / Export | 3 | Medium | Medium | PII scrubbing from Sentry |

---

## Tier 1 — Highest ROI (build these first)

### F1. Session Transcript Search + Bookmarks

- **Status**: [ ] not started
- **Why**: The most common frustration with LLM CLI tools is losing a good response in scroll history. Full-text search + bookmarks turn the terminal from ephemeral to searchable.
- **Current state**: `ArchivedSession` stores transcript data. `session-deep-search.ts` has a custom indexer. B8's SQLite schema includes an FTS5 `transcripts_fts` virtual table — the groundwork is done.
- **Implementation plan**:
  1. New sidebar panel or feature-rail icon `search` — `SessionType: 'transcript-search'` mirroring kanban/team structure.
  2. New `src/renderer/components/transcript-search/` — `instance.ts` + `pane.ts` + `search-view.ts`.
  3. IPC channel `session:searchTranscripts({ query, projectId? })` — delegates to `session-deep-search.ts`; once B8 lands, switch to FTS5 query on `transcripts_fts`.
  4. Bookmarks: add `bookmarks?: { sessionId, line, note }[]` to `ProjectRecord`. New IPC `session:addBookmark` / `session:removeBookmark`.
  5. In-terminal shortcut: `⌘+B` on a selected line opens "Add bookmark" dialog (handled in `terminal-pane.ts` keydown listener).
  6. Sidebar "Bookmarks" collapsible section below session tree.
- **Affected files**: `src/shared/types.ts`, `src/main/ipc/session.ts`, `src/renderer/components/transcript-search/` (new), `src/renderer/components/sidebar.ts`, `src/renderer/components/terminal-pane.ts`
- **Acceptance**: `⌘+F` opens search pane, results show session + line context, clicking jumps to session. Bookmarks persist across restarts.

---

### F2. Prompt Template Library

- **Status**: [ ] not started
- **Why**: Developers reuse 80% of the same prompts (review this, write tests, explain this error). Templates with variable slots eliminate repetitive typing and standardize team prompting.
- **Current state**: Team personas (`components/team/`) use the same GitHub Contents API + frontmatter pattern that templates should reuse. No prompt reuse infrastructure exists.
- **Implementation plan**:
  1. New `src/shared/team-config.ts` sibling: `src/shared/templates-config.ts` — `TEMPLATES_REPO` constant pointing at a curated templates repo.
  2. New `SessionType: 'prompt-templates'` or integrate as a modal (`⌘+/`) to avoid adding a new tab.
  3. Template schema (Markdown frontmatter):
     ```md
     ---
     name: Write tests for {{filename}}
     description: Generates unit tests for a given file
     tags: [testing, jest, vitest]
     variables: [filename, framework]
     ---
     Write comprehensive {{framework}} tests for `{{filename}}`...
     ```
  4. Variable substitution UI: when a template is selected, show an inline form for each `{{variable}}` slot.
  5. "Insert" action: fills the PTY input line (via `pty.write`) with the substituted prompt.
  6. Per-project templates stored in `.aiyard/templates/` (mirrors `.claude/agents/` pattern); global in `state.templates[]`.
  7. Community templates fetched via GitHub Contents API (same `github-fetcher.ts` pattern as `predefined-picker.ts`).
- **Affected files**: `src/shared/types.ts` (new `PromptTemplate` type), `src/renderer/components/terminal-pane.ts` (keydown handler for `⌘+/`), new `src/renderer/components/prompt-templates/` dir
- **Acceptance**: `⌘+/` opens template picker, variable slots prompt inline, substituted text lands in PTY input.

---

### F3. Context Window Visualizer

- **Status**: [x] done 2026-05-08
- **Why**: Developers using Claude for long sessions routinely hit context limits and get degraded responses without warning. A visible fill indicator creates awareness before the cliff.
- **Outcome 2026-05-08**: Most of F3 was already shipped before this session — the doc plan was stale. Discovery + delta:
  - **Already shipped (pre-session)**: `ContextWindowInfo` type in `src/shared/types.ts`; `ClaudeProvider.meta.defaultContextWindowSize: 200_000` and `capabilities.contextWindow: true`; `SessionRecord.contextWindow` field with persistence via `restoreContext` on startup; `src/renderer/session-context.ts` module with `setContextData` / `getContext` / `getContextSeverity` (thresholds 70 warning / 90 critical) / observer pattern; ASCII `[====-----] 40%` indicator + tooltip in terminal-pane status bar; consumers in `board-card.ts`, `session-inspector-views.ts`, `session-insights.ts`, `insights/big-initial-context.ts`.
  - **Added this session**: (a) Replaced ASCII bar with a 4px graphical progress bar (`.context-bar` + `.context-bar-fill`) that animates width and color through severity classes; (b) Added the proactive "Context nearly full — type /compact to summarize" banner with **Run /compact** action button and dismiss×/Escape; banner uses `shouldShowContextBanner(pct, dismissed)` — a single-source-of-truth helper exported from `session-context.ts` alongside `CONTEXT_BANNER_THRESHOLD = 90`; per-instance dismissal flag resets when usage drops below 90% so re-crossing re-shows; (c) Added 4 unit tests covering threshold and dismissal contract; (d) Honors `prefers-reduced-motion`; uses existing CSS variables only; ARIA `role="progressbar"` + `role="status" aria-live="polite"`.
  - **Decision: kept severity thresholds at 70/90** (not the doc's earlier 75/90) — they're shared with `board-card.ts`, `session-inspector-views.ts`, and `session-insights.ts`; changing would shift behavior in 4 places for cosmetic alignment.
- **Affected files (this session)**: `src/renderer/components/terminal-pane.ts`, `src/renderer/components/terminal-pane.test.ts`, `src/renderer/session-context.ts`, `src/renderer/session-context.test.ts`, `src/renderer/styles/terminal.css`, `docs/FEATURE_ROADMAP.md`
- **Acceptance (verified)**: Bar fills proportionally; warning/critical color states trigger at 70/90 via CSS; banner appears at ≥90%, "Run /compact" writes the command into the active PTY, × button or Escape dismisses, banner re-shows after `/compact` brings usage down then back up. 21/21 session-context tests + 18/18 terminal-pane tests passing.

---

### F4. Environment Variables Manager

- **Status**: [ ] not started
- **Why**: Every project has `.env` files with secrets that should never be pasted into the LLM. A built-in manager injects env vars into PTY sessions safely, without exposing them to the model's context.
- **Current state**: `ClaudeProvider.buildEnv()` in `src/main/providers/claude-provider.ts` already merges custom env vars. `ProjectRecord` has no env var storage. The `pty:create` IPC handler accepts `env?: Record<string, string>`.
- **Implementation plan**:
  1. Extend `ProjectRecord` in `src/shared/types.ts`: add `envVars?: { key: string; value: string; masked: boolean }[]`.
  2. New Overview widget `env-vars-widget.ts` — registered in `widget-registry.ts`. Shows key names with masked values (dots for masked). Add/Edit/Delete actions.
  3. Storage: persist to `state.json` via existing store. **Do NOT persist actual secret values in state** — store reference path only; actual values read from `.env` file at PTY spawn time. Offer two modes: (a) direct value entry (stored in state, masked in UI), (b) `.env` file path (read fresh on each spawn).
  4. At PTY spawn: `pty.ts` IPC handler reads `project.envVars`, merges into env (mode a: use stored value; mode b: parse the `.env` file).
  5. "Never send to AI" guard: filter env vars from any prompt-building codepath.
- **Affected files**: `src/shared/types.ts`, `src/main/ipc/pty.ts`, `src/renderer/components/project-tab/widgets/env-vars-widget.ts` (new), `widget-registry.ts`
- **Acceptance**: Env vars saved in manager appear in PTY process env. Masked vars show dots in UI. Values never appear in terminal output or prompt text.

---

### F5. Multi-Session Broadcast

- **Status**: [ ] not started
- **Why**: Running the same refactor or formatting fix across 5 open sessions currently means typing the same prompt 5 times. Broadcast sends one prompt to selected sessions simultaneously.
- **Current state**: `pty.write` IPC channel is per-session. `AppState` holds all active sessions and their PTY IDs.
- **Implementation plan**:
  1. New IPC channel `pty:broadcast({ sessionIds: string[], data: string })` in `src/main/ipc/pty.ts` — iterates `sessionIds`, calls `ptyManager.write(id, data)` for each.
  2. UI: in the terminal header, add a "Broadcast" toggle button (radio-tower icon). When active, the session header gets a colored ring.
  3. Broadcast mode: a floating input bar appears at the bottom of the window (above tab bar). Typing here sends to all sessions with broadcast enabled.
  4. Session picker: right-clicking the toggle opens a checklist of active sessions to include/exclude.
  5. Persist broadcast group to `AppState` (not `state.json` — ephemeral per app launch).
- **Affected files**: `src/main/ipc/pty.ts`, `src/renderer/components/terminal-pane.ts`, new `src/renderer/components/broadcast-bar.ts`, `src/renderer/styles/terminal.css`
- **Acceptance**: Typing in broadcast bar sends to all selected PTY sessions simultaneously. Ring indicator clearly marks which sessions are in broadcast mode.

---

## Tier 2 — Strong Workflow Upgrades

### F6. Network Traffic Monitor (Browser Tab)

- **Status**: [ ] not started — **depends on A5 Phase 5 (WebContentsView cutover)**
- **Why**: This is the strongest competitive differentiator AI-yard can ship. No mainstream AI IDE (Cursor, Windsurf, Zed) surfaces network failures as LLM context. It closes the loop: "page broke in browser" → Claude has the full HTTP error automatically.
- **Current state**: C11 in `IMPROVEMENTS.md` covers CDP console capture. Network monitoring is the natural extension. A5 Phase 5 must land first (WebContentsView gives direct `webContents` access for CDP).
- **Implementation plan**:
  1. In `src/main/ipc/browser-view.ts`, after view creation: `view.webContents.debugger.attach('1.3')`, then `debugger.sendCommand('Network.enable')`.
  2. Listen to `view.webContents.debugger.on('message', ...)` for `Network.responseReceived` (filter `response.status >= 400`) and `Network.loadingFailed`.
  3. Buffer last 50 network events in a `Map<viewId, NetworkEvent[]>` in main. Broadcast to renderer via `browser-view:network-event` channel.
  4. New panel in browser tab UI (below the HUD strip): collapsible "Network" tab showing failed requests. Each row: method + URL + status code + timing.
  5. "Explain this error" button on each row: builds a prompt with URL, status, response headers, and injects into active Claude session via `sendToSession`.
  6. Console capture (C11): same `debugger` attachment, `Console.enable` + `Console.messageAdded` — do both in the same session since the plumbing is shared.
- **Affected files**: `src/main/ipc/browser-view.ts`, `src/shared/browser-view-contract.ts`, `src/renderer/components/browser-tab/pane.ts`, new `src/renderer/components/browser-tab/network-monitor.ts`, `src/renderer/styles/browser-tab.css`
- **Acceptance**: 4xx/5xx requests appear in panel within 500ms. "Explain" button opens a pre-filled Claude session with full error context.

---

### F7. Git Feature Suite

- **Status**: [ ] not started — see dedicated roadmap
- **Why**: Git features grew into a full roadmap of 21 items spanning core operations, AI-powered workflows, GitHub integration, and advanced operations. Too large to cover here.
- **→ See `docs/GIT_FEATURES.md`** for the complete breakdown including:
  - G1 Commit Creation UI, G2 Push/Pull/Fetch, G3 Hunk Staging, G4 Stash Manager
  - G5 Commit History Graph, G6 Git Blame, G7 Tag Manager, G8 Reflog Viewer, G9 Branch Comparison
  - G10 Merge Conflict Resolver
  - G11 AI Commit Messages, G12 AI PR Description, G13 PR Review Panel, G14 AI Conflict Resolver, G15 AI Bisect
  - G16 CI/GitHub Actions Status, G17 Repo Stats Widget, G18 Code Search across History
  - G19 Interactive Rebase, G20 Cherry-pick Assistant, G21 Submodule Manager
- **Recommended starting point**: G1 (Commit UI) + G2 (Push/Pull) — closes the local git loop with the lowest effort.

---

### F8. Responsive Design Tester (Browser Tab)

- **Status**: [ ] not started — **depends on A5 Phase 5**
- **Why**: Developers building web UIs constantly switch between device sizes. Integrating this into the browser tab (alongside inspect/flow/draw) makes AI-yard the natural place to catch responsive bugs and immediately ask Claude to fix them.
- **Current state**: Browser tab viewport is fixed to the container size. A5 WebContentsView exposes `view.setBounds()` which can set arbitrary dimensions.
- **Implementation plan**:
  1. Add a "Responsive" button to the browser tab HUD strip (`.browser-tool-hud`).
  2. Clicking opens a viewport picker: preset chips (iPhone SE 375px, iPhone 15 390px, iPad 768px, Desktop 1440px, Custom).
  3. Custom input: width × height fields.
  4. When a preset is active: `browser-view:setBounds` is called with the fixed dimensions; the placeholder element is styled to match so layout is consistent.
  5. Add a device-frame overlay (CSS border-radius + bezel outline) for the mobile presets — visual polish.
  6. "Screenshot at this viewport" — captures via `view.webContents.capturePage()` + saves (reuses `browser:saveScreenshot` IPC pattern from draw mode).
  7. Side-by-side comparison mode: open two WebContentsViews at different viewports (requires tracking multiple `viewId`s per tab — design note: extend `BrowserTabInstance` to support an array).
- **Affected files**: `src/renderer/components/browser-tab/pane.ts`, `src/renderer/components/browser-tab/viewport.ts` (new), `src/renderer/styles/browser-tab.css`, `src/shared/browser-view-contract.ts`
- **Acceptance**: Viewport presets correctly resize the native view. Device frame overlay renders. Screenshot capture works at custom dimensions.

---

### F9. Dependency Vulnerability Widget

- **Status**: [ ] not started
- **Why**: Security debt compounds silently. A widget that surfaces CVE counts without leaving the IDE creates a low-friction path from "there's a vuln" → "ask Claude to fix it".
- **Current state**: Overview tab has `readiness`, `github-prs`, `github-issues`, `team`, `kanban`, `sessions` widgets. `src/main/ipc/fs.ts` has `isWithinKnownProject` for path validation. Running shell commands from main is already done in `github-cli.ts`.
- **Implementation plan**:
  1. New `src/main/dep-audit.ts` — runs `npm audit --json` / `pip-audit --output json` / `cargo audit --format json` based on detected lock files. Returns structured `{ critical, high, moderate, low, advisories[] }`.
  2. New IPC `deps:audit({ projectPath })` — path-gated via `isWithinKnownProject`.
  3. New widget `widgets/dep-audit-widget.ts` in `src/renderer/components/project-tab/widgets/`. Registered in `widget-registry.ts`.
  4. Widget renders: severity badge row (critical/high/moderate/low counts with color), expandable advisory list (package, CVE ID, description, fix version).
  5. Each advisory row has "Fix with AI" button: opens Claude session pre-loaded with `npm audit fix` guidance + the specific CVE details.
  6. Auto-refresh: configurable interval (default 1 hour) to avoid hammering the registry.
  7. Settings modal (mirrors `github-settings-modal.ts`): refresh interval, severity threshold for badge color, opt-out packages.
- **Affected files**: `src/main/dep-audit.ts` (new), `src/main/ipc/app.ts` (register handler), `src/renderer/components/project-tab/widgets/dep-audit-widget.ts` (new), `widget-registry.ts`, `src/renderer/styles/widgets.css`
- **Acceptance**: Widget shows audit results within 5 seconds of project open. "Fix with AI" opens correct pre-filled session. Zero-vuln state shows a green badge.

---

### F10. AI Session Summary + Changelog Generator

- **Status**: [ ] not started
- **Why**: After a long Claude session, developers need to communicate what changed to teammates or record it in a CHANGELOG. Automating this from the transcript closes the last mile of the AI workflow.
- **Current state**: `ArchivedSession` stores `transcript`, `cost`, `createdAt`, `updatedAt`. `session-cost.ts` already extracts structured cost. No summary or changelog generation exists.
- **Implementation plan**:
  1. New IPC `session:summarize({ sessionId })` — reads transcript from `ArchivedSession`, calls Claude (provider-agnostic) with a summary prompt. Returns `{ headline, bullets[], filesChanged[] }`.
  2. UI: "Summarize" button in the session history panel (sidebar session tree → right-click menu on archived sessions).
  3. Result rendered in a modal with copy-to-clipboard and "Add to CHANGELOG.md" action.
  4. CHANGELOG action: `fs:appendToFile` IPC writes a dated entry to `<project>/CHANGELOG.md` in Keepachangelog format.
  5. Cross-session changelog: new Overview widget `changelog-widget.ts` that aggregates summaries from the last N archived sessions into a draft changelog. Button: "Export this week's changes".
  6. Provider-agnostic: `session:summarize` uses the project's default provider (or a dedicated summarization provider setting).
- **Affected files**: `src/main/ipc/session.ts`, `src/renderer/components/sidebar.ts` (right-click menu), new `src/renderer/components/session-summary-modal.ts`, `src/renderer/components/project-tab/widgets/changelog-widget.ts` (new)
- **Acceptance**: Summarize produces ≤5 bullet points in <10s. "Add to CHANGELOG" writes valid Keepachangelog format. Cross-session changelog groups by date.

---

### F11. AI Code Review Panel

- **Status**: [ ] not started
- **Why**: Code review is the most repeated developer workflow that benefits from AI context. AI-yard already has `github-cli.ts` for PR fetching and session creation — this connects them.
- **Current state**: `github-prs` widget shows PR list. `github-cli.ts` shells out to `gh pr diff`. Session creation with pre-loaded prompts is handled via `pendingSystemPrompt` on `SessionRecord`.
- **Implementation plan**:
  1. "Review PR" action on each row in the `github-prs` widget (button or context menu item).
  2. New IPC `github:prDiff({ repo, prNumber })` — calls `gh pr diff <number>` (or GitHub REST API `/repos/:owner/:repo/pulls/:number/files`). Returns diff text.
  3. Build a structured review prompt: system prompt template with review focus areas (correctness, security, performance, readability). User can customize via Prompt Templates (F2).
  4. Opens a new Claude session pre-loaded with the diff as the first message.
  5. Structured output template in the system prompt: "Format your review as: **Summary** / **Issues** (critical/major/minor) / **Suggestions** / **Verdict**".
  6. After review, "Post comment to GitHub" button: calls `gh pr comment` with the review text.
- **Affected files**: `src/main/ipc/github.ts` (new `prDiff` handler), `src/renderer/components/project-tab/widgets/github-prs-widget.ts`, `src/renderer/components/session-summary-modal.ts` (repurpose or new modal)
- **Acceptance**: "Review PR" from the widget opens a Claude session with the full diff in context within 3 seconds. "Post comment" action sends to GitHub.

---

### F12. CLAUDE.md / Agent Config Editor

- **Status**: [ ] not started
- **Why**: `CLAUDE.md` is the primary way to customize Claude's behavior per project. Editing it externally and restarting sessions is friction. An in-app editor makes iteration instant.
- **Current state**: Team personas use `installAgent` / `removeAgent` via `src/main/providers/agent-files.ts`. `fs.ts` IPC has `fs:readFile` / `fs:writeFile`. The Team modal pattern (form → save → agent file) can be adapted.
- **Implementation plan**:
  1. New sidebar button or Overview widget: "Project Config" — opens a modal or dedicated pane.
  2. Editor pane: CodeMirror lite (or a `<textarea>` with monospace font for simplicity) showing current `CLAUDE.md` content.
  3. "Load" reads via `fs:readFile(projectPath + '/CLAUDE.md')`. "Save" writes via `fs:writeFile`.
  4. Template picker: pre-built `CLAUDE.md` templates (testing-focused, security-focused, full-stack, etc.) stored in a templates repo (F2 overlap).
  5. "Apply to active sessions" button: calls `pty:broadcast` (F5) with `/config` or restarts sessions with the updated system prompt.
  6. Agent config section: list agents in `~/.claude/agents/` for the project, add/edit/remove (mirrors Team's `predefined-picker.ts` pattern).
  7. Live preview panel: show how Claude interprets the CLAUDE.md (summarize via Claude — same F10 summarize IPC).
- **Affected files**: `src/renderer/components/project-tab/` (new widget or pane), `src/main/ipc/fs.ts` (ensure write path is allowed for project config files)
- **Acceptance**: Editor loads current `CLAUDE.md`. Save writes to disk. Template picker applies a pre-built config. Agent list shows files from `~/.claude/agents/`.

---

## Tier 3 — Ecosystem & Collaboration

### F13. Pomodoro / Focus Session Timer

- **Status**: [ ] not started
- **Why**: Developer focus is the scarcest resource. A Pomodoro timer tied to session cost shows burn rate per work block and enforces breaks — both underserved in AI IDE tools.
- **Current state**: Session cost indicator is in the terminal header (`terminal-pane.ts`). `session-activity.ts` already tracks working/waiting/idle states.
- **Implementation plan**:
  1. Add a timer to the session header (next to cost display): `25:00 ▶` (click to start/pause, right-click for settings).
  2. Timer state: `{ mode: 'focus' | 'break', remaining: number, cycles: number }` in module-level state (not persisted — resets on session switch).
  3. On break: optional input lock — disable PTY write temporarily (a polite warning, not a hard block).
  4. Stats: "This session: 3 cycles, $0.42 spent, 47 min focused". Shown in session summary tooltip.
  5. Settings: work duration (default 25m), break duration (default 5m), long break after N cycles (default 4).
  6. Notification: uses `new Notification()` from renderer when focus/break timer ends.
- **Affected files**: `src/renderer/components/terminal-pane.ts`, `src/renderer/styles/terminal.css`, new `src/renderer/pomodoro.ts`
- **Acceptance**: Timer visible in header, counts down correctly, switches modes, shows session stats in tooltip.

---

### F14. Linear Integration

- **Status**: [ ] not started
- **Why**: Linear is increasingly common in dev-first teams (Vercel, Linear's own users, startups). Mirrors the C17 Jira three-slice approach but faster to ship (Linear's REST API is simpler than Jira's REST v3).
- **Current state**: `github-prs` and `github-issues` widgets establish the exact pattern to follow. No Linear client exists.
- **Implementation plan**:
  Follows the same **three-slice** approach as C17 Jira:

  **Slice 1 — Read-only widget (~1 day)**
  1. New `src/main/linear-api.ts` — Linear GraphQL client (Linear uses GraphQL, not REST). Auth via personal API key stored in `safeStorage.encryptString()`.
  2. New IPC `linear:listIssues({ teamId, filter, max })`.
  3. New widget `widgets/linear-issues-widget.ts` — per-widget settings: team, filter, max, refresh interval.
  4. Settings modal: `linear-settings-modal.ts` (mirror `github-settings-modal.ts`).

  **Slice 2 — Push action (~half day)**
  1. Extend `BoardCard` with `linearId?: string`, `linearUrl?: string`.
  2. Card context menu: "Push to Linear" → `linear:createIssue` IPC → chip on card.

  **Slice 3 — Two-way sync (DEFER)** — same reasoning as Jira: conflict resolution is expensive. Ship slices 1+2, reassess.
- **Affected files**: `src/main/linear-api.ts` (new), `src/main/ipc/app.ts` (register handlers), `src/renderer/components/project-tab/widgets/linear-issues-widget.ts` (new), `src/shared/types.ts`
- **Acceptance**: Widget renders Linear issues, click opens in browser, unread badge works. "Push to Linear" creates issue and links card.

---

### F15. Session Sharing / Export

- **Status**: [ ] not started
- **Why**: "Here's what Claude built" is a common need for async handoffs, PR descriptions, and team knowledge sharing. Export turns sessions from private artifacts into shareable documentation.
- **Current state**: `ArchivedSession` has full transcript. Sentry's `beforeSend` already demonstrates PII scrubbing patterns. F10 (summarize) produces structured content ready for export.
- **Implementation plan**:
  1. Right-click on archived session in sidebar → "Export session…" menu item.
  2. Export modal with format options: **Markdown** (default), **HTML** (styled, self-contained), **JSON** (raw transcript).
  3. PII scrubbing pass before export: replace home directory path with `~`, strip env vars, redact strings matching secret patterns (same approach as `sentry.ts` `beforeSend`).
  4. Export destinations: **Copy to clipboard**, **Save as file** (`fs:saveAs` dialog), **GitHub Gist** (via `gh gist create --secret` — reuses `github-cli.ts` shell pattern).
  5. Optional: include session summary (F10) at the top of the export.
  6. Shareable link via Gist: return the Gist URL after creation, show in a toast notification.
- **Affected files**: `src/renderer/components/sidebar.ts` (context menu), new `src/renderer/components/session-export-modal.ts`, `src/main/ipc/session.ts` (export handler), `src/main/ipc/github.ts` (gist creation)
- **Acceptance**: Markdown export opens in text editor correctly. Gist creation returns a working URL. PII patterns (home path, common secret shapes) are stripped.

---

## Implementation Notes (read before starting any feature)

### Patterns to follow (all existing in codebase)

| Pattern | Where to find it | Used by |
|---|---|---|
| New tab type | `src/shared/types.ts` `SessionType` union + `split-layout.ts` + `feature-rail.ts` | kanban, team, cost-dashboard, dev-server |
| New Overview widget | `src/renderer/components/project-tab/widgets/widget-registry.ts` | readiness, github-prs, sessions, team, kanban |
| GitHub Contents API + cache | `src/renderer/components/team/github-fetcher.ts` | Team predefined picker |
| Frontmatter parsing | `src/renderer/components/team/frontmatter.ts` | Team personas |
| Settings modal pattern | `src/renderer/components/project-tab/widgets/github-settings-modal.ts` | GitHub widgets |
| Secure credential storage | `safeStorage.encryptString()` in `src/main/ipc/session.ts` | Session secrets |
| Shell command execution | `src/main/github-cli.ts` | GitHub widgets |
| Observer pattern | `src/renderer/session-cost.ts` `onCostUpdate()` | Cost dashboard |
| PII scrubbing | `src/main/sentry.ts` `beforeSend` | Sentry crash reports |

### Wiring checklist for any new feature

- [ ] `SessionType` union updated in `src/shared/types.ts` (if new tab type)
- [ ] `split-layout.ts` — 5 branches: create / render-pre-pass / hide-all-x2 / attach
- [ ] `feature-rail.ts` — icon + label added to rail
- [ ] `tab-bar.ts` — exclusion from `+` menu if needed
- [ ] `sidebar.ts` — button between existing buttons (respect ordering)
- [ ] IPC handler registered in `ipc-handlers.ts` barrel
- [ ] `src/renderer/types.ts` — `window.aiyard` namespace extended
- [ ] `preload.ts` — new namespace exposed via `contextBridge`
- [ ] Tests: at minimum unit tests for the main-process module + render states (loading/empty/error/data)
- [ ] `docs/IMPROVEMENTS.md` — append a dated outcome entry when done

---

## Decision log

- **2026-05-08** — Document created from research session. 15 features proposed and documented with implementation plans. Prioritized by ROI vs effort relative to existing codebase patterns.
- **2026-05-08** — F3 marked done. ~80% was already shipped before the session (the doc plan was stale on `current state`). This session added the missing pieces: graphical progress bar, proactive `/compact` banner with dismiss/re-arm logic, and `shouldShowContextBanner` helper backed by 4 unit tests.
