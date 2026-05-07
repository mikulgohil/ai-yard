/**
 * Type-safe IPC contract — see docs/IMPROVEMENTS.md B6.
 *
 * STATUS: Scaffolding only. One channel migrated as a worked example
 * (`store:load`). Adopting this fully means:
 *   1. Add an entry to `IpcContract` for every existing `ipcMain.handle('foo:bar', ...)`.
 *   2. Replace `window.aiyard.foo.bar(args)` calls with `invoke('foo:bar', args)`.
 *   3. Replace `ipcMain.handle('foo:bar', handler)` with `registerHandler('foo:bar', handler)`.
 *   4. Both renderer and main type-error if either side drifts.
 *
 * The full migration is deferred — it touches every IPC call site (~80 channels).
 * Do not adopt this incrementally; a half-typed surface is worse than the current
 * hand-typed one.
 */

import type { PersistedState } from './types';

/**
 * The single source of truth for every IPC channel. Keys are channel names,
 * values describe input and output types.
 *
 * Add new channels here as plain TypeScript types. Validation at the channel
 * boundary is the renderer's responsibility (zod / valibot / hand-rolled);
 * this contract is for compile-time safety, not runtime checks.
 */
export interface IpcContract {
  // === Worked example: store ===
  'store:load': {
    input: undefined;
    output: PersistedState;
  };
  'store:save': {
    input: PersistedState;
    output: undefined;
  };

  // === To be filled in when migrating ===
  // 'pty:create': { input: { sessionId: string; cwd: string; /* ... */ }; output: void };
  // 'pty:write':  { input: { sessionId: string; data: string }; output: void };
  // 'fs:readFile': { input: { filePath: string }; output: ReadFileResult };
  // ... etc for the remaining ~78 channels
}

export type IpcChannel = keyof IpcContract;
export type IpcInput<C extends IpcChannel> = IpcContract[C]['input'];
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output'];

export type IpcHandler<C extends IpcChannel> = (input: IpcInput<C>) => IpcOutput<C> | Promise<IpcOutput<C>>;
