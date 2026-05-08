# Reskin Screenshot Capture Checklist

Manual checklist for the calm-productivity reskin (Phases 1-4). Capture
screenshots once per theme so the visual delta against pre-reskin (commit
`bf9a552^`) can be inspected later.

## Setup

```bash
npm run dev
```

Then in the running app:

1. Open Preferences → Appearance.
2. Switch theme to **midnight**, capture each screen below.
3. Switch theme to **paper**, capture again.
4. Switch theme to **slate**, capture again.

Save each PNG into `docs/screenshots/reskin/<theme>/<screen>.png` using the
exact filenames listed below — that way the directories diff cleanly against
each other in a future review.

## Screens to capture (8 × 3 = 24 PNGs)

| File                  | Where                                               | What it should show                                  |
| --------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `sidebar.png`         | Default app shell                                   | Project list, sidebar buttons, Git/file panels       |
| `tabs.png`            | App with 2-3 sessions open                          | Tab bar with mixed states (active, idle, working)    |
| `project-tab.png`     | Project tab → Overview                              | Readiness gauge + at least 3 widgets in the grid     |
| `kanban.png`          | Project tab → Kanban                                | A board with cards across To-do / In progress / Done |
| `cost-dashboard.png`  | Sidebar → Cost dashboard tab                        | KPI row + spend-over-time chart + by-provider list   |
| `team.png`            | Sidebar → Team tab                                  | Member grid with at least 3 cards                    |
| `modals.png`          | Anywhere — open the Add Project / Edit Member modal | Modal with primary/secondary buttons visible         |
| `preferences.png`     | Preferences → Appearance                            | Theme picker + density preview block                 |
| `browser-tab.png`     | Open a Browser tab                                  | URL bar + a real page rendered (e.g. example.com)    |

> The brief asks for 8 screens; capture all 24 PNGs (8 × 3 themes). Add more
> if you find a regression worth documenting.

## Tips

- Use the OS-native screenshot tool (`Cmd+Shift+4` on macOS, area-select).
- Capture at 2× retina if your display supports it — saved PNGs will be
  ~2560×1600 for full-window. Don't downscale; large PNGs are fine here.
- For modals, capture the full window with the modal centered, not just the
  modal — context matters.
- Don't redact session IDs or project paths unless they're sensitive.

## Light verification while capturing

While clicking around in each theme, confirm by eye:

1. **Hex literals**: open DevTools → Elements → pick any reskinned element →
   confirm `color` / `background` resolve to a `--token` value, not a literal.
   (One-off literals like `transparent` or `#fff0` for shadows are fine.)
2. **Focus rings visible**: press `Tab` repeatedly from the sidebar. Each
   focusable element should grow a 2px terracotta ring. Note any element that
   doesn't.
3. **Reduced motion**: System Settings → Accessibility → Display → "Reduce
   motion". Re-launch the app. Animations should snap to ~0ms.

Findings from these spot checks go in `QA.md` under "Visual spot checks".
