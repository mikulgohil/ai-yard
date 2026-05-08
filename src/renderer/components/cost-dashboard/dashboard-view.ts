import {
  type CostBucket,
  type CostSummary,
  type Granularity,
  type Scope,
  summarize,
} from '../../cost-aggregator.js';
import { onChange as onCostChange } from '../../session-cost.js';
import { appState } from '../../state.js';

let dashboardEl: HTMLElement | null = null;
let granularity: Granularity = 'daily';
let scope: Scope = 'project';
let unsubCost: (() => void) | null = null;

function isDashboardActive(): boolean {
  const project = appState.activeProject;
  if (!project) return false;
  const active = project.sessions.find((s) => s.id === project.activeSessionId);
  return active?.type === 'cost-dashboard';
}

export function initCostDashboard(): void {
  appState.on('project-changed', () => {
    if (isDashboardActive()) renderDashboard();
  });
  appState.on('session-changed', () => {
    if (isDashboardActive()) renderDashboard();
  });
  // Re-render on live cost ticks (debounced via simple guard).
  let pending = false;
  unsubCost?.();
  unsubCost = onCostChange(() => {
    if (!isDashboardActive() || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (isDashboardActive()) renderDashboard();
    });
  });
}

export function renderDashboard(target?: HTMLElement): void {
  const container = target ?? activeContainer();
  if (!container) return;

  if (!dashboardEl) {
    dashboardEl = buildDashboardShell();
  }
  if (!container.contains(dashboardEl)) {
    container.appendChild(dashboardEl);
  }
  dashboardEl.style.display = '';

  refreshContent();
}

export function hideDashboard(): void {
  if (dashboardEl) dashboardEl.style.display = 'none';
}

function activeContainer(): HTMLElement | null {
  const active = document.querySelector('.cost-dashboard-pane:not(.hidden)') as HTMLElement | null;
  return active;
}

function buildDashboardShell(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'cost-dashboard';

  // Header: title + scope toggle + granularity selector
  const header = document.createElement('div');
  header.className = 'cost-dashboard-header';

  const title = document.createElement('span');
  title.className = 'cost-dashboard-title';
  title.textContent = 'Cost Dashboard';

  const controls = document.createElement('div');
  controls.className = 'cost-dashboard-controls';

  controls.appendChild(buildScopeToggle());
  controls.appendChild(buildGranularityToggle());

  header.appendChild(title);
  header.appendChild(controls);
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'cost-dashboard-body';
  body.dataset.role = 'body';
  root.appendChild(body);

  return root;
}

function buildScopeToggle(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cost-dashboard-segmented';
  wrap.setAttribute('role', 'tablist');
  wrap.setAttribute('aria-label', 'Scope');

  for (const value of ['project', 'global'] as Scope[]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cost-dashboard-segment';
    btn.dataset.scopeValue = value;
    btn.textContent = value === 'project' ? 'This project' : 'All projects';
    btn.setAttribute('role', 'tab');
    if (value === scope) btn.classList.add('active');
    btn.addEventListener('click', () => {
      if (scope === value) return;
      scope = value;
      syncSegmentedActive(wrap, value);
      refreshContent();
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function buildGranularityToggle(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cost-dashboard-segmented';
  wrap.setAttribute('role', 'tablist');
  wrap.setAttribute('aria-label', 'Granularity');

  for (const value of ['daily', 'weekly', 'monthly'] as Granularity[]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cost-dashboard-segment';
    btn.dataset.granularityValue = value;
    btn.textContent = value === 'daily' ? 'Daily' : value === 'weekly' ? 'Weekly' : 'Monthly';
    btn.setAttribute('role', 'tab');
    if (value === granularity) btn.classList.add('active');
    btn.addEventListener('click', () => {
      if (granularity === value) return;
      granularity = value;
      syncSegmentedActive(wrap, value);
      refreshContent();
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function syncSegmentedActive(wrap: HTMLElement, value: string): void {
  for (const btn of wrap.querySelectorAll('.cost-dashboard-segment')) {
    btn.classList.toggle('active', (btn as HTMLElement).textContent !== null && getSegmentValue(btn as HTMLElement) === value);
  }
}

function getSegmentValue(btn: HTMLElement): string | undefined {
  return btn.dataset.scopeValue ?? btn.dataset.granularityValue;
}

function refreshContent(): void {
  if (!dashboardEl) return;
  const body = dashboardEl.querySelector('[data-role="body"]') as HTMLElement | null;
  if (!body) return;
  body.innerHTML = '';

  const projects = appState.projects;
  const activeProjectId = appState.activeProject?.id ?? null;
  const summary = summarize(projects, scope, activeProjectId, granularity);

  if (summary.sessionCount === 0) {
    body.appendChild(buildEmptyState());
    return;
  }

  body.appendChild(buildKpiRow(summary));
  body.appendChild(buildChartCard(summary.buckets));
  body.appendChild(buildBreakdownGrid(summary));
}

function buildEmptyState(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'cost-dashboard-empty';
  empty.textContent = scope === 'project'
    ? 'No cost data yet for this project. Start a session to begin tracking spend.'
    : 'No cost data yet. Start a session to begin tracking spend.';
  return empty;
}

function buildKpiRow(summary: CostSummary): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cost-dashboard-kpis';

  row.appendChild(buildKpi('Total spend', formatUsd(summary.totalCostUsd)));
  row.appendChild(buildKpi('Tokens (in)', formatTokens(summary.totalInputTokens)));
  row.appendChild(buildKpi('Tokens (out)', formatTokens(summary.totalOutputTokens)));
  row.appendChild(buildKpi('Sessions', String(summary.sessionCount)));
  return row;
}

function buildKpi(label: string, value: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cost-dashboard-kpi';
  const valueEl = document.createElement('div');
  valueEl.className = 'cost-dashboard-kpi-value';
  valueEl.textContent = value;
  const labelEl = document.createElement('div');
  labelEl.className = 'cost-dashboard-kpi-label';
  labelEl.textContent = label;
  card.appendChild(valueEl);
  card.appendChild(labelEl);
  return card;
}

function buildChartCard(buckets: CostBucket[]): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cost-dashboard-card';

  const title = document.createElement('div');
  title.className = 'cost-dashboard-card-title';
  title.textContent = 'Spend over time';
  card.appendChild(title);

  if (buckets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cost-dashboard-empty';
    empty.textContent = 'Not enough data to chart yet.';
    card.appendChild(empty);
    return card;
  }

  const wrap = document.createElement('div');
  wrap.className = 'cost-dashboard-chart-wrap';
  wrap.appendChild(buildBarChart(buckets));
  card.appendChild(wrap);
  return card;
}

const CHART_HEIGHT = 160;
const CHART_PAD_BOTTOM = 24;
const CHART_PAD_TOP = 16;
const SLOT_WIDTH = 60;

function buildBarChart(buckets: CostBucket[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('cost-dashboard-chart');
  const chartWidth = buckets.length * SLOT_WIDTH || SLOT_WIDTH;
  svg.setAttribute('width', String(chartWidth));
  svg.setAttribute('height', String(CHART_HEIGHT));
  svg.setAttribute('viewBox', `0 0 ${chartWidth} ${CHART_HEIGHT}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Spend over time, ${buckets.length} buckets`);

  const max = Math.max(...buckets.map((b) => b.totalCostUsd), 0.01);
  const slotWidth = SLOT_WIDTH;
  const barWidth = 36;

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const slotX = i * slotWidth;
    const ratio = b.totalCostUsd / max;
    const barHeight = ratio * (CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM);
    const barY = CHART_HEIGHT - CHART_PAD_BOTTOM - barHeight;
    const barX = slotX + (slotWidth - barWidth) / 2;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.classList.add('cost-dashboard-bar');
    if (b.totalCostUsd === 0) rect.classList.add('empty');
    rect.setAttribute('x', String(barX));
    rect.setAttribute('y', String(barY));
    rect.setAttribute('width', String(barWidth));
    rect.setAttribute('height', String(barHeight));
    rect.setAttribute('rx', '2');
    const tooltip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    tooltip.textContent = `${b.label}: ${formatUsd(b.totalCostUsd)} · ${b.sessionCount} session${b.sessionCount === 1 ? '' : 's'}`;
    rect.appendChild(tooltip);
    svg.appendChild(rect);

    // Value label above the bar — only show for non-empty buckets to avoid clutter.
    if (b.totalCostUsd > 0) {
      const valueLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      valueLabel.classList.add('cost-dashboard-bar-value');
      valueLabel.setAttribute('x', String(slotX + slotWidth / 2));
      valueLabel.setAttribute('y', String(Math.max(barY - 4, 10)));
      valueLabel.setAttribute('text-anchor', 'middle');
      valueLabel.textContent = formatUsdShort(b.totalCostUsd);
      svg.appendChild(valueLabel);
    }

    // X-axis label
    const axisLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    axisLabel.classList.add('cost-dashboard-bar-label');
    axisLabel.setAttribute('x', String(slotX + slotWidth / 2));
    axisLabel.setAttribute('y', String(CHART_HEIGHT - 6));
    axisLabel.setAttribute('text-anchor', 'middle');
    axisLabel.textContent = b.label;
    svg.appendChild(axisLabel);
  }

  return svg;
}

function buildBreakdownGrid(summary: CostSummary): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'cost-dashboard-grid';

  grid.appendChild(buildProviderCard(summary));
  grid.appendChild(buildProjectCard(summary));
  grid.appendChild(buildTopRunsCard(summary));

  return grid;
}

function buildProviderCard(summary: CostSummary): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cost-dashboard-card';
  const title = document.createElement('div');
  title.className = 'cost-dashboard-card-title';
  title.textContent = 'By provider';
  card.appendChild(title);

  if (summary.byProvider.length === 0) {
    card.appendChild(buildEmptyHint('No provider data yet.'));
    return card;
  }

  const list = document.createElement('div');
  list.className = 'cost-dashboard-list';
  for (const p of summary.byProvider) {
    list.appendChild(buildBreakdownRow(p.providerId, formatUsd(p.totalCostUsd), `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}`));
  }
  card.appendChild(list);
  return card;
}

function buildProjectCard(summary: CostSummary): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cost-dashboard-card';
  const title = document.createElement('div');
  title.className = 'cost-dashboard-card-title';
  title.textContent = 'By project';
  card.appendChild(title);

  if (summary.byProject.length === 0) {
    card.appendChild(buildEmptyHint('No project data yet.'));
    return card;
  }

  const list = document.createElement('div');
  list.className = 'cost-dashboard-list';
  for (const p of summary.byProject) {
    list.appendChild(buildBreakdownRow(p.projectName, formatUsd(p.totalCostUsd), `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}`));
  }
  card.appendChild(list);
  return card;
}

function buildTopRunsCard(summary: CostSummary): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cost-dashboard-card';
  const title = document.createElement('div');
  title.className = 'cost-dashboard-card-title';
  title.textContent = 'Top runs';
  card.appendChild(title);

  if (summary.topRuns.length === 0) {
    card.appendChild(buildEmptyHint('No top runs to show yet.'));
    return card;
  }

  const list = document.createElement('div');
  list.className = 'cost-dashboard-list';
  for (const run of summary.topRuns) {
    const subline = run.archived ? `${run.projectName} · archived` : `${run.projectName} · active`;
    list.appendChild(buildBreakdownRow(run.sessionName, formatUsd(run.totalCostUsd), subline));
  }
  card.appendChild(list);
  return card;
}

function buildBreakdownRow(label: string, value: string, sub: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cost-dashboard-row';
  const labelGroup = document.createElement('div');
  labelGroup.className = 'cost-dashboard-row-labels';
  const labelEl = document.createElement('div');
  labelEl.className = 'cost-dashboard-row-label';
  labelEl.textContent = label;
  const subEl = document.createElement('div');
  subEl.className = 'cost-dashboard-row-sub';
  subEl.textContent = sub;
  labelGroup.appendChild(labelEl);
  labelGroup.appendChild(subEl);
  const valueEl = document.createElement('div');
  valueEl.className = 'cost-dashboard-row-value';
  valueEl.textContent = value;
  row.appendChild(labelGroup);
  row.appendChild(valueEl);
  return row;
}

function buildEmptyHint(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cost-dashboard-empty';
  el.textContent = text;
  return el;
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatUsdShort(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}
