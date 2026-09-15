import { execFile } from 'child_process';
import { ipcMain } from 'electron';
import { ClaudeProvider } from '../providers/claude-provider';
import { getFullPath } from '../pty-manager';

const provider = new ClaudeProvider();

/**
 * One-shot, headless Claude call. Used by the AI-powered git features
 * (G11 commit-message, G12 PR description, G14 conflict resolver, G15 bisect).
 * Returns the raw text response. Falls back to an empty string on failure so
 * callers can detect it and let the user fall back to manual input.
 */
export async function callAiOnce(prompt: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  const cwd = opts.cwd || process.cwd();
  const timeout = opts.timeoutMs ?? 30_000;
  let bin: string;
  try {
    bin = provider.resolveBinaryPath();
  } catch {
    return '';
  }

  return new Promise<string>((resolve) => {
    execFile(
      bin,
      ['-p', prompt, '--output-format', 'text'],
      {
        cwd,
        env: { ...process.env, PATH: getFullPath() },
        maxBuffer: 4 * 1024 * 1024,
        timeout,
        windowsHide: true,
      },
      (err, stdout) => {
        if (err) {
          resolve('');
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

export function registerAiUtilIpcHandlers(): void {
  ipcMain.handle('ai:callOnce', (_event, prompt: string, cwd?: string) => callAiOnce(prompt, { cwd }));
}
