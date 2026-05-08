import { formatPmRun } from '../../../shared/run-command.js';
import type { RunCandidate } from '../../../shared/types.js';
import { createCustomSelect } from '../custom-select.js';
import { closeModal, registerModalCleanup } from '../modal.js';

/**
 * Run-confirmation modal — shown the first time the user clicks Run for a
 * project (or when they invoke "Edit run command…" from the context menu).
 *
 * Bypasses `showModal` because we need:
 *  - Reactive script picker → command field (changing the dropdown updates the
 *    text input live, so the user can preview the resolved command).
 *  - Header context line ("Detected from package.json"), which `showModal`'s
 *    label-only field model can't express cleanly.
 *
 * Returns the chosen `{ command, save }` via `onConfirm`. Caller decides what
 * to do with `save: true` — typically persist `command` onto `ProjectRecord.runCommand`.
 */
export interface RunConfirmationResult {
  command: string;
  save: boolean;
}

export function showRunConfirmationModal(
  candidate: RunCandidate,
  defaultSave: boolean,
  onConfirm: (result: RunConfirmationResult) => void,
): void {
  const overlay = document.getElementById('modal-overlay')!;
  const titleEl = document.getElementById('modal-title')!;
  const bodyEl = document.getElementById('modal-body')!;
  const btnCancel = document.getElementById('modal-cancel') as HTMLButtonElement;
  const btnConfirm = document.getElementById('modal-confirm') as HTMLButtonElement;

  titleEl.textContent = 'Run dev server';
  bodyEl.innerHTML = '';
  btnCancel.textContent = 'Cancel';
  btnConfirm.textContent = 'Run';

  // 1. Source line — explains where the command came from.
  const sourceLine = document.createElement('div');
  sourceLine.className = 'modal-message';
  sourceLine.textContent = describeSource(candidate);
  bodyEl.appendChild(sourceLine);

  // 2. Script picker (only when there are alternates worth showing).
  let scriptSelect: ReturnType<typeof createCustomSelect> | null = null;
  const showsPicker = candidate.source === 'package.json'
    && Array.isArray(candidate.allScripts)
    && candidate.allScripts.length > 1;

  if (showsPicker) {
    const field = document.createElement('div');
    field.className = 'modal-field';
    const label = document.createElement('label');
    label.setAttribute('for', 'modal-dev-script');
    label.textContent = 'Script';
    field.appendChild(label);

    const options = (candidate.allScripts ?? []).map((name) => ({
      value: name,
      label: name,
    }));
    scriptSelect = createCustomSelect(
      'modal-dev-script',
      options,
      candidate.script,
      (value) => {
        // Live-update the command field whenever the script choice changes.
        const cmdInput = document.getElementById('modal-dev-command') as HTMLInputElement | null;
        if (cmdInput && candidate.packageManager) {
          cmdInput.value = formatPmRun(candidate.packageManager, value);
        }
      },
    );
    field.appendChild(scriptSelect.element);
    bodyEl.appendChild(field);
    registerModalCleanup(() => scriptSelect?.destroy());
  }

  // 3. Editable command line.
  const cmdField = document.createElement('div');
  cmdField.className = 'modal-field';
  const cmdLabel = document.createElement('label');
  cmdLabel.setAttribute('for', 'modal-dev-command');
  cmdLabel.textContent = 'Command';
  cmdField.appendChild(cmdLabel);
  const cmdInput = document.createElement('input');
  cmdInput.id = 'modal-dev-command';
  cmdInput.type = 'text';
  cmdInput.value = candidate.command;
  cmdInput.placeholder = 'npm run dev';
  cmdField.appendChild(cmdInput);
  bodyEl.appendChild(cmdField);

  // 4. "Save for this project" checkbox.
  const saveField = document.createElement('div');
  saveField.className = 'modal-field modal-field-checkbox';
  const saveInput = document.createElement('input');
  saveInput.id = 'modal-dev-save';
  saveInput.type = 'checkbox';
  saveInput.checked = defaultSave;
  const saveLabel = document.createElement('label');
  saveLabel.setAttribute('for', 'modal-dev-save');
  saveLabel.textContent = 'Save as default for this project';
  saveField.appendChild(saveInput);
  saveField.appendChild(saveLabel);
  bodyEl.appendChild(saveField);

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    cmdInput.focus();
    cmdInput.select();
  });

  const handleConfirm = (): void => {
    const command = cmdInput.value.trim();
    if (!command) return;
    closeModal();
    onConfirm({ command, save: saveInput.checked });
  };

  const handleCancel = (): void => closeModal();

  const handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  btnConfirm.addEventListener('click', handleConfirm);
  btnCancel.addEventListener('click', handleCancel);
  document.addEventListener('keydown', handleKeydown);

  // Mirror showModal's slot so closeModal() runs our teardown too.
  // biome-ignore lint/suspicious/noExplicitAny: matches existing modal.ts pattern
  (overlay as any)._cleanup = () => {
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
    document.removeEventListener('keydown', handleKeydown);
  };
}

function describeSource(candidate: RunCandidate): string {
  if (candidate.source === 'package.json' && candidate.script && candidate.packageManager) {
    return `Detected ${candidate.packageManager} script "${candidate.script}" in package.json.`;
  }
  if (candidate.source === 'http-server') {
    return 'No package.json run script found — falling back to http-server for static files.';
  }
  return 'No run command detected. Edit below to provide one.';
}
