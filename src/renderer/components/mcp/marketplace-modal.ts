import { MCP_DOMAIN_LABELS, MCP_DOMAINS, type McpDomain, type McpServerEntry } from '../../../shared/mcp-config.js';
import type { McpServer } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { fetchMcpServerEntries, isMcpCacheFresh } from './marketplace-fetcher.js';

type DomainFilter = 'all' | McpDomain;

interface DialogState {
  overlay: HTMLDivElement;
  list: HTMLDivElement;
  status: HTMLDivElement;
  searchInput: HTMLInputElement;
  chips: Map<DomainFilter, HTMLButtonElement>;
  allEntries: McpServerEntry[];
  installedNames: Set<string>;
  query: string;
  activeDomain: DomainFilter;
  /** Called after a successful install so the parent (e.g. mcp-add-modal or inspector) can refresh. */
  onInstalled: (() => void) | null;
}

export interface ShowMarketplaceArgs {
  onInstalled?: () => void;
}

export async function showMcpMarketplace({ onInstalled }: ShowMarketplaceArgs = {}): Promise<void> {
  const state = buildDialog(onInstalled ?? null);
  document.body.appendChild(state.overlay);

  // Render from cache immediately if fresh, then re-fetch in background.
  const cache = appState.mcp.marketplaceCache;
  if (cache && isMcpCacheFresh(cache)) {
    state.allEntries = cache.entries.map((e) => ({ ...e, domain: e.domain as McpDomain | undefined }));
  }
  await refreshInstalledNames(state);

  if (state.allEntries.length === 0) {
    await load(state);
  } else {
    rerender(state);
    // Background refresh
    void load(state, { silent: true });
  }
}

function buildDialog(onInstalled: (() => void) | null): DialogState {
  const overlay = document.createElement('div');
  overlay.className = 'mcp-marketplace-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'mcp-marketplace-dialog';

  const header = document.createElement('div');
  header.className = 'mcp-marketplace-header';
  const title = document.createElement('div');
  title.className = 'mcp-marketplace-title';
  title.textContent = 'Browse MCP servers';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'mcp-marketplace-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close');

  header.appendChild(title);
  header.appendChild(closeBtn);

  const status = document.createElement('div');
  status.className = 'mcp-marketplace-status';

  const filterRow = document.createElement('div');
  filterRow.className = 'mcp-marketplace-filter';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'mcp-marketplace-search';
  searchInput.placeholder = 'Search by name, description…';

  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'mcp-marketplace-domain-chips';

  const chips = new Map<DomainFilter, HTMLButtonElement>();
  const filters: DomainFilter[] = ['all', ...MCP_DOMAINS];
  for (const filter of filters) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mcp-marketplace-chip';
    chip.textContent = filter === 'all' ? 'All' : MCP_DOMAIN_LABELS[filter];
    if (filter === 'all') chip.classList.add('active');
    chips.set(filter, chip);
    chipsWrap.appendChild(chip);
  }

  filterRow.appendChild(searchInput);
  filterRow.appendChild(chipsWrap);

  const list = document.createElement('div');
  list.className = 'mcp-marketplace-list';

  dialog.appendChild(header);
  dialog.appendChild(status);
  dialog.appendChild(filterRow);
  dialog.appendChild(list);
  overlay.appendChild(dialog);

  const state: DialogState = {
    overlay,
    list,
    status,
    searchInput,
    chips,
    allEntries: [],
    installedNames: new Set(),
    query: '',
    activeDomain: 'all',
    onInstalled,
  };

  for (const [filter, chip] of chips) {
    chip.addEventListener('click', () => selectDomain(state, filter));
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  searchInput.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.query = searchInput.value.trim().toLowerCase();
      rerender(state);
    }, 150);
  });

  const escListener = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dispose();
  };
  const dispose = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', escListener);
  };
  closeBtn.addEventListener('click', dispose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dispose(); });
  document.addEventListener('keydown', escListener);

  return state;
}

function selectDomain(state: DialogState, filter: DomainFilter): void {
  if (state.activeDomain === filter) return;
  state.activeDomain = filter;
  for (const [key, el] of state.chips) el.classList.toggle('active', key === filter);
  rerender(state);
}

async function load(state: DialogState, opts: { silent?: boolean } = {}): Promise<void> {
  if (!opts.silent) {
    state.status.textContent = 'Loading marketplace from GitHub…';
    state.list.innerHTML = '';
  }
  try {
    const entries = await fetchMcpServerEntries();
    appState.setMcpMarketplaceCache(entries);
    state.allEntries = entries;
    rerender(state);
  } catch (err) {
    if (!opts.silent) {
      state.status.textContent = `Failed to load: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

async function refreshInstalledNames(state: DialogState): Promise<void> {
  // Pull installed servers from the user-scope provider config (project scope is
  // a per-project view; the marketplace is global, so user scope is the right
  // signal for "do I already have this name installed?").
  try {
    const projectPath = appState.activeProject?.path ?? '';
    const config = await window.aiyard.provider.getConfig('claude', projectPath);
    state.installedNames = new Set(config.mcpServers.map((s: McpServer) => s.name));
  } catch {
    state.installedNames = new Set();
  }
}

function rerender(state: DialogState): void {
  state.list.innerHTML = '';
  if (state.allEntries.length === 0) {
    state.status.textContent = 'No marketplace entries found.';
    return;
  }
  state.status.textContent = '';

  const filtered = filterEntries(state.allEntries, state.query, state.activeDomain);
  if (filtered.length === 0) {
    state.list.appendChild(buildEmptyState(state));
    return;
  }

  const buckets = new Map<McpDomain, McpServerEntry[]>();
  for (const entry of filtered) {
    const key: McpDomain = entry.domain ?? 'other';
    const bucket = buckets.get(key) ?? [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }

  for (const domain of MCP_DOMAINS) {
    const entries = buckets.get(domain);
    if (!entries || entries.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'mcp-marketplace-section';

    const heading = document.createElement('div');
    heading.className = 'mcp-marketplace-section-title';
    heading.textContent = MCP_DOMAIN_LABELS[domain];
    section.appendChild(heading);

    const cards = document.createElement('div');
    cards.className = 'mcp-marketplace-section-cards';
    for (const entry of entries) {
      cards.appendChild(buildCard(state, entry));
    }
    section.appendChild(cards);

    state.list.appendChild(section);
  }
}

function buildEmptyState(state: DialogState): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mcp-marketplace-empty';

  const msg = document.createElement('div');
  msg.textContent = 'No servers match your filter.';
  wrap.appendChild(msg);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'mcp-marketplace-empty-clear';
  clear.textContent = 'Clear filters';
  clear.addEventListener('click', () => {
    state.query = '';
    state.activeDomain = 'all';
    state.searchInput.value = '';
    for (const [key, el] of state.chips) el.classList.toggle('active', key === 'all');
    rerender(state);
  });
  wrap.appendChild(clear);
  return wrap;
}

function buildCard(state: DialogState, entry: McpServerEntry): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mcp-marketplace-card';

  const headerRow = document.createElement('div');
  headerRow.className = 'mcp-marketplace-card-header';

  const name = document.createElement('div');
  name.className = 'mcp-marketplace-card-name';
  name.textContent = entry.name;

  const transport = document.createElement('span');
  transport.className = 'mcp-marketplace-card-transport';
  transport.textContent = entry.url ? 'sse' : 'stdio';

  headerRow.appendChild(name);
  headerRow.appendChild(transport);
  card.appendChild(headerRow);

  const desc = document.createElement('div');
  desc.className = 'mcp-marketplace-card-description';
  desc.textContent = entry.description;
  card.appendChild(desc);

  const actions = document.createElement('div');
  actions.className = 'mcp-marketplace-card-actions';

  const installed = state.installedNames.has(entry.id) || state.installedNames.has(entry.name);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'mcp-marketplace-card-add';
  applyAddState(addBtn, installed);
  addBtn.addEventListener('click', async () => {
    addBtn.disabled = true;
    addBtn.textContent = 'Installing…';
    const ok = await installEntry(entry);
    if (ok) {
      state.installedNames.add(entry.id);
      applyAddState(addBtn, true);
      state.onInstalled?.();
    } else {
      applyAddState(addBtn, false);
      addBtn.textContent = 'Failed — retry';
    }
  });
  actions.appendChild(addBtn);

  if (entry.setupUrl) {
    const setup = document.createElement('a');
    setup.className = 'mcp-marketplace-card-setup-link';
    setup.textContent = 'Setup';
    setup.href = entry.setupUrl;
    setup.addEventListener('click', (e) => {
      e.preventDefault();
      if (entry.setupUrl) void window.aiyard.app.openExternal(entry.setupUrl);
    });
    actions.appendChild(setup);
  }

  card.appendChild(actions);
  return card;
}

function applyAddState(btn: HTMLButtonElement, installed: boolean): void {
  btn.disabled = installed;
  btn.textContent = installed ? 'Installed' : 'Install';
}

async function installEntry(entry: McpServerEntry): Promise<boolean> {
  const config: Record<string, unknown> = entry.url
    ? { url: entry.url }
    : { command: entry.command, args: entry.args ?? [] };
  if (entry.env && Object.keys(entry.env).length > 0) config.env = entry.env;

  // User-scope install — the marketplace is global; users can re-add at project
  // scope manually if they want it scoped narrower.
  const result = await window.aiyard.mcp.addServer(entry.id, config, 'user');
  if (!result.success) {
    console.error('mcp marketplace install failed:', result.error);
    return false;
  }
  return true;
}

function filterEntries(all: McpServerEntry[], query: string, domain: DomainFilter): McpServerEntry[] {
  return all.filter((e) => {
    if (domain !== 'all') {
      const entryDomain: McpDomain = e.domain ?? 'other';
      if (entryDomain !== domain) return false;
    }
    if (!query) return true;
    return (
      e.name.toLowerCase().includes(query) ||
      e.description.toLowerCase().includes(query) ||
      e.id.toLowerCase().includes(query)
    );
  });
}
