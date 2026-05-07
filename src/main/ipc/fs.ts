import { execSync } from 'child_process';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ReadFileResult } from '../../shared/types';
import { setFileWatcherWindow, unwatchFile as unwatchFileForChanges, watchFile as watchFileForChanges } from '../file-watcher';
import { BINARY_SNIFF_BYTES, expandUserPath, isBinaryBuffer } from '../fs-utils';
import { isMac, isWin } from '../platform';
import { loadState } from '../store';

/**
 * Filesystem IPC handlers + path-security helpers.
 * Extracted from ipc-handlers.ts (docs/IMPROVEMENTS.md B7). No behavior change.
 *
 * The two helpers below are exported because future IPC modules may need them.
 * Today they are only used by handlers in this file.
 */

/** True if the resolved path is within one of the user's known project directories. */
export function isWithinKnownProject(resolvedPath: string): boolean {
  const state = loadState();
  return state.projects.some((p) => resolvedPath.startsWith(p.path + path.sep) || resolvedPath === p.path);
}

/**
 * True if the resolved path is allowed for reading: within a known project
 * directory OR within a known CLI-tool config location.
 */
export function isAllowedReadPath(resolvedPath: string): boolean {
  if (isWithinKnownProject(resolvedPath)) {
    return true;
  }

  const home = os.homedir();
  const allowedPaths = [
    path.join(home, '.claude.json'),
    path.join(home, '.mcp.json'),
    path.join(home, '.claude') + path.sep,
    path.join(home, '.codex') + path.sep,
    path.join(home, '.gemini') + path.sep,
    path.join(home, '.copilot') + path.sep,
  ];

  if (isMac) {
    allowedPaths.push('/Library/Application Support/ClaudeCode/');
  } else if (isWin) {
    allowedPaths.push('C:\\Program Files\\ClaudeCode\\');
  } else {
    allowedPaths.push('/etc/claude-code/');
  }

  return allowedPaths.some((allowed) => resolvedPath === allowed || resolvedPath.startsWith(allowed));
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function registerFsIpcHandlers(): void {
  ipcMain.handle('fs:isDirectory', (_event, filePath: string) => {
    try {
      return fs.statSync(expandUserPath(filePath)).isDirectory();
    } catch {
      return false;
    }
  });

  ipcMain.handle('fs:expandPath', (_event, filePath: string): string => expandUserPath(filePath));

  ipcMain.handle('fs:listDirs', (_event, dirPath: string, prefix?: string) => {
    try {
      const expanded = expandUserPath(dirPath);
      const entries = fs.readdirSync(expanded, { withFileTypes: true });
      const lowerPrefix = prefix?.toLowerCase();
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && (!lowerPrefix || e.name.toLowerCase().startsWith(lowerPrefix)))
        .map((e) => path.join(expanded, e.name))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 20);
    } catch {
      return [];
    }
  });

  ipcMain.handle('fs:listDir', (_event, dirPath: string) => {
    try {
      const expanded = expandUserPath(dirPath);
      if (!isAllowedReadPath(expanded)) return [];
      const entries = fs.readdirSync(expanded, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        path: path.join(expanded, e.name),
        isDirectory: e.isDirectory(),
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('fs:browseDirectory', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('fs:listFiles', (_event, cwd: string, query: string) => {
    try {
      const resolvedCwd = path.resolve(cwd);
      if (!isWithinKnownProject(resolvedCwd)) {
        return [];
      }
      let files: string[];
      try {
        const output = execSync('git ls-files --cached --others --exclude-standard', { cwd: resolvedCwd, encoding: 'utf-8', timeout: 5000 });
        files = output.split('\n').filter(Boolean);
      } catch {
        files = [];
        const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '__pycache__']);
        const MAX_DEPTH = 5;
        const MAX_FILES = 5000;
        function walk(dir: string, depth: number): void {
          if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
          let entries: fs.Dirent[];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            if (files.length >= MAX_FILES) return;
            if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
            const rel = path.relative(resolvedCwd, path.join(dir, entry.name));
            if (entry.isDirectory()) {
              walk(path.join(dir, entry.name), depth + 1);
            } else {
              files.push(rel);
            }
          }
        }
        walk(resolvedCwd, 0);
      }

      if (query) {
        const lower = query.toLowerCase();
        const exact: string[] = [];
        const startsWith: string[] = [];
        const nameContains: string[] = [];
        const pathContains: string[] = [];
        for (const f of files) {
          const fileName = path.basename(f).toLowerCase();
          if (fileName === lower) exact.push(f);
          else if (fileName.startsWith(lower)) startsWith.push(f);
          else if (fileName.includes(lower)) nameContains.push(f);
          else if (f.toLowerCase().includes(lower)) pathContains.push(f);
        }
        files = [...exact, ...startsWith, ...nameContains, ...pathContains];
      }
      return files.slice(0, 50);
    } catch (err) {
      console.warn('fs:listFiles failed:', err);
      return [];
    }
  });

  ipcMain.handle('fs:exists', (_event, filePath: string): boolean => {
    try {
      const resolved = path.resolve(filePath);
      if (!isAllowedReadPath(resolved)) return false;
      return fs.existsSync(resolved);
    } catch {
      return false;
    }
  });

  ipcMain.handle('fs:readFile', (_event, filePath: string): ReadFileResult => {
    try {
      const resolved = path.resolve(filePath);
      if (!isAllowedReadPath(resolved)) {
        console.warn(`fs:readFile blocked: ${resolved} is not within an allowed path`);
        return { ok: false, reason: 'error' };
      }
      const fd = fs.openSync(resolved, 'r');
      try {
        const head = Buffer.alloc(BINARY_SNIFF_BYTES);
        const bytesRead = fs.readSync(fd, head, 0, BINARY_SNIFF_BYTES, 0);
        if (isBinaryBuffer(head.subarray(0, bytesRead))) {
          return { ok: false, reason: 'binary' };
        }
      } finally {
        fs.closeSync(fd);
      }
      return { ok: true, content: fs.readFileSync(resolved, 'utf-8') };
    } catch (err) {
      console.warn('fs:readFile failed:', err);
      return { ok: false, reason: 'error' };
    }
  });

  ipcMain.handle('fs:readImage', (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath);
      if (!isAllowedReadPath(resolved)) {
        console.warn(`fs:readImage blocked: ${resolved} is not within an allowed path`);
        return null;
      }
      const mime = IMAGE_MIME_BY_EXT[path.extname(resolved).toLowerCase()];
      if (!mime) return null;
      const stat = fs.statSync(resolved);
      if (stat.size > MAX_IMAGE_BYTES) {
        console.warn(`fs:readImage rejected: ${resolved} exceeds ${MAX_IMAGE_BYTES} bytes`);
        return null;
      }
      const buf = fs.readFileSync(resolved);
      return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
    } catch (err) {
      console.warn('fs:readImage failed:', err);
      return null;
    }
  });

  ipcMain.handle('fs:trashItem', async (_event, filePath: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const resolved = path.resolve(filePath);
      if (!isWithinKnownProject(resolved)) {
        console.warn(`fs:trashItem blocked: ${resolved} is not within a known project`);
        return { ok: false, error: 'Path is not within a known project' };
      }
      await shell.trashItem(resolved);
      return { ok: true };
    } catch (err) {
      console.warn('fs:trashItem failed:', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.on('fs:watchFile', (event, filePath: string) => {
    const resolved = path.resolve(filePath);
    if (!isAllowedReadPath(resolved)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) setFileWatcherWindow(win);
    watchFileForChanges(resolved);
  });

  ipcMain.on('fs:unwatchFile', (_event, filePath: string) => {
    const resolved = path.resolve(filePath);
    unwatchFileForChanges(resolved);
  });
}
