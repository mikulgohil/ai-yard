# CCIDE

A terminal-centric IDE for AI-powered CLI tools. Manage multiple sessions, track costs, and work with split panes — all from a keyboard-driven Electron app.

## Features

- **Multi-session terminal management** — run multiple CLI sessions per project, each backed by a real PTY
- **Split panes** — side-by-side terminal layout for parallel workflows
- **Session cost tracking** — per-session and aggregate cost, token, and cache usage (USD)
- **CLI provider abstraction** — built for Claude Code today, extensible to other AI CLI tools
- **Auto-updater** — in-app updates via GitHub Releases
- **Keyboard-driven** — full keyboard shortcut support for navigation, session management, and layout
- **Session resume** — sessions persist across app restarts via CLI session IDs
- **Project terminal** — built-in shell terminal per project for quick commands
- **MCP Inspector** — integrated MCP server inspection tool
- **Session insights** — smart alerts that monitor session health, starting with pre-context usage. When a new session's pre-context exceeds 15% of the context window, CCIDE shows an alert with exact token counts and a one-click "Fix in New Session" action that launches Claude to analyze and reduce context bloat. Dismissible per-project and toggleable in preferences.
- **AI Readiness Score** — per-project readiness analysis that evaluates how well-prepared a project is for AI coding assistance. Displays an overall percentage score with color-coded category breakdowns in the sidebar. Click into any category for detailed checks with one-click "Fix" buttons that open a new session to resolve issues automatically.
- **Context window tracking** — real-time context usage displayed in the status bar, persisted across restarts
- **Session history** — archived sessions with resume support, automatic archiving on `/clear`
- **Usage stats** — aggregated CLI usage statistics from Claude Code's stats cache
- **Clickable file paths** — click file paths in terminal output to navigate to them
- **Unread indicators** — visual indicators on sidebar projects for sessions with new activity
- **Tab reordering** — drag-and-drop and context menu (move left/right) tab management

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Node v24+ (only if building from source — see `.nvmrc`)

## Installation

### macOS (DMG)

1. Download the `.dmg` from [GitHub Releases](https://github.com/elirantutia/ccide/releases)
2. Open the `.dmg` and drag **CCIDE** to your Applications folder
3. Since the app is unsigned, macOS Gatekeeper will block the first launch. To open it, run:
   ```bash
   xattr -cr /Applications/CCIDE.app
   ```

### Build from Source

```bash
git clone https://github.com/elirantutia/ccide.git
cd ccide
nvm use        # or ensure Node v24+
npm install
npm start      # builds and launches the app
```

## Development

```bash
npm run build         # compile main, preload, and renderer
npm start             # build + launch (alias: npm run dev)
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # coverage report (HTML at coverage/index.html)
```

No hot reload — changes require a full rebuild and app restart.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development guide.

## Architecture

CCIDE uses a three-process Electron architecture with strict context isolation:

- **Main process** — Node.js: window management, PTY lifecycle via `node-pty`, filesystem access, persistent state
- **Preload** — secure bridge exposing `window.claudeIde` API via `contextBridge`
- **Renderer** — vanilla TypeScript DOM UI (no framework), reactive state via event emitter pattern

CLI-specific behavior is encapsulated behind a provider interface, making it straightforward to add support for additional AI CLI tools.

For full architecture details, see [CLAUDE.md](CLAUDE.md).

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting a PR.

## License

[MIT](LICENSE)

## Disclaimer

CCIDE is an independent project and is not affiliated with or endorsed by Anthropic.
