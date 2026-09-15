import type { ViewAdapter } from './view-adapter.js';

export interface SelectorOption {
  type: 'qa' | 'attr' | 'id' | 'css' | 'aria';
  label: string;
  value: string;
}

export type ActiveSelector = SelectorOption;

export interface ElementInfo {
  tagName: string;
  id: string;
  classes: string[];
  textContent: string;
  selectors: SelectorOption[];
  activeSelector: ActiveSelector;
  pageUrl: string;
  rect?: { width: number; height: number };
  computedStyles?: {
    display: string;
    position: string;
    color: string;
    backgroundColor: string;
    fontSize: string;
  };
  domPath?: string;
}

export interface FlowStep {
  type: 'click' | 'navigate' | 'expect' | 'fill' | 'select' | 'press';
  tagName?: string;
  textContent?: string;
  selectors?: SelectorOption[];
  activeSelector?: SelectorOption;
  pageUrl?: string;
  url?: string;
  /** Typed value for fill steps; selected option value for select steps */
  value?: string;
  /** Human-readable label for select steps (the <option> text) */
  selectedText?: string;
  /** Key name for press steps (e.g. 'Enter', 'Tab', 'Escape') */
  key?: string;
  modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean };
  /** True when this expect step was auto-suggested by DOM diff after a click */
  suggestion?: boolean;
}

export interface FlowPickerMetadata {
  tagName: string;
  textContent: string;
  selectors: SelectorOption[];
  pageUrl: string;
}

export type FlowPickerAction = 'click' | 'record' | 'click-and-record' | 'fill' | 'expect';

export interface ViewportPreset {
  label: string;
  width: number | null;
  height: number | null;
}

export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { label: 'Responsive', width: null, height: null },
  { label: 'iPhone SE',  width: 375,  height: 667  },
  { label: 'iPhone 14',  width: 393,  height: 852  },
  { label: 'Pixel 7',    width: 412,  height: 915  },
  { label: 'iPad Air',   width: 820,  height: 1180 },
  { label: 'iPad Pro',   width: 1024, height: 1366 },
];

export interface BrowserTabInstance {
  sessionId: string;
  element: HTMLDivElement;
  view: ViewAdapter;
  viewportContainer: HTMLDivElement;
  newTabPage: HTMLDivElement;
  urlInput: HTMLInputElement;
  inspectBtn: HTMLButtonElement;
  viewportBtn: HTMLButtonElement;
  viewportDropdown: HTMLDivElement;
  inspectPanel: HTMLDivElement;
  instructionInput: HTMLTextAreaElement;
  inspectAttachDimsCheckbox: HTMLInputElement;
  inspectPlanModeCheckbox: HTMLInputElement;
  elementInfoEl: HTMLDivElement;
  inspectMode: boolean;
  selectedElement: ElementInfo | null;
  currentViewport: ViewportPreset;
  viewportOutsideClickHandler: (e: MouseEvent) => void;
  recordBtn: HTMLButtonElement;
  flowPanel: HTMLDivElement;
  flowPanelLabel: HTMLSpanElement;
  flowStepsList: HTMLDivElement;
  flowInputRow: HTMLDivElement;
  flowInstructionInput: HTMLTextAreaElement;
  flowPlanModeRow: HTMLLabelElement;
  flowPlanModeCheckbox: HTMLInputElement;
  flowMode: boolean;
  flowSteps: FlowStep[];
  flowPickerOverlay: HTMLDivElement;
  flowPickerMenu: HTMLDivElement;
  flowPickerPending: FlowPickerMetadata | null;
  replayBtn: HTMLButtonElement;
  exportBtn: HTMLButtonElement;
  /** Index of the step currently highlighted during replay, or -1 */
  replayIndex: number;
  drawBtn: HTMLButtonElement;
  drawPanel: HTMLDivElement;
  drawInstructionInput: HTMLTextAreaElement;
  drawAttachDimsCheckbox: HTMLInputElement;
  drawPlanModeCheckbox: HTMLInputElement;
  drawErrorEl: HTMLDivElement;
  drawMode: boolean;
  sendMenuOverlay: HTMLDivElement;
  sendMenuEl: HTMLDivElement;
  sendMenuCleanup?: () => void;
}
