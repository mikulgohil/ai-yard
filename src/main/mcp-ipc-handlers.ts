import { ipcMain } from 'electron';
import { addMcpServer, type McpServerConfig, removeMcpServer } from './claude-cli';
import * as mcpClient from './mcp-client';

export function registerMcpHandlers(): void {
  ipcMain.handle('mcp:addServer', (_event, name: string, config: McpServerConfig, scope: 'user' | 'project', projectPath?: string) => {
    try {
      addMcpServer(name, config, scope, projectPath);
      return { success: true };
    } catch (err) {
      console.error('mcp:addServer failed:', err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('mcp:removeServer', (_event, name: string, filePath: string, scope: 'user' | 'project', projectPath?: string) => {
    try {
      removeMcpServer(name, filePath, scope, projectPath);
      return { success: true };
    } catch (err) {
      console.error('mcp:removeServer failed:', err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('mcp:connect', (_event, id: string, url: string) =>
    mcpClient.connect(id, url));

  ipcMain.handle('mcp:disconnect', (_event, id: string) =>
    mcpClient.disconnect(id));

  ipcMain.handle('mcp:listTools', (_event, id: string) =>
    mcpClient.listTools(id));

  ipcMain.handle('mcp:listResources', (_event, id: string) =>
    mcpClient.listResources(id));

  ipcMain.handle('mcp:listPrompts', (_event, id: string) =>
    mcpClient.listPrompts(id));

  ipcMain.handle('mcp:callTool', (_event, id: string, name: string, args: Record<string, unknown>) =>
    mcpClient.callTool(id, name, args));

  ipcMain.handle('mcp:readResource', (_event, id: string, uri: string) =>
    mcpClient.readResource(id, uri));

  ipcMain.handle('mcp:getPrompt', (_event, id: string, name: string, args: Record<string, string>) =>
    mcpClient.getPrompt(id, name, args));
}
