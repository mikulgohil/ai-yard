import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Vite 7 changed its default resolver behavior; bare Node built-in imports
    // (e.g. `import * as fs from 'fs'`) were no longer auto-externalized in
    // vitest's vite-backed module loader. Force-externalize the built-ins our
    // test files import. Without this, tests fail with "Failed to resolve entry
    // for package 'fs'" etc. (B9 follow-up; the codebase uniformly uses bare
    // imports per CLAUDE.md.)
    server: {
      deps: {
        external: [
          /^node:/,
          'fs',
          'fs/promises',
          'path',
          'os',
          'crypto',
          'child_process',
          'util',
          'stream',
          'http',
          'https',
          'url',
          'events',
          'net',
          'tls',
          'dns',
          'zlib',
          'querystring',
          'assert',
          'buffer',
          'string_decoder',
          'timers',
          'tty',
          'readline',
        ],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'src/main/**/*.ts',
        'src/renderer/**/*.ts',
      ],
      exclude: [
        'src/main/main.ts',
        'src/main/ipc-handlers.ts',
        'src/main/mcp-ipc-handlers.ts',
        'src/main/menu.ts',
        'src/main/mcp-client.ts',
        'src/renderer/index.ts',
        'src/renderer/components/**',
        'src/renderer/keybindings.ts',
        'src/renderer/notification-sound.ts',
        'src/renderer/git-status.ts',
        'src/preload/**',
      ],
    },
  },
});
