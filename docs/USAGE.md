# Using AI-yard

A task-oriented guide to working in AI-yard day-to-day. For installation, see [README.md](../README.md). For architecture, see [CLAUDE.md](../CLAUDE.md).

---

## Contents

1. [Getting started](#getting-started)
2. [Projects and sessions](#projects-and-sessions)
3. [Working with sessions](#working-with-sessions)
4. [The kanban board](#the-kanban-board)
5. [Cost dashboard](#cost-dashboard)
6. [Project Overview widgets](#project-overview-widgets)
7. [Team members (personas)](#team-members-personas)
8. [Browser tabs and inspect mode](#browser-tabs-and-inspect-mode)
9. [MCP servers](#mcp-servers)
10. [Hooks](#hooks)
11. [Preferences](#preferences)
12. [Sharing sessions (P2P)](#sharing-sessions-p2p)
13. [Keyboard shortcuts](#keyboard-shortcuts)
14. [Troubleshooting](#troubleshooting)

---

## Getting started

### Prerequisites

You need at least one supported CLI installed and authenticated:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [OpenAI Codex CLI](https://github.com/openai/codex)
- [GitHub Copilot CLI](https://docs.github.com/en/copilot)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)

On Windows, Python is also required for the hook scripts that capture session telemetry. The app shows a warning dialog at launch if Python is missing.

### First launch

On first launch AI-yard creates `~/.ai-yard/` containing:

- `state.json` — projects, sessions, layout, preferences, team members
- `run/` — runtime hook artifacts (status files, captured events)

There is no migration from `~/.vibeyard/` (the upstream project's directory). AI-yard starts with a clean slate.

### Workspace layout

The window is split into:

- **Sidebar** — projects list, with sessions nested under each project
- **Main area** — the active session terminal, browser tab, kanban board, or Project Overview
- **Tab bar** — your open tabs across all projects

Toggle the sidebar with `Cmd/Ctrl+B`.

---

## Projects and sessions

### Create a project

`Cmd/Ctrl+Shift+P` opens the New Project dialog. Pick a working directory; AI-yard remembers the path and uses it as the cwd for every session you start in this project.

### Start a session

Three ways:

1. **`Cmd/Ctrl+T`** — opens a new session using your default provider (set in Preferences → General).
2. **`Cmd/Ctrl+Shift+N`** — same as above, alternate keybind.
3. **From a kanban card** — click the run icon on a card to spawn a session named after the task.

Each session runs its own PTY backed by the chosen CLI provider. The session terminal is rendered with `xterm.js` (WebGL when available, software fallback otherwise).

### Switching CLI providers

A project can mix sessions from different providers — there's no project-wide lock-in. The provider for each new session is the default from Preferences, unless you explicitly choose another from the new-session dropdown.

Active providers are registered at startup in `src/main/providers/registry.ts`: Claude, Codex, Copilot, Gemini.

---

## Working with sessions

### Tabs and split mode

- **Cycle sessions**: `Cmd/Ctrl+1` through `Cmd/Ctrl+9` jump to a specific session in the active project. `Cmd/Ctrl+Shift+]` and `Cmd/Ctrl+Shift+[` cycle next/previous.
- **Tab history**: `Cmd/Ctrl+[` and `Cmd/Ctrl+]` move back and forward through the order you visited tabs (like a browser's back/forward).
- **Split mode**: `Cmd/Ctrl+\` toggles a side-by-side split. Drag a tab into the second pane to split work between two sessions.
- **Close session**: `Cmd/Ctrl+W` (the session is moved to recent history; you can resume it).

### Session resume

Sessions persist their CLI session ID. Closing a session archives it; the **Sessions** widget on Project Overview lists recent archives — click one to restart the underlying CLI with `--resume <id>` (or the equivalent for other providers).

### Cost and context tracking

Per-session metrics are tracked live:

- **Cost** — USD spent, input/output tokens, cache reads, duration. Surfaced in the session header and in the Usage Stats panel (`Cmd/Ctrl+Shift+U`).
- **Context window** — `usedPercentage` of the model's window. Warnings fire at ≥70%, critical alerts at ≥90%.

Cost data is read from the Claude CLI status line when available, with a regex fallback for older versions. Other providers may report less detail depending on their CLI.

### Session inspector

`Cmd/Ctrl+Shift+I` toggles the inspector — a side panel showing the session's event timeline, tool-use breakdown, and detailed cost/context views. The data comes from hooks installed by AI-yard into the CLI's hooks config.

---

## The kanban board

Each project has a board at `state.activeProject.board`. Open it from the project tabs.

**What you can do:**

- **Create tasks** — click "+ Add task" in any column, or open the modal to set tags and a description.
- **Drag tasks between columns** — supports reorder within a column too.
- **Filter** — search box plus tag pills above the board.
- **Run from a card** — clicking run starts a session in the project, names it after the task, and links them. When the session completes, the task auto-moves to the column with `behavior: 'done'` (set on column creation).
- **Resume from a card** — if the linked session was archived, the resume action restarts it.

The board state lives in `state.json`; tag definitions and column behaviors are per-project.

---

## Cost dashboard

Click the **Cost** action button in the project sidebar to open a per-project cost dashboard. (Hidden if the "Show Cost dashboard sidebar button" preference is off.)

**What you'll see:**

- **KPI cards** — total spend, input tokens, output tokens, session count.
- **Spend over time** — vertical bar chart with one bar per day, ISO week, or calendar month. Days/weeks/months with no spend are filled in as zero bars so trends stay honest.
- **Breakdown grid** — three cards: by provider (Claude / Codex / Copilot / Gemini), by project, top runs. Sorted descending by cost.

**Controls:**

- **Granularity** — Daily / Weekly / Monthly toggle in the top-right.
- **Scope** — "This project" (default) or "All projects". The "All projects" view aggregates across every project in your workspace.

**Where the data comes from:**

- Live cost from active sessions (`session-cost.ts` aggregator).
- Archived cost from `ProjectRecord.sessionHistory[].cost` for closed sessions.
- Sessions with zero cost or no cost data are excluded.

The dashboard is ephemeral — granularity and scope reset to defaults each app launch.

---

## Project Overview widgets

The Overview is a drag-and-drop dashboard per project. It's the home tab for each project. Toolbar:

- **+ Add Widget** — opens the widget picker with all registered types.
- **Edit layout** — toggle to expose drag handles, resize handles, and remove buttons on every tile. Click again to lock the layout.

### Available widgets

| Type | What it shows | Multiple? | Settings? |
|---|---|---|---|
| **AI Readiness** | Project readiness score, quick wins, category breakdown | No | No |
| **Provider Tools** | MCP servers, agents, skills, slash commands per installed CLI | No | No |
| **Recent PRs - GitHub** | Latest PRs for a repo (via local `gh` CLI), unread badges | Yes | Yes |
| **Recent Issues - GitHub** | Latest issues for a repo, unread badges | Yes | Yes |
| **Team** | Your team of AI personas | No | No |
| **Kanban** | Tasks grouped by column, with run/resume/edit | No | No |
| **Sessions** | Active sessions + recent archived | No | Yes |
| **Favorite Sessions** | Bookmarked archived sessions | No | No |

### GitHub widgets

The GitHub widgets shell out to your local `gh` CLI — no API tokens stored in AI-yard. Repo defaults to the project's `git remote origin`. Per-widget settings let you override repo, state filter (`open`/`closed`/`all`), max items, and refresh interval. Unread tracking is per-item via `lastSeen` timestamps stored on the project.

If you don't see PRs/issues:
- Confirm `gh auth status` is logged in
- Confirm the project has a git remote
- Open the widget settings to point at a specific repo

---

## Team members (personas)

The Team tab is a global library of AI personas (not per-project). Each member has a name, role, system prompt, and optionally an `agentSlug`.

**Member actions:**

- **Chat** — opens a session preconfigured with the member's system prompt.
- **Edit** — change name, role, prompt, or `installAsAgent` flag.
- **Sessions** — list sessions started from this member.
- **Delete** — removes the member (and uninstalls any agent files).

### Predefined personas

The "Browse" picker fetches a curated list from a GitHub repo (`TEAM_MEMBERS_REPO` in `src/shared/team-config.ts` — currently `elirantutia/vibeyard/personas`). Already-installed members are marked. The list is cached for 1 hour.

### Install as agent

Members with `installAsAgent: true` are mirrored as `<slug>.md` files in every installed provider's agents directory:

- `~/.claude/agents/<slug>.md`
- `~/.codex/agents/<slug>.md`
- `~/.copilot/agents/<slug>.agent.md`
- `~/.gemini/agents/<slug>.md`

This makes them invokable as `/<slug>` inside any CLI session. Renaming a member preserves the slug.

---

## Browser tabs and inspect mode

Browser tabs are full Chromium webviews inside AI-yard, useful for previewing local dev servers next to your terminal.

### Open a URL

Open a new browser tab from the new-tab menu. The new-tab page shows quick-launch buttons for `localhost:3000`, `localhost:5173`, `localhost:8080`, and `localhost:4200` — handy if you usually have a dev server running on one of those.

### Inspect mode

Toggle inspect mode on the browser tab. Hovering an element shows a popover with:

- Tag, classes, id
- Visible text content
- Multiple selector options (CSS selector, XPath, text-based) — copy any one to clipboard

**For AI editing**: click any element and AI-yard sends its selector + text + page URL as context to the active session. Useful for prompts like "make this button bigger" without typing the selector yourself.

---

## MCP servers

Add MCP (Model Context Protocol) servers via the MCP Inspector. Two transport types are supported in the add modal:

- **stdio (command)** — runs a local binary, reads/writes JSON-RPC over stdin/stdout
- **sse (URL)** — connects to a remote MCP endpoint

Each server can be added at:

- **User scope** — applies to every project (stored in CLI's user settings)
- **Project scope** — only this project (stored in project's CLI config file)

Environment variables are configured as `KEY=VALUE` per line in the modal.

The inspector shows server status (connected/configured/error), available tools, and lets you remove servers.

---

## Hooks

AI-yard installs hook scripts into each CLI's hooks config to capture session events (start, prompt, tool use, stop). This is what powers the inspector timeline, status indicators, and cost tracking.

See [HOOKS.md](../HOOKS.md) for the full hook lifecycle, the env vars passed to subprocesses (`AIYARD_SESSION_ID` since the 2026-05-07 rename), and the file paths used.

---

## Preferences

Open with the standard preferences shortcut for your platform (or via the menu). Five sections:

### General
- **Default provider** — used when starting a new session without explicit choice
- **Confirm close on working session** — prompts before closing a session that's mid-task
- **Sound on session waiting** — audio cue when a session needs your input
- **Desktop notifications** — system notifications for session state changes
- **Session history** — toggle archive of closed sessions
- **Insights** — toggle context/cost insights tracking
- **Auto-title** — derive session names from the first prompt
- **Copy on select** — terminal text-selection copies to clipboard automatically
- **Show Cost dashboard sidebar button** — toggles the per-project Cost button. On by default. Live update — no restart needed.

#### Privacy
- **Send crash reports** — opt-in Sentry crash reporting from the main process. Off by default. Even when on, reports are only transmitted if `SENTRY_DSN` is set in the environment when AI-yard launches; without a DSN the toggle is a no-op. Stack frames are scrubbed so home-directory paths become `~` and `~/.ai-yard` becomes `<state>` before leaving the machine. Toggling requires an app restart.
- **Send anonymous usage stats** — opt-in counters for app launch, session start (per provider), and feature use (kanban / team / browser-tab / overview). Off by default. Even when on, events are only transmitted if both `TELEMETRY_ENDPOINT` and `TELEMETRY_WEBSITE_ID` env vars are set when AI-yard launches; without them the toggle is a no-op. No file paths, project names, or session contents are ever sent. See [docs/PRIVACY.md](PRIVACY.md) for the full payload shape and how to clear your anonymous device id. Toggling requires an app restart.

### Appearance
- **Theme** — light or dark, applied live to terminals and UI
- Re-themeable while sessions are running

### Shortcuts
- View and rebind all 33 keyboard shortcuts (see the table below)
- Reset individual shortcuts to defaults

### Setup
- Re-run prerequisite checks (CLI installations, Python on Windows, etc.)
- Reinstall hooks for each provider

### About
- Version, credits, links

---

## Sharing sessions (P2P)

AI-yard can share a live session with a peer over WebRTC — no servers in between, no recording.

**Modes:**

- **Read-only** (default) — the guest sees terminal output but can't type
- **Read-write** — the guest can type into your session

**Flow:**

1. Host opens the share dialog from the session header
2. Host picks a mode and a 4–8 digit PIN
3. Host generates an offer code, sends it (Slack, message) to the guest
4. Guest enters the PIN + offer, generates an answer code, sends it back
5. Host pastes the answer; the connection is established

The PIN is required at both ends — it's used as the encryption key, not just an authentication token. If the PIN is wrong, the encrypted channel won't decode and nothing connects.

---

## Keyboard shortcuts

All shortcuts are rebindable in Preferences → Shortcuts. Defaults below; on macOS `Ctrl` becomes `Cmd` automatically.

### Sessions

| Action | Keys |
|---|---|
| New Session | `Cmd/Ctrl+T` |
| New Session (Alt) | `Cmd/Ctrl+Shift+N` |
| New Project | `Cmd/Ctrl+Shift+P` |
| Close Session | `Cmd/Ctrl+W` |
| Go to Session 1–9 | `Cmd/Ctrl+1` … `Cmd/Ctrl+9` |
| Next Session | `Cmd/Ctrl+Shift+]` |
| Previous Session | `Cmd/Ctrl+Shift+[` |
| Back (Tab History) | `Cmd/Ctrl+[` |
| Forward (Tab History) | `Cmd/Ctrl+]` |

### Panels

| Action | Keys |
|---|---|
| Toggle Sidebar | `Cmd/Ctrl+B` |
| Toggle Split Mode | `Cmd/Ctrl+\` |
| Project Terminal | `` Ctrl+` `` |
| Project Terminal (Alt) | `Cmd/Ctrl+J` |
| Toggle Session Inspector | `Cmd/Ctrl+Shift+I` |
| Usage Stats | `Cmd/Ctrl+Shift+U` |
| Git Panel | `Cmd/Ctrl+Shift+G` |
| Debug Panel | `Cmd/Ctrl+Shift+D` |

### Search and help

| Action | Keys |
|---|---|
| Quick Open File | `Cmd/Ctrl+P` |
| Search All Sessions | `Cmd/Ctrl+Shift+F` |
| Find (in terminal) | `Cmd/Ctrl+F` |
| Go to Line | `Cmd/Ctrl+L` |
| Help | `F1` |

### View

| Action | Keys |
|---|---|
| Zoom In | `Cmd/Ctrl+=` |
| Zoom Out | `Cmd/Ctrl+-` |
| Reset Zoom | `Cmd/Ctrl+0` |

---

## Troubleshooting

### "Claude CLI not found"
The app couldn't locate the Claude CLI on `PATH`. Install it (`npm i -g @anthropic-ai/claude-code` or via the official installer), then re-run prerequisite checks in Preferences → Setup.

### "Python Not Found" warning on Windows
Hook scripts are Python. Install Python 3 from python.org and ensure `python` or `python3` is on `PATH`.

### Sessions don't show cost or context
Cost telemetry comes from CLI hooks. If hooks aren't installed:
- Open Preferences → Setup
- Click "Reinstall hooks" for the affected provider
- Start a new session — existing sessions started before reinstall won't get retroactive data

### GitHub widget shows nothing
- Run `gh auth status` in a terminal — must be logged in
- The widget defaults to the project's git remote; if there's no remote, set the repo explicitly via the widget's gear icon (settings)

### Sessions disappear after restart
Check `~/.ai-yard/state.json` exists and is writable. If it was deleted or corrupted, projects need to be re-imported. Backup the file periodically if you have important kanban tasks.

### Browser tab logs `ERR_CONNECTION_REFUSED`
The new-tab page suggestion buttons (`localhost:3000`, etc.) only navigate when clicked. The error appears if you click one before starting your dev server. Start the server, then refresh the browser tab.

### Hooks installed but inspector still empty
Hooks write to `~/.ai-yard/run/<session-id>/`. If the directory exists but the inspector is empty, check the dev tools console (`Cmd/Ctrl+Shift+D` to open Debug Panel, then enable DevTools) for IPC errors.

### Auto-updater never shows update notifications
Intentional in this fork. The `electron-builder` `publish` block was removed during the Vibeyard → AI-yard rename, so the updater has no feed to check against and is held dormant on purpose (rather than spamming "no provider configured" errors). When a release pipeline lands at `mikulgohil/ai-yard`, the updater can be re-enabled — see `docs/IMPROVEMENTS.md` A4 and `docs/RENAME.md` Tier 2 for the path forward.

---

## See also

- [README.md](../README.md) — install, project overview, demo GIFs
- [HOOKS.md](../HOOKS.md) — hook system internals and env vars
- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to contribute upstream
- [CLAUDE.md](../CLAUDE.md) — architecture for AI agents working in this codebase
