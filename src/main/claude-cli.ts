import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

export interface McpServer { name: string; url: string; status: string; scope: 'user' | 'project' }
export interface Agent { name: string; model: string; category: 'plugin' | 'built-in'; scope: 'user' | 'project' }
export interface Skill { name: string; description: string; scope: 'user' | 'project' }
export interface ClaudeConfig { mcpServers: McpServer[]; agents: Agent[]; skills: Skill[] }

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function readDirSafe(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

/** Parse YAML-ish frontmatter from an .md file (between --- delimiters) */
function parseFrontmatter(filePath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/** Read MCP servers from settings.json mcpServers key and .mcp.json files */
function readMcpServers(settingsPath: string, mcpJsonPath: string, scope: 'user' | 'project'): McpServer[] {
  const servers: McpServer[] = [];

  // Read from settings.json mcpServers
  const settings = readJsonSafe(settingsPath);
  if (settings && typeof settings.mcpServers === 'object' && settings.mcpServers !== null) {
    const mcpServers = settings.mcpServers as Record<string, unknown>;
    for (const [name, config] of Object.entries(mcpServers)) {
      const cfg = config as Record<string, unknown>;
      const url = (cfg.url as string) || (cfg.command as string) || '';
      servers.push({ name, url, status: 'configured', scope });
    }
  }

  // Read from .mcp.json
  const mcpJson = readJsonSafe(mcpJsonPath);
  if (mcpJson && typeof mcpJson.mcpServers === 'object' && mcpJson.mcpServers !== null) {
    const mcpServers = mcpJson.mcpServers as Record<string, unknown>;
    const existingNames = new Set(servers.map(s => s.name));
    for (const [name, config] of Object.entries(mcpServers)) {
      if (existingNames.has(name)) continue;
      const cfg = config as Record<string, unknown>;
      const url = (cfg.url as string) || (cfg.command as string) || '';
      servers.push({ name, url, status: 'configured', scope });
    }
  }

  return servers;
}

/** Read agents from .md files in an agents directory */
function readAgentsFromDir(dirPath: string, scope: 'user' | 'project', category: 'plugin' | 'built-in'): Agent[] {
  const agents: Agent[] = [];
  for (const file of readDirSafe(dirPath)) {
    if (!file.endsWith('.md')) continue;
    const fm = parseFrontmatter(path.join(dirPath, file));
    if (fm.name) {
      agents.push({ name: fm.name, model: fm.model || '', category, scope });
    }
  }
  return agents;
}

/** Read agents from installed plugins */
function readPluginAgents(): Agent[] {
  const installedPath = path.join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  const installed = readJsonSafe(installedPath);
  if (!installed || typeof installed.plugins !== 'object' || installed.plugins === null) return [];

  const agents: Agent[] = [];
  const plugins = installed.plugins as Record<string, Array<{ installPath: string; scope?: string }>>;
  const enabledPlugins = getEnabledPlugins();

  for (const [pluginId, versions] of Object.entries(plugins)) {
    if (!enabledPlugins.has(pluginId)) continue;
    for (const version of versions) {
      const agentsDir = path.join(version.installPath, 'agents');
      const scope = (version.scope as 'user' | 'project') || 'user';
      agents.push(...readAgentsFromDir(agentsDir, scope, 'plugin'));
    }
  }
  return agents;
}

/** Read skills from installed plugins */
function readPluginSkills(): Skill[] {
  const installedPath = path.join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  const installed = readJsonSafe(installedPath);
  if (!installed || typeof installed.plugins !== 'object' || installed.plugins === null) return [];

  const skills: Skill[] = [];
  const plugins = installed.plugins as Record<string, Array<{ installPath: string; scope?: string }>>;
  const enabledPlugins = getEnabledPlugins();

  for (const [pluginId, versions] of Object.entries(plugins)) {
    if (!enabledPlugins.has(pluginId)) continue;
    for (const version of versions) {
      const skillsDir = path.join(version.installPath, 'skills');
      const scope = (version.scope as 'user' | 'project') || 'user';
      for (const skillName of readDirSafe(skillsDir)) {
        const skillMd = path.join(skillsDir, skillName, 'SKILL.md');
        const fm = parseFrontmatter(skillMd);
        if (fm.name || skillName) {
          skills.push({
            name: fm.name || skillName,
            description: fm.description || '',
            scope,
          });
        }
      }
    }
  }
  return skills;
}

/** Read skills from a directory (user or project scope) */
function readSkillsFromDir(dirPath: string, scope: 'user' | 'project'): Skill[] {
  const skills: Skill[] = [];
  for (const skillName of readDirSafe(dirPath)) {
    const skillMd = path.join(dirPath, skillName, 'SKILL.md');
    const fm = parseFrontmatter(skillMd);
    if (fm.name || skillName) {
      skills.push({ name: fm.name || skillName, description: fm.description || '', scope });
    }
  }
  return skills;
}

/** Get set of enabled plugin IDs from user settings */
function getEnabledPlugins(): Set<string> {
  const settings = readJsonSafe(path.join(homedir(), '.claude', 'settings.json'));
  if (!settings || typeof settings.enabledPlugins !== 'object' || settings.enabledPlugins === null) {
    return new Set();
  }
  const enabled = settings.enabledPlugins as Record<string, boolean>;
  return new Set(Object.entries(enabled).filter(([, v]) => v).map(([k]) => k));
}

const HOOK_MARKER = '# claude-ide-hook';

interface HookHandler {
  type: string;
  command: string;
}

interface HookMatcherEntry {
  matcher: string;
  hooks: HookHandler[];
}

type HooksConfig = Record<string, HookMatcherEntry[]>;

function isIdeHook(h: HookHandler): boolean {
  return h.command?.includes(HOOK_MARKER) ?? false;
}

/**
 * Install Claude Code hooks in ~/.claude/settings.json so that
 * UserPromptSubmit → working, Stop → waiting, Notification → waiting.
 */
export function installHooks(): void {
  const settingsPath = path.join(homedir(), '.claude', 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    // File may not exist yet
  }

  const existingHooks: HooksConfig = (settings.hooks ?? {}) as HooksConfig;

  // Remove any previously-installed claude-ide hooks from all event types
  const cleaned: HooksConfig = {};
  for (const [event, matchers] of Object.entries(existingHooks)) {
    const filteredMatchers = matchers
      .map((m) => ({
        ...m,
        hooks: (m.hooks ?? []).filter((h) => !isIdeHook(h)),
      }))
      .filter((m) => m.hooks.length > 0);
    if (filteredMatchers.length > 0) {
      cleaned[event] = filteredMatchers;
    }
  }

  const statusCmd = (status: string) =>
    `sh -c 'mkdir -p /tmp/claude-ide && echo ${status} > /tmp/claude-ide/$CLAUDE_IDE_SESSION_ID.status ${HOOK_MARKER}'`;

  // Hook to capture Claude's session ID from the hook input JSON (stdin)
  const captureSessionIdCmd =
    `sh -c 'input=$(cat); sid=$(echo "$input" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get(\\"session_id\\",\\"\\"))" 2>/dev/null); if [ -n "$sid" ]; then mkdir -p /tmp/claude-ide && echo "$sid" > /tmp/claude-ide/$CLAUDE_IDE_SESSION_ID.sessionid; fi ${HOOK_MARKER}'`;

  // Add our hooks for each event type
  const ideEvents: Record<string, string> = {
    SessionStart: 'waiting',
    UserPromptSubmit: 'working',
    Stop: 'waiting',
    Notification: 'waiting',
    TaskCompleted: 'completed',
  };

  for (const [event, status] of Object.entries(ideEvents)) {
    const existing = cleaned[event] ?? [];
    const hooks: HookHandler[] = [{ type: 'command', command: statusCmd(status) }];
    // Capture Claude session ID on first prompt submission
    if (event === 'UserPromptSubmit') {
      hooks.push({ type: 'command', command: captureSessionIdCmd });
    }
    existing.push({
      matcher: '',
      hooks,
    });
    cleaned[event] = existing;
  }

  settings.hooks = cleaned;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

export async function getClaudeConfig(projectPath: string): Promise<ClaudeConfig> {
  const home = homedir();
  const claudeDir = path.join(home, '.claude');

  // MCP Servers
  const userServers = readMcpServers(
    path.join(claudeDir, 'settings.json'),
    path.join(home, '.mcp.json'),
    'user',
  );
  const projectServers = readMcpServers(
    path.join(projectPath, '.claude', 'settings.json'),
    path.join(projectPath, '.mcp.json'),
    'project',
  );
  // Deduplicate: project servers override user servers by name
  const serverMap = new Map<string, McpServer>();
  for (const s of userServers) serverMap.set(s.name, s);
  for (const s of projectServers) serverMap.set(s.name, s);
  const mcpServers = Array.from(serverMap.values());

  // Agents
  const pluginAgents = readPluginAgents();
  const userAgents = readAgentsFromDir(path.join(claudeDir, 'agents'), 'user', 'plugin');
  const projectAgents = readAgentsFromDir(path.join(projectPath, '.claude', 'agents'), 'project', 'plugin');

  const agentNames = new Set<string>();
  const agents: Agent[] = [];
  for (const list of [pluginAgents, userAgents, projectAgents]) {
    for (const a of list) {
      if (!agentNames.has(a.name)) {
        agentNames.add(a.name);
        agents.push(a);
      }
    }
  }

  // Skills
  const pluginSkills = readPluginSkills();
  const userSkills = readSkillsFromDir(path.join(claudeDir, 'skills'), 'user');
  const projectSkills = readSkillsFromDir(path.join(projectPath, '.claude', 'skills'), 'project');

  const skillNames = new Set<string>();
  const skills: Skill[] = [];
  for (const list of [pluginSkills, userSkills, projectSkills]) {
    for (const s of list) {
      if (!skillNames.has(s.name)) {
        skillNames.add(s.name);
        skills.push(s);
      }
    }
  }

  return { mcpServers, agents, skills };
}
