# Privacy

AI-yard runs locally on your machine and stores everything in `~/.ai-yard/state.json` by default. Two outbound network features are opt-in and off by default.

## Crash reports (Sentry)

- **Off by default.** Toggle in **Preferences → General → Privacy → "Send crash reports"**.
- Activated only when all three are true:
  1. App is packaged (no reports in dev builds).
  2. Preference is on.
  3. `SENTRY_DSN` env var is set in the build.
- PII is scrubbed before send: home directory paths become `~`, `~/.ai-yard` paths become `<state>`. Stack traces, breadcrumbs, exception messages, and tags are all run through the scrubber.
- See `src/main/sentry.ts` and `src/shared/sentry-scrub.ts` for the scrubber implementation.

## Anonymous usage stats (Telemetry)

- **Off by default.** Toggle in **Preferences → General → Privacy → "Send anonymous usage stats"**.
- Activated only when all four are true:
  1. App is packaged.
  2. Preference is on.
  3. `TELEMETRY_ENDPOINT` env var is set in the build (e.g. an Umami `/api/send` URL).
  4. `TELEMETRY_WEBSITE_ID` env var is set.

### What's tracked

| Event | Payload |
|---|---|
| `app.launch` | List of available CLI providers (e.g. `claude,codex`), provider count |
| `session.start` | Provider id (`claude` / `codex` / `copilot` / `gemini`), `resume: true/false` |
| `feature.used` | `surface` (kanban / team / browser-tab / overview), `kind` (mount / interaction), `action` (e.g. `task-created`, `navigate`) |

Every event also carries:

- `deviceId` — random UUID generated on first telemetry send and persisted in `state.json`. Anonymous; cannot be reversed to a real user.
- `sessionId` — random UUID regenerated each app launch (in-memory only).
- `appVersion`, `platform` (`darwin` / `linux` / `win32`).

### What's never tracked

- No file paths.
- No project names or paths.
- No CLI session contents, prompts, or transcripts.
- No GitHub repos, issue numbers, or PR titles.
- No team member names or system prompts.
- No clipboard contents, no environment variables, no usernames.
- The IPC channel `telemetry:track` strips any value that isn't a `string`, `number`, or `boolean`, and caps strings at 200 chars — defense-in-depth against accidental data leaks.

### How to opt out / clear

- **Stop sending events**: turn the preference off and restart the app. Both Sentry and telemetry require a restart because their network handlers cannot be cleanly unmounted.
- **Clear your device id**: delete `~/.ai-yard/state.json` (also clears all projects/sessions — make a backup first), or open the file and remove the `telemetryDeviceId` field. A new id will be generated next time telemetry is enabled.
- **Audit what's sent**: see `src/main/telemetry.ts` for the exact payload shape.

### Network behavior

- POSTs are fire-and-forget with a 5-second timeout.
- Failures are silently swallowed — telemetry never affects UX.
- No retries, no batching to disk, no fallback storage.
