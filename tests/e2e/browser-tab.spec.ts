import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

/**
 * A5 Phase 5 smoke: open a browser tab on the WebContentsView path,
 * confirm chrome, placeholder bounds, navigation, and inspect/draw/record toggles.
 * The native page contents are not in the renderer DOM, so we assert the
 * host chrome and that no legacy <webview> tag is created.
 */

const PROJECT_ID = 'p-browser';

interface BootedApp {
  app: ElectronApplication;
  tempHome: string;
  pageFile: string;
  cleanup: () => Promise<void>;
}

function buildState(projectPath: string): Record<string, unknown> {
  return {
    version: 1,
    activeProjectId: PROJECT_ID,
    projects: [
      {
        id: PROJECT_ID,
        name: 'BrowserSmoke',
        path: projectPath,
        sessions: [],
        activeSessionId: null,
        layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
        sessionHistory: [],
      },
    ],
    preferences: {
      soundOnSessionWaiting: false,
      notificationsDesktop: false,
      debugMode: false,
      sessionHistoryEnabled: true,
      insightsEnabled: false,
      autoTitleEnabled: false,
      confirmCloseWorkingSession: false,
    },
  };
}

async function bootApp(): Promise<BootedApp> {
  const tempHome = mkdtempSync(path.join(tmpdir(), 'aiyard-browser-e2e-'));
  const projectPath = path.join(tempHome, 'project');
  mkdirSync(projectPath, { recursive: true });
  const pageFile = path.join(projectPath, 'smoke.html');
  writeFileSync(
    pageFile,
    '<!doctype html><html><body><h1 id="hello">hello from aiyard</h1></body></html>\n',
  );

  const stateDir = path.join(tempHome, '.ai-yard');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(buildState(projectPath), null, 2));

  const mainPath = path.resolve(__dirname, '..', '..', 'dist', 'main', 'main', 'main.js');
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      HOME: tempHome,
      AIYARD_E2E: '1',
    },
  });

  return {
    app,
    tempHome,
    pageFile,
    cleanup: async () => {
      await app.close();
      try { rmSync(tempHome, { recursive: true, force: true }); } catch {}
    },
  };
}

test.describe('browser tab WebContentsView', () => {
  let booted: BootedApp;

  test.beforeAll(async () => {
    booted = await bootApp();
  });

  test.afterAll(async () => {
    await booted?.cleanup();
  });

  test('opens a tab on the WCV path, navigates, and toggles inspect/draw/record', async () => {
    const window = await booted.app.firstWindow();
    await expect.poll(async () => window.title()).toBe('AI-yard');

    await window.getByRole('button', { name: 'New Browser Tab' }).click();

    const pane = window.locator('.browser-tab-pane').last();
    await expect(pane).toBeVisible();
    await expect(pane).not.toHaveClass(/hidden/);

    await expect(pane.locator('.browser-url-input')).toBeVisible();
    await expect(pane.getByTitle('Back')).toBeVisible();
    await expect(pane.getByTitle('Forward')).toBeVisible();
    await expect(pane.getByTitle('Reload')).toBeVisible();
    await expect(pane.getByTitle('Inspect Element')).toBeVisible();
    await expect(pane.getByTitle('Record browser flow')).toBeVisible();
    await expect(pane.getByTitle('Draw on page and send annotated screenshot to AI')).toBeVisible();
    await expect(pane.locator('.browser-ntp-subtitle')).toBeVisible();

    const placeholder = pane.locator('.browser-webcontents-placeholder');
    await expect(placeholder).toBeAttached();
    await expect(pane.locator('webview')).toHaveCount(0);

    await expect.poll(async () => {
      const box = await placeholder.boundingBox();
      return box ? Math.round(box.width * box.height) : 0;
    }).toBeGreaterThan(10_000);

    const nativeViews = await booted.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win?.contentView.children.length ?? 0;
    });
    expect(nativeViews).toBeGreaterThan(0);

    const fileUrl = pathToFileURL(booted.pageFile).href;
    await pane.locator('.browser-url-input').fill(fileUrl);
    await pane.locator('.browser-go-btn').click();
    await expect(pane.locator('.browser-url-input')).toHaveValue(fileUrl);
    await expect(pane.locator('.browser-new-tab-page')).toBeHidden();

    const inspectBtn = pane.getByTitle('Inspect Element');
    await inspectBtn.click();
    await expect(inspectBtn).toHaveClass(/active/);
    await inspectBtn.click();
    await expect(inspectBtn).not.toHaveClass(/active/);

    const drawBtn = pane.getByTitle('Draw on page and send annotated screenshot to AI');
    await drawBtn.click();
    await expect(drawBtn).toHaveClass(/active/);
    await expect(pane.locator('.browser-draw-panel')).toBeVisible();
    await drawBtn.click();
    await expect(drawBtn).not.toHaveClass(/active/);
    await expect(pane.locator('.browser-draw-panel')).toBeHidden();

    const recordBtn = pane.getByTitle('Record browser flow');
    await recordBtn.click();
    await expect(recordBtn).toHaveClass(/active/);
    await expect(pane.locator('.browser-flow-panel')).toBeVisible();
    await recordBtn.click();
    await expect(recordBtn).not.toHaveClass(/active/);
  });
});
