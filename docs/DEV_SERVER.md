# Dev Server Tab

One-click way to launch a project's dev server inside AI-yard, so users don't need an external terminal.

## User flow

1. Add a project (existing flow).
2. Click the **Run** button in the sidebar — primary, full-width pill that sits **above** the project name/path of the active project (extracted from the secondary view-tabs row so it reads as the project's primary action).
3. **First time** for a project:
   - Detection runs against `package.json` and the project root.
   - A confirmation modal opens with the resolved command pre-filled. The user can:
     - Pick a different script from the dropdown (only shown when `package.json` has more than one script).
     - Edit the command directly.
     - Toggle "Save as default for this project" (on by default).
   - On confirm → a new **Dev Server** tab opens, the shell PTY spawns in the project directory, and the resolved command is auto-typed into it.
4. **Subsequent runs** with a saved command: one click → tab opens immediately, no prompt.
5. **Right-click the Run button** for "Edit run command…" or "Clear saved command". When editing while a command is already saved, the modal seeds the **saved** command into the text field — not the freshly-detected one — so editing replaces what's saved rather than reverting to detection. (`sidebar.ts:626-633`).
6. **Auto-open in a browser tab**: as the dev server prints its first localhost URL (e.g. `http://localhost:4321/`), AI-yard opens it in an in-app browser tab automatically. Fires once per dev-server session; subsequent reloads/restarts don't spawn duplicate tabs (and `addBrowserTabSession` further dedupes by URL).

When a `runCommand` is saved, the button shows the command inline next to the label.

## Persistence model

State is intentionally split across two records:

| Field | Lives on | Purpose | Lifetime |
|---|---|---|---|
| `runCommand` | `ProjectRecord` | User-saved preference — what to spawn next time the user clicks ▶ | Persists in `~/.ai-yard/state.json`; cleared via right-click → "Clear saved command" |
| `devServerCommand` | `SessionRecord` | The exact command this session was spawned with | Tied to the session; never re-reads `runCommand` after spawn |

This split lets a user run a **one-off** command (uncheck "Save as default for this project" in the modal) without disturbing their saved preference. The Dev Server tab keeps running the one-off; subsequent ▶ clicks still use the saved value.

## Detection rules

Resolution priority, in order:

1. `package.json` with a recognized script — picks first match in `dev` → `start` → `serve`.
2. No matching script + `index.html` exists at the root → `npx http-server -p 0` (random free port).
3. Otherwise → `source: 'none'`. The modal still opens so the user can type a command manually.

Package manager is inferred from lockfile presence: `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, otherwise `npm` (which uses `npm run <script>`).

## Architecture

| Layer | File | Responsibility |
|---|---|---|
| Pure helpers | `src/shared/run-command.ts` | `pickRunScript`, `formatPmRun`, `pickPackageManager`. Shared by main + renderer to avoid drift. |
| Main detection | `src/main/dev-runner.ts` | Reads `package.json` + lockfiles. Pure-helper composition + io. |
| IPC | `src/main/ipc/dev-runner.ts` | Channel `dev-runner:detect`. Path-gated via `isWithinKnownProject`. |
| Preload bridge | `src/preload/preload.ts` | `window.aiyard.devRunner.detect(cwd)`. |
| Pane | `src/renderer/components/dev-server/pane.ts` | Lightweight xterm wrapper. Spawns via `pty.createShell`, auto-types the command on first show, kills the PTY on tab close. |
| Modal | `src/renderer/components/dev-server/confirmation-modal.ts` | Custom modal (bypasses `showModal` because it needs reactive script-picker → command updates). |
| Sidebar wire | `src/renderer/components/sidebar.ts` | Run button + click/contextmenu handlers. |
| Types | `src/shared/types.ts` | Adds `'dev-server'` to `SessionType`, `RunCandidate`, `PackageManager`. Adds `runCommand?` on `ProjectRecord`, `devServerCommand?` on `SessionRecord`. |
| State | `src/renderer/state.ts` | `openDevServerTab(projectId, command)`, `setProjectRunCommand(projectId, command)`. |
| Layout | `src/renderer/components/split-layout.ts` | Branches on `'dev-server'` for create / show / hide / destroy / fit. |
| Tab bar | `src/renderer/components/tab-bar.ts` | Badge (`▶`) + non-renamable + tooltip showing the command. |
| Styles | `src/renderer/styles/dev-server.css` | Pane positioning + tab-badge + sidebar dot. |

## Why a new SessionType (and not a new CliProvider)

`CliProvider` (`src/main/providers/`) is shaped for interactive AI CLIs — chat-style, hooks, status-line, cost tracking, session resume. A dev server is different: long-running, one-way logs, no chat, no cost. Wedging it into the provider system would require disabling half of every provider capability for one type. A standalone `'dev-server'` SessionType keeps the abstraction honest.

## Why spawn via `pty.createShell` and auto-type the command (vs spawning the binary directly)

- The shell shows the command being typed → debuggable, transparent.
- `Ctrl+C` works as users expect — they're inside their own shell.
- Reuses the existing `pty.createShell` IPC, which already inherits the user's `$PATH` (so `pnpm`/`yarn`/`npx` resolve correctly without re-implementing path detection).
- One trade-off: there's a startup race — the shell prompt may render before the auto-typed command. We `requestAnimationFrame` once after `createShell` resolves to give the prompt a frame to draw. Tested with zsh, bash, fish, PowerShell.

## Lifecycle

- **Tab open**: `pty.createShell` spawns a fresh shell at the project path. The resolved command is auto-typed after one `requestAnimationFrame` so the prompt has time to draw first.
- **Server exits on its own** (crash, `Ctrl+C`, framework shutdown): `pane.ts` catches the `pty:exit` and writes a dimmed `[process exited with code N]` line into the terminal. The tab stays open so final output remains readable. Re-clicking ▶ does *not* respawn into the same tab — close it first, then run again.
- **Tab closed**: `destroyDevServerPane` calls `pty.kill(sessionId)` (best-effort — the PTY may already be dead). Subscriptions are released, the xterm is disposed, and the DOM node is removed. There is no detached/background mode in v1.
- **Single tab per project**: `openDevServerTab` finds an existing `'dev-server'`-typed session via `findExistingTabByType` and focuses it instead of spawning a second PTY. This is intentional — "restart" is the explicit gesture *close tab → click ▶*, not silent respawn.

## Tests

- `src/shared/run-command.test.ts` — pure-helper coverage (priority, pm picking, formatting).
- `src/main/dev-runner.test.ts` — io integration with mocked `node:fs`. Covers all branches of `detectRunCommand` plus malformed-package.json and missing-scripts-field defenses.

The `node:fs` prefix in the test mock is deliberate — bare `'fs'` mocks fail in this project's vitest setup (see the broader 37-file fs-resolve issue, separate from this feature).

## Browser auto-open

The dev-server pane subscribes to its own PTY stream and runs each chunk through a small URL sniffer (`maybeAutoOpenUrl` in `pane.ts`):

- Buffer last 4KB of output, ANSI CSI escapes stripped before matching.
- Regex: `https?://(localhost|127.0.0.1)(:\d+)?(/...)?`. Network/LAN URLs (e.g. `0.0.0.0`, `192.168.x.x`) are intentionally ignored — the LAN URL is rarely what the user wants in-app.
- On first match → `appState.addBrowserTabSession(projectId, url)`. The new session activates (matching the typical "click a link → see it" UX) but the dev-server PTY keeps running in the background.
- The instance flag `urlOpened` ensures a single shot per session even if the user hot-reloads or the framework reprints the banner.

## Known limits / future polish

- **No env-var configuration.** If a user wants `PORT=3001 pnpm dev`, they edit the saved command directly.
- **No status integration with the Overview readiness widget.** A "running / stopped" indicator would be a nice cross-link, but not v1.
- **No persistent log buffer.** The xterm scrollback is whatever xterm holds; closing the tab loses everything.
- **Path security is detection-only.** `dev-runner:detect` rejects empty cwds and paths outside known projects (returns `{source: 'none', command: ''}`); it does not validate the *command* the user types in the modal. By design — the user owns their machine — but worth knowing if this ever ships to a multi-user environment.
