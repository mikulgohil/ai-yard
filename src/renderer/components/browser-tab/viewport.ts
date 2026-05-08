import type { BrowserTabInstance, ViewportPreset } from './types.js';

export function applyViewport(instance: BrowserTabInstance, preset: ViewportPreset): void {
  instance.currentViewport = preset;

  const label = preset.width !== null ? `${preset.width}×${preset.height}` : 'Responsive';
  instance.viewportBtn.textContent = label;
  instance.viewportBtn.classList.toggle('active', preset.width !== null);

  if (preset.width !== null && preset.height !== null) {
    instance.viewportContainer.classList.remove('responsive');
    instance.view.setExplicitSize(preset.width, preset.height);
  } else {
    instance.viewportContainer.classList.add('responsive');
    instance.view.clearExplicitSize();
  }
}

export function openViewportDropdown(instance: BrowserTabInstance): void {
  instance.viewportDropdown.classList.add('visible');
}

export function closeViewportDropdown(instance: BrowserTabInstance): void {
  instance.viewportDropdown.classList.remove('visible');
}

export function getViewportContext(instance: BrowserTabInstance, include: boolean): string {
  if (!include) return '';
  const vp = instance.currentViewport;
  if (vp.width !== null) {
    return ` [viewport: ${vp.width}×${vp.height} – ${vp.label}]`;
  }
  const rect = instance.view.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (!w || !h) return '';
  return ` [viewport: ${w}×${h} – Responsive]`;
}
