/** Matches ANSI escape sequences (CSI codes, OSC sequences, etc.) */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences are control characters by definition
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;

/** Strip all ANSI escape sequences from a string */
export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}
