import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

/**
 * Smoke test — boots the Electron app with no projects, verifies the chrome renders.
 *
 * Strategy:
 *   - AIYARD_E2E=1 skips the "no CLI provider" hard exit (see main.ts).
 *   - HOME is redirected to a fresh temp dir so the test never touches the user's
 *     real ~/.ai-yard state.
 *   - We wait for the first window, assert its title, and check that the sidebar
 *     "+" button (project creation) is rendered. That's enough to know the
 *     main process started, the preload bridged successfully, and the renderer
 *     bundle parsed.
 *
 * Out of scope (future tests):
 *   - Creating a project / starting a session (would need a mocked PTY).
 *   - Theme switching, modal flows, etc. — add as separate spec files.
 */

let app: ElectronApplication;
let tempHome: string;

test.beforeAll(async () => {
  tempHome = mkdtempSync(path.join(tmpdir(), 'aiyard-e2e-'));
  // The app's main entry per package.json#main.
  const mainPath = path.resolve(__dirname, '..', '..', 'dist', 'main', 'main', 'main.js');
  app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      HOME: tempHome,
      AIYARD_E2E: '1',
    },
  });
});

test.afterAll(async () => {
  await app?.close();
  if (tempHome) {
    try { rmSync(tempHome, { recursive: true, force: true }); } catch {}
  }
});

test('boots and renders the main window chrome', async () => {
  const window = await app.firstWindow();

  // Window title is the source-of-truth for the rename — guarded in identity.test.ts already,
  // but worth confirming end-to-end.
  await expect.poll(async () => window.title()).toBe('AI-yard');

  // Sidebar essentials: project list container + add-project button.
  await expect(window.locator('#project-list')).toBeAttached();
  await expect(window.locator('#btn-add-project')).toBeVisible();

  // Tab bar essentials.
  await expect(window.locator('#tab-bar')).toBeAttached();
  await expect(window.locator('#btn-add-session')).toBeVisible();
});
