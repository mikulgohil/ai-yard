import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

/**
 * Cost dashboard e2e — three variants:
 *   1. Populated state, default (dark) theme — happy path with archived cost data.
 *   2. Empty state — project with no sessions and no history. Verifies the empty
 *      message renders and the heavyweight pieces (KPIs, chart) are correctly skipped.
 *   3. Populated state, light theme — verifies no theme-specific breakage from
 *      hardcoded colors. Theme is applied at boot from `Preferences.theme`.
 *
 * Each variant runs in its own describe block with a fresh Electron app and
 * temp HOME, so seeded state.json doesn't leak between runs. ~3 boots × ~2-3s.
 */

const PROJECT_ID = 'p-test';

interface BootedApp {
  app: ElectronApplication;
  tempHome: string;
  cleanup: () => Promise<void>;
}

interface SeedOptions {
  withCostData?: boolean;
  theme?: 'dark' | 'light';
}

function buildState(homeDir: string, opts: SeedOptions): Record<string, unknown> {
  const sessionHistory = opts.withCostData
    ? [
        {
          id: 'a-test',
          name: 'Sample run',
          providerId: 'claude',
          cliSessionId: 'cli-1',
          createdAt: '2026-05-01T12:00:00.000Z',
          closedAt: '2026-05-01T13:00:00.000Z',
          cost: {
            totalCostUsd: 4.2,
            totalInputTokens: 1500,
            totalOutputTokens: 600,
            totalDurationMs: 60_000,
          },
        },
      ]
    : [];

  return {
    version: 1,
    activeProjectId: PROJECT_ID,
    projects: [
      {
        id: PROJECT_ID,
        name: 'TestProject',
        path: homeDir,
        sessions: [],
        activeSessionId: null,
        layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
        sessionHistory,
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
      costDashboardEnabled: true,
      ...(opts.theme ? { theme: opts.theme } : {}),
    },
  };
}

async function bootApp(seedOpts: SeedOptions): Promise<BootedApp> {
  const tempHome = mkdtempSync(path.join(tmpdir(), 'aiyard-cost-e2e-'));
  const stateDir = path.join(tempHome, '.ai-yard');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(buildState(tempHome, seedOpts), null, 2));

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
    cleanup: async () => {
      await app.close();
      try { rmSync(tempHome, { recursive: true, force: true }); } catch {}
    },
  };
}

test.describe('cost dashboard - populated state', () => {
  let booted: BootedApp;

  test.beforeAll(async () => { booted = await bootApp({ withCostData: true }); });
  test.afterAll(async () => { await booted?.cleanup(); });

  test('renders KPIs, chart, and toggles granularity / scope', async () => {
    const window = await booted.app.firstWindow();
    await expect.poll(async () => window.title()).toBe('AI-yard');

    const costBtn = window.locator('button.project-action-btn', { hasText: 'Cost' });
    await expect(costBtn).toBeVisible();
    await costBtn.click();

    await expect(window.locator('.cost-dashboard')).toBeVisible();
    await expect(window.locator('.cost-dashboard-title')).toHaveText('Cost Dashboard');

    await expect(window.locator('.cost-dashboard-kpi')).toHaveCount(4);
    const kpiValue = window.locator('.cost-dashboard-kpi-value').first();
    await expect(kpiValue).toHaveText('$4.20');

    const monthlyBtn = window.locator('.cost-dashboard-segment', { hasText: 'Monthly' });
    await monthlyBtn.click();
    await expect(monthlyBtn).toHaveClass(/active/);

    const allProjectsBtn = window.locator('.cost-dashboard-segment', { hasText: 'All projects' });
    await allProjectsBtn.click();
    await expect(allProjectsBtn).toHaveClass(/active/);

    await expect(window.locator('.cost-dashboard-chart .cost-dashboard-bar').first()).toBeVisible();
  });
});

test.describe('cost dashboard - empty state', () => {
  let booted: BootedApp;

  test.beforeAll(async () => { booted = await bootApp({ withCostData: false }); });
  test.afterAll(async () => { await booted?.cleanup(); });

  test('shows empty message and skips KPIs + chart when there is no cost data', async () => {
    const window = await booted.app.firstWindow();
    await expect.poll(async () => window.title()).toBe('AI-yard');

    const costBtn = window.locator('button.project-action-btn', { hasText: 'Cost' });
    await costBtn.click();

    // Dashboard shell still mounts (header, controls)
    await expect(window.locator('.cost-dashboard')).toBeVisible();
    await expect(window.locator('.cost-dashboard-title')).toHaveText('Cost Dashboard');

    // The body shows the empty message — exact copy comes from buildEmptyState() in
    // dashboard-view.ts when scope is 'project' (the default).
    const empty = window.locator('.cost-dashboard-body .cost-dashboard-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText(/No cost data yet for this project/);

    // The KPI row, chart, and breakdown grid are skipped (refreshContent() returns
    // after rendering the empty state — no spurious zero-only views).
    await expect(window.locator('.cost-dashboard-kpi')).toHaveCount(0);
    await expect(window.locator('.cost-dashboard-chart')).toHaveCount(0);
    await expect(window.locator('.cost-dashboard-grid')).toHaveCount(0);
  });
});

test.describe('cost dashboard - light theme', () => {
  let booted: BootedApp;

  test.beforeAll(async () => { booted = await bootApp({ withCostData: true, theme: 'light' }); });
  test.afterAll(async () => { await booted?.cleanup(); });

  test('renders correctly under the light theme', async () => {
    const window = await booted.app.firstWindow();
    await expect.poll(async () => window.title()).toBe('AI-yard');

    // Theme is applied at boot via index.ts:223, reading Preferences.theme from
    // the seeded state.json.
    await expect.poll(async () => window.locator('html').getAttribute('data-theme')).toBe('light');

    const costBtn = window.locator('button.project-action-btn', { hasText: 'Cost' });
    await costBtn.click();

    // Same chrome should render under light theme — catches anything that
    // hardcodes colors instead of using CSS variables.
    await expect(window.locator('.cost-dashboard')).toBeVisible();
    await expect(window.locator('.cost-dashboard-kpi')).toHaveCount(4);
    await expect(window.locator('.cost-dashboard-chart .cost-dashboard-bar').first()).toBeVisible();

    // Sanity: a known theme-aware element resolves to a non-empty color.
    // This catches the regression where a CSS variable is undefined under one
    // theme — that would resolve to `rgba(0,0,0,0)` (transparent).
    const bg = await window.locator('.cost-dashboard-kpi').first().evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
  });
});
