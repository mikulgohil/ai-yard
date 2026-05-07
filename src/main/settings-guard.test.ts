import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { isWin } from './platform';

const SCRIPT_DIR = path.join('/home/test', '.ai-yard', 'run');
const STATUSLINE_SCRIPT = path.join(SCRIPT_DIR, isWin ? 'statusline.cmd' : 'statusline.sh');

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
  homedir: () => '/home/test',
}));

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: { on: vi.fn(), once: vi.fn(), removeListener: vi.fn() },
}));

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
  rmSync: vi.fn(),
  watch: vi.fn(),
}));

import { isAIYardStatusLine, shouldWarnStatusLine } from './settings-guard';

describe('isAIYardStatusLine', () => {
  it('returns true for current statusline path', () => {
    expect(isAIYardStatusLine({ command: STATUSLINE_SCRIPT })).toBe(true);
  });

  it('returns true for legacy tmp-dir statusline path (unix)', () => {
    expect(isAIYardStatusLine({
      command: '/var/folders/_k/hyr0867141z9_6ghbmwh65g80000gn/T/ai-yard/statusline.sh',
    })).toBe(true);
  });

  it('returns true for legacy /tmp/ai-yard path', () => {
    expect(isAIYardStatusLine({ command: '/tmp/ai-yard/statusline.sh' })).toBe(true);
  });

  it('returns true for legacy windows tmp-dir statusline path', () => {
    expect(isAIYardStatusLine({
      command: 'C:\\Users\\test\\AppData\\Local\\Temp\\ai-yard\\statusline.cmd',
    })).toBe(true);
  });

  it('returns false for foreign statusline', () => {
    expect(isAIYardStatusLine({ command: '/usr/local/bin/some-other-tool.sh' })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isAIYardStatusLine(null)).toBe(false);
    expect(isAIYardStatusLine(undefined)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isAIYardStatusLine('string')).toBe(false);
  });

  it('returns false for object without command', () => {
    expect(isAIYardStatusLine({ url: 'http://example.com' })).toBe(false);
  });
});

describe('shouldWarnStatusLine', () => {
  const FOREIGN = '/usr/local/bin/other-tool.sh';
  const DIFFERENT_FOREIGN = '/opt/another/tool.sh';

  it('never warns when statusLine is AI-yard', () => {
    expect(shouldWarnStatusLine('aiyard', null, null, null)).toBe(false);
    expect(shouldWarnStatusLine('aiyard', 'granted', FOREIGN, null)).toBe(false);
    expect(shouldWarnStatusLine('aiyard', 'declined', FOREIGN, null)).toBe(false);
  });

  it('suppresses warning when user declined the same foreign command', () => {
    expect(shouldWarnStatusLine('foreign', 'declined', FOREIGN, FOREIGN)).toBe(false);
  });

  it('warns when foreign command differs from previously declined one', () => {
    expect(shouldWarnStatusLine('foreign', 'declined', FOREIGN, DIFFERENT_FOREIGN)).toBe(true);
  });

  it('warns when user declined but consent command is unknown (legacy)', () => {
    expect(shouldWarnStatusLine('foreign', 'declined', null, FOREIGN)).toBe(true);
    expect(shouldWarnStatusLine('foreign', 'declined', undefined, FOREIGN)).toBe(true);
  });

  it('still warns about missing statusLine even if user declined', () => {
    expect(shouldWarnStatusLine('missing', 'declined', FOREIGN, null)).toBe(true);
  });

  it('warns when user has not yet decided', () => {
    expect(shouldWarnStatusLine('foreign', null, null, FOREIGN)).toBe(true);
    expect(shouldWarnStatusLine('foreign', undefined, null, FOREIGN)).toBe(true);
    expect(shouldWarnStatusLine('missing', null, null, null)).toBe(true);
  });

  it('warns when user granted but another tool overwrote it', () => {
    expect(shouldWarnStatusLine('foreign', 'granted', null, FOREIGN)).toBe(true);
  });
});
