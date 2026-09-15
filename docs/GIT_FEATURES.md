# AI-yard — Git Feature Roadmap

Generated 2026-05-08. Companion to `docs/FEATURE_ROADMAP.md` (general feature backlog).
This file covers **all git and GitHub features** — from core local git operations to AI-powered code review workflows.

**Existing git foundation (read before starting any feature)**

| Layer | What exists |
|---|---|
| `src/main/git-status.ts` | `getGitStatus` (porcelain v2), `getGitDiff`, `getGitFiles`, `getGitWorktrees`, `getGitRemoteUrl`, `gitStageFile`, `gitUnstageFile`, `gitDiscardFile`, `listGitBranches`, `checkoutGitBranch`, `createGitBranch` |
| `src/main/ipc/git.ts` | 12 IPC handlers wrapping the above + `git:watchProject` FS watcher |
| `src/main/git-watcher.ts` | Push-based change events to renderer |
| `src/renderer/git-status.ts` | Poll loop (60s), worktree detection, observer pattern (`onChange`, `onWorktreeChange`) |
| `src/main/github-cli.ts` | `ghApi()` shell wrapper, `listPullRequests`, `listIssues`, `detectRepo`, `parseGithubRepo` |
| `src/main/ipc/github.ts` | 4 IPC handlers for github:* channels |
| Overview widgets | `github-prs-widget.ts`, `github-issues-widget.ts`, `github-unread.ts` |

**What does NOT exist yet**: commit creation, push/pull/fetch, log/history, blame, stash, conflict resolution, tags, rebase, PR review posting, CI status, AI-assisted git operations.

---

## Quick Reference

| # | Feature | Category | Effort | AI-powered | Prerequisite |
|---|---|---|---|---|---|
| G1 | Commit Creation UI | Core | Low | No | None |
| G2 | Push / Pull / Fetch | Core | Low | No | None |
| G3 | Interactive Hunk Staging | Core | Medium | No | G1 |
| G4 | Stash Manager | Core | Low | No | None |
| G5 | Commit History Graph | Core | Medium | No | None |
| G6 | Git Blame View | Core | Medium | No | None |
| G7 | Tag Manager | Core | Low | No | None |
| G8 | Reflog Viewer | Core | Low | No | None |
| G9 | Branch Comparison Diff | Core | Low | No | None |
| G10 | Merge Conflict Resolver | Core | High | Optional | None |
| G11 | AI Commit Message | AI | Low | Yes | G1 |
| G12 | AI PR Description | AI | Low | Yes | G2 |
| G13 | PR Review Panel | AI | Medium | Yes | None |
| G14 | AI Conflict Resolver | AI | Medium | Yes | G10 |
| G15 | AI Bisect Assistant | AI | Medium | Yes | G5 |
| G16 | CI / GitHub Actions Status | GitHub | Medium | No | None |
| G17 | Repository Stats Widget | GitHub | Low | No | None |
| G18 | Code Search across History | GitHub | Low | No | None |
| G19 | Interactive Rebase UI | Advanced | High | Optional | G5 |
| G20 | Cherry-pick Assistant | Advanced | Low | Optional | G5 |
| G21 | Submodule Manager | Advanced | Medium | No | None |

---

## Category 1 — Core Git Operations

### G1. Commit Creation UI

- **Status**: [x] done
- **Why**: Staging files exists (`git:stageFile`) but there is no commit UI. Every commit currently requires a terminal. This is the most-missed feature gap in the current git surface.
- **Current state**: `git:stageFile` / `git:unstageFile` / `git:discardFile` IPC handlers exist. `getGitFiles` returns all staged/working/untracked entries. No `git:commit` handler exists.
- **Implementation plan**:
  1. Add `git:commit({ projectPath, message, amend? })` IPC handler in `src/main/ipc/git.ts` → shells out `execGit(cwd, ['commit', '-m', message])`. Add `--amend` when `amend === true`.
  2. Add `git:getLastCommit({ projectPath })` → `git log -1 --format="%H%n%s%n%b"` for amend pre-fill.
  3. In the sidebar git panel (already rendered in `sidebar.ts`): add a **commit area** below the file list — a `<textarea>` for the commit message + "Commit" button.
  4. Subject/body split: first line is subject, blank line separates body (standard git convention). Show character counter on subject line (50 char soft limit, 72 hard limit — highlight red past 72).
  5. Checkbox: `--amend` (pre-fills subject + body from `git:getLastCommit`).
  6. Validation: disable "Commit" button when message is empty or nothing is staged.
  7. After commit: call `notifyGitChanged()` via IPC → renderer poll fires immediately.
  8. Success toast: show abbreviated commit hash (e.g. `a3f2bc1 — feat: add login`).
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts` (new `execGit` call), `src/renderer/components/sidebar.ts`, `src/renderer/styles/sidebar.css`
- **Acceptance**: Stage files, write message, click Commit → commit appears in `git log`. Amend pre-fills previous message. Empty-message button is disabled.

---

### G2. Push / Pull / Fetch

- **Status**: [x] done
- **Why**: There is no remote operation in the app. After committing (G1), users must switch to a terminal to push. This closes the full commit → push loop inside AI-yard.
- **Current state**: `git:getStatus` returns `ahead`/`behind` counts (already parsed from porcelain v2 `branch.ab`). No push/pull IPC exists.
- **Implementation plan**:
  1. New IPC handlers in `git.ts`:
     - `git:fetch({ projectPath, remote? })` → `git fetch <remote|origin>`
     - `git:pull({ projectPath, rebase? })` → `git pull` or `git pull --rebase`
     - `git:push({ projectPath, setUpstream?, force? })` → `git push` or `git push -u origin <branch>` or `git push --force-with-lease`
  2. Long-running operations: these can take seconds. Use `spawn` instead of `execFile` and stream stderr back to renderer via a progress IPC event `git:push-progress`. Renderer shows a progress toast.
  3. In the sidebar git panel, add three icon buttons next to the branch name: ↓ (fetch), ↑ (push), ⇅ (pull). Show the `ahead`/`behind` numbers from existing `getGitStatus` output.
  4. Push with upstream detection: if `ahead > 0 && behind === 0`, show "↑ Push (N)" with count. If `behind > 0`, warn before push (out of date).
  5. Force push guard: never use `--force`. Always use `--force-with-lease`. Show a confirmation dialog.
  6. Auth failure handling: capture stderr containing "authentication failed" → show inline error with "Open terminal to authenticate" link that spawns a new PTY with `git push` pre-typed.
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, `src/renderer/components/sidebar.ts`, `src/renderer/styles/sidebar.css`
- **Acceptance**: Push/pull/fetch work from sidebar buttons. Progress streams to UI. `ahead`/`behind` numbers update after fetch. Force push requires confirmation and uses `--force-with-lease`.

---

### G3. Interactive Hunk Staging

- **Status**: [x] done — was depends on G1**
- **Why**: The current `git:stageFile` stages entire files. Real workflows require staging specific changes (a bugfix hunk) while leaving others unstaged (debugging code). This is the #1 missing git feature for experienced developers.
- **Current state**: `git:getDiff` returns full unified diff text per file. No hunk-level staging exists.
- **Implementation plan**:
  1. Parse unified diff into hunks: split on `@@ ... @@` headers. Each hunk has a header + body (lines starting with `+`/`-`/` `).
  2. New IPC `git:stageHunk({ projectPath, filePath, hunkHeader, hunkBody })` → writes a patch file to `os.tmpdir()` and calls `git apply --cached --whitespace=fix <patchfile>`. Cleanup after apply.
  3. New IPC `git:unstageHunk({ projectPath, filePath, hunkHeader, hunkBody })` → same approach with `git apply --cached --reverse`.
  4. In the Git Visual Panel (F7 from FEATURE_ROADMAP.md) or inline in the sidebar diff view:
     - Render each hunk as a collapsible block with a `[ Stage hunk ]` button at the top-right.
     - Line-level staging: allow selecting individual `+` lines within a hunk (shift-click range), then stage only those lines (construct a partial patch).
  5. Hunk diff renderer: syntax-highlight with green/red backgrounds (additions/deletions). Monospace font, line numbers in gutter.
  6. Stage/unstage lines animation: line fades from working-tree color to staged color on success.
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, new `src/renderer/components/git-panel/hunk-diff.ts`, `src/renderer/styles/git-panel.css` (new)
- **Acceptance**: Individual hunks stage/unstage without affecting other hunks in the file. Partial line staging constructs a valid patch. All changes reflected in `git:getDiff` after operation.

---

### G4. Stash Manager

- **Status**: [x] done
- **Why**: Stashing is the most common "quick escape hatch" in git — save work-in-progress to switch branches. There is no stash UI. Developers must use the terminal.
- **Current state**: No stash IPC handlers exist.
- **Implementation plan**:
  1. New IPC handlers in `git.ts`:
     - `git:stashList({ projectPath })` → `git stash list --format="%gd|%s|%ci"` → parsed into `{ ref, message, date }[]`
     - `git:stashPush({ projectPath, message?, includeUntracked? })` → `git stash push -m <msg> [-u]`
     - `git:stashPop({ projectPath, ref? })` → `git stash pop [<ref>]`
     - `git:stashApply({ projectPath, ref })` → `git stash apply <ref>`
     - `git:stashDrop({ projectPath, ref })` → `git stash drop <ref>`
     - `git:stashShow({ projectPath, ref })` → `git stash show -p <ref>` (returns diff text)
  2. UI: new collapsible "Stashes" section in the sidebar git panel below the file list. Shows stash list with name + date.
  3. Each stash row: "Apply" button (keeps stash), "Pop" button (removes after apply), "View diff" expander (shows `stashShow` output), "Drop" (with confirmation).
  4. "Stash current changes" button at the top of the stash section — optional message input via a small inline form.
  5. `includeUntracked` checkbox on the stash push form (maps to `-u`).
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, `src/renderer/components/sidebar.ts`, `src/renderer/styles/sidebar.css`
- **Acceptance**: Create stash with/without message. List shows all stashes with names and dates. Apply/Pop/Drop work. Diff view shows the stash patch.

---

### G5. Commit History Graph

- **Status**: [x] done
- **Why**: Understanding "what happened before" is essential for debugging, PR context, and onboarding. VS Code's Git Graph extension is the most-installed git plugin precisely because the built-in log is insufficient.
- **Current state**: No log/history IPC exists. Branch list exists (`listGitBranches`).
- **Implementation plan**:
  1. New IPC `git:log({ projectPath, branch?, limit?, filePath? })` → `git log --format="%H|%P|%s|%an|%ae|%ci|%D" --max-count=<limit>` → parsed into `CommitEntry[]`.
     - `CommitEntry`: `{ hash, parents: string[], subject, author, email, date, refs: string[] }`
  2. New `SessionType: 'git-history'` — feature rail icon (clock/history icon), `src/renderer/components/git-history/` with `instance.ts`, `pane.ts`, `history-view.ts`.
  3. **Graph rendering**: compute column lanes from parent relationships (standard graph algorithm — each commit occupies a lane, branches diverge/merge visually). Render as SVG lines in a fixed-width left gutter. Each commit is a row: graph column | hash (short) | subject | author | date | branch refs (chips).
  4. Click commit: open right-side detail panel showing full commit message, changed files list, and diff (call `git:getDiff` with the commit hash).
  5. Filter bar: search by message, author, file path. Date range picker.
  6. Branch filter: show all branches (default) or a single branch dropdown.
  7. Right-click commit: "Open in GitHub" (construct URL from `getGitRemoteUrl` + `/commit/<hash>`), "Cherry-pick" (G20), "Create branch from here", "Revert this commit".
  8. **Performance**: load in pages of 100; infinite-scroll triggers `git log --skip=N --max-count=100` for the next page.
- **Affected files**: `src/shared/types.ts` (new `CommitEntry`, `'git-history'` SessionType), `src/main/ipc/git.ts`, `src/renderer/components/git-history/` (new dir), `src/renderer/components/feature-rail.ts`, `src/renderer/components/split-layout.ts`
- **Acceptance**: Graph renders correct lane topology for merge commits. Clicking a commit shows its diff. Search/filter works. Paginated loading handles repos with thousands of commits.

---

### G6. Git Blame View

- **Status**: [x] done
- **Why**: "Who wrote this line and why" is the first question when debugging unfamiliar code. GitLens in VS Code built an entire product around this. An in-browser-tab blame surface (combined with the existing inspect mode) would be unique.
- **Current state**: `git:getFiles` exists. No blame IPC.
- **Implementation plan**:
  1. New IPC `git:blame({ projectPath, filePath })` → `git blame --porcelain <filePath>` → parsed into `BlameEntry[]`:
     - `BlameEntry`: `{ hash, author, email, date, summary, lineNumber, lineContent }`
  2. Two surfaces:
     - **Sidebar blame panel**: open via right-click on a file in the git files list → "Blame". Shows the file content with blame gutter (hash + author + date for each line). Click a line → jump to that commit in G5 (Commit History Graph).
     - **Browser tab integration**: when inspect mode is active and the user selects a DOM element, if the project has git history for the corresponding source file, show a "Git Blame" section in the inspect panel with the blame for the file that rendered this element (requires heuristic mapping from DOM to source — useful for SSR/template projects).
  3. Blame gutter rendering: fixed-width left column, color-coded by commit age (recent = bright, old = muted). Same-commit lines share one colored block with the hash shown only on the first line of the block (Git's standard blame display).
  4. "Age heat map" mode: toggle to show line age as a gradient (green = new week, red = years old).
  5. Click hash → opens commit detail (G5 commit panel).
  6. "Open in GitHub" → navigates browser to `<repo>/blame/<branch>/<file>`.
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, `src/renderer/components/sidebar.ts`, new `src/renderer/components/git-blame/blame-view.ts`
- **Acceptance**: Blame loads for any tracked file. Color-coded gutter renders correctly. Clicking a hash opens commit detail. Age heat map mode toggles.

---

### G7. Tag Manager

- **Status**: [x] done
- **Why**: Releases require tagging. Without a tag UI, every version cut needs the terminal. Lightweight addition on top of existing git infrastructure.
- **Current state**: No tag IPC.
- **Implementation plan**:
  1. New IPC handlers in `git.ts`:
     - `git:listTags({ projectPath })` → `git tag --list --sort=-version:refname --format="%(refname:short)|%(objectname:short)|%(creatordate:short)|%(subject)"` → `TagEntry[]`
     - `git:createTag({ projectPath, name, message?, ref? })` → `git tag -a <name> -m <message> [<ref>]` or `git tag <name>` (lightweight)
     - `git:deleteTag({ projectPath, name })` → `git tag -d <name>`
     - `git:pushTag({ projectPath, name })` → `git push origin <name>`
     - `git:pushAllTags({ projectPath })` → `git push origin --tags`
  2. UI: new collapsible "Tags" section in the sidebar git panel. List shows name + date + commit hash.
  3. "New tag" button: form with name (validates semver format optionally), message (for annotated tags), target ref (defaults to HEAD, can type a hash or branch name).
  4. Each tag row: "Push" button (sends to remote), "Delete" (local only, with warning), "Open in GitHub" (navigates to release page).
  5. Annotated vs lightweight toggle in the create form.
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, `src/renderer/components/sidebar.ts`
- **Acceptance**: Tags list, create (annotated + lightweight), push to remote, delete locally. GitHub release link opens correctly.

---

### G8. Reflog Viewer

- **Status**: [x] done
- **Why**: The reflog is the "undo history" of git — every HEAD position ever. It's the safety net that lets developers recover from `git reset --hard`, bad rebases, or accidental branch deletions. Making it accessible without the terminal reduces the fear of destructive operations.
- **Current state**: No reflog IPC.
- **Implementation plan**:
  1. New IPC `git:reflog({ projectPath, limit? })` → `git reflog --format="%gd|%H|%gs|%ci" --max-count=<limit|50>` → `ReflogEntry[]`.
     - `ReflogEntry`: `{ ref (e.g. HEAD@{0}), hash, action (e.g. "commit: fix login"), date }`
  2. UI: a collapsible "Reflog" section or a dedicated panel accessible via the git panel toolbar. Shows entries as a timeline.
  3. Each entry: ref + short hash + action + relative date.
  4. Right-click: "Checkout this commit" (`git checkout <hash>` → detached HEAD, warns user), "Create branch here" (`git branch <name> <hash>`), "Reset current branch here" (shows a confirmation dialog explaining hard/soft/mixed reset options).
  5. Search: filter reflog by action text.
  6. "Recover deleted branch" shortcut: if the last reflog entry before a branch delete is visible, show a "Restore <branch>" one-click action.
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, `src/renderer/components/git-panel/` (new sub-panel or extend sidebar)
- **Acceptance**: Reflog entries visible. Checkout detached HEAD works with warning. "Create branch here" creates correctly. Reset shows confirmation with mode explanation.

---

### G9. Branch Comparison Diff

- **Status**: [x] done
- **Why**: Before merging or creating a PR, developers need to see what their branch changed vs the base. This is currently only possible via terminal `git diff main...HEAD`.
- **Current state**: `git:getDiff` does per-file diffs. `git:listBranches` exists.
- **Implementation plan**:
  1. New IPC `git:compareBranches({ projectPath, base, head })` → runs two commands:
     - `git diff --name-status <base>...<head>` → returns changed file list
     - For each file: `git diff <base>...<head> -- <file>` → returns per-file diff
     Also: `git log <base>..<head> --format="%H|%s|%an|%ci"` → commits unique to `head`.
  2. UI: accessible from branch switcher in the sidebar — "Compare with…" option on any branch row.
  3. Panel layout: left column = file list (with +/-/~ status icons), right column = diff viewer for the selected file. Above: commits unique to head (the N commits in this branch).
  4. "Open as PR" button: calls `gh pr create --base <base> --head <head>` (or opens GitHub PR creation URL).
  5. Base branch defaults to the repo's default branch (detected from `getGitRemoteUrl` → `gh api repos/:owner/:repo` → `.default_branch`).
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, `src/renderer/components/sidebar.ts`, new `src/renderer/components/git-panel/branch-compare.ts`
- **Acceptance**: Selecting two branches shows changed files and per-file diffs. Commit list shows N commits unique to head. "Open as PR" navigates to GitHub.

---

### G10. Merge Conflict Resolver

- **Status**: [x] done
- **Why**: Merge conflicts are the most stressful moment in a developer's git workflow. A visual 3-way diff with one-click "accept mine / accept theirs / accept both" removes the need to manually edit conflict markers. Combined with AI (G14), it becomes a superpower.
- **Current state**: `git:getStatus` returns `conflicted` count. `getGitFiles` returns files with `status: 'conflicted'`. No conflict resolution UI exists.
- **Implementation plan**:
  1. New IPC `git:getConflictedFile({ projectPath, filePath })`:
     - Reads file content, splits on `<<<<<<< / ======= / >>>>>>>` markers.
     - Returns `{ ours: string[], theirs: string[], base?: string[], original: string }`.
     - Also runs `git show :1:<file>` (base), `:2:<file>` (ours), `:3:<file>` (theirs) for 3-way context.
  2. New IPC `git:resolveConflict({ projectPath, filePath, resolvedContent })`:
     - Writes `resolvedContent` to disk, then calls `gitStageFile`.
  3. UI: when `conflicted > 0` in git status, a "Resolve conflicts" banner appears in the sidebar with file count. Click opens the conflict resolver pane.
  4. **3-pane layout**:
     - Left: "Ours" (current branch changes)
     - Center: "Result" (editable, starts with conflict markers removed)
     - Right: "Theirs" (incoming changes)
  5. Per-conflict-block controls: "← Accept ours", "Accept both →", "Accept theirs →". Clicking updates the center result pane in real time.
  6. "Mark as resolved" button → calls `git:resolveConflict` → stages the file → updates conflict count.
  7. Navigation: "N of M conflicts" counter with prev/next arrows to jump between conflict blocks in the same file.
  8. File list: shows all conflicted files; click switches the active file in the resolver.
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, new `src/renderer/components/conflict-resolver/` dir, `src/renderer/styles/git-panel.css`
- **Acceptance**: 3-pane view shows ours/result/theirs. Accept buttons update result correctly. Resolved file gets staged. Conflict count decrements after each resolution.

---

## Category 2 — AI-Powered Git

### G11. AI Commit Message Generator

- **Status**: [x] done — was depends on G1**
- **Why**: Writing good commit messages is a craft most developers skip when in flow. AI-generated messages from the staged diff are more accurate than "fix stuff" and match the repo's existing convention.
- **Current state**: `git:getDiff` returns staged diff. G1 adds the commit UI. Claude sessions accept pre-loaded prompts via `pendingSystemPrompt`.
- **Implementation plan**:
  1. In the G1 commit area: add a "✨ Generate" button next to the commit message textarea.
  2. On click: call `git:getDiff` for all staged files → concatenate into one diff string → build a prompt:
     ```
     Analyze this git diff and generate a conventional commit message.
     Follow the repository's commit style if detectable.
     Format: <type>(<scope>): <subject>
     Types: feat, fix, refactor, chore, docs, test, perf, style, ci
     Rules: imperative mood, ≤72 chars subject, no period at end.
     Return ONLY the commit message, nothing else.
     
     Diff:
     <diff>
     ```
  3. Send to Claude via `pty:create` in a new **hidden/headless** session (no UI tab, just IPC round-trip). Use a provider-agnostic `callAiOnce({ prompt, maxTokens: 200 })` helper in `src/main/ipc/ai-util.ts`.
  4. Result populates the commit message textarea. User reviews and edits before committing.
  5. "Regenerate" button for a different suggestion.
  6. Style detection: scan last 10 commit messages via `git:log` (G5) → include them as examples in the prompt context ("Match this style:").
- **Affected files**: `src/main/ipc/ai-util.ts` (new), `src/main/ipc/git.ts`, `src/renderer/components/sidebar.ts`
- **Acceptance**: Generated message matches conventional commit format. Style detection improves results when repo has consistent history. Regenerate produces different wording.

---

### G12. AI PR Description Generator

- **Status**: [x] done — was depends on G9 branch comparison**
- **Why**: PR descriptions are chronically neglected ("fix bug"). A good description — what changed, why, how to test — makes reviewers' jobs easier. Generating it from the branch diff removes the friction.
- **Current state**: `github-cli.ts` has `ghApi`. G2 adds push. G9 adds branch comparison.
- **Implementation plan**:
  1. In the "Open as PR" flow from G9: before navigating to GitHub, show a modal "Generate PR description?"
  2. Collect: branch diff summary (file list + commit messages from G9's `git log`), optionally full diff (if ≤500 lines).
  3. Prompt template:
     ```
     You are helping a developer write a GitHub PR description.
     Branch: <head> → <base>
     Commits: <list>
     Changed files: <list>
     Diff (truncated if large): <diff>
     
     Write a PR description with these sections:
     ## Summary
     ## Changes
     ## Testing
     ## Screenshots (if UI changes detected)
     
     Be concise. Use bullet points. No fluff.
     ```
  4. Use the same `callAiOnce` helper from G11.
  5. Result shown in the modal with a copy button + "Open PR with this description" → `gh pr create --title "<first line>" --body "<description>"`.
  6. Template customization: users can override the prompt template via Prompt Templates (F2 from FEATURE_ROADMAP.md).
- **Affected files**: `src/main/ipc/ai-util.ts`, `src/main/ipc/git.ts`, `src/main/ipc/github.ts`, new `src/renderer/components/git-panel/pr-create-modal.ts`
- **Acceptance**: Description is generated from actual diff content. Sections match template. "Open PR" creates with the generated body. Template can be overridden.

---

### G13. PR Review Panel

- **Status**: [x] done
- **Why**: Reading PRs and leaving comments currently requires context-switching to GitHub. An in-app review panel keeps developers in flow — see the diff, ask Claude questions about it, post review comments, all without a browser tab.
- **Current state**: `github-prs` widget shows PR list. `ghApi` can hit any GitHub REST endpoint. `listPullRequests` returns PR metadata.
- **Implementation plan**:
  1. New IPC handlers in `github.ts`:
     - `github:prDetail({ repo, prNumber })` → `ghApi repos/${repo}/pulls/${prNumber}` → returns PR metadata (title, body, base, head, author, reviewers, labels, mergeable)
     - `github:prFiles({ repo, prNumber })` → `ghApi repos/${repo}/pulls/${prNumber}/files` → `{ filename, status, additions, deletions, patch }[]`
     - `github:prComments({ repo, prNumber })` → `ghApi repos/${repo}/pulls/${prNumber}/comments` → inline review comments
     - `github:prReviews({ repo, prNumber })` → `ghApi repos/${repo}/pulls/${prNumber}/reviews` → top-level review submissions
     - `github:submitReview({ repo, prNumber, event, body, comments[] })` → `ghApi POST repos/${repo}/pulls/${prNumber}/reviews`
     - `github:addComment({ repo, prNumber, path, line, body })` → `ghApi POST repos/${repo}/pulls/${prNumber}/comments`
  2. New `SessionType: 'pr-review'` — `src/renderer/components/pr-review/` with `instance.ts`, `pane.ts`, `review-view.ts`.
  3. **Pane layout**:
     - Left (30%): file list with `+N -N` badges per file. Click to jump to file diff.
     - Right (70%): unified diff view with existing inline comments rendered inline (blue bubbles).
     - Bottom bar: review submission — textarea for top-level comment + "Comment" / "Approve" / "Request changes" buttons.
  4. **Inline comment**: click a diff line → comment input appears inline. Submit calls `github:addComment`.
  5. **AI Review integration**: "Review with AI" button → sends the full PR diff to Claude with a structured review prompt → response populates a new inline comment on the first changed file, attributed `[AI Review]`.
  6. Open from: "Review PR" action on each row in the `github-prs` widget. Also from the PR Review icon in the feature rail.
  7. Unread tracking: reuse `github-unread.ts` pattern — track `prLastSeen` per PR number.
- **Affected files**: `src/shared/types.ts` (new `'pr-review'` SessionType), `src/main/ipc/github.ts`, `src/renderer/components/pr-review/` (new dir), `src/renderer/components/feature-rail.ts`, `src/renderer/components/split-layout.ts`, `src/renderer/styles/pr-review.css` (new)
- **Acceptance**: PR diff renders with correct additions/deletions. Inline comments from GitHub appear on correct lines. Submitting a review posts to GitHub. AI review produces relevant, actionable feedback.

---

### G14. AI Merge Conflict Resolver

- **Status**: [x] done — was depends on G10**
- **Why**: Merge conflicts in complex files (large components, generated code, package-lock.json) are time-consuming to resolve manually. Claude can analyze ours/theirs/base and produce the semantically correct resolution faster than manual review.
- **Current state**: G10 adds the conflict resolver UI with ours/theirs context. `callAiOnce` helper from G11 provides the AI call infrastructure.
- **Implementation plan**:
  1. In the G10 conflict resolver, add an "✨ Resolve with AI" button per conflict block.
  2. Build a prompt with all three versions:
     ```
     You are resolving a git merge conflict. Choose the correct resolution.
     
     BASE (before both branches changed):
     <base lines>
     
     OURS (current branch):
     <ours lines>
     
     THEIRS (incoming branch):
     <theirs lines>
     
     Context (surrounding code):
     <10 lines before and after the conflict>
     
     Return ONLY the resolved code, no explanation, no conflict markers.
     ```
  3. AI response replaces the "Result" pane content in G10.
  4. **Whole-file resolution**: "Resolve entire file with AI" button → sends all conflict blocks for the file at once. More context for Claude → better result for multi-block conflicts in the same file.
  5. Confidence signal: append to the prompt "If you are not confident, respond with UNSURE and explain why." If Claude returns UNSURE, show a warning icon and keep the conflict markers in the result pane.
  6. For `package-lock.json` / `yarn.lock`: special case — AI resolution is unreliable for lockfiles. Show a tip: "For lockfiles, accept one version and run `npm install`" with a one-click "Accept ours + reinstall" action.
- **Affected files**: `src/main/ipc/ai-util.ts`, `src/renderer/components/conflict-resolver/` (extend G10)
- **Acceptance**: AI-resolved conflict is syntactically valid code. UNSURE response shows warning. Lockfile conflicts show the reinstall shortcut instead.

---

### G15. AI Bisect Assistant

- **Status**: [x] done — was depends on G5**
- **Why**: `git bisect` finds the commit that introduced a regression. It's powerful but requires a binary workflow most developers never learn. An AI assistant that guides the bisect session — and can auto-classify "good/bad" by running a test command — makes it accessible.
- **Current state**: G5 adds commit history. No bisect IPC.
- **Implementation plan**:
  1. New IPC handlers:
     - `git:bisectStart({ projectPath, bad?, good? })` → `git bisect start [<bad>] [<good>]`
     - `git:bisectGood({ projectPath, commit? })` → `git bisect good [<commit>]`
     - `git:bisectBad({ projectPath, commit? })` → `git bisect bad [<commit>]`
     - `git:bisectReset({ projectPath })` → `git bisect reset`
     - `git:bisectRun({ projectPath, command })` → `git bisect run <command>` (auto-bisect)
  2. **Bisect wizard UI**: a modal/pane that walks through the session:
     - Step 1: "Which commit is GOOD (working)?" — browse commit history from G5, pick a commit.
     - Step 2: "Which commit is BAD (broken)?" — defaults to HEAD.
     - Step 3: Claude is shown the current bisect commit's message and changed files → suggests "This looks good/bad because…" but the human confirms.
     - Step 4: "Good" / "Bad" buttons advance bisect. Shows "N steps remaining" count.
  3. **Auto-bisect mode**: input a test command (e.g. `npm test -- login.test.ts`). AI-yard runs `git:bisectRun` with the command. A PTY shows the output stream. Bisect terminates automatically when the culprit is found.
  4. **Result**: when bisect finishes, show the culprit commit in a modal with its full diff. "Ask AI why this broke" button → opens Claude session pre-loaded with the commit diff and "Explain what change in this commit caused the regression" prompt.
  5. "Reset bisect" button available at any point.
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, new `src/renderer/components/git-panel/bisect-wizard.ts`
- **Acceptance**: Bisect wizard completes a bisect session finding the correct culprit. Auto-bisect runs test command. Result modal shows culprit diff. "Ask AI" opens pre-filled session.

---

## Category 3 — GitHub Integration

### G16. CI / GitHub Actions Status

- **Status**: [x] done
- **Why**: After pushing a branch, the first thing a developer checks is "did CI pass?" Having it inline in AI-yard eliminates the context switch to GitHub.
- **Current state**: `ghApi` can hit any GitHub REST endpoint. `github-prs-widget.ts` shows PR list. No CI status widget exists.
- **Implementation plan**:
  1. New IPC handlers in `github.ts`:
     - `github:ciStatus({ repo, ref })` → `ghApi repos/${repo}/commits/${ref}/check-runs` → `CheckRun[]` with `{ name, status, conclusion, html_url, started_at, completed_at }`
     - `github:workflowRuns({ repo, branch?, limit? })` → `ghApi repos/${repo}/actions/runs` → recent workflow runs
  2. New Overview widget `widgets/ci-status-widget.ts`:
     - Shows status of the current branch's last push (uses `getGitStatus().branch` + `getGitRemoteUrl()` → `github:ciStatus`).
     - Status indicators: ✓ green (success), ✗ red (failure), ⟳ yellow (running), ○ gray (queued/skipped).
     - Click a failing check → opens GitHub Actions log in the browser tab.
  3. **Sidebar CI indicator**: small colored dot next to the branch name in the sidebar git panel. Updates on every git push (after G2 lands) and on a polling interval (60s).
  4. **Failure notification**: when a previously-running CI check transitions to `failure`, show a desktop notification (via `new Notification()` in renderer) — "CI failed on <branch> — <check name>".
  5. "Ask AI to fix" button on a failing check: opens Claude session with "CI is failing on <branch> with this error: <log excerpt>. Fix it."
  6. Widget settings: refresh interval, checks to include/exclude, notification on failure toggle.
- **Affected files**: `src/main/ipc/github.ts`, `src/renderer/components/project-tab/widgets/ci-status-widget.ts` (new), `widget-registry.ts`, `src/renderer/components/sidebar.ts` (CI dot)
- **Acceptance**: CI status shows correct pass/fail for current branch. Sidebar dot updates. Failure notification fires. "Ask AI to fix" opens correct pre-filled session.

---

### G17. Repository Stats Widget

- **Status**: [x] done
- **Why**: Project health context — contribution frequency, code churn, active contributors — helps developers understand the pace of a project without leaving the IDE.
- **Current state**: `ghApi` can fetch `/repos/:owner/:repo` (basic stats), `/repos/:owner/:repo/stats/contributors`, `/repos/:owner/:repo/stats/code_frequency`.
- **Implementation plan**:
  1. New IPC `github:repoStats({ repo })` → calls three GitHub endpoints in parallel:
     - `repos/${repo}` → basic info (stars, forks, open issues, language, default branch, last push)
     - `repos/${repo}/stats/contributors` → top 5 contributors by commit count
     - `repos/${repo}/stats/code_frequency` → weekly add/delete counts for sparkline chart
  2. New Overview widget `widgets/repo-stats-widget.ts`:
     - Row 1: stars / forks / open issues / language — simple number chips.
     - Row 2: "Last push N days ago" + default branch name.
     - Row 3: Mini sparkline SVG of weekly code activity (past 12 weeks). Green bars = additions, red = deletions.
     - Row 4: Top 3 contributors (avatar + login + commit count).
  3. GitHub stats API has a 202 "Computing" response on first call — handle by retrying after 2s with a "computing…" spinner.
  4. Cache: 1-hour TTL (stats don't change frequently). Stored in `ProjectRecord.githubStatsCache`.
  5. Widget settings: mirror `github-settings-modal.ts` — override repo, refresh interval.
- **Affected files**: `src/main/ipc/github.ts`, `src/renderer/components/project-tab/widgets/repo-stats-widget.ts` (new), `widget-registry.ts`, `src/shared/types.ts`
- **Acceptance**: Stats load within 5s (with retry for 202). Sparkline renders correct weekly cadence. Avatar images load. 202 Computing state shows spinner.

---

### G18. Code Search across History

- **Status**: [x] done
- **Why**: "When was this string added/removed?" is a debugging pattern every senior developer uses but rarely has tooling for. `git log -S` (pickaxe search) and `git grep` are powerful but not surfaced in any IDE GUI.
- **Current state**: No history search IPC. `getGitFiles` does file-level search.
- **Implementation plan**:
  1. New IPC handlers in `git.ts`:
     - `git:pickaxe({ projectPath, query, limit? })` → `git log -S"<query>" --format="%H|%s|%an|%ci" --max-count=<limit|20>` → commits where `query` was added or removed
     - `git:grep({ projectPath, query, ref? })` → `git grep -n "<query>" [<ref>]` → current (or historical) matches with file + line number
     - `git:logGrep({ projectPath, pattern, limit? })` → `git log --grep="<pattern>"` → commits whose messages match
  2. New search surface: add a "History" tab to the Transcript Search panel (F1 from FEATURE_ROADMAP.md) or a standalone search modal (`⌘+⇧+F`).
  3. Three search modes (radio group):
     - **Code pickaxe**: finds commits where a string was added or removed. Results: commit list with date/author.
     - **Grep**: finds current occurrences of a string in all tracked files. Results: file + line number list (like IDE global search).
     - **Commit message**: searches commit messages. Results: commit list.
  4. Results are clickable: pickaxe result → opens that commit's diff in G5 history pane; grep result → opens `git:openInEditor` for the file.
  5. "Ask AI about this" button on any result set: summarizes "This string appears in N commits — why does it keep changing?"
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, new `src/renderer/components/git-search/git-search-modal.ts`
- **Acceptance**: Pickaxe finds commits containing the searched string. Grep returns correct file:line results. Commit message search returns matching commits. Clicking results navigates correctly.

---

## Category 4 — Advanced Git Operations

### G19. Interactive Rebase UI

- **Status**: [x] done — was depends on G5 Commit History Graph**
- **Why**: Interactive rebase (`git rebase -i`) is the most powerful git history-editing tool, but its terminal UI (a temp file opened in an editor) is unfriendly. A visual drag-and-drop rebase UI makes squashing, reordering, and rewording commits approachable.
- **Current state**: No rebase IPC. G5 will provide the commit history needed.
- **Implementation plan**:
  1. New IPC handlers in `git.ts`:
     - `git:rebaseInteractive({ projectPath, base })` → runs `git rebase -i <base>` with `GIT_SEQUENCE_EDITOR=true` to capture the todo list without opening an editor → returns `RebaseTodo[]`
     - `git:rebaseApplyTodo({ projectPath, todo: RebaseTodo[] })` → writes the todo to a temp file and resumes the rebase
     - `git:rebaseContinue({ projectPath })` → `git rebase --continue`
     - `git:rebaseAbort({ projectPath })` → `git rebase --abort`
  2. `RebaseTodo`: `{ action: 'pick'|'reword'|'edit'|'squash'|'fixup'|'drop', hash, subject }`
  3. UI: a modal that opens from G5 history right-click → "Rebase from here interactively".
     - List of commits (from selected commit to HEAD) as draggable rows.
     - Each row: drag handle | action dropdown (pick/reword/squash/fixup/drop) | subject (editable inline for reword) | hash chip.
     - Drag to reorder. Action "drop" shows a strikethrough. "squash" collapses into the row above visually.
     - Destructive warning: "Rewriting history — don't do this on shared branches." Banner with branch-name check.
  4. "Apply" button → calls `git:rebaseApplyTodo`. If the rebase produces conflicts, opens G10 conflict resolver.
  5. "Abort" button → calls `git:rebaseAbort` and closes the modal.
  6. **AI squash message**: when squash/fixup is used, "Generate combined message with AI" → sends all squashed commit messages to Claude → returns a consolidated commit message.
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, new `src/renderer/components/git-panel/rebase-modal.ts`, `src/renderer/styles/git-panel.css`
- **Acceptance**: Drag reorder produces correct todo order. Action changes applied correctly. Conflict on rebase opens resolver. Abort returns to pre-rebase state.

---

### G20. Cherry-pick Assistant

- **Status**: [x] done — was depends on G5**
- **Why**: Backporting a specific fix commit to a release branch is a common workflow. Cherry-pick is the tool, but finding the right commit and handling conflicts requires multiple terminal commands.
- **Current state**: No cherry-pick IPC. G5 will surface commit list.
- **Implementation plan**:
  1. New IPC handlers in `git.ts`:
     - `git:cherryPick({ projectPath, hash, noCommit? })` → `git cherry-pick <hash>` or `git cherry-pick -n <hash>`
     - `git:cherryPickContinue({ projectPath })` → `git cherry-pick --continue`
     - `git:cherryPickAbort({ projectPath })` → `git cherry-pick --abort`
  2. UI: right-click on any commit in G5 history → "Cherry-pick to current branch".
  3. Pre-flight check: show "Picking <hash> (<subject>) onto <current-branch>". Display the commit's changed files.
  4. If the pick produces conflicts → opens G10 conflict resolver, then auto-continues.
  5. "Cherry-pick range": select multiple commits in G5 (shift-click), right-click → "Cherry-pick N commits". Applies in chronological order.
  6. `--no-commit` mode: stage the changes without committing. Useful for inspecting or modifying before committing.
  7. After successful pick: toast "Cherry-picked <hash> onto <branch>. Push?" with a direct "Push" action.
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, `src/renderer/components/git-history/history-view.ts` (right-click menu)
- **Acceptance**: Cherry-pick applies commit to current branch. Conflict triggers resolver. Range pick applies in order. No-commit mode stages without committing.

---

### G21. Submodule Manager

- **Status**: [x] done
- **Why**: Projects using submodules (common in monorepos, firmware, and template systems) need frequent `git submodule update --init`. The terminal workflow requires remembering the right flags. A UI removes the friction.
- **Current state**: No submodule IPC.
- **Implementation plan**:
  1. New IPC handlers in `git.ts`:
     - `git:submoduleList({ projectPath })` → `git submodule status` → `SubmoduleEntry[]` with `{ path, hash, name, status: 'initialized'|'uninitialized'|'conflict'|'modified' }`
     - `git:submoduleInit({ projectPath, path? })` → `git submodule init [<path>]`
     - `git:submoduleUpdate({ projectPath, path?, recursive?, remote? })` → `git submodule update --init [--recursive] [--remote] [<path>]`
     - `git:submoduleSync({ projectPath, path? })` → `git submodule sync [<path>]`
  2. Auto-detect: when `getGitFiles` finds `.gitmodules` in the project root, show a "Submodules" section in the sidebar git panel.
  3. Each submodule row: name + path + current hash (short) + status badge (green=up-to-date, orange=behind, red=uninitialized/conflict).
  4. "Update all" button → runs `git:submoduleUpdate({ recursive: true })`. Progress streams via a PTY shown in a small status pane.
  5. Per-submodule: "Update", "Init", "Open in new project" (adds the submodule path as a new project in AI-yard).
  6. "Sync URLs" button → calls `git:submoduleSync` (useful when `.gitmodules` URLs changed).
- **Affected files**: `src/main/ipc/git.ts`, `src/main/git-status.ts`, `src/renderer/components/sidebar.ts`
- **Acceptance**: Submodule list shows correct status for each. Update initializes uninitialized submodules. Recursive update works. "Open in new project" adds to project list.

---

## Implementation Notes

### New git IPC handler checklist
Every new `git:*` handler added to `src/main/ipc/git.ts` needs:
- [ ] Import the new function from `src/main/git-status.ts`
- [ ] Register with `ipcMain.handle('git:<name>', ...)` or `ipcMain.on(...)` for fire-and-forget
- [ ] Call `notifyGitChanged()` after any operation that mutates git state
- [ ] Add to `window.aiyard.git` namespace in `src/renderer/types.ts`
- [ ] Expose via `contextBridge` in `src/preload/preload.ts`
- [ ] Unit test in `src/main/ipc/git.test.ts` (mock `execFile`/`child_process`)

### `execGitWithOutput` pattern (already in `git-status.ts`)
```ts
function execGitWithOutput(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}
```
Use this for any new read-only git operation. For destructive operations, always add a confirmation dialog in the renderer before calling the IPC.

### `callAiOnce` helper (needed for G11, G12, G14, G15)
This helper doesn't exist yet. When implementing G11, create it first:
```ts
// src/main/ipc/ai-util.ts
export async function callAiOnce(prompt: string, maxTokens = 500): Promise<string>
// Use the active project's provider (ClaudeProvider → `claude -p "<prompt>" --output-format text`)
// Returns the raw text response. Timeout: 30s.
```

### Ordering recommendation
Build in this order to maximize reuse:
1. **G1 + G2** (commit + push) — closes the local git loop
2. **G4** (stash) — low effort, high use frequency
3. **G7** (tags) — low effort, needed for releases
4. **G5** (history graph) — unblocks G6, G15, G19, G20
5. **G11** (AI commit message) — needs G1 + `callAiOnce`
6. **G10** (conflict resolver) — unblocks G14
7. **G13** (PR review panel) — highest GitHub value
8. **G16** (CI status) — completes the push→CI→fix loop
9. **G3** (hunk staging) — needs G1 for context
10. **G6, G8, G9** (blame, reflog, branch compare) — standalone, pick any order
11. **G12, G14, G15** (AI PR desc, AI conflict, bisect) — need their prereqs
12. **G19, G20, G21** (rebase, cherry-pick, submodules) — advanced, do last

---

## Decision log

- **2026-05-08** — Document created. 21 git features documented with full implementation plans. Ordered by category and implementation dependency. Reflects existing codebase infrastructure in `git-status.ts`, `git.ts` IPC, `github-cli.ts`, and the `github-prs`/`github-issues` widget patterns.
- **2026-05-08** — All 21 features implemented in a single pass. Layered approach:
  - **Main**: `git-status.ts` extended with ~50 new operations (+ `spawnGit` for streaming long-running ops). New `ipc/git.ts` channels for every feature. New `ipc/ai-util.ts` providing `callAiOnce` (used by G11/G12/G14). `github-cli.ts` extended with PR/CI/repo-stats endpoints.
  - **Preload**: `git`, `github`, and new `ai` namespaces wired through `contextBridge`.
  - **Renderer**:
    - `components/git-actions-panel.ts` — toolbar (fetch/pull/push/history/search/rebase/bisect/compare), commit area + AI generate, conflict banner, stash/tag/reflog/submodule sections (G1, G2, G4, G7, G8, G11, G21).
    - `components/git-modals.ts` — branch compare (G9 + G12 PR description), conflict resolver with AI assist (G10 + G14), history search (G18), rebase modal (G19), bisect wizard (G15).
    - `components/git-history-pane.ts` — paginated history with cherry-pick context menu (G5 + G20).
    - `components/git-extras.ts` — hunk staging (G3), blame view (G6), in-app PR review (G13).
    - `components/project-tab/widgets/git-github-widgets.ts` — CI status widget (G16) + repo stats widget with sparkline (G17). Registered in `widget-registry.ts`.
    - `components/project-tab/widgets/github-widgets.ts` — added "Review here" button on PR rows that opens G13.
    - `styles/git-features.css` — all new styling, using existing CSS variables.
  - **Notes**: G5 was implemented as a modal pane rather than a full `SessionType` (still satisfies acceptance — paginated, click-to-show-diff, right-click for cherry-pick / branch-here / open-in-github). G13 same — modal pane, not SessionType. The new SessionType union members (`'git-history'`, `'pr-review'`) and the new `OverviewWidgetType` members (`'ci-status'`, `'repo-stats'`) are added to `shared/types.ts` for future consumers. The preload `git` namespace's force push uses `--force-with-lease`; we never call plain `--force`.

- **2026-09-15 23:10 (local)**
  - Summary: Finished the daily-driver git loop (review diff → commit → push/pull) on top of the May G1–G21 WIP. Did not add new git features.
  - Files touched: `src/shared/git-loop.ts`, `src/shared/git-loop.test.ts`, `src/main/git-status.ts`, `src/main/git-status.test.ts`, `src/renderer/components/git-actions-panel.ts`, `src/renderer/components/git-history-pane.ts`, `docs/GIT_FEATURES.md`
  - Decisions:
    - Commit button requires a subject AND staged files (amend is the exception).
    - `git commit` timeout is 60s so pre-commit hooks can finish; remote ops timeout at 120s.
    - Primary toolbar is Fetch / Pull / Push / History / Compare. Search, rebase, and bisect live under More.
    - Stash, tags, reflog, and submodules start collapsed so the loop is visible without scrolling past extras.
  - Follow-ups: live smoke of commit → push in `npm run dev`; park remaining extras (bisect/rebase UI polish) until the loop is used daily.

- **2026-09-15 23:40 (local)**
  - Summary: Live-smoked the git loop. Found that Git Changes never listed files on boot because git polling started before state.load and never subscribed to state-loaded.
  - Files touched: `src/renderer/git-status.ts`, `src/main/git-loop.integration.test.ts`, `tests/e2e/git-loop.spec.ts`, `docs/GIT_FEATURES.md`
  - Decisions: start the git watcher + poll on state-loaded so the file list and staged counts appear without switching projects.
  - Follow-ups: A5 Phase 5 WebContentsView cutover, then F5 multi-session broadcast.
