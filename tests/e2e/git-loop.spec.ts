import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

/**
 * Daily-driver git loop in the running Electron app.
 * Seeds a real git repo as the active project and drives commit from the sidebar.
 */

const PROJECT_ID = 'p-git-loop';

interface BootedApp {
  app: ElectronApplication;
  tempHome: string;
  repo: string;
  cleanup: () => Promise<void>;
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function seedGitRepo(dir: string): void {
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'loop@example.com']);
  git(dir, ['config', 'user.name', 'Loop Test']);
  writeFileSync(path.join(dir, 'README.md'), 'seed\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'chore: seed']);
  writeFileSync(path.join(dir, 'note.txt'), 'uncommitted\n');
}

function buildState(repoPath: string): Record<string, unknown> {
  return {
    version: 1,
    activeProjectId: PROJECT_ID,
    projects: [
      {
        id: PROJECT_ID,
        name: 'GitLoop',
        path: repoPath,
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
  const tempHome = mkdtempSync(path.join(tmpdir(), 'aiyard-git-e2e-'));
  const repo = path.join(tempHome, 'repo');
  mkdirSync(repo, { recursive: true });
  seedGitRepo(repo);

  const stateDir = path.join(tempHome, '.ai-yard');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(buildState(repo), null, 2));

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
    repo,
    cleanup: async () => {
      await app.close();
      try { rmSync(tempHome, { recursive: true, force: true }); } catch {}
    },
  };
}

test.describe('git loop', () => {
  let booted: BootedApp;

  test.beforeAll(async () => {
    booted = await bootApp();
  });

  test.afterAll(async () => {
    await booted?.cleanup();
  });

  test('sidebar loop: stage from file list, commit, then history Escape', async () => {
    const window = await booted.app.firstWindow();
    await expect.poll(async () => window.title()).toBe('AI-yard');

    const panel = window.locator('#git-actions-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.git-toolbar-branch')).toHaveText('main');

    await expect(window.getByRole('button', { name: 'Fetch' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Pull (rebase)' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Push' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Commit history' })).toBeVisible();

    const commitBtn = panel.locator('.git-commit-btn');
    await expect(commitBtn).toBeDisabled();

    const fileRow = window.locator('#git-panel .config-item', { hasText: 'note.txt' });
    await expect(fileRow).toBeVisible({ timeout: 15_000 });
    await fileRow.hover();
    await fileRow.locator('button.git-action-btn[title="Stage"]').click();

    await expect(panel.locator('.git-commit-counter')).toContainText('staged: 1', { timeout: 10_000 });
    await expect(commitBtn).toBeDisabled();

    await panel.locator('.git-commit-input').fill('feat: add note');
    await expect(commitBtn).toBeEnabled();

    await commitBtn.click();
    await expect(window.locator('.git-toast')).toContainText('feat: add note', { timeout: 15_000 });
    await expect(panel.locator('.git-commit-counter')).toContainText('staged: 0');

    await window.getByRole('button', { name: 'Commit history' }).click();
    const host = window.locator('#git-history-host');
    await expect(host).not.toHaveClass(/hidden/);
    await expect(host.locator('.git-history-subject', { hasText: 'feat: add note' })).toBeVisible();

    await window.keyboard.press('Escape');
    await expect(host).toHaveClass(/hidden/);
  });
});
