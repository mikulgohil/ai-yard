import { appState } from '../state.js';
import { closeModal } from './modal.js';

const overlay = document.getElementById('modal-overlay')!;
const modal = document.getElementById('modal')!;
const titleEl = document.getElementById('modal-title')!;
const bodyEl = document.getElementById('modal-body')!;
const btnCancel = document.getElementById('modal-cancel')!;
const btnConfirm = document.getElementById('modal-confirm')!;

type Section = 'general' | 'about';

export function showPreferencesModal(): void {
  titleEl.textContent = 'Preferences';
  bodyEl.innerHTML = '';
  modal.classList.add('modal-wide');

  // Build two-pane layout
  const layout = document.createElement('div');
  layout.className = 'preferences-layout';

  // Side menu
  const menu = document.createElement('div');
  menu.className = 'preferences-menu';

  const sections: { id: Section; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'about', label: 'About' },
  ];

  const menuItems: Map<Section, HTMLDivElement> = new Map();
  for (const section of sections) {
    const item = document.createElement('div');
    item.className = 'preferences-menu-item';
    item.textContent = section.label;
    item.dataset.section = section.id;
    menu.appendChild(item);
    menuItems.set(section.id, item);
  }

  // Content area
  const content = document.createElement('div');
  content.className = 'preferences-content';

  layout.appendChild(menu);
  layout.appendChild(content);
  bodyEl.appendChild(layout);

  // Build section content
  let currentSection: Section = 'general';
  let checkbox: HTMLInputElement | null = null;

  function renderSection(section: Section) {
    currentSection = section;
    content.innerHTML = '';

    // Update active menu item
    for (const [id, item] of menuItems) {
      item.classList.toggle('active', id === section);
    }

    if (section === 'general') {
      const row = document.createElement('div');
      row.className = 'modal-toggle-field';

      const label = document.createElement('label');
      label.htmlFor = 'pref-sound-on-waiting';
      label.textContent = 'Play sound when session finishes work';

      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'pref-sound-on-waiting';
      checkbox.checked = appState.preferences.soundOnSessionWaiting;

      row.appendChild(label);
      row.appendChild(checkbox);
      content.appendChild(row);
    } else if (section === 'about') {
      const aboutDiv = document.createElement('div');
      aboutDiv.className = 'about-section';

      const appName = document.createElement('div');
      appName.className = 'about-app-name';
      appName.textContent = 'Claude IDE';

      const versionLine = document.createElement('div');
      versionLine.className = 'about-version';
      versionLine.textContent = 'Version: loading...';

      aboutDiv.appendChild(appName);
      aboutDiv.appendChild(versionLine);
      content.appendChild(aboutDiv);

      window.claudeIde.app.getVersion().then((ver) => {
        versionLine.textContent = `Version: ${ver}`;
      });
    }
  }

  // Menu click handler
  menu.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.preferences-menu-item') as HTMLElement | null;
    if (target && target.dataset.section) {
      renderSection(target.dataset.section as Section);
    }
  });

  // Show initial section
  renderSection('general');

  btnConfirm.textContent = 'Done';
  overlay.classList.remove('hidden');

  // Clean up previous listeners
  if ((overlay as any)._cleanup) {
    (overlay as any)._cleanup();
    (overlay as any)._cleanup = null;
  }

  const save = () => {
    if (checkbox) {
      appState.setPreference('soundOnSessionWaiting', checkbox.checked);
    }
  };

  const handleConfirm = () => {
    save();
    closeModal();
    modal.classList.remove('modal-wide');
    btnConfirm.textContent = 'Create';
  };

  const handleCancel = () => {
    closeModal();
    modal.classList.remove('modal-wide');
    btnConfirm.textContent = 'Create';
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

  (overlay as any)._cleanup = () => {
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
    overlay.removeEventListener('keydown', handleKeydown);
  };
}
