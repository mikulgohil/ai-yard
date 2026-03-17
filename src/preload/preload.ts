import { contextBridge, ipcRenderer } from 'electron';

export interface ClaudeIdeApi {
  pty: {
    create(sessionId: string, cwd: string, claudeSessionId: string | null, isResume: boolean): Promise<void>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, exitCode: number, signal?: number) => void): () => void;
  };
  session: {
    onHookStatus(callback: (sessionId: string, status: 'working' | 'waiting') => void): () => void;
    onClaudeSessionId(callback: (sessionId: string, claudeSessionId: string) => void): () => void;
  };
  fs: {
    isDirectory(path: string): Promise<boolean>;
  };
  store: {
    load(): Promise<unknown>;
    save(state: unknown): Promise<void>;
  };
  claude: {
    getConfig(projectPath: string): Promise<unknown>;
  };
  app: {
    getVersion(): Promise<string>;
  };
  menu: {
    onNewProject(callback: () => void): () => void;
    onNewSession(callback: () => void): () => void;
    onToggleSplit(callback: () => void): () => void;
    onNextSession(callback: () => void): () => void;
    onPrevSession(callback: () => void): () => void;
    onGotoSession(callback: (index: number) => void): () => void;
  };
}

function onChannel(channel: string, callback: (...args: unknown[]) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ClaudeIdeApi = {
  pty: {
    create: (sessionId, cwd, claudeSessionId, isResume) =>
      ipcRenderer.invoke('pty:create', sessionId, cwd, claudeSessionId, isResume),
    write: (sessionId, data) =>
      ipcRenderer.send('pty:write', sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.send('pty:resize', sessionId, cols, rows),
    kill: (sessionId) =>
      ipcRenderer.invoke('pty:kill', sessionId),
    onData: (callback) =>
      onChannel('pty:data', (sessionId, data) => callback(sessionId as string, data as string)),
    onExit: (callback) =>
      onChannel('pty:exit', (sessionId, exitCode, signal) =>
        callback(sessionId as string, exitCode as number, signal as number | undefined)),
  },
  session: {
    onHookStatus: (callback) =>
      onChannel('session:hookStatus', (sessionId, status) =>
        callback(sessionId as string, status as 'working' | 'waiting')),
    onClaudeSessionId: (callback) =>
      onChannel('session:claudeSessionId', (sessionId, claudeSessionId) =>
        callback(sessionId as string, claudeSessionId as string)),
  },
  fs: {
    isDirectory: (path) => ipcRenderer.invoke('fs:isDirectory', path),
  },
  claude: {
    getConfig: (projectPath) => ipcRenderer.invoke('claude:getConfig', projectPath),
  },
  store: {
    load: () => ipcRenderer.invoke('store:load'),
    save: (state) => ipcRenderer.invoke('store:save', state),
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },
  menu: {
    onNewProject: (cb) => onChannel('menu:new-project', cb),
    onNewSession: (cb) => onChannel('menu:new-session', cb),
    onToggleSplit: (cb) => onChannel('menu:toggle-split', cb),
    onNextSession: (cb) => onChannel('menu:next-session', cb),
    onPrevSession: (cb) => onChannel('menu:prev-session', cb),
    onGotoSession: (cb) => onChannel('menu:goto-session', (index) => cb(index as number)),
  },
};

contextBridge.exposeInMainWorld('claudeIde', api);
