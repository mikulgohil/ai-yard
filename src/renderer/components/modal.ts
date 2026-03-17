interface FieldDef {
  label: string;
  id: string;
  placeholder?: string;
  defaultValue?: string;
  buttonLabel?: string;
  onButtonClick?: (input: HTMLInputElement) => void;
}

const overlay = document.getElementById('modal-overlay')!;
const titleEl = document.getElementById('modal-title')!;
const bodyEl = document.getElementById('modal-body')!;
const btnCancel = document.getElementById('modal-cancel')!;
const btnConfirm = document.getElementById('modal-confirm')!;

export function setModalError(fieldId: string, message: string): void {
  const existing = bodyEl.querySelector(`#modal-error-${fieldId}`);
  if (existing) existing.remove();

  if (!message) return;

  const input = document.getElementById(`modal-${fieldId}`);
  if (!input) return;

  const errEl = document.createElement('div');
  errEl.id = `modal-error-${fieldId}`;
  errEl.className = 'modal-error';
  errEl.textContent = message;
  input.parentElement!.appendChild(errEl);
}

export function closeModal(): void {
  overlay.classList.add('hidden');
  cleanup();
}

export function showModal(
  title: string,
  fields: FieldDef[],
  onConfirm: (values: Record<string, string>) => void | Promise<void>
): void {
  titleEl.textContent = title;
  bodyEl.innerHTML = '';

  for (const field of fields) {
    const div = document.createElement('div');
    div.className = 'modal-field';

    const label = document.createElement('label');
    label.setAttribute('for', `modal-${field.id}`);
    label.textContent = field.label;
    div.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `modal-${field.id}`;
    input.placeholder = field.placeholder ?? '';
    input.value = field.defaultValue ?? '';

    if (field.buttonLabel && field.onButtonClick) {
      const row = document.createElement('div');
      row.className = 'modal-field-row';
      row.appendChild(input);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modal-field-btn';
      btn.textContent = field.buttonLabel;
      btn.addEventListener('click', () => field.onButtonClick!(input));
      row.appendChild(btn);
      div.appendChild(row);
    } else {
      div.appendChild(input);
    }

    bodyEl.appendChild(div);
  }

  overlay.classList.remove('hidden');

  // Focus first input
  const firstInput = bodyEl.querySelector('input') as HTMLInputElement | null;
  if (firstInput) {
    requestAnimationFrame(() => {
      firstInput.focus();
      firstInput.select();
    });
  }

  // Clean up previous listeners
  cleanup();

  const handleConfirm = async () => {
    const values: Record<string, string> = {};
    for (const field of fields) {
      const input = document.getElementById(`modal-${field.id}`) as HTMLInputElement;
      values[field.id] = input?.value ?? '';
    }
    await onConfirm(values);
  };

  const handleCancel = () => {
    closeModal();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  btnConfirm.addEventListener('click', handleConfirm);
  btnCancel.addEventListener('click', handleCancel);
  overlay.addEventListener('keydown', handleKeydown);

  // Store for cleanup
  (overlay as any)._cleanup = () => {
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
    overlay.removeEventListener('keydown', handleKeydown);
  };
}

function cleanup(): void {
  if ((overlay as any)._cleanup) {
    (overlay as any)._cleanup();
    (overlay as any)._cleanup = null;
  }
}
