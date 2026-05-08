import { buildSelectorOptions } from './selector-ui.js';
import type { BrowserTabInstance, FlowStep } from './types.js';

// Step delay used between replay actions (ms)
const REPLAY_STEP_DELAY = 600;

export function renderFlowSteps(instance: BrowserTabInstance): void {
  const list = instance.flowStepsList;

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed && list.contains(sel.anchorNode)) return;

  list.innerHTML = '';

  instance.flowSteps.forEach((step, i) => {
    const row = document.createElement('div');
    row.className = 'flow-step';
    if (i === instance.replayIndex) row.classList.add('is-replay-current');

    const num = document.createElement('span');
    num.className = 'flow-step-number';
    num.textContent = `${i + 1}.`;

    const content = document.createElement('div');
    content.className = 'flow-step-content';

    if (step.type === 'click' || step.type === 'expect') {
      const header = document.createElement('div');
      header.className = 'flow-step-header';
      const typeBadge = document.createElement('span');
      typeBadge.className = `flow-step-type-badge flow-step-type-badge-${step.type}`;
      typeBadge.textContent = step.type;
      const tag = document.createElement('span');
      tag.className = 'flow-step-tag';
      tag.textContent = `<${step.tagName}>`;
      const desc = document.createElement('span');
      desc.textContent = step.textContent ? ` "${step.textContent}"` : '';
      if (step.suggestion) {
        const chip = document.createElement('span');
        chip.className = 'flow-suggestion-chip';
        chip.title = 'Auto-suggested based on DOM change after click';
        chip.textContent = 'suggested';
        header.appendChild(chip);
      }
      header.appendChild(typeBadge);
      header.appendChild(tag);
      header.appendChild(desc);
      content.appendChild(header);

      if (step.selectors?.length) {
        const selectorOptions = buildSelectorOptions(
          step.selectors,
          step.activeSelector,
          (sel) => { step.activeSelector = sel; renderFlowSteps(instance); }
        );
        selectorOptions.className = 'flow-step-selectors';

        // Inline selector editing
        const editRow = document.createElement('div');
        editRow.className = 'flow-step-selector-edit-row';
        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.className = 'flow-step-selector-edit-input';
        editInput.value = step.activeSelector?.value ?? '';
        editInput.placeholder = 'Custom selector…';
        editInput.title = 'Edit selector directly';
        editInput.addEventListener('change', () => {
          if (step.activeSelector) {
            step.activeSelector = { ...step.activeSelector, value: editInput.value };
          } else {
            step.activeSelector = { type: 'css', label: 'css', value: editInput.value };
          }
        });
        editRow.appendChild(editInput);
        content.appendChild(selectorOptions);
        content.appendChild(editRow);
      }
    } else if (step.type === 'fill') {
      const header = document.createElement('div');
      header.className = 'flow-step-header';
      const typeBadge = document.createElement('span');
      typeBadge.className = 'flow-step-type-badge flow-step-type-badge-fill';
      typeBadge.textContent = 'fill';
      const tag = document.createElement('span');
      tag.className = 'flow-step-tag';
      tag.textContent = `<${step.tagName}>`;
      const val = document.createElement('span');
      val.className = 'flow-step-value';
      val.textContent = step.value ? ` "${step.value}"` : '';
      header.appendChild(typeBadge);
      header.appendChild(tag);
      header.appendChild(val);
      content.appendChild(header);
      if (step.selectors?.length) {
        const selectorOptions = buildSelectorOptions(step.selectors, step.activeSelector, (sel) => { step.activeSelector = sel; });
        selectorOptions.className = 'flow-step-selectors';
        content.appendChild(selectorOptions);
      }
    } else if (step.type === 'select') {
      const header = document.createElement('div');
      header.className = 'flow-step-header';
      const typeBadge = document.createElement('span');
      typeBadge.className = 'flow-step-type-badge flow-step-type-badge-select';
      typeBadge.textContent = 'select';
      const tag = document.createElement('span');
      tag.className = 'flow-step-tag';
      tag.textContent = `<select>`;
      const val = document.createElement('span');
      val.className = 'flow-step-value';
      val.textContent = step.selectedText ? ` → "${step.selectedText}"` : step.value ? ` → "${step.value}"` : '';
      header.appendChild(typeBadge);
      header.appendChild(tag);
      header.appendChild(val);
      content.appendChild(header);
      if (step.selectors?.length) {
        const selectorOptions = buildSelectorOptions(step.selectors, step.activeSelector, (sel) => { step.activeSelector = sel; });
        selectorOptions.className = 'flow-step-selectors';
        content.appendChild(selectorOptions);
      }
    } else if (step.type === 'press') {
      const header = document.createElement('div');
      header.className = 'flow-step-header';
      const typeBadge = document.createElement('span');
      typeBadge.className = 'flow-step-type-badge flow-step-type-badge-press';
      typeBadge.textContent = 'press';
      const keySpan = document.createElement('span');
      keySpan.className = 'flow-step-key';
      const parts: string[] = [];
      if (step.modifiers?.meta) parts.push('Cmd');
      if (step.modifiers?.ctrl) parts.push('Ctrl');
      if (step.modifiers?.shift) parts.push('Shift');
      if (step.modifiers?.alt) parts.push('Alt');
      parts.push(step.key ?? '?');
      keySpan.textContent = ` ${parts.join('+')}`;
      header.appendChild(typeBadge);
      header.appendChild(keySpan);
      content.appendChild(header);
    } else {
      // navigate
      const urlSpan = document.createElement('span');
      urlSpan.className = 'flow-step-url';
      urlSpan.textContent = `→ ${step.url}`;
      content.appendChild(urlSpan);
    }

    // Reorder buttons
    const reorderBtns = document.createElement('div');
    reorderBtns.className = 'flow-step-reorder-btns';
    const upBtn = document.createElement('button');
    upBtn.className = 'flow-step-reorder-btn';
    upBtn.textContent = '↑';
    upBtn.title = 'Move step up';
    upBtn.disabled = i === 0;
    upBtn.addEventListener('click', () => {
      [instance.flowSteps[i - 1], instance.flowSteps[i]] = [instance.flowSteps[i], instance.flowSteps[i - 1]];
      renderFlowSteps(instance);
    });
    const downBtn = document.createElement('button');
    downBtn.className = 'flow-step-reorder-btn';
    downBtn.textContent = '↓';
    downBtn.title = 'Move step down';
    downBtn.disabled = i === instance.flowSteps.length - 1;
    downBtn.addEventListener('click', () => {
      [instance.flowSteps[i], instance.flowSteps[i + 1]] = [instance.flowSteps[i + 1], instance.flowSteps[i]];
      renderFlowSteps(instance);
    });
    reorderBtns.appendChild(upBtn);
    reorderBtns.appendChild(downBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'flow-step-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove step';
    removeBtn.addEventListener('click', () => {
      instance.flowSteps.splice(i, 1);
      renderFlowSteps(instance);
    });

    row.appendChild(num);
    row.appendChild(content);
    row.appendChild(reorderBtns);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });

  const hasSteps = instance.flowSteps.length > 0;
  instance.flowPanel.style.display = (instance.flowMode || hasSteps) ? 'flex' : 'none';
  instance.flowInputRow.style.display = hasSteps ? 'flex' : 'none';
  instance.flowPlanModeRow.style.display = hasSteps ? 'flex' : 'none';
  instance.flowPanelLabel.textContent = `Flow (${instance.flowSteps.length} steps)`;
  instance.replayBtn.disabled = !hasSteps;
  instance.exportBtn.disabled = !hasSteps;
}

export function addFlowStep(instance: BrowserTabInstance, step: FlowStep): void {
  instance.flowSteps.push(step);
  renderFlowSteps(instance);
}

export function addFlowSuggestions(instance: BrowserTabInstance, suggestions: Array<{ tagName: string; id: string; classes: string[]; textContent: string; selectors: Array<{ type: string; label: string; value: string }>; pageUrl: string }>): void {
  for (const s of suggestions.slice(0, 2)) {
    instance.flowSteps.push({
      type: 'expect',
      tagName: s.tagName,
      textContent: s.textContent,
      selectors: s.selectors as FlowStep['selectors'],
      activeSelector: s.selectors[0] as FlowStep['activeSelector'],
      pageUrl: s.pageUrl,
      suggestion: true,
    });
  }
  renderFlowSteps(instance);
}

export function toggleFlowMode(instance: BrowserTabInstance): void {
  instance.flowMode = !instance.flowMode;
  instance.recordBtn.classList.toggle('active', instance.flowMode);
  instance.recordBtn.setAttribute('data-label', instance.flowMode ? 'Stop Recording' : 'Record Flow');

  instance.inspectBtn.disabled = instance.flowMode;
  instance.drawBtn.disabled = instance.flowMode;
  if (instance.flowMode) {
    instance.view.send('enter-flow-mode');
    instance.flowPanel.style.display = 'flex';
  } else {
    instance.view.send('exit-flow-mode');
    if (instance.flowSteps.length === 0) {
      instance.flowPanel.style.display = 'none';
    }
  }
}

export function clearFlow(instance: BrowserTabInstance): void {
  instance.flowSteps = [];
  instance.replayIndex = -1;
  instance.flowInstructionInput.value = '';
  instance.flowInstructionInput.dispatchEvent(new Event('input'));
  renderFlowSteps(instance);
}

export function dismissFlow(instance: BrowserTabInstance): void {
  if (instance.flowMode) toggleFlowMode(instance);
  clearFlow(instance);
}

export function buildFlowPrompt(instance: BrowserTabInstance): string | null {
  if (instance.flowSteps.length === 0) return null;
  const instruction = instance.flowInstructionInput.value.trim();
  if (!instruction) return null;

  const lines = instance.flowSteps.map((step, i) => {
    const n = i + 1;
    if (step.type === 'click' || step.type === 'expect') {
      const tag = `<${step.tagName}>`;
      const text = step.textContent ? ` "${step.textContent}"` : '';
      const at = step.pageUrl ? ` at ${step.pageUrl}` : '';
      const sel = step.activeSelector ? `\n   selector: '${step.activeSelector.value}'` : '';
      const verb = step.type === 'expect' ? 'Assert/Expect' : 'Click';
      return `${n}. ${verb}: ${tag}${text}${at}${sel}`;
    } else if (step.type === 'fill') {
      const tag = `<${step.tagName}>`;
      const at = step.pageUrl ? ` at ${step.pageUrl}` : '';
      const sel = step.activeSelector ? `\n   selector: '${step.activeSelector.value}'` : '';
      return `${n}. Fill: ${tag}${at} with "${step.value ?? ''}"${sel}`;
    } else if (step.type === 'select') {
      const at = step.pageUrl ? ` at ${step.pageUrl}` : '';
      const sel = step.activeSelector ? `\n   selector: '${step.activeSelector.value}'` : '';
      const display = step.selectedText ? `"${step.selectedText}" (value: "${step.value ?? ''}")` : `"${step.value ?? ''}"`;
      return `${n}. Select: <select>${at} → ${display}${sel}`;
    } else if (step.type === 'press') {
      const parts: string[] = [];
      if (step.modifiers?.meta) parts.push('Cmd');
      if (step.modifiers?.ctrl) parts.push('Ctrl');
      if (step.modifiers?.shift) parts.push('Shift');
      if (step.modifiers?.alt) parts.push('Alt');
      parts.push(step.key ?? '?');
      return `${n}. Press: ${parts.join('+')}`;
    } else {
      return `${n}. Navigate to: ${step.url}`;
    }
  });

  return (
    `Recorded browser flow (${instance.flowSteps.length} steps):\n` +
    lines.join('\n') +
    `\n\nInstructions: ${instruction}`
  );
}

export function buildPlaywrightCode(steps: FlowStep[]): string {
  const lines = steps.map((step) => {
    const sel = step.activeSelector?.value ? `page.locator(${JSON.stringify(step.activeSelector.value)})` : null;
    if (step.type === 'navigate') {
      return `  await page.goto(${JSON.stringify(step.url ?? '')});`;
    } else if (step.type === 'click') {
      return sel ? `  await ${sel}.click();` : `  // click (no selector)`;
    } else if (step.type === 'fill') {
      return sel ? `  await ${sel}.fill(${JSON.stringify(step.value ?? '')});` : `  // fill (no selector)`;
    } else if (step.type === 'select') {
      return sel ? `  await ${sel}.selectOption(${JSON.stringify(step.value ?? '')});` : `  // select (no selector)`;
    } else if (step.type === 'press') {
      const parts: string[] = [];
      if (step.modifiers?.meta) parts.push('Meta');
      if (step.modifiers?.ctrl) parts.push('Control');
      if (step.modifiers?.shift) parts.push('Shift');
      if (step.modifiers?.alt) parts.push('Alt');
      parts.push(step.key ?? '');
      const chord = parts.join('+');
      return `  await page.keyboard.press(${JSON.stringify(chord)});`;
    } else if (step.type === 'expect') {
      return sel ? `  await expect(${sel}).toBeVisible();` : `  // expect (no selector)`;
    }
    return '';
  }).filter(Boolean);

  return [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test('recorded flow', async ({ page }) => {`,
    ...lines,
    `});`,
  ].join('\n');
}

export async function replayFlow(instance: BrowserTabInstance): Promise<void> {
  if (instance.flowSteps.length === 0) return;
  instance.replayBtn.disabled = true;
  instance.replayBtn.textContent = '⏹ Replaying…';

  for (let i = 0; i < instance.flowSteps.length; i++) {
    instance.replayIndex = i;
    renderFlowSteps(instance);

    const step = instance.flowSteps[i];
    const selector = step.activeSelector?.value ?? '';

    if (step.type === 'navigate' && step.url) {
      instance.view.setSrc(step.url);
      // Give the page time to load before continuing
      await new Promise((r) => setTimeout(r, 1500));
    } else if (step.type === 'click') {
      instance.view.send('flow-do-click', selector);
      await new Promise((r) => setTimeout(r, REPLAY_STEP_DELAY));
    } else if (step.type === 'fill') {
      instance.view.send('flow-replay-fill', selector, step.value ?? '');
      await new Promise((r) => setTimeout(r, REPLAY_STEP_DELAY));
    } else if (step.type === 'select') {
      instance.view.send('flow-replay-select', selector, step.value ?? '');
      await new Promise((r) => setTimeout(r, REPLAY_STEP_DELAY));
    } else if (step.type === 'press') {
      instance.view.send('flow-replay-press', step.key ?? '', step.modifiers ?? {});
      await new Promise((r) => setTimeout(r, REPLAY_STEP_DELAY));
    }
    // expect/assert steps are visual-only — no action during replay
  }

  instance.replayIndex = -1;
  renderFlowSteps(instance);
  instance.replayBtn.disabled = false;
  instance.replayBtn.textContent = '▶ Replay';
}
