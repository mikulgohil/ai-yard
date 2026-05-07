import { ipcMain } from 'electron';
import type { ProviderId } from '../../shared/types';
import { getProvider } from '../providers/registry';
import { buildHandoffPrompt } from '../providers/resume-handoff';
import { searchSessions } from '../session-deep-search';

/**
 * Session-level IPC handlers (handoff + deep search).
 * Extracted from ipc-handlers.ts (docs/IMPROVEMENTS.md B7). No behavior change.
 */
export function registerSessionIpcHandlers(): void {
  ipcMain.handle('session:buildResumeWithPrompt', async (
    _event,
    sourceProviderId: ProviderId,
    sourceCliSessionId: string | null,
    projectPath: string,
    sessionName: string,
  ) => {
    const sourceProvider = getProvider(sourceProviderId);
    const fromProviderLabel = sourceProvider.meta.displayName;
    let transcriptPath: string | null = null;
    if (sourceCliSessionId && sourceProvider.getTranscriptPath) {
      try {
        transcriptPath = sourceProvider.getTranscriptPath(sourceCliSessionId, projectPath);
      } catch (err) {
        console.warn('getTranscriptPath failed:', err);
      }
    }
    return buildHandoffPrompt({ fromProviderLabel, sessionName, transcriptPath });
  });

  ipcMain.handle('session:deepSearch', (_event, query: string) => {
    return searchSessions(query);
  });
}
