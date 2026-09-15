export type {
  Agent,
  BlameEntry,
  BranchCompareResult,
  CheckRun,
  ClaudeConfig,
  CliProviderCapabilities,
  CliProviderMeta,
  Command,
  CommitEntry,
  ConflictedFile,
  CostData,
  GitFileEntry,
  GitWorktree,
  GrepMatch,
  McpResult,
  McpServer,
  PRComment,
  PRDetail,
  PRFile,
  PickaxeMatch,
  ProviderConfig,
  ProviderId,
  ReadinessCategory,
  ReadinessCheck,
  ReadinessCheckStatus,
  ReadinessResult,
  RebaseAction,
  RebaseTodo,
  ReflogEntry,
  RepoStats,
  Skill,
  StashEntry,
  StatsCache,
  SubmoduleEntry,
  TagEntry,
} from '../shared/types.js';

import type {
  BrowserViewCapturePageOutput,
  BrowserViewCreateInput,
  BrowserViewCreateOutput,
  BrowserViewEvent,
  ViewId,
  ViewRect,
} from '../shared/browser-view-contract.js';
import type {
  BlameEntry,
  BranchCompareResult,
  CheckRun,
  CliProviderMeta,
  CommitEntry,
  ConflictedFile,
  CostData,
  GitWorktree,
  GrepMatch,
  McpResult,
  PRComment,
  PRDetail,
  PRFile,
  PickaxeMatch,
  ProviderConfig,
  ProviderId,
  ReadinessResult,
  RebaseTodo,
  ReflogEntry,
  RepoStats,
  StashEntry,
  StatsCache,
  SubmoduleEntry,
  TagEntry,
} from '../shared/types.js';

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
    onHookStatus(callback: (sessionId: string, status: 'working' | 'waiting' | 'completed' | 'input', hookName: string) => void): () => void;
    onCliSessionId(callback: (sessionId: string, cliSessionId: string) => void): () => void;
    /** @deprecated Use onCliSessionId */
    onClaudeSessionId(callback: (sessionId: string, claudeSessionId: string) => void): () => void;
    onCostData(callback: (sessionId: string, costData: CostData) => void): () => void;
  };
  fs: {
    isDirectory(path: string): Promise<boolean>;
    expandPath(path: string): Promise<string>;
    listDirs(dirPath: string, prefix?: string): Promise<string[]>;
    browseDirectory(): Promise<string | null>;
    listFiles(cwd: string, query: string): Promise<string[]>;
    exists(filePath: string): Promise<boolean>;
    readFile(filePath: string): Promise<string>;
    readImage(filePath: string): Promise<{ dataUrl: string } | null>;
    watchFile(filePath: string): void;
    unwatchFile(filePath: string): void;
    onFileChanged(callback: (filePath: string) => void): () => void;
  };
  store: {
    load(): Promise<unknown>;
    save(state: unknown): Promise<void>;
  };
  provider: {
    getConfig(providerId: ProviderId, projectPath: string): Promise<ProviderConfig>;
    getMeta(providerId: ProviderId): Promise<CliProviderMeta>;
    listProviders(): Promise<CliProviderMeta[]>;
    watchProject(providerId: ProviderId, projectPath: string): void;
    onConfigChanged(callback: () => void): () => void;
  };
  /** @deprecated Use provider namespace */
  claude: {
    getConfig(projectPath: string): Promise<ProviderConfig>;
  };
  git: {
    getStatus(path: string): Promise<unknown>;
    getFiles(path: string): Promise<unknown>;
    getDiff(path: string, file: string, area: string): Promise<string>;
    getWorktrees(path: string): Promise<GitWorktree[]>;
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
    commit(path: string, message: string, amend: boolean): Promise<{ hash: string; subject: string }>;
    getLastCommit(path: string): Promise<{ subject: string; body: string }>;
    fetch(path: string, remote?: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    pull(path: string, rebase: boolean): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    push(path: string, opts: { setUpstream?: boolean; force?: boolean; branch?: string }): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    stageHunk(path: string, patch: string): Promise<void>;
    unstageHunk(path: string, patch: string): Promise<void>;
    stashList(path: string): Promise<StashEntry[]>;
    stashPush(path: string, message?: string, includeUntracked?: boolean): Promise<void>;
    stashPop(path: string, ref?: string): Promise<void>;
    stashApply(path: string, ref: string): Promise<void>;
    stashDrop(path: string, ref: string): Promise<void>;
    stashShow(path: string, ref: string): Promise<string>;
    log(path: string, opts?: { branch?: string; limit?: number; skip?: number; filePath?: string }): Promise<CommitEntry[]>;
    show(path: string, hash: string): Promise<string>;
    blame(path: string, filePath: string): Promise<BlameEntry[]>;
    listTags(path: string): Promise<TagEntry[]>;
    createTag(path: string, name: string, message?: string, ref?: string): Promise<void>;
    deleteTag(path: string, name: string): Promise<void>;
    pushTag(path: string, name: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    pushAllTags(path: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    reflog(path: string, limit?: number): Promise<ReflogEntry[]>;
    reset(path: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>;
    branchAt(path: string, branch: string, hash: string): Promise<void>;
    checkoutHash(path: string, hash: string): Promise<void>;
    compareBranches(path: string, base: string, head: string): Promise<BranchCompareResult>;
    defaultBranch(path: string): Promise<string>;
    getConflictedFile(path: string, filePath: string): Promise<ConflictedFile>;
    resolveConflict(path: string, filePath: string, content: string): Promise<void>;
    bisectStart(path: string, bad?: string, good?: string): Promise<string>;
    bisectGood(path: string, commit?: string): Promise<string>;
    bisectBad(path: string, commit?: string): Promise<string>;
    bisectReset(path: string): Promise<void>;
    bisectRun(path: string, command: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    pickaxe(path: string, query: string, limit?: number): Promise<PickaxeMatch[]>;
    grep(path: string, query: string, ref?: string): Promise<GrepMatch[]>;
    logGrep(path: string, pattern: string, limit?: number): Promise<PickaxeMatch[]>;
    rebaseTodo(path: string, base: string): Promise<RebaseTodo[]>;
    rebaseApply(path: string, base: string, todos: RebaseTodo[]): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    rebaseContinue(path: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    rebaseAbort(path: string): Promise<void>;
    cherryPick(path: string, hash: string, noCommit?: boolean): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    cherryPickContinue(path: string): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    cherryPickAbort(path: string): Promise<void>;
    submoduleList(path: string): Promise<SubmoduleEntry[]>;
    submoduleUpdate(path: string, recursive?: boolean): Promise<{ ok: boolean; stdout: string; stderr: string }>;
    submoduleSync(path: string): Promise<void>;
    createWorktree(projectPath: string, projectId: string, branch: string, baseBranch: string): Promise<{ path: string }>;
    removeWorktree(projectPath: string, worktreePath: string): Promise<void>;
    deleteBranch(projectPath: string, branch: string): Promise<void>;
    branchExists(projectPath: string, branch: string): Promise<boolean>;
  };
  github: {
    isAvailable(): Promise<boolean>;
    detectRepo(projectPath: string): Promise<{ owner: string; repo: string } | null>;
    listPRs(repo: string, state: 'open' | 'closed' | 'all', max: number): Promise<unknown>;
    listIssues(repo: string, state: 'open' | 'closed' | 'all', max: number): Promise<unknown>;
    prDetail(repo: string, prNumber: number): Promise<PRDetail>;
    prFiles(repo: string, prNumber: number): Promise<PRFile[]>;
    prComments(repo: string, prNumber: number): Promise<PRComment[]>;
    submitReview(repo: string, prNumber: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body: string): Promise<void>;
    addComment(repo: string, prNumber: number, filePath: string, line: number, body: string): Promise<void>;
    ciStatus(repo: string, ref: string): Promise<CheckRun[]>;
    repoStats(repo: string): Promise<RepoStats | null>;
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
    onQuitting(callback: () => void): () => void;
  };
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
    onEvent(viewId: ViewId, callback: (event: BrowserViewEvent) => void): () => void;
  };
  mcp: {
    connect(id: string, url: string): Promise<McpResult>;
    disconnect(id: string): Promise<McpResult>;
    listTools(id: string): Promise<McpResult>;
    listResources(id: string): Promise<McpResult>;
    listPrompts(id: string): Promise<McpResult>;
    callTool(id: string, name: string, args: Record<string, unknown>): Promise<McpResult>;
    readResource(id: string, uri: string): Promise<McpResult>;
    getPrompt(id: string, name: string, args: Record<string, string>): Promise<McpResult>;
  };
  readiness: {
    analyze(projectPath: string, excludedProviders?: string[]): Promise<ReadinessResult>;
  };
  stats: {
    getCache(): Promise<StatsCache | null>;
  };
  clipboard: {
    write(text: string): Promise<void>;
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
  };
}
