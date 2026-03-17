import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';

const STATUS_DIR = '/tmp/claude-ide';

let watcher: fs.FSWatcher | null = null;

export function startWatching(win: BrowserWindow): void {
  // Ensure directory exists
  fs.mkdirSync(STATUS_DIR, { recursive: true });

  watcher = fs.watch(STATUS_DIR, (eventType, filename) => {
    if (!filename) return;

    if (filename.endsWith('.status')) {
      const sessionId = filename.replace('.status', '');
      const filePath = path.join(STATUS_DIR, filename);

      try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (content === 'working' || content === 'waiting' || content === 'completed') {
          if (!win.isDestroyed()) {
            win.webContents.send('session:hookStatus', sessionId, content);
          }
        }
      } catch {
        // File may have been deleted between watch event and read
      }
    } else if (filename.endsWith('.sessionid')) {
      const sessionId = filename.replace('.sessionid', '');
      const filePath = path.join(STATUS_DIR, filename);

      try {
        const claudeSessionId = fs.readFileSync(filePath, 'utf-8').trim();
        if (claudeSessionId && !win.isDestroyed()) {
          win.webContents.send('session:claudeSessionId', sessionId, claudeSessionId);
        }
      } catch {
        // File may have been deleted between watch event and read
      }
    }
  });
}

export function cleanupSessionStatus(sessionId: string): void {
  for (const ext of ['.status', '.sessionid']) {
    try {
      fs.unlinkSync(path.join(STATUS_DIR, `${sessionId}${ext}`));
    } catch {
      // Already gone
    }
  }
}

export function cleanupAll(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  try {
    const files = fs.readdirSync(STATUS_DIR);
    for (const file of files) {
      if (file.endsWith('.status') || file.endsWith('.sessionid')) {
        fs.unlinkSync(path.join(STATUS_DIR, file));
      }
    }
    fs.rmdirSync(STATUS_DIR);
  } catch {
    // Directory may not exist
  }
}
