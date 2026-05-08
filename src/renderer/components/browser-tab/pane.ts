import { createPlanModeRow } from '../../dom-utils.js';
import { trackMount } from '../../feature-telemetry.js';
import { shortcutManager } from '../../shortcuts.js';
import { appState } from '../../state.js';
import { wireSubmitDisabled } from '../submit-disabled.js';
import {
  clearDrawing,
  dismissDraw,
  positionDrawPopover,
  sendDrawToCustomSession,
  sendDrawToNewSession,
  toggleDrawMode,
} from './draw-mode.js';
import { dismissFlowPicker, showFlowPicker } from './flow-picker.js';
import { addFlowStep, addFlowSuggestions, buildPlaywrightCode, clearFlow, replayFlow, renderFlowSteps, toggleFlowMode } from './flow-recording.js';
import { createTaskFromInspect, dismissInspect, showElementInfo, toggleInspectMode } from './inspect-mode.js';
import { getPreloadPath, instances } from './instance.js';
import { navigateTo } from './navigation.js';
import { dismissSendMenu, showSendMenu } from './send-menu.js';
import {
  deliverDraw,
  deliverFlow,
  deliverInspect,
  sendFlowToCustomSession,
  sendFlowToNewSession,
  sendToCustomSession,
  sendToNewSession,
} from './session-integration.js';
import {
  type BrowserTabInstance,
  type ElementInfo,
  type FlowPickerAction,
  type FlowPickerMetadata,
  VIEWPORT_PRESETS,
  type WebviewElement,
} from './types.js';
import { createWebContentsViewAdapter, createWebviewAdapter, type ViewAdapter } from './view-adapter.js';
import { applyViewport, closeViewportDropdown, openViewportDropdown } from './viewport.js';

export function createBrowserTabPane(sessionId: string, url?: string): void {
  if (instances.has(sessionId)) return;

  trackMount('browser-tab');
  const el = document.createElement('div');
  el.className = 'browser-tab-pane hidden';

  const toolbar = document.createElement('div');
  toolbar.className = 'browser-tab-toolbar';

  const backBtn = document.createElement('button');
  backBtn.className = 'browser-nav-btn';
  backBtn.textContent = '\u25C0';
  backBtn.title = 'Back';

  const fwdBtn = document.createElement('button');
  fwdBtn.className = 'browser-nav-btn';
  fwdBtn.textContent = '\u25B6';
  fwdBtn.title = 'Forward';

  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'browser-nav-btn browser-reload-btn';
  reloadBtn.textContent = '\u21BB';
  reloadBtn.title = 'Reload';

  const urlInput = document.createElement('input');
  urlInput.className = 'browser-url-input';
  urlInput.type = 'text';
  urlInput.placeholder = 'Enter URL (e.g. localhost:3000)';
  urlInput.value = url || '';

  const goBtn = document.createElement('button');
  goBtn.className = 'browser-go-btn';
  goBtn.textContent = 'Go';

  // Viewport picker button + dropdown
  const viewportWrapper = document.createElement('div');
  viewportWrapper.className = 'browser-viewport-wrapper';

  const viewportBtn = document.createElement('button');
  viewportBtn.className = 'browser-viewport-btn';
  viewportBtn.textContent = 'Responsive';
  viewportBtn.title = 'Change viewport size';

  const viewportDropdown = document.createElement('div');
  viewportDropdown.className = 'browser-viewport-dropdown';

  for (const preset of VIEWPORT_PRESETS) {
    const item = document.createElement('div');
    item.className = 'browser-viewport-item';
    item.textContent = preset.width !== null
      ? `${preset.label} — ${preset.width}×${preset.height}`
      : preset.label;
    item.addEventListener('click', () => {
      applyViewport(instance, preset);
      closeViewportDropdown(instance);
    });
    viewportDropdown.appendChild(item);
  }

  const customItem = document.createElement('div');
  customItem.className = 'browser-viewport-item browser-viewport-item-custom';
  customItem.textContent = 'Custom\u2026';
  viewportDropdown.appendChild(customItem);

  const customForm = document.createElement('div');
  customForm.className = 'browser-viewport-custom';

  const customWInput = document.createElement('input');
  customWInput.type = 'number';
  customWInput.className = 'browser-viewport-custom-input';
  customWInput.placeholder = 'W';
  customWInput.min = '1';

  const customSep = document.createElement('span');
  customSep.className = 'browser-viewport-custom-sep';
  customSep.textContent = '\u00D7';

  const customHInput = document.createElement('input');
  customHInput.type = 'number';
  customHInput.className = 'browser-viewport-custom-input';
  customHInput.placeholder = 'H';
  customHInput.min = '1';

  const customApplyBtn = document.createElement('button');
  customApplyBtn.className = 'browser-viewport-custom-apply';
  customApplyBtn.textContent = 'Apply';

  customForm.appendChild(customWInput);
  customForm.appendChild(customSep);
  customForm.appendChild(customHInput);
  customForm.appendChild(customApplyBtn);
  viewportDropdown.appendChild(customForm);

  viewportWrapper.appendChild(viewportBtn);
  viewportWrapper.appendChild(viewportDropdown);

  // Contextual tool buttons \u2014 live in the floating HUD (right-edge of viewport)
  const inspectBtn = document.createElement('button');
  inspectBtn.className = 'browser-inspect-btn hud-btn';
  inspectBtn.setAttribute('data-label', 'Inspect Element');
  inspectBtn.title = 'Inspect Element';
  // Cursor arrow + dotted selection box — universally recognised as "element picker"
  inspectBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2 1.5l.45 10.5 2.05-2.8 1.8 3.8 1.5-.7-1.8-3.8 2.9-.15z"/><rect x="9" y="1.5" width="5.5" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.2"/></svg>';

  const recordBtn = document.createElement('button');
  recordBtn.className = 'browser-record-btn hud-btn';
  recordBtn.setAttribute('data-label', 'Record Flow');
  recordBtn.title = 'Record browser flow';
  recordBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><circle cx="8" cy="8" r="5.5"/></svg>';

  const drawBtn = document.createElement('button');
  drawBtn.className = 'browser-draw-btn hud-btn';
  drawBtn.setAttribute('data-label', 'Draw & Annotate');
  drawBtn.title = 'Draw on page and send annotated screenshot to AI';
  drawBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 14l2-2 8-8-2-2-8 8z"/><path d="M10 4l2 2"/></svg>';

  toolbar.appendChild(backBtn);
  toolbar.appendChild(fwdBtn);
  toolbar.appendChild(reloadBtn);
  toolbar.appendChild(urlInput);
  toolbar.appendChild(goBtn);
  toolbar.appendChild(viewportWrapper);
  el.appendChild(toolbar);

  const viewportContainer = document.createElement('div');
  viewportContainer.className = 'browser-viewport-container responsive';

  const dragOverlay = document.createElement('div');
  dragOverlay.className = 'browser-drag-overlay';
  viewportContainer.appendChild(dragOverlay);

  const newTabPage = document.createElement('div');
  newTabPage.className = 'browser-new-tab-page';
  newTabPage.style.display = url ? 'none' : 'flex';

  const ntpLogo = document.createElement('div');
  ntpLogo.className = 'browser-ntp-logo';
  ntpLogo.textContent = 'AI-yard';
  newTabPage.appendChild(ntpLogo);

  const ntpSubtitle = document.createElement('div');
  ntpSubtitle.className = 'browser-ntp-subtitle';
  ntpSubtitle.textContent = 'Enter a URL above to start browsing';
  newTabPage.appendChild(ntpSubtitle);

  const ntpLinks = document.createElement('div');
  ntpLinks.className = 'browser-ntp-links';
  for (const port of ['localhost:3000', 'localhost:5173', 'localhost:8080', 'localhost:4200']) {
    const btn = document.createElement('button');
    btn.className = 'browser-ntp-link';
    btn.textContent = port;
    btn.addEventListener('click', () => navigateTo(instance, port));
    ntpLinks.appendChild(btn);
  }
  newTabPage.appendChild(ntpLinks);

  viewportContainer.appendChild(newTabPage);

  // A5 Phase 2 feature flag. Default `false` so behavior is unchanged for all
  // existing tabs; Phase 5 will flip this once the WebContentsView path has
  // parity with the <webview> path.
  const useWebContentsView = false;

  const view: ViewAdapter = useWebContentsView
    ? createWebContentsViewAdapter({
        tabId: sessionId,
        // The adapter awaits this internally and queues any operations made
        // before it resolves, so we don't have to defer pane construction.
        preloadPath: getPreloadPath(),
        url,
      })
    : (() => {
        const webview = document.createElement('webview') as unknown as WebviewElement;
        webview.className = 'browser-webview';
        webview.setAttribute('allowpopups', '');
        webview.setAttribute('webpreferences', 'backgroundThrottling=false');
        return createWebviewAdapter(webview);
      })();
  viewportContainer.appendChild(view.element);

  // Floating pill toolbar lives inside the viewport container so it overlays the webview
  viewportContainer.appendChild(toolbar);

  // Floating tool HUD — right-edge contextual tools
  const toolHud = document.createElement('div');
  toolHud.className = 'browser-tool-hud';
  toolHud.appendChild(inspectBtn);
  toolHud.appendChild(recordBtn);
  toolHud.appendChild(drawBtn);
  viewportContainer.appendChild(toolHud);

  el.appendChild(viewportContainer);

  const inspectPanel = document.createElement('div');
  inspectPanel.className = 'browser-inspect-panel';
  inspectPanel.style.display = 'none';

  const inspectPanelHeader = document.createElement('div');
  inspectPanelHeader.className = 'inspect-panel-header';

  const inspectHeaderTitle = document.createElement('span');
  inspectHeaderTitle.className = 'inspect-panel-title';
  inspectHeaderTitle.textContent = 'Inspect Element';

  const inspectCloseBtn = document.createElement('button');
  inspectCloseBtn.className = 'inspect-panel-close';
  inspectCloseBtn.setAttribute('aria-label', 'Dismiss inspect panel');
  inspectCloseBtn.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 1l10 10M11 1L1 11"/></svg>';

  inspectPanelHeader.appendChild(inspectHeaderTitle);
  inspectPanelHeader.appendChild(inspectCloseBtn);
  inspectPanel.appendChild(inspectPanelHeader);

  const elementInfoEl = document.createElement('div');
  elementInfoEl.className = 'inspect-element-info';
  inspectPanel.appendChild(elementInfoEl);

  const inputRow = document.createElement('div');
  inputRow.className = 'inspect-input-row';

  const instructionInput = document.createElement('textarea');
  instructionInput.className = 'inspect-instruction-input';
  instructionInput.rows = 3;
  instructionInput.placeholder = 'Describe what you want to do\u2026';

  const submitGroup = document.createElement('div');
  submitGroup.className = 'inspect-submit-group';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'inspect-submit-btn';
  submitBtn.textContent = 'Send to AI';

  const customBtn = document.createElement('button');
  customBtn.className = 'inspect-dropdown-btn';
  customBtn.textContent = '▼';
  customBtn.title = 'More options — pick a session or create new';

  submitGroup.appendChild(submitBtn);
  submitGroup.appendChild(customBtn);

  inputRow.appendChild(instructionInput);
  inspectPanel.appendChild(inputRow);

  const inspectAttachDimsRow = document.createElement('label');
  inspectAttachDimsRow.className = 'inspect-attach-dims-row';
  const inspectAttachDimsCheckbox = document.createElement('input');
  inspectAttachDimsCheckbox.type = 'checkbox';
  inspectAttachDimsCheckbox.checked = true;
  const inspectAttachDimsText = document.createElement('span');
  inspectAttachDimsText.textContent = 'Attach browser dimensions to the instructions';
  inspectAttachDimsRow.appendChild(inspectAttachDimsCheckbox);
  inspectAttachDimsRow.appendChild(inspectAttachDimsText);
  inspectPanel.appendChild(inspectAttachDimsRow);

  const { row: inspectPlanModeRow, checkbox: inspectPlanModeCheckbox } = createPlanModeRow();
  inspectPanel.appendChild(inspectPlanModeRow);

  inspectPanel.appendChild(submitGroup);

  const addToBoardBtn = document.createElement('button');
  addToBoardBtn.className = 'inspect-board-btn';
  addToBoardBtn.title = 'Save as a Kanban task to fix later';
  addToBoardBtn.innerHTML =
    '<svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="1" y="1" width="4.5" height="12" rx="1"/>' +
    '<rect x="7" y="1" width="6" height="7.5" rx="1"/>' +
    '<rect x="7" y="10" width="6" height="3" rx="1"/>' +
    '</svg> Add to Board';
  inspectPanel.appendChild(addToBoardBtn);

  el.appendChild(inspectPanel);

  const drawPanel = document.createElement('div');
  drawPanel.className = 'browser-inspect-panel browser-draw-panel';
  drawPanel.style.display = 'none';

  const drawHeader = document.createElement('div');
  drawHeader.className = 'inspect-tag-line';
  drawHeader.textContent = 'Draw on the page, then describe what you want.';
  drawPanel.appendChild(drawHeader);

  const drawControlsRow = document.createElement('div');
  drawControlsRow.className = 'inspect-input-row';

  const drawInstructionInput = document.createElement('textarea');
  drawInstructionInput.className = 'inspect-instruction-input';
  drawInstructionInput.rows = 3;
  drawInstructionInput.placeholder = 'Describe what you want to do\u2026';

  const drawSubmitGroup = document.createElement('div');
  drawSubmitGroup.className = 'inspect-submit-group';

  const drawClearBtn = document.createElement('button');
  drawClearBtn.className = 'inspect-clear-btn';
  drawClearBtn.textContent = 'Clear';
  drawClearBtn.title = 'Clear drawing';

  const drawSubmitBtn = document.createElement('button');
  drawSubmitBtn.className = 'inspect-submit-btn';
  drawSubmitBtn.textContent = 'Send to AI';

  const drawCustomBtn = document.createElement('button');
  drawCustomBtn.className = 'inspect-dropdown-btn';
  drawCustomBtn.textContent = '▼';
  drawCustomBtn.title = 'More options — pick a session or create new';

  drawSubmitGroup.appendChild(drawSubmitBtn);
  drawSubmitGroup.appendChild(drawCustomBtn);

  const drawActions = document.createElement('div');
  drawActions.className = 'inspect-draw-actions';
  drawActions.appendChild(drawClearBtn);
  drawActions.appendChild(drawSubmitGroup);

  drawControlsRow.appendChild(drawInstructionInput);
  drawPanel.appendChild(drawControlsRow);

  const drawAttachDimsRow = document.createElement('label');
  drawAttachDimsRow.className = 'inspect-attach-dims-row';
  const drawAttachDimsCheckbox = document.createElement('input');
  drawAttachDimsCheckbox.type = 'checkbox';
  drawAttachDimsCheckbox.checked = true;
  const drawAttachDimsText = document.createElement('span');
  drawAttachDimsText.textContent = 'Attach browser dimensions to the instructions';
  drawAttachDimsRow.appendChild(drawAttachDimsCheckbox);
  drawAttachDimsRow.appendChild(drawAttachDimsText);
  drawPanel.appendChild(drawAttachDimsRow);

  const { row: drawPlanModeRow, checkbox: drawPlanModeCheckbox } = createPlanModeRow();
  drawPanel.appendChild(drawPlanModeRow);

  const drawErrorEl = document.createElement('div');
  drawErrorEl.className = 'inspect-error-text';
  drawPanel.appendChild(drawErrorEl);

  drawPanel.appendChild(drawActions);
  el.appendChild(drawPanel);

  // Flow Panel
  const flowPanel = document.createElement('div');
  flowPanel.className = 'browser-flow-panel';
  flowPanel.style.display = 'none';

  const flowHeader = document.createElement('div');
  flowHeader.className = 'flow-panel-header';

  const flowLabel = document.createElement('span');
  flowLabel.className = 'flow-panel-label';
  flowLabel.textContent = 'Flow (0 steps)';

  const flowClearBtn = document.createElement('button');
  flowClearBtn.className = 'flow-panel-clear-btn';
  flowClearBtn.textContent = 'Clear';

  const flowReplayBtn = document.createElement('button');
  flowReplayBtn.className = 'flow-panel-action-btn';
  flowReplayBtn.textContent = '▶ Replay';
  flowReplayBtn.title = 'Replay all recorded steps in the browser';
  flowReplayBtn.disabled = true;

  const flowExportBtn = document.createElement('button');
  flowExportBtn.className = 'flow-panel-action-btn';
  flowExportBtn.textContent = '↗ Playwright';
  flowExportBtn.title = 'Copy Playwright test code to clipboard';
  flowExportBtn.disabled = true;

  const flowSaveBtn = document.createElement('button');
  flowSaveBtn.className = 'flow-panel-action-btn';
  flowSaveBtn.textContent = '💾 Save';
  flowSaveBtn.title = 'Save flow to project for later reuse';
  flowSaveBtn.disabled = true;

  const flowHeaderActions = document.createElement('div');
  flowHeaderActions.className = 'flow-panel-header-actions';
  flowHeaderActions.appendChild(flowReplayBtn);
  flowHeaderActions.appendChild(flowExportBtn);
  flowHeaderActions.appendChild(flowSaveBtn);
  flowHeaderActions.appendChild(flowClearBtn);

  flowHeader.appendChild(flowLabel);
  flowHeader.appendChild(flowHeaderActions);
  flowPanel.appendChild(flowHeader);

  const flowStepsList = document.createElement('div');
  flowStepsList.className = 'flow-steps-list';
  flowPanel.appendChild(flowStepsList);

  const flowInputRow = document.createElement('div');
  flowInputRow.className = 'flow-input-row';
  flowInputRow.style.display = 'none';

  const flowInstructionInput = document.createElement('textarea');
  flowInstructionInput.className = 'flow-instruction-input';
  flowInstructionInput.placeholder = 'Describe what to do with this flow\u2026';
  flowInstructionInput.rows = 2;

  const flowSubmitGroup = document.createElement('div');
  flowSubmitGroup.className = 'inspect-submit-group';

  const flowSubmitBtn = document.createElement('button');
  flowSubmitBtn.className = 'inspect-submit-btn';
  flowSubmitBtn.textContent = 'Send to AI';

  const flowCustomBtn = document.createElement('button');
  flowCustomBtn.className = 'inspect-dropdown-btn';
  flowCustomBtn.textContent = '▼';
  flowCustomBtn.title = 'More options — pick a session or create new';

  flowSubmitGroup.appendChild(flowSubmitBtn);
  flowSubmitGroup.appendChild(flowCustomBtn);
  flowInputRow.appendChild(flowInstructionInput);
  flowInputRow.appendChild(flowSubmitGroup);

  const { row: flowPlanModeRow, checkbox: flowPlanModeCheckbox } = createPlanModeRow();
  flowPlanModeRow.style.display = 'none';

  flowPanel.appendChild(flowPlanModeRow);
  flowPanel.appendChild(flowInputRow);
  el.appendChild(flowPanel);

  // Flow action picker popup
  const flowPickerOverlay = document.createElement('div');
  flowPickerOverlay.className = 'flow-picker-overlay';
  flowPickerOverlay.style.display = 'none';

  const flowPickerMenu = document.createElement('div');
  flowPickerMenu.className = 'flow-picker-menu';

  const pickerOptions: { label: string; sub: string; action: FlowPickerAction }[] = [
    { label: 'Click',          sub: 'Navigate without recording', action: 'click' },
    { label: 'Record',         sub: 'Capture without clicking',   action: 'record' },
    { label: 'Click + Record', sub: 'Click and add step',         action: 'click-and-record' },
  ];
  for (const opt of pickerOptions) {
    const item = document.createElement('button');
    item.className = 'flow-picker-item';
    item.dataset.action = opt.action;
    const labelEl = document.createElement('span');
    labelEl.className = 'flow-picker-label';
    labelEl.textContent = opt.label;
    const subEl = document.createElement('span');
    subEl.className = 'flow-picker-sub';
    subEl.textContent = opt.sub;
    item.appendChild(labelEl);
    item.appendChild(subEl);
    flowPickerMenu.appendChild(item);
  }
  flowPickerOverlay.appendChild(flowPickerMenu);
  el.appendChild(flowPickerOverlay);

  // Send-menu (overflow) popup — replaces the old "custom session" modal + "pick existing" modal
  const sendMenuOverlay = document.createElement('div');
  sendMenuOverlay.className = 'send-menu-overlay';
  sendMenuOverlay.style.display = 'none';
  const sendMenuEl = document.createElement('div');
  sendMenuEl.className = 'send-menu';
  sendMenuOverlay.appendChild(sendMenuEl);
  el.appendChild(sendMenuOverlay);

  const instance: BrowserTabInstance = {
    sessionId,
    element: el,
    view,
    useWebContentsView,
    viewportContainer,
    newTabPage,
    urlInput,
    inspectBtn,
    viewportBtn,
    viewportDropdown,
    inspectPanel,
    instructionInput,
    inspectAttachDimsCheckbox,
    inspectPlanModeCheckbox,
    elementInfoEl,
    inspectMode: false,
    selectedElement: null,
    currentViewport: VIEWPORT_PRESETS[0],
    viewportOutsideClickHandler: () => {},
    recordBtn,
    flowPanel,
    flowPanelLabel: flowLabel,
    flowStepsList,
    flowInputRow,
    flowInstructionInput,
    flowPlanModeRow,
    flowPlanModeCheckbox,
    flowMode: false,
    flowSteps: [],
    flowPickerOverlay,
    flowPickerMenu,
    flowPickerPending: null,
    replayBtn: flowReplayBtn,
    exportBtn: flowExportBtn,
    replayIndex: -1,
    drawBtn,
    drawPanel,
    drawInstructionInput,
    drawAttachDimsCheckbox,
    drawPlanModeCheckbox,
    drawErrorEl,
    drawMode: false,
    sendMenuOverlay,
    sendMenuEl,
  };
  instances.set(sessionId, instance);

  view.onBeforeInput((input, preventDefault) => {
    if (input.type !== 'keyDown') return;
    const synthetic = {
      key: input.key,
      ctrlKey: input.control,
      metaKey: input.meta,
      shiftKey: input.shift,
      altKey: input.alt,
      preventDefault,
    } as KeyboardEvent;
    shortcutManager.matchEvent(synthetic);
  });

  // Preload must be set before src to ensure the inspect script is injected.
  // For the WebContentsView path the adapter handles preload + initial URL at
  // create time, so this block is a no-op in that branch.
  if (!useWebContentsView) {
    getPreloadPath().then((p) => {
      // DEBUG: temporary instrumentation for inspect-element regression.
      console.log('[INSPECT] host setPreload', p, 'url:', url);
      view.setPreload(p);
      if (url) view.setSrc(url);
    });
  }

  backBtn.addEventListener('click', () => view.goBack());
  fwdBtn.addEventListener('click', () => view.goForward());
  reloadBtn.addEventListener('click', () => view.reload());

  goBtn.addEventListener('click', () => navigateTo(instance, urlInput.value));
  urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') navigateTo(instance, urlInput.value);
  });

  viewportBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    if (viewportDropdown.classList.contains('visible')) {
      closeViewportDropdown(instance);
    } else {
      customForm.style.display = 'none';
      openViewportDropdown(instance);
    }
  });

  instance.viewportOutsideClickHandler = (e: MouseEvent) => {
    if (!viewportWrapper.contains(e.target as Node)) {
      closeViewportDropdown(instance);
    }
  };
  document.addEventListener('mousedown', instance.viewportOutsideClickHandler);

  customItem.addEventListener('click', () => {
    customForm.style.display = 'flex';
    customWInput.focus();
  });

  function applyCustomSize(): void {
    const w = parseInt(customWInput.value, 10);
    const h = parseInt(customHInput.value, 10);
    if (w > 0 && h > 0) {
      applyViewport(instance, { label: 'Custom', width: w, height: h });
      closeViewportDropdown(instance);
    }
  }

  customApplyBtn.addEventListener('click', applyCustomSize);
  customWInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') applyCustomSize(); });
  customHInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') applyCustomSize(); });

  wireSubmitDisabled(instructionInput, submitBtn, customBtn);
  wireSubmitDisabled(drawInstructionInput, drawSubmitBtn, drawCustomBtn);
  wireSubmitDisabled(flowInstructionInput, flowSubmitBtn, flowCustomBtn);

  inspectBtn.addEventListener('click', () => toggleInspectMode(instance));
  inspectCloseBtn.addEventListener('click', () => dismissInspect(instance));
  addToBoardBtn.addEventListener('click', () => createTaskFromInspect(instance));
  recordBtn.addEventListener('click', () => toggleFlowMode(instance));
  drawBtn.addEventListener('click', () => toggleDrawMode(instance));
  drawClearBtn.addEventListener('click', () => clearDrawing(instance));
  drawSubmitBtn.addEventListener('click', () => { void sendDrawToNewSession(instance); });
  drawCustomBtn.addEventListener('click', () => {
    showSendMenu(instance, drawCustomBtn, {
      deliverTo: (session) => deliverDraw(instance, session),
      onNewSession: () => sendDrawToNewSession(instance),
      onNewWithArgs: () => sendDrawToCustomSession(instance),
    });
  });
  drawInstructionInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendDrawToNewSession(instance);
    } else if (e.key === 'Escape') { dismissDraw(instance); }
  });
  // Keep save button in sync with whether there are steps (renderFlowSteps owns replay+export)
  function syncSaveBtn(): void {
    flowSaveBtn.disabled = instance.flowSteps.length === 0;
  }

  flowClearBtn.addEventListener('click', () => { clearFlow(instance); syncSaveBtn(); });
  flowReplayBtn.addEventListener('click', () => { void replayFlow(instance); });
  flowSaveBtn.addEventListener('click', () => {
    const project = appState.activeProject;
    if (!project || instance.flowSteps.length === 0) return;
    const instruction = instance.flowInstructionInput.value.trim();
    const name = instruction.slice(0, 40) || `Flow ${new Date().toLocaleTimeString()}`;
    const steps = instance.flowSteps.map((s) => ({
      type: s.type,
      tagName: s.tagName,
      textContent: s.textContent,
      selectorValue: s.activeSelector?.value,
      pageUrl: s.pageUrl,
      url: s.url,
      value: s.value,
      selectedText: s.selectedText,
      key: s.key,
      modifiers: s.modifiers,
    }));
    appState.saveFlow(project.id, name, steps);
    flowSaveBtn.textContent = '✓ Saved';
    setTimeout(() => { flowSaveBtn.textContent = '💾 Save'; }, 1800);
  });
  flowExportBtn.addEventListener('click', async () => {
    const code = buildPlaywrightCode(instance.flowSteps);
    await navigator.clipboard.writeText(code);
    flowExportBtn.textContent = '✓ Copied!';
    setTimeout(() => { flowExportBtn.textContent = '↗ Playwright'; }, 1800);
  });
  flowSubmitBtn.addEventListener('click', () => sendFlowToNewSession(instance));
  flowCustomBtn.addEventListener('click', () => {
    showSendMenu(instance, flowCustomBtn, {
      deliverTo: (session) => deliverFlow(instance, session),
      onNewSession: () => sendFlowToNewSession(instance),
      onNewWithArgs: () => sendFlowToCustomSession(instance),
    });
  });

  flowPickerMenu.addEventListener('click', (e: MouseEvent) => {
    const item = (e.target as HTMLElement).closest<HTMLButtonElement>('.flow-picker-item');
    if (!item || !instance.flowPickerPending) return;
    const action = item.dataset.action as FlowPickerAction;
    const metadata = instance.flowPickerPending;
    dismissFlowPicker(instance);
    if (action === 'click' || action === 'click-and-record') {
      instance.view.send('flow-do-click', metadata.selectors[0]?.value ?? '');
    }
    if (action === 'record' || action === 'click-and-record') {
      addFlowStep(instance, {
        type: action === 'record' ? 'expect' : 'click',
        tagName: metadata.tagName,
        textContent: metadata.textContent,
        selectors: metadata.selectors,
        activeSelector: metadata.selectors[0],
        pageUrl: metadata.pageUrl,
      });
      syncSaveBtn();
    }
  });

  flowPickerOverlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === flowPickerOverlay) dismissFlowPicker(instance);
  });

  sendMenuOverlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === sendMenuOverlay) dismissSendMenu(instance);
  });

  submitBtn.addEventListener('click', () => sendToNewSession(instance));
  customBtn.addEventListener('click', () => {
    showSendMenu(instance, customBtn, {
      deliverTo: (session) => deliverInspect(instance, session),
      onNewSession: () => sendToNewSession(instance),
      onNewWithArgs: () => sendToCustomSession(instance),
    });
  });
  instructionInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendToNewSession(instance);
    } else if (e.key === 'Escape') dismissInspect(instance);
  });

  function recordNavigationStep(url: string): void {
    const lastStep = instance.flowSteps[instance.flowSteps.length - 1];
    if (lastStep?.type === 'navigate' && lastStep.url === url) return;
    addFlowStep(instance, { type: 'navigate', url });
  }

  view.onDidNavigate((navUrl) => {
    urlInput.value = navUrl;
    newTabPage.style.display = 'none';
    appState.updateSessionBrowserTabUrl(sessionId, navUrl);
    if (instance.flowMode) recordNavigationStep(navUrl);
    // Re-inject active modes — full navigation re-runs the preload from scratch,
    // resetting all module-level state (drawMode, inspectMode, flowMode → false).
    if (instance.drawMode) instance.view.send('enter-draw-mode');
    if (instance.inspectMode) instance.view.send('enter-inspect-mode');
    if (instance.flowMode) instance.view.send('enter-flow-mode');
  });
  view.onDidNavigateInPage((navUrl) => {
    urlInput.value = navUrl;
    appState.updateSessionBrowserTabUrl(sessionId, navUrl);
    if (instance.flowMode) recordNavigationStep(navUrl);
  });

  view.onIpcMessage((channel, args) => {
    // DEBUG: temporary instrumentation for inspect-element regression.
    console.log('[INSPECT] host onIpcMessage', channel, args);
    if (channel === 'element-selected') {
      const { metadata, x, y } = args[0] as { metadata: Omit<ElementInfo, 'activeSelector'>; x: number; y: number };
      const info: ElementInfo = { ...metadata, activeSelector: metadata.selectors[0] };
      showElementInfo(instance, info, x, y);
    } else if (channel === 'flow-click-recorded') {
      const { metadata } = args[0] as { metadata: FlowPickerMetadata & { rect?: unknown; computedStyles?: unknown; domPath?: string }; x: number; y: number };
      addFlowStep(instance, {
        type: 'click',
        tagName: metadata.tagName,
        textContent: metadata.textContent,
        selectors: metadata.selectors,
        activeSelector: metadata.selectors[0],
        pageUrl: metadata.pageUrl,
      });
      syncSaveBtn();
    } else if (channel === 'flow-input-filled') {
      const { metadata, value } = args[0] as { metadata: FlowPickerMetadata & { rect?: unknown; computedStyles?: unknown; domPath?: string }; value: string };
      addFlowStep(instance, {
        type: 'fill',
        tagName: metadata.tagName,
        textContent: metadata.textContent,
        selectors: metadata.selectors,
        activeSelector: metadata.selectors[0],
        pageUrl: metadata.pageUrl,
        value,
      });
      syncSaveBtn();
    } else if (channel === 'flow-select-changed') {
      const { metadata, value, selectedText } = args[0] as { metadata: FlowPickerMetadata & { rect?: unknown; computedStyles?: unknown; domPath?: string }; value: string; selectedText: string };
      addFlowStep(instance, {
        type: 'select',
        tagName: 'select',
        textContent: metadata.textContent,
        selectors: metadata.selectors,
        activeSelector: metadata.selectors[0],
        pageUrl: metadata.pageUrl,
        value,
        selectedText,
      });
      syncSaveBtn();
    } else if (channel === 'flow-key-pressed') {
      const { key, modifiers } = args[0] as { key: string; modifiers: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean } };
      addFlowStep(instance, { type: 'press', key, modifiers });
      syncSaveBtn();
    } else if (channel === 'flow-assertion-suggestions') {
      const { suggestions } = args[0] as { suggestions: Array<{ tagName: string; id: string; classes: string[]; textContent: string; selectors: Array<{ type: string; label: string; value: string }>; pageUrl: string }> };
      addFlowSuggestions(instance, suggestions);
      syncSaveBtn();
    } else if (channel === 'draw-stroke-end') {
      const { x, y } = args[0] as { x: number; y: number };
      positionDrawPopover(instance, x, y);
    }
  });

  // DEBUG: forward webview-side console + load errors to host DevTools so the
  // preload's logs show up in a single place. Only wires for the <webview> path.
  if (!useWebContentsView) {
    const wv = view.element as unknown as {
      addEventListener: (type: string, listener: (e: Event) => void) => void;
      openDevTools?: () => void;
    };
    wv.addEventListener('console-message', (e: Event) => {
      const ev = e as Event & { message: string; level: number; line: number; sourceId: string };
      console.log('[INSPECT][webview console]', ev.message, '@', ev.sourceId, ':', ev.line);
    });
    wv.addEventListener('did-fail-load', (e: Event) => {
      const ev = e as Event & { errorCode: number; errorDescription: string; validatedURL: string };
      console.warn('[INSPECT] webview did-fail-load', ev.errorCode, ev.errorDescription, ev.validatedURL);
    });
    wv.addEventListener('preload-error', (e: Event) => {
      const ev = e as Event & { preloadPath?: string; error?: { message?: string } };
      console.error('[INSPECT] webview preload-error', ev.preloadPath, ev.error?.message);
    });
    wv.addEventListener('dom-ready', () => {
      console.log('[INSPECT] webview dom-ready');
    });
  }

}

export function attachBrowserTabToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function showBrowserTabPane(sessionId: string, isSplit: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.remove('hidden');
  instance.element.classList.toggle('split', isSplit);
}

export function hideAllBrowserTabPanes(): void {
  for (const instance of instances.values()) {
    instance.element.classList.add('hidden');
  }
}

export function destroyBrowserTabPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  // Delete from the map first so errors below can't leave a half-destroyed instance around.
  instances.delete(sessionId);

  document.removeEventListener('mousedown', instance.viewportOutsideClickHandler);
  try { dismissSendMenu(instance); } catch {}

  // <webview> calls throw if it isn't attached + dom-ready yet. Guard each
  // one individually so a failure can't skip instance.element.remove() below.
  try { if (instance.inspectMode) instance.view.send('exit-inspect-mode'); } catch {}
  try { if (instance.flowMode) instance.view.send('exit-flow-mode'); } catch {}
  try { if (instance.drawMode) instance.view.send('exit-draw-mode'); } catch {}
  try { instance.view.stop(); } catch {}
  try { instance.view.setSrc('about:blank'); } catch {}
  try { instance.view.destroy(); } catch {}

  instance.element.remove();
}
