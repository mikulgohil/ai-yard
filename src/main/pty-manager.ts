import * as pty from 'node-pty';

interface PtyInstance {
  process: pty.IPty;
  sessionId: string;
}

const ptys = new Map<string, PtyInstance>();

export function spawnPty(
  sessionId: string,
  cwd: string,
  claudeSessionId: string | null,
  isResume: boolean,
  extraArgs: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void
): void {
  if (ptys.has(sessionId)) {
    killPty(sessionId);
  }

  const env = { ...process.env };
  delete env.CLAUDE_CODE; // avoid subprocess detection conflicts
  env.CLAUDE_IDE_SESSION_ID = sessionId;

  const args: string[] = [];
  if (claudeSessionId) {
    if (isResume) {
      args.push('-r', claudeSessionId);
    } else {
      args.push('--session-id', claudeSessionId);
    }
  }

  if (extraArgs) {
    args.push(...extraArgs.split(/\s+/).filter(Boolean));
  }

  const shell = 'claude';
  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env,
  });

  ptyProcess.onData((data) => onData(data));
  ptyProcess.onExit(({ exitCode, signal }) => {
    ptys.delete(sessionId);
    onExit(exitCode, signal);
  });

  ptys.set(sessionId, { process: ptyProcess, sessionId });
}

export function writePty(sessionId: string, data: string): void {
  const instance = ptys.get(sessionId);
  if (instance) {
    instance.process.write(data);
  }
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const instance = ptys.get(sessionId);
  if (instance) {
    instance.process.resize(cols, rows);
  }
}

export function killPty(sessionId: string): void {
  const instance = ptys.get(sessionId);
  if (instance) {
    instance.process.kill();
    ptys.delete(sessionId);
  }
}

export function killAllPtys(): void {
  for (const [id] of ptys) {
    killPty(id);
  }
}
