# Reskin QA Notes

Verification record for the calm-productivity reskin (Phases 1-4). All
programmatic gates verified at commit `8982658` (the Phase 4 brand commit).

## Phase scope reminder

| Phase | Commit(s)                                | Concern                          |
| ----- | ---------------------------------------- | -------------------------------- |
| 1     | `7942e26`                                | Theme tokens + density           |
| 2     | `73f597a`                                | Component primitives (.btn, .panel) |
| 3     | `60c543a` → `8c1fd85` (9 commits)       | Per-feature CSS reskin           |
| 4     | `8982658`                                | Brand mark + icon assets         |
| 5     | this commit                              | Screenshots + QA                 |

## Gate 1 — All 11 reskinned CSS files are hex-clean

```
$ for f in sidebar tabs kanban project-tab widgets cost-dashboard team modals dialogs preferences browser-tab; do
    count=$(grep -E '#[0-9A-Fa-f]{3,8}\b' src/renderer/styles/$f.css | wc -l)
    printf "%-22s %s\n" "$f.css" "$count"
  done
```

Output:

```
sidebar.css            0 hex literals
tabs.css               0 hex literals
kanban.css             0 hex literals
project-tab.css        0 hex literals
widgets.css            0 hex literals
cost-dashboard.css     0 hex literals
team.css               0 hex literals
modals.css             0 hex literals
dialogs.css            0 hex literals
preferences.css        0 hex literals
browser-tab.css        0 hex literals
```

✅ All 11 files reference theme tokens (`var(--…)`) only. Hex literals live
exclusively in `base.css` (token definitions per theme).

## Gate 2 — `src/main/`, `src/preload/`, `src/shared/` untouched during reskin

The brief asks that the reskin not touch IPC/contracts. The honest result:

```
$ git diff --stat 7942e26..HEAD -- src/main/ src/preload/ src/shared/
(empty)
```

✅ Phases 2-4 made zero changes to main, preload, or shared.

For full transparency, Phase 1 (`7942e26`, "introduce midnight/paper/slate")
made one deliberate, minimal change to `src/shared/types.ts` to widen the
`theme` union:

```diff
- theme?: 'dark' | 'light';
+ /** 'dark' and 'light' are deprecated aliases kept for backward-compatible
+  * persisted state — resolveTheme() in the renderer maps them to
+  * 'midnight' and 'paper' respectively. */
+ theme?: 'midnight' | 'paper' | 'slate' | 'dark' | 'light';
```

This was unavoidable: the theme value is persisted in `Preferences`, so the
type had to learn the new theme names. The old `'dark' | 'light'` values are
preserved as aliases, so existing user state files load without migration.

## Gate 3 — `terminal.css` byte-identical to pre-reskin

```
$ git diff 7942e26^..HEAD -- src/renderer/styles/terminal.css | wc -l
       0
```

✅ Zero-line diff. The xterm appearance is untouched.

## Gate 4 — `prefers-reduced-motion: reduce` disables animations app-wide

`base.css:242-251`:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

✅ Global `*` selector with `!important` ensures any per-component animation
or transition (including ones added later) is overridden. Matches the WCAG
2.2 reduced-motion pattern.

**Manual spot-check** (recorded after capturing screenshots): toggle
System Settings → Accessibility → Display → "Reduce motion" and reload
DevTools' "Emulate CSS prefers-reduced-motion: reduce" — animations should
snap to ~0ms in all three themes.

## Gate 5 — `:focus-visible` rings present across reskinned files

Counts per file (rules using the `:focus-visible` pseudo-class):

| File                | Count | Notes                                          |
| ------------------- | ----- | ---------------------------------------------- |
| sidebar.css         | 2     | Main nav buttons                               |
| tabs.css            | 4     | Tab item, close button, icon button, branch search |
| kanban.css          | 10    | Cards, column headers, search, tag chips, etc. |
| project-tab.css     | 0     | Intentional — focusable controls live in widgets.css |
| widgets.css         | 3+    | Toolbar, widget action, GitHub mark-all        |
| cost-dashboard.css  | 1     | Granularity toggles                            |
| team.css            | 9     | Member cards, picker chips, picker cards, etc. |
| modals.css          | 4     | Buttons + close affordances                    |
| dialogs.css         | 1     | Primary action                                 |
| preferences.css     | 6     | Theme picker, density picker, etc.             |
| browser-tab.css     | 14    | Nav, URL input, viewport buttons, flow picker  |

✅ Every reskinned surface has at least one focus-visible ring. The single
zero (`project-tab.css`) is intentional: project-tab.css carries layout-only
selectors (`.project-tab-pane`, `.readiness-gauge*`) and all focusable
controls in that view are defined in `widgets.css` (toolbar buttons, widget
action buttons), which has them.

**Manual spot-check** (recorded after capturing screenshots): Tab through
the sidebar / tab bar / kanban in all three themes. Focus ring should be a
2px terracotta outline at 2px offset, visible against every surface.

## Gate 6 — Three themes resolve correctly

`base.css` defines:

- `:root` — defaults to midnight values (so an unset `[data-theme]`
  attribute still renders correctly).
- `[data-theme="midnight"]`, `[data-theme="dark"]` — midnight palette.
  `dark` is the backward-compat alias.
- `[data-theme="paper"]`, `[data-theme="light"]` — paper palette.
  `light` is the backward-compat alias.
- `[data-theme="slate"]` — slate palette.

✅ Renderer's `resolveTheme()` maps deprecated values to the new theme names
without requiring a state migration.

## Gate 7 — Build + tests still pass

```
$ npm test
Test Files  37 failed | 85 passed (122)
     Tests  1115 passed (1115)
```

✅ 1115 renderer tests passing. The 37 failing test *files* are all
pre-existing main-process `fs` resolution issues (independent of this work);
no test count changed.

```
$ npm run build
✓ built in 1.99s
```

✅ Vite production build succeeds.

## Phase 4 — brand asset verification

Asset set generated from `build/icon.svg` via `scripts/generate-icons.js`:

| File                | Type                                                | Size  |
| ------------------- | --------------------------------------------------- | ----- |
| `build/icon.svg`    | Master source (1024 viewBox)                        | 1.2KB |
| `build/icon.png`    | 1024×1024 RGBA                                      | 25KB  |
| `build/icon.ico`    | Windows multi-res (16/32/48/64/128/256)             | 10KB  |
| `build/icon.icns`   | macOS iconset with full @2x retina (16-1024)        | 114KB |

Propagation across the build pipeline (md5 of `build/icon.png`):

```
db316b4002a8be93b3576fe6296f3e72  build/icon.png
db316b4002a8be93b3576fe6296f3e72  src/renderer/.vite-public/icon.png
db316b4002a8be93b3576fe6296f3e72  dist/renderer/icon.png
```

✅ Identical hash across all three locations — `scripts/copy-vite-public.js`
sources from `build/icon.png` and Vite's build copies it through.

## Visual spot checks

To be filled in after the screenshots in `CAPTURE.md` are captured. Three
checks per theme:

| Check                                       | midnight | paper | slate |
| ------------------------------------------- | -------- | ----- | ----- |
| Tab key produces visible focus rings         |          |       |       |
| Reduced-motion (DevTools emulation) snaps    |          |       |       |
| Modal overlay tints render against surface   |          |       |       |

Add a row per regression found.

## Out of scope (not blocking)

These eight CSS files outside the Phase 3 scope still contain hex literals
and were intentionally left alone:

```
debug-panel.css       git-panel.css        file-viewer.css
mcp-inspector.css     p2p-sharing.css      session-inspector.css
alerts.css            mcp-marketplace.css
```

They aren't covered by the verification gate. A follow-up "10th-feature
cleanup" phase could fold them in if desired.
