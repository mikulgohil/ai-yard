import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import type { Terminal } from '@xterm/xterm';

export interface DevServerInstance {
  sessionId: string;
  projectId: string;
  command: string;
  element: HTMLDivElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  spawned: boolean;
  exited: boolean;
  /** Set once the first localhost URL has been sniffed and a browser tab opened. */
  urlOpened: boolean;
  /** Tail of recent PTY output, capped at URL_SNIFF_BUFFER_LIMIT bytes, used to find the first server URL across chunk boundaries. */
  urlSniffBuffer: string;
  /** Drops the IPC subscription registered in pane.ts; called from destroy. */
  unsubscribe: () => void;
}

export const instances = new Map<string, DevServerInstance>();

export function getDevServerInstance(sessionId: string): DevServerInstance | undefined {
  return instances.get(sessionId);
}
