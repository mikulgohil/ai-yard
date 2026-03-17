export interface McpServer { name: string; url: string; status: string; scope: 'user' | 'project' }
export interface Agent { name: string; model: string; category: 'plugin' | 'built-in'; scope: 'user' | 'project' }
export interface Skill { name: string; description: string; scope: 'user' | 'project' }
export interface ClaudeConfig { mcpServers: McpServer[]; agents: Agent[]; skills: Skill[] }

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
  store: {
    load(): Promise<unknown>;
    save(state: unknown): Promise<void>;
  };
  claude: {
    getConfig(projectPath: string): Promise<ClaudeConfig>;
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
