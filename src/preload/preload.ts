import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';
import * as os from 'os';
import * as path from 'path';
import {
  BROWSER_VIEW_CHANNELS,
  type BrowserViewCapturePageOutput,
  type BrowserViewCreateInput,
  type BrowserViewCreateOutput,
  type BrowserViewEvent,
  type ViewId,
  type ViewRect,
} from '../shared/browser-view-contract';
import type {
  BlameEntry,
  BranchCompareResult,
  CheckRun,
  CliProviderMeta,
  CommitEntry,
  ConflictedFile,
  CostData,
  DeepSearchResult,
  GithubFetchResult,
  GithubRepo,
  GrepMatch,
  InspectorEvent,
  PRComment,
  PRDetail,
  PRFile,
  PickaxeMatch,
  ProviderConfig,
  ProviderId,
  ReadFileResult,
  ReadinessResult,
  RebaseTodo,
  ReflogEntry,
  RepoStats,
  RunCandidate,
  SettingsValidationResult,
  SettingsWarningData,
  StashEntry,
  StatsCache,
  StatusLineConflictData,
  SubmoduleEntry,
  TagEntry,
  ToolFailureData,
} from '../shared/types';
import { ZOOM_MAX, ZOOM_MIN } from '../shared/types';

export type { CostData } from '../shared/types';

export interface AIYardApi {
  pty: {
    create(sessionId: string, cwd: string, cliSessionId: string | null, isResume: boolean, extraArgs?: string, providerId?: ProviderId, initialPrompt?: string, systemPrompt?: string): Promise<void>;
    createShell(sessionId: string, cwd: string): Promise<void>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    getCwd(sessionId: string): Promise<string | null>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, exitCode: number, signal?: number) => void): () => void;
  };
  session: {
    buildResumeWithPrompt(sourceProviderId: ProviderId, sourceCliSessionId: string | null, projectPath: string, sessionName: string): Promise<string>;
    deepSearch(query: string): Promise<DeepSearchResult[]>;
    onHookStatus(callback: (sessionId: string, status: 'working' | 'waiting' | 'completed' | 'input', hookName: string) => void): () => void;
    onCliSessionId(callback: (sessionId: string, cliSessionId: string) => void): () => void;
    /** @deprecated Use onCliSessionId instead */
    onClaudeSessionId(callback: (sessionId: string, claudeSessionId: string) => void): () => void;
    onCostData(callback: (sessionId: string, costData: CostData) => void): () => void;
    onToolFailure(callback: (sessionId: string, data: ToolFailureData) => void): () => void;
    onInspectorEvents(callback: (sessionId: string, events: InspectorEvent[]) => void): () => void;
  };
  fs: {
    isDirectory(path: string): Promise<boolean>;
    expandPath(path: string): Promise<string>;
    listDirs(dirPath: string, prefix?: string): Promise<string[]>;
    listDir(dirPath: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>>;
    browseDirectory(): Promise<string | null>;
    listFiles(cwd: string, query: string): Promise<string[]>;
    exists(filePath: string): Promise<boolean>;
    readFile(filePath: string): Promise<ReadFileResult>;
    readImage(filePath: string): Promise<{ dataUrl: string } | null>;
    trashItem(filePath: string): Promise<{ ok: boolean; error?: string }>;
    watchFile(filePath: string): void;
    unwatchFile(filePath: string): void;
    onFileChanged(callback: (filePath: string) => void): () => void;
    getDroppedFilePath(file: File): string;
  };
  store: {
    load(): Promise<unknown>;
    save(state: unknown): Promise<void>;
  };
  provider: {
    getConfig(providerId: ProviderId, projectPath: string): Promise<ProviderConfig>;
    getMeta(providerId: ProviderId): Promise<CliProviderMeta>;
    listProviders(): Promise<CliProviderMeta[]>;
    checkBinary(providerId?: ProviderId): Promise<boolean>;
    watchProject(providerId: ProviderId, projectPath: string): void;
    onConfigChanged(callback: () => void): () => void;
    installAgent(slug: string, content: string): Promise<Array<{ providerId: ProviderId; ok: boolean; filePath?: string; error?: string }>>;
    removeAgent(slug: string): Promise<void>;
  };
  /** @deprecated Use provider namespace instead */
  claude: {
    getConfig(projectPath: string): Promise<ProviderConfig>;
  };
  git: {
    getStatus(path: string): Promise<unknown>;
    getFiles(path: string): Promise<unknown>;
    getDiff(path: string, file: string, area: string): Promise<string>;
    getWorktrees(path: string): Promise<unknown>;
    getRemoteUrl(path: string): Promise<string | null>;
    stageFile(path: string, file: string): Promise<void>;
    unstageFile(path: string, file: string): Promise<void>;
    discardFile(path: string, file: string, area: string): Promise<void>;
    openInEditor(path: string, file: string): Promise<void>;
    listBranches(path: string): Promise<{ name: string; current: boolean }[]>;
    checkoutBranch(path: string, branch: string): Promise<void>;
    createBranch(path: string, branch: string): Promise<void>;
    watchProject(path: string): void;
    onChanged(callback: () => void): () => void;
    // G1
    commit(path: string, message: string, amend: boolean): Promise<{ hash: string; subject: string }>;
    getLastCommit(path: string): Promise<{ subject: string; body: string }>;
    // G2
    fetch(path: string, remote?: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    pull(path: string, rebase: boolean): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    push(path: string, opts: { setUpstream?: boolean; force?: boolean; branch?: string }): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    // G3
    stageHunk(path: string, patch: string): Promise<void>;
    unstageHunk(path: string, patch: string): Promise<void>;
    // G4
    stashList(path: string): Promise<StashEntry[]>;
    stashPush(path: string, message?: string, includeUntracked?: boolean): Promise<void>;
    stashPop(path: string, ref?: string): Promise<void>;
    stashApply(path: string, ref: string): Promise<void>;
    stashDrop(path: string, ref: string): Promise<void>;
    stashShow(path: string, ref: string): Promise<string>;
    // G5
    log(path: string, opts?: { branch?: string; limit?: number; skip?: number; filePath?: string }): Promise<CommitEntry[]>;
    show(path: string, hash: string): Promise<string>;
    // G6
    blame(path: string, filePath: string): Promise<BlameEntry[]>;
    // G7
    listTags(path: string): Promise<TagEntry[]>;
    createTag(path: string, name: string, message?: string, ref?: string): Promise<void>;
    deleteTag(path: string, name: string): Promise<void>;
    pushTag(path: string, name: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    pushAllTags(path: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    // G8
    reflog(path: string, limit?: number): Promise<ReflogEntry[]>;
    reset(path: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>;
    branchAt(path: string, branch: string, hash: string): Promise<void>;
    checkoutHash(path: string, hash: string): Promise<void>;
    // G9
    compareBranches(path: string, base: string, head: string): Promise<BranchCompareResult>;
    defaultBranch(path: string): Promise<string>;
    // G10
    getConflictedFile(path: string, filePath: string): Promise<ConflictedFile>;
    resolveConflict(path: string, filePath: string, content: string): Promise<void>;
    // G15
    bisectStart(path: string, bad?: string, good?: string): Promise<string>;
    bisectGood(path: string, commit?: string): Promise<string>;
    bisectBad(path: string, commit?: string): Promise<string>;
    bisectReset(path: string): Promise<void>;
    bisectRun(path: string, command: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    // G18
    pickaxe(path: string, query: string, limit?: number): Promise<PickaxeMatch[]>;
    grep(path: string, query: string, ref?: string): Promise<GrepMatch[]>;
    logGrep(path: string, pattern: string, limit?: number): Promise<PickaxeMatch[]>;
    // G19
    rebaseTodo(path: string, base: string): Promise<RebaseTodo[]>;
    rebaseApply(path: string, base: string, todos: RebaseTodo[]): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    rebaseContinue(path: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    rebaseAbort(path: string): Promise<void>;
    // G20
    cherryPick(path: string, hash: string, noCommit?: boolean): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    cherryPickContinue(path: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    cherryPickAbort(path: string): Promise<void>;
    // G21
    submoduleList(path: string): Promise<SubmoduleEntry[]>;
    submoduleUpdate(path: string, recursive?: boolean): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    submoduleSync(path: string): Promise<void>;
    // Worktree management (per-session isolated worktrees under ~/.ai-yard/worktrees/)
    createWorktree(projectPath: string, projectId: string, branch: string, baseBranch: string): Promise<{ path: string }>;
    removeWorktree(projectPath: string, worktreePath: string): Promise<void>;
    deleteBranch(projectPath: string, branch: string): Promise<void>;
    branchExists(projectPath: string, branch: string): Promise<boolean>;
  };
  ai: {
    callOnce(prompt: string, cwd?: string): Promise<string>;
  };
  update: {
    checkNow(): Promise<void>;
    install(): Promise<void>;
    onAvailable(cb: (info: { version: string }) => void): () => void;
    onDownloadProgress(cb: (info: { percent: number }) => void): () => void;
    onDownloaded(cb: (info: { version: string }) => void): () => void;
    onError(cb: (info: { message: string }) => void): () => void;
  };
  app: {
    focus(): void;
    getVersion(): Promise<string>;
    openExternal(url: string): Promise<void>;
    getBrowserPreloadPath(): Promise<string>;
    /** Static paths used by the renderer for PII scrubbing (Sentry). */
    envPaths: { home: string; state: string };
    onQuitting(callback: () => void): () => void;
    onConfirmClose(callback: () => void): () => void;
    closeConfirmed(): void;
  };
  browser: {
    saveScreenshot(sessionId: string, dataUrl: string, projectPath?: string): Promise<string>;
  };
  /**
   * WebContentsView-backed browser tab path (A5 Phase 2). Dormant unless the
   * `BrowserTabInstance.useWebContentsView` flag is set; the flag defaults to
   * `false` until Phase 5. Channel + payload contract lives in
   * `src/shared/browser-view-contract.ts`.
   */
  browserView: {
    create(input: BrowserViewCreateInput): Promise<BrowserViewCreateOutput>;
    destroy(viewId: ViewId): Promise<void>;
    setBounds(viewId: ViewId, rect: ViewRect): Promise<void>;
    navigate(viewId: ViewId, url: string): Promise<void>;
    goBack(viewId: ViewId): Promise<void>;
    goForward(viewId: ViewId): Promise<void>;
    reload(viewId: ViewId): Promise<void>;
    stop(viewId: ViewId): Promise<void>;
    send(viewId: ViewId, channel: string, args: unknown[]): Promise<void>;
    capturePage(viewId: ViewId): Promise<BrowserViewCapturePageOutput>;
    setPreload(viewId: ViewId, preloadPath: string): Promise<void>;
    /** Subscribe to a single view's broadcast events. Returns an unsubscribe fn. */
    onEvent(viewId: ViewId, callback: (event: BrowserViewEvent) => void): () => void;
  };
  mcp: {
    connect(id: string, url: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    disconnect(id: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    listTools(id: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    listResources(id: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    listPrompts(id: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    callTool(id: string, name: string, args: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }>;
    readResource(id: string, uri: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    getPrompt(id: string, name: string, args: Record<string, string>): Promise<{ success: boolean; data?: unknown; error?: string }>;
    addServer(name: string, config: unknown, scope: 'user' | 'project', projectPath?: string): Promise<{ success: boolean; error?: string }>;
    removeServer(name: string, filePath: string, scope: 'user' | 'project', projectPath?: string): Promise<{ success: boolean; error?: string }>;
  };
  readiness: {
    analyze(projectPath: string, excludedProviders?: string[]): Promise<ReadinessResult>;
  };
  github: {
    isAvailable(): Promise<boolean>;
    detectRepo(projectPath: string): Promise<GithubRepo | null>;
    listPRs(repo: string, state: 'open' | 'closed' | 'all', max: number): Promise<GithubFetchResult>;
    listIssues(repo: string, state: 'open' | 'closed' | 'all', max: number): Promise<GithubFetchResult>;
    // G13
    prDetail(repo: string, prNumber: number): Promise<PRDetail>;
    prFiles(repo: string, prNumber: number): Promise<PRFile[]>;
    prComments(repo: string, prNumber: number): Promise<PRComment[]>;
    submitReview(repo: string, prNumber: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body: string): Promise<void>;
    addComment(repo: string, prNumber: number, filePath: string, line: number, body: string): Promise<void>;
    // G16
    ciStatus(repo: string, ref: string): Promise<CheckRun[]>;
    // G17
    repoStats(repo: string): Promise<RepoStats | null>;
  };
  devRunner: {
    detect(cwd: string): Promise<RunCandidate>;
  };
  stats: {
    getCache(): Promise<StatsCache | null>;
  };
  settings: {
    onWarning(callback: (data: SettingsWarningData) => void): () => void;
    onConflictDialog(callback: (data: StatusLineConflictData) => void): () => void;
    respondConflictDialog(choice: 'replace' | 'keep'): void;
    reinstall(providerId?: ProviderId): Promise<{ success: boolean }>;
    validate(providerId?: ProviderId): Promise<SettingsValidationResult>;
  };
  clipboard: {
    write(text: string): Promise<void>;
  };
  zoom: {
    set(factor: number): void;
  };
  menu: {
    onNewProject(callback: () => void): () => void;
    onNewSession(callback: () => void): () => void;
    onToggleSplit(callback: () => void): () => void;
    onNextSession(callback: () => void): () => void;
    onPrevSession(callback: () => void): () => void;
    onGotoSession(callback: (index: number) => void): () => void;
    onToggleDebug(callback: () => void): () => void;
    onUsageStats(callback: () => void): () => void;
    onToggleInspector(callback: () => void): () => void;
    onCloseSession(callback: () => void): () => void;
    rebuild(debugMode: boolean): Promise<void>;
  };
  telemetry: {
    /** Fire-and-forget; ignored in dev or when the user has telemetry disabled. */
    track(event: 'app.launch' | 'session.start' | 'feature.used', data?: Record<string, string | number | boolean>): void;
  };
}

function onChannel(channel: string, callback: (...args: unknown[]) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: AIYardApi = {
  pty: {
    create: (sessionId, cwd, cliSessionId, isResume, extraArgs, providerId, initialPrompt, systemPrompt) =>
      ipcRenderer.invoke('pty:create', sessionId, cwd, cliSessionId, isResume, extraArgs || '', providerId || 'claude', initialPrompt, systemPrompt),
    createShell: (sessionId, cwd) =>
      ipcRenderer.invoke('pty:createShell', sessionId, cwd),
    write: (sessionId, data) =>
      ipcRenderer.send('pty:write', sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.send('pty:resize', sessionId, cols, rows),
    kill: (sessionId) =>
      ipcRenderer.invoke('pty:kill', sessionId),
    getCwd: (sessionId: string) =>
      ipcRenderer.invoke('pty:getCwd', sessionId),
    onData: (callback) =>
      onChannel('pty:data', (sessionId, data) => callback(sessionId as string, data as string)),
    onExit: (callback) =>
      onChannel('pty:exit', (sessionId, exitCode, signal) =>
        callback(sessionId as string, exitCode as number, signal as number | undefined)),
  },
  session: {
    buildResumeWithPrompt: (sourceProviderId, sourceCliSessionId, projectPath, sessionName) =>
      ipcRenderer.invoke('session:buildResumeWithPrompt', sourceProviderId, sourceCliSessionId, projectPath, sessionName),
    deepSearch: (query) =>
      ipcRenderer.invoke('session:deepSearch', query),
    onHookStatus: (callback) =>
      onChannel('session:hookStatus', (sessionId, status, hookName) =>
        callback(sessionId as string, status as 'working' | 'waiting' | 'completed' | 'input', (hookName as string) || '')),
    onCliSessionId: (callback) =>
      onChannel('session:cliSessionId', (sessionId, cliSessionId) =>
        callback(sessionId as string, cliSessionId as string)),
    onClaudeSessionId: (callback) =>
      onChannel('session:claudeSessionId', (sessionId, claudeSessionId) =>
        callback(sessionId as string, claudeSessionId as string)),
    onCostData: (callback) =>
      onChannel('session:costData', (sessionId, costData) =>
        callback(sessionId as string, costData as CostData)),
    onToolFailure: (callback) =>
      onChannel('session:toolFailure', (sessionId, data) =>
        callback(sessionId as string, data as ToolFailureData)),
    onInspectorEvents: (callback) =>
      onChannel('session:inspectorEvents', (sessionId, events) =>
        callback(sessionId as string, events as InspectorEvent[])),
  },
  fs: {
    isDirectory: (path) => ipcRenderer.invoke('fs:isDirectory', path),
    expandPath: (path: string) => ipcRenderer.invoke('fs:expandPath', path),
    listDirs: (dirPath: string, prefix?: string) => ipcRenderer.invoke('fs:listDirs', dirPath, prefix),
    listDir: (dirPath: string) => ipcRenderer.invoke('fs:listDir', dirPath),
    browseDirectory: () => ipcRenderer.invoke('fs:browseDirectory'),
    listFiles: (cwd: string, query: string) => ipcRenderer.invoke('fs:listFiles', cwd, query),
    exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    readImage: (filePath: string) => ipcRenderer.invoke('fs:readImage', filePath),
    trashItem: (filePath: string) => ipcRenderer.invoke('fs:trashItem', filePath),
    watchFile: (filePath: string) => ipcRenderer.send('fs:watchFile', filePath),
    unwatchFile: (filePath: string) => ipcRenderer.send('fs:unwatchFile', filePath),
    onFileChanged: (callback: (filePath: string) => void) => onChannel('fs:fileChanged', (filePath) => callback(filePath as string)),
    getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),
  },
  provider: {
    getConfig: (providerId, projectPath) => ipcRenderer.invoke('provider:getConfig', providerId, projectPath),
    getMeta: (providerId) => ipcRenderer.invoke('provider:getMeta', providerId),
    listProviders: () => ipcRenderer.invoke('provider:listProviders'),
    checkBinary: (providerId) => ipcRenderer.invoke('provider:checkBinary', providerId || 'claude'),
    watchProject: (providerId, projectPath) => ipcRenderer.send('config:watchProject', providerId, projectPath),
    onConfigChanged: (callback) => onChannel('config:changed', callback),
    installAgent: (slug, content) => ipcRenderer.invoke('provider:installAgent', slug, content),
    removeAgent: (slug) => ipcRenderer.invoke('provider:removeAgent', slug),
  },
  claude: {
    getConfig: (projectPath) => ipcRenderer.invoke('claude:getConfig', projectPath),
  },
  store: {
    load: () => ipcRenderer.invoke('store:load'),
    save: (state) => ipcRenderer.invoke('store:save', state),
  },
  git: {
    getStatus: (path) => ipcRenderer.invoke('git:getStatus', path),
    getFiles: (path) => ipcRenderer.invoke('git:getFiles', path),
    getDiff: (path: string, file: string, area: string) => ipcRenderer.invoke('git:getDiff', path, file, area),
    getWorktrees: (path: string) => ipcRenderer.invoke('git:getWorktrees', path),
    getRemoteUrl: (path: string) => ipcRenderer.invoke('git:getRemoteUrl', path),
    stageFile: (path: string, file: string) => ipcRenderer.invoke('git:stageFile', path, file),
    unstageFile: (path: string, file: string) => ipcRenderer.invoke('git:unstageFile', path, file),
    discardFile: (path: string, file: string, area: string) => ipcRenderer.invoke('git:discardFile', path, file, area),
    openInEditor: (path: string, file: string) => ipcRenderer.invoke('git:openInEditor', path, file),
    listBranches: (path: string) => ipcRenderer.invoke('git:listBranches', path),
    checkoutBranch: (path: string, branch: string) => ipcRenderer.invoke('git:checkoutBranch', path, branch),
    createBranch: (path: string, branch: string) => ipcRenderer.invoke('git:createBranch', path, branch),
    watchProject: (path: string) => ipcRenderer.send('git:watchProject', path),
    onChanged: (callback: () => void) => onChannel('git:changed', callback),
    commit: (path, message, amend) => ipcRenderer.invoke('git:commit', path, message, amend),
    getLastCommit: (path) => ipcRenderer.invoke('git:getLastCommit', path),
    fetch: (path, remote) => ipcRenderer.invoke('git:fetch', path, remote),
    pull: (path, rebase) => ipcRenderer.invoke('git:pull', path, rebase),
    push: (path, opts) => ipcRenderer.invoke('git:push', path, opts),
    stageHunk: (path, patch) => ipcRenderer.invoke('git:stageHunk', path, patch),
    unstageHunk: (path, patch) => ipcRenderer.invoke('git:unstageHunk', path, patch),
    stashList: (path) => ipcRenderer.invoke('git:stashList', path),
    stashPush: (path, message, includeUntracked) => ipcRenderer.invoke('git:stashPush', path, message, includeUntracked),
    stashPop: (path, ref) => ipcRenderer.invoke('git:stashPop', path, ref),
    stashApply: (path, ref) => ipcRenderer.invoke('git:stashApply', path, ref),
    stashDrop: (path, ref) => ipcRenderer.invoke('git:stashDrop', path, ref),
    stashShow: (path, ref) => ipcRenderer.invoke('git:stashShow', path, ref),
    log: (path, opts) => ipcRenderer.invoke('git:log', path, opts),
    show: (path, hash) => ipcRenderer.invoke('git:show', path, hash),
    blame: (path, filePath) => ipcRenderer.invoke('git:blame', path, filePath),
    listTags: (path) => ipcRenderer.invoke('git:listTags', path),
    createTag: (path, name, message, ref) => ipcRenderer.invoke('git:createTag', path, name, message, ref),
    deleteTag: (path, name) => ipcRenderer.invoke('git:deleteTag', path, name),
    pushTag: (path, name) => ipcRenderer.invoke('git:pushTag', path, name),
    pushAllTags: (path) => ipcRenderer.invoke('git:pushAllTags', path),
    reflog: (path, limit) => ipcRenderer.invoke('git:reflog', path, limit),
    reset: (path, hash, mode) => ipcRenderer.invoke('git:reset', path, hash, mode),
    branchAt: (path, branch, hash) => ipcRenderer.invoke('git:branchAt', path, branch, hash),
    checkoutHash: (path, hash) => ipcRenderer.invoke('git:checkoutHash', path, hash),
    compareBranches: (path, base, head) => ipcRenderer.invoke('git:compareBranches', path, base, head),
    defaultBranch: (path) => ipcRenderer.invoke('git:defaultBranch', path),
    getConflictedFile: (path, filePath) => ipcRenderer.invoke('git:getConflictedFile', path, filePath),
    resolveConflict: (path, filePath, content) => ipcRenderer.invoke('git:resolveConflict', path, filePath, content),
    bisectStart: (path, bad, good) => ipcRenderer.invoke('git:bisectStart', path, bad, good),
    bisectGood: (path, commit) => ipcRenderer.invoke('git:bisectGood', path, commit),
    bisectBad: (path, commit) => ipcRenderer.invoke('git:bisectBad', path, commit),
    bisectReset: (path) => ipcRenderer.invoke('git:bisectReset', path),
    bisectRun: (path, command) => ipcRenderer.invoke('git:bisectRun', path, command),
    pickaxe: (path, query, limit) => ipcRenderer.invoke('git:pickaxe', path, query, limit),
    grep: (path, query, ref) => ipcRenderer.invoke('git:grep', path, query, ref),
    logGrep: (path, pattern, limit) => ipcRenderer.invoke('git:logGrep', path, pattern, limit),
    rebaseTodo: (path, base) => ipcRenderer.invoke('git:rebaseTodo', path, base),
    rebaseApply: (path, base, todos) => ipcRenderer.invoke('git:rebaseApply', path, base, todos),
    rebaseContinue: (path) => ipcRenderer.invoke('git:rebaseContinue', path),
    rebaseAbort: (path) => ipcRenderer.invoke('git:rebaseAbort', path),
    cherryPick: (path, hash, noCommit) => ipcRenderer.invoke('git:cherryPick', path, hash, noCommit),
    cherryPickContinue: (path) => ipcRenderer.invoke('git:cherryPickContinue', path),
    cherryPickAbort: (path) => ipcRenderer.invoke('git:cherryPickAbort', path),
    submoduleList: (path) => ipcRenderer.invoke('git:submoduleList', path),
    submoduleUpdate: (path, recursive) => ipcRenderer.invoke('git:submoduleUpdate', path, recursive),
    submoduleSync: (path) => ipcRenderer.invoke('git:submoduleSync', path),
    createWorktree: (projectPath, projectId, branch, baseBranch) =>
      ipcRenderer.invoke('git:createWorktree', projectPath, projectId, branch, baseBranch),
    removeWorktree: (projectPath, worktreePath) =>
      ipcRenderer.invoke('git:removeWorktree', projectPath, worktreePath),
    deleteBranch: (projectPath, branch) => ipcRenderer.invoke('git:deleteBranch', projectPath, branch),
    branchExists: (projectPath, branch) => ipcRenderer.invoke('git:branchExists', projectPath, branch),
  },
  ai: {
    callOnce: (prompt: string, cwd?: string) => ipcRenderer.invoke('ai:callOnce', prompt, cwd),
  },
  update: {
    checkNow: () => ipcRenderer.invoke('update:checkNow'),
    install: () => ipcRenderer.invoke('update:install'),
    onAvailable: (cb) => onChannel('update:available', (info) => cb(info as { version: string })),
    onDownloadProgress: (cb) => onChannel('update:download-progress', (info) => cb(info as { percent: number })),
    onDownloaded: (cb) => onChannel('update:downloaded', (info) => cb(info as { version: string })),
    onError: (cb) => onChannel('update:error', (info) => cb(info as { message: string })),
  },
  app: {
    focus: () => { ipcRenderer.send('app:focus'); },
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    getBrowserPreloadPath: () => ipcRenderer.invoke('app:getBrowserPreloadPath'),
    envPaths: { home: os.homedir(), state: path.join(os.homedir(), '.ai-yard') },
    onQuitting: (cb: () => void) => onChannel('app:quitting', cb),
    onConfirmClose: (cb: () => void) => onChannel('app:confirmClose', cb),
    closeConfirmed: () => { ipcRenderer.send('app:closeConfirmed'); },
  },
  browser: {
    saveScreenshot: (sessionId: string, dataUrl: string, projectPath?: string) =>
      ipcRenderer.invoke('browser:saveScreenshot', sessionId, dataUrl, projectPath),
  },
  browserView: {
    create: (input) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.create, input),
    destroy: (viewId) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.destroy, { viewId }),
    setBounds: (viewId, rect) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.setBounds, { viewId, rect }),
    navigate: (viewId, url) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.navigate, { viewId, url }),
    goBack: (viewId) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.goBack, { viewId }),
    goForward: (viewId) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.goForward, { viewId }),
    reload: (viewId) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.reload, { viewId }),
    stop: (viewId) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.stop, { viewId }),
    send: (viewId, channel, args) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.send, { viewId, channel, args }),
    capturePage: (viewId) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.capturePage, { viewId }),
    setPreload: (viewId, preloadPath) => ipcRenderer.invoke(BROWSER_VIEW_CHANNELS.setPreload, { viewId, preloadPath }),
    onEvent: (viewId, callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        const event = payload as BrowserViewEvent;
        if (event && event.viewId === viewId) callback(event);
      };
      ipcRenderer.on(BROWSER_VIEW_CHANNELS.event, listener);
      return () => ipcRenderer.removeListener(BROWSER_VIEW_CHANNELS.event, listener);
    },
  },
  mcp: {
    connect: (id: string, url: string) => ipcRenderer.invoke('mcp:connect', id, url),
    disconnect: (id: string) => ipcRenderer.invoke('mcp:disconnect', id),
    listTools: (id: string) => ipcRenderer.invoke('mcp:listTools', id),
    listResources: (id: string) => ipcRenderer.invoke('mcp:listResources', id),
    listPrompts: (id: string) => ipcRenderer.invoke('mcp:listPrompts', id),
    callTool: (id: string, name: string, args: Record<string, unknown>) => ipcRenderer.invoke('mcp:callTool', id, name, args),
    readResource: (id: string, uri: string) => ipcRenderer.invoke('mcp:readResource', id, uri),
    getPrompt: (id: string, name: string, args: Record<string, string>) => ipcRenderer.invoke('mcp:getPrompt', id, name, args),
    addServer: (name: string, config: unknown, scope: 'user' | 'project', projectPath?: string) => ipcRenderer.invoke('mcp:addServer', name, config, scope, projectPath),
    removeServer: (name: string, filePath: string, scope: 'user' | 'project', projectPath?: string) => ipcRenderer.invoke('mcp:removeServer', name, filePath, scope, projectPath),
  },
  readiness: {
    analyze: (projectPath: string, excludedProviders?: string[]) => ipcRenderer.invoke('readiness:analyze', projectPath, excludedProviders),
  },
  github: {
    isAvailable: () => ipcRenderer.invoke('github:isAvailable'),
    detectRepo: (projectPath: string) => ipcRenderer.invoke('github:detectRepo', projectPath),
    listPRs: (repo: string, state: 'open' | 'closed' | 'all', max: number) => ipcRenderer.invoke('github:listPRs', repo, state, max),
    listIssues: (repo: string, state: 'open' | 'closed' | 'all', max: number) => ipcRenderer.invoke('github:listIssues', repo, state, max),
    prDetail: (repo, prNumber) => ipcRenderer.invoke('github:prDetail', repo, prNumber),
    prFiles: (repo, prNumber) => ipcRenderer.invoke('github:prFiles', repo, prNumber),
    prComments: (repo, prNumber) => ipcRenderer.invoke('github:prComments', repo, prNumber),
    submitReview: (repo, prNumber, event, body) => ipcRenderer.invoke('github:submitReview', repo, prNumber, event, body),
    addComment: (repo, prNumber, filePath, line, body) => ipcRenderer.invoke('github:addComment', repo, prNumber, filePath, line, body),
    ciStatus: (repo, ref) => ipcRenderer.invoke('github:ciStatus', repo, ref),
    repoStats: (repo) => ipcRenderer.invoke('github:repoStats', repo),
  },
  devRunner: {
    detect: (cwd: string) => ipcRenderer.invoke('dev-runner:detect', cwd),
  },
  stats: {
    getCache: () => ipcRenderer.invoke('stats:getCache'),
  },
  settings: {
    onWarning: (cb) => onChannel('settings:warning', (data) => cb(data as SettingsWarningData)),
    onConflictDialog: (cb) => onChannel('settings:showConflictDialog', (data) => cb(data as StatusLineConflictData)),
    respondConflictDialog: (choice) => ipcRenderer.send('settings:conflictDialogResponse', choice),
    reinstall: (providerId) => ipcRenderer.invoke('settings:reinstall', providerId || 'claude'),
    validate: (providerId) => ipcRenderer.invoke('settings:validate', providerId || 'claude'),
  },
  clipboard: {
    write: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  },
  zoom: {
    set: (factor: number) => {
      webFrame.setZoomFactor(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor)));
    },
  },
  menu: {
    onNewProject: (cb) => onChannel('menu:new-project', cb),
    onNewSession: (cb) => onChannel('menu:new-session', cb),
    onToggleSplit: (cb) => onChannel('menu:toggle-split', cb),
    onNextSession: (cb) => onChannel('menu:next-session', cb),
    onPrevSession: (cb) => onChannel('menu:prev-session', cb),
    onGotoSession: (cb) => onChannel('menu:goto-session', (index) => cb(index as number)),
    onToggleDebug: (cb) => onChannel('menu:toggle-debug', cb),
    onUsageStats: (cb) => onChannel('menu:usage-stats', cb),
    onToggleInspector: (cb) => onChannel('menu:toggle-inspector', cb),
    onCloseSession: (cb) => onChannel('menu:close-session', cb),
    rebuild: (debugMode) => ipcRenderer.invoke('menu:rebuild', debugMode),
  },
  telemetry: {
    track: (event, data) => ipcRenderer.send('telemetry:track', event, data ?? {}),
  },
};

contextBridge.exposeInMainWorld('aiyard', api);
