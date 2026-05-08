/**
 * Preload script injected into the browser-tab guest webContents.
 *
 * Provides DOM element inspection: hover highlight, click to select,
 * draw mode, and flow recording. Bubbles guest-side events back to the
 * host renderer via {@link bubbleHostMessage}.
 *
 * A5 Phase 4: this preload runs unchanged in both the legacy `<webview>`
 * adapter and the `WebContentsView` adapter. The two paths differ in how
 * preload → host messages are routed:
 *   - `<webview>`: `ipcRenderer.sendToHost(channel, payload)` triggers an
 *     `ipc-message` DOM event on the `<webview>` element in the host
 *     renderer, which `createWebviewAdapter` listens for.
 *   - `WebContentsView`: `ipcRenderer.send(channel, payload)` reaches the
 *     main process, where `wc.on('ipc-message', ...)` in
 *     `src/main/ipc/browser-view.ts` rebroadcasts it as a
 *     `BrowserViewEvent` with `kind: 'ipc-message'` for
 *     `createWebContentsViewAdapter` to dispatch.
 *
 * `sendToHost` outside of a `<webview>` context is a silent no-op (its
 * internal `ipc-message-host` channel has no receiver), and a stray
 * `ipcRenderer.send` under the `<webview>` path lands in main where no
 * handler is registered for these channels. So dual-emitting is safe in
 * both directions and saves us from runtime context detection.
 */
import { ipcRenderer } from 'electron';

// DEBUG: temporary instrumentation for inspect-element regression. Visible
// from the host renderer DevTools because pane.ts forwards the webview's
// console-message event into the host console.
console.log('[INSPECT] preload script loaded');

interface SelectorOption {
  type: 'qa' | 'attr' | 'id' | 'css' | 'aria';
  label: string;
  value: string;
}

const QA_ATTRS = ['data-testid', 'data-qa', 'data-cy', 'data-test', 'data-automation', 'qaTag'];

function bubbleHostMessage(channel: string, payload: unknown): void {
  // Legacy <webview>: routes to host renderer's ipc-message DOM event.
  ipcRenderer.sendToHost(channel, payload);
  // WebContentsView: routes to main, which broadcasts back to the renderer.
  ipcRenderer.send(channel, payload);
}

let inspectMode = false;
let flowMode = false;
let drawMode = false;
let suppressNextFlowClick = false;
let highlightOverlay: HTMLDivElement | null = null;
let flowMutationObserver: MutationObserver | null = null;
let flowMutationTimeout: ReturnType<typeof setTimeout> | null = null;

let drawCanvas: HTMLCanvasElement | null = null;
let drawCtx: CanvasRenderingContext2D | null = null;
let drawing = false;
let strokeCompleted = false;

function applyDrawStyles(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ff3b30';
}

function ensureDrawCanvas(): HTMLCanvasElement {
  if (!drawCanvas) {
    drawCanvas = document.createElement('canvas');
    // edit_pen icon with thick white outline for visibility on any background
    const penSvg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 -960 960 960'>" +
      "<path fill='black' stroke='white' stroke-width='90' stroke-linejoin='round' paint-order='stroke' " +
      "d='M180.18-144q-15.18 0-25.68-10.3-10.5-10.29-10.5-25.52v-86.85q0-14.33 5-27.33 5-13 16-24l477-477q11-11 23.84-16 12.83-5 27-5 14.16 0 27.16 5t24 16l51 51q11 11 16 24t5 26.54q0 14.45-5.02 27.54T795-642L318-165q-11 11-23.95 16t-27.24 5h-86.63ZM693-642l51-51-51-51-51 51 51 51Z'/>" +
      "</svg>";
    drawCanvas.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
      'z-index:2147483646;pointer-events:auto;' +
      `cursor:url("data:image/svg+xml;utf8,${penSvg}") 5 24, crosshair;` +
      'background:transparent;';
    drawCanvas.width = window.innerWidth;
    drawCanvas.height = window.innerHeight;
    document.documentElement.appendChild(drawCanvas);
    drawCtx = drawCanvas.getContext('2d');
    if (drawCtx) applyDrawStyles(drawCtx);
  }
  return drawCanvas;
}

function onDrawPointerDown(e: PointerEvent): void {
  if (!drawMode || !drawCtx) return;
  e.preventDefault();
  e.stopPropagation();
  if (strokeCompleted && drawCanvas) {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    strokeCompleted = false;
  }
  drawing = true;
  drawCtx.beginPath();
  drawCtx.moveTo(e.clientX, e.clientY);
}

function onDrawPointerMove(e: PointerEvent): void {
  if (!drawMode || !drawing || !drawCtx) return;
  e.preventDefault();
  drawCtx.lineTo(e.clientX, e.clientY);
  drawCtx.stroke();
}

function onDrawPointerUp(e: PointerEvent): void {
  if (!drawMode || !drawing) return;
  e.preventDefault();
  drawing = false;
  strokeCompleted = true;
  bubbleHostMessage('draw-stroke-end', { x: e.clientX, y: e.clientY });
}

function onDrawResize(): void {
  if (!drawCanvas || !drawCtx) return;
  // Resizing a canvas clears its bitmap, so snapshot first and blit back.
  const tmp = document.createElement('canvas');
  tmp.width = drawCanvas.width;
  tmp.height = drawCanvas.height;
  tmp.getContext('2d')?.drawImage(drawCanvas, 0, 0);
  drawCanvas.width = window.innerWidth;
  drawCanvas.height = window.innerHeight;
  applyDrawStyles(drawCtx);
  drawCtx.drawImage(tmp, 0, 0);
}

function enterDrawMode(): void {
  drawMode = true;
  strokeCompleted = false;
  const canvas = ensureDrawCanvas();
  canvas.style.display = 'block';
  canvas.addEventListener('pointerdown', onDrawPointerDown, true);
  canvas.addEventListener('pointermove', onDrawPointerMove, true);
  canvas.addEventListener('pointerup', onDrawPointerUp, true);
  canvas.addEventListener('pointercancel', onDrawPointerUp, true);
  window.addEventListener('resize', onDrawResize);
}

function exitDrawMode(): void {
  drawMode = false;
  drawing = false;
  strokeCompleted = false;
  if (drawCanvas) {
    drawCanvas.removeEventListener('pointerdown', onDrawPointerDown, true);
    drawCanvas.removeEventListener('pointermove', onDrawPointerMove, true);
    drawCanvas.removeEventListener('pointerup', onDrawPointerUp, true);
    drawCanvas.removeEventListener('pointercancel', onDrawPointerUp, true);
    if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCanvas.remove();
    drawCanvas = null;
    drawCtx = null;
  }
  window.removeEventListener('resize', onDrawResize);
}

function clearDrawing(): void {
  if (drawCtx && drawCanvas) {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
  strokeCompleted = false;
}

function ensureOverlay(): HTMLDivElement {
  if (!highlightOverlay) {
    highlightOverlay = document.createElement('div');
    highlightOverlay.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483647;' +
      'border:2px solid #4a9eff;background:rgba(74,158,255,0.15);' +
      'transition:all 0.05s ease;display:none;';
    document.documentElement.appendChild(highlightOverlay);
  }
  return highlightOverlay;
}

function positionOverlay(el: Element): void {
  const overlay = ensureOverlay();
  const rect = el.getBoundingClientRect();
  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.display = 'block';
}

function hideOverlay(): void {
  if (highlightOverlay) highlightOverlay.style.display = 'none';
}

function buildCssPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
      parts.unshift(selector);
      break; // ID is unique enough
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function buildDomPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < 4 && current !== document.body && current !== document.documentElement) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${current.id}`;
    } else if (current.classList.length) {
      part += `.${current.classList[0]}`;
    }
    parts.unshift(part);
    current = current.parentElement;
    depth++;
  }
  return parts.join(' › ');
}

function buildAllSelectors(el: Element): SelectorOption[] {
  const options: SelectorOption[] = [];

  const qaSet = new Set(QA_ATTRS);
  for (const attr of QA_ATTRS) {
    const val = el.getAttribute(attr);
    if (val) options.push({ type: 'qa', label: attr, value: `[${attr}="${val}"]` });
  }

  for (const attr of el.getAttributeNames()) {
    if (attr.startsWith('data-') && !qaSet.has(attr)) {
      const val = el.getAttribute(attr);
      if (val) options.push({ type: 'attr', label: attr, value: `[${attr}="${val}"]` });
    }
  }

  if (el.id) options.push({ type: 'id', label: 'id', value: `#${el.id}` });

  // ARIA role + accessible name — more resilient than CSS positional selectors
  const role = el.getAttribute('role') || el.tagName.toLowerCase();
  const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
    ? el.getAttribute('aria-label') ?? undefined
    : undefined;
  const ariaName = ariaLabel ?? (el.textContent || '').trim().slice(0, 60) || undefined;
  if (ariaName) {
    options.push({
      type: 'aria',
      label: 'aria',
      value: `[role="${role}"][aria-label="${ariaName}"]`,
    });
  }

  options.push({ type: 'css', label: 'css', value: buildCssPath(el) });

  return options;
}

function getElementMetadata(el: Element) {
  const text = (el.textContent || '').trim();
  const domRect = el.getBoundingClientRect();
  const cs = window.getComputedStyle(el);
  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: Array.from(el.classList),
    textContent: text.length > 150 ? `${text.slice(0, 150)}\u2026` : text,
    selectors: buildAllSelectors(el),
    pageUrl: window.location.href,
    rect: { width: Math.round(domRect.width), height: Math.round(domRect.height) },
    computedStyles: {
      display: cs.display,
      position: cs.position,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize,
    },
    domPath: buildDomPath(el),
  };
}

function onMouseOver(e: MouseEvent): void {
  if (!inspectMode && !flowMode) return;
  const target = e.target as Element;
  if (target === highlightOverlay) return;
  positionOverlay(target);
}

function onMouseOut(_e: MouseEvent): void {
  if (!inspectMode && !flowMode) return;
  hideOverlay();
}

function onClick(e: MouseEvent): void {
  // DEBUG: temporary instrumentation for inspect-element regression.
  console.log('[INSPECT] preload onClick fired, inspectMode=', inspectMode, 'target=', (e.target as Element)?.tagName);
  if (!inspectMode) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  const target = e.target as Element;
  if (target === highlightOverlay) return;
  const metadata = getElementMetadata(target);
  console.log('[INSPECT] preload bubbling element-selected');
  bubbleHostMessage('element-selected', { metadata, x: e.clientX, y: e.clientY });
}

function onFlowClick(e: MouseEvent): void {
  if (!flowMode) return;
  if (suppressNextFlowClick) {
    suppressNextFlowClick = false;
    return;
  }
  const target = e.target as Element;
  if (target === highlightOverlay) return;
  // Let the click go through naturally so the page interaction completes.
  // Record the step directly — the old picker approach used a host-renderer
  // popup that rendered behind the <webview> compositor layer.
  bubbleHostMessage('flow-click-recorded', {
    metadata: getElementMetadata(target),
    x: e.clientX,
    y: e.clientY,
  });
  // Watch the DOM for a second after each click to suggest assertion steps
  watchForAssertionSuggestions();
}

function onFlowInputChange(e: Event): void {
  if (!flowMode) return;
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if (target.tagName === 'SELECT') {
    const sel = target as HTMLSelectElement;
    bubbleHostMessage('flow-select-changed', {
      metadata: getElementMetadata(target),
      value: sel.value,
      selectedText: sel.options[sel.selectedIndex]?.text ?? '',
      x: 0, y: 0,
    });
  } else {
    bubbleHostMessage('flow-input-filled', {
      metadata: getElementMetadata(target),
      value: (target as HTMLInputElement | HTMLTextAreaElement).value,
      x: 0, y: 0,
    });
  }
}

const FLOW_NOTABLE_KEYS = ['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', ' '];

function onFlowKeyDown(e: KeyboardEvent): void {
  if (!flowMode) return;
  if (!FLOW_NOTABLE_KEYS.includes(e.key)) return;
  // Skip pure Tab presses on non-interactive elements to avoid noise
  if (e.key === 'Tab' && !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement || document.activeElement instanceof HTMLButtonElement)) return;
  bubbleHostMessage('flow-key-pressed', {
    key: e.key,
    modifiers: { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey },
  });
}

function watchForAssertionSuggestions(): void {
  if (flowMutationTimeout) { clearTimeout(flowMutationTimeout); flowMutationTimeout = null; }
  if (flowMutationObserver) { flowMutationObserver.disconnect(); flowMutationObserver = null; }

  const suggestions: Array<ReturnType<typeof getElementMetadata>> = [];

  flowMutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        const el = node as Element;
        // Only suggest visible, non-overlay elements with meaningful content
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const text = (el.textContent || '').trim();
        if (!text && !el.querySelector('img, svg')) continue;
        if (suggestions.length < 3) suggestions.push(getElementMetadata(el));
      }
    }
  });

  flowMutationObserver.observe(document.body, { childList: true, subtree: true });

  // Stop watching after 1 second and emit suggestions
  flowMutationTimeout = setTimeout(() => {
    if (flowMutationObserver) { flowMutationObserver.disconnect(); flowMutationObserver = null; }
    if (suggestions.length > 0) {
      bubbleHostMessage('flow-assertion-suggestions', { suggestions });
    }
  }, 1000);
}

function enterFlowMode(): void {
  flowMode = true;
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onFlowClick, true);
  document.addEventListener('change', onFlowInputChange, true);
  document.addEventListener('keydown', onFlowKeyDown, true);
  document.body.style.cursor = 'crosshair';
}

function exitFlowMode(): void {
  flowMode = false;
  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('mouseout', onMouseOut, true);
  document.removeEventListener('click', onFlowClick, true);
  document.removeEventListener('change', onFlowInputChange, true);
  document.removeEventListener('keydown', onFlowKeyDown, true);
  if (flowMutationTimeout) { clearTimeout(flowMutationTimeout); flowMutationTimeout = null; }
  if (flowMutationObserver) { flowMutationObserver.disconnect(); flowMutationObserver = null; }
  hideOverlay();
  document.body.style.cursor = '';
}

function enterInspectMode(): void {
  inspectMode = true;
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClick, true);
  document.body.style.cursor = 'crosshair';
  // DEBUG: temporary instrumentation for inspect-element regression.
  console.log('[INSPECT] preload enterInspectMode — listeners attached, body=', document.body ? 'ok' : 'null');
}

function exitInspectMode(): void {
  inspectMode = false;
  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('mouseout', onMouseOut, true);
  document.removeEventListener('click', onClick, true);
  hideOverlay();
  document.body.style.cursor = '';
}

// DEBUG: temporary instrumentation for inspect-element regression.
ipcRenderer.on('enter-inspect-mode', () => { console.log('[INSPECT] preload received enter-inspect-mode'); enterInspectMode(); });
ipcRenderer.on('exit-inspect-mode', () => { console.log('[INSPECT] preload received exit-inspect-mode'); exitInspectMode(); });
ipcRenderer.on('enter-flow-mode', () => enterFlowMode());
ipcRenderer.on('exit-flow-mode', () => exitFlowMode());
ipcRenderer.on('enter-draw-mode', () => enterDrawMode());
ipcRenderer.on('exit-draw-mode', () => exitDrawMode());
ipcRenderer.on('draw-clear', () => clearDrawing());
ipcRenderer.on('flow-do-click', (_event, selector: string) => {
  const el = document.querySelector(selector);
  if (el instanceof HTMLElement) {
    suppressNextFlowClick = true;
    el.click();
  }
});

ipcRenderer.on('flow-replay-fill', (_event, selector: string, value: string) => {
  const el = document.querySelector(selector);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    nativeInputValueSetter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

ipcRenderer.on('flow-replay-select', (_event, selector: string, value: string) => {
  const el = document.querySelector(selector);
  if (el instanceof HTMLSelectElement) {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

ipcRenderer.on('flow-replay-press', (_event, key: string, modifiers: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean }) => {
  const activeEl = document.activeElement ?? document.body;
  const opts: KeyboardEventInit = {
    key,
    bubbles: true,
    shiftKey: modifiers.shift,
    ctrlKey: modifiers.ctrl,
    metaKey: modifiers.meta,
    altKey: modifiers.alt,
  };
  activeEl.dispatchEvent(new KeyboardEvent('keydown', opts));
  activeEl.dispatchEvent(new KeyboardEvent('keyup', opts));
});
