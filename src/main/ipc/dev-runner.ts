import { ipcMain } from 'electron';
import type { RunCandidate } from '../../shared/types';
import { detectRunCommand } from '../dev-runner';
import { isWithinKnownProject } from './fs';

/**
 * IPC for detecting how to run a project's dev server.
 * Detection logic lives in `../dev-runner.ts`; this file is the channel binding.
 *
 * Path-security: the renderer only ever asks about its own project paths, but
 * we still gate on `isWithinKnownProject` so a misbehaving renderer can't probe
 * arbitrary filesystem locations for `package.json` contents.
 */
export function registerDevRunnerIpcHandlers(): void {
  ipcMain.handle('dev-runner:detect', (_event, cwd: unknown): RunCandidate => {
    if (typeof cwd !== 'string' || cwd.length === 0) {
      return { source: 'none', command: '' };
    }
    if (!isWithinKnownProject(cwd)) {
      console.warn(`dev-runner:detect blocked: ${cwd} is not within a known project`);
      return { source: 'none', command: '' };
    }
    return detectRunCommand(cwd);
  });
}
