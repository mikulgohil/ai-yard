/**
 * electron-vite config DRAFT — see docs/IMPROVEMENTS.md B9.
 *
 * STATUS: Reference only. NOT ACTIVE. The current build pipeline is
 * tsc(main) + tsc(preload) + esbuild(renderer). To adopt:
 *
 *   1. `npm i -D electron-vite vite`
 *   2. Rename this file to `electron-vite.config.ts` (drop `.draft`)
 *   3. Replace `package.json` "build" / "start" / "dev" scripts:
 *        "dev":   "electron-vite dev"
 *        "build": "electron-vite build && npm run copy-assets"
 *        "start": "npm run build && electron ."
 *   4. Remove `tsconfig.preload.json` and `tsconfig.main.json` if you keep their
 *      compilerOptions colocated here, or keep them for editor IntelliSense.
 *   5. Confirm `dist/main/main/main.js` and `dist/preload/preload/preload.js`
 *      paths still match `package.json#main` and the BrowserWindow preload
 *      reference. Adjust `outDir` below if not.
 *
 * Do NOT adopt this incrementally. The build pipeline is one-or-the-other.
 */

import { defineConfig } from 'electron-vite';
import path from 'path';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main/main',
      lib: {
        entry: path.resolve(__dirname, 'src/main/main.ts'),
        formats: ['cjs'],
        fileName: () => 'main.js',
      },
      rollupOptions: {
        external: ['electron', 'node-pty', 'electron-updater', 'better-sqlite3'],
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload/preload',
      lib: {
        entry: {
          preload: path.resolve(__dirname, 'src/preload/preload.ts'),
          'browser-tab-preload': path.resolve(__dirname, 'src/preload/browser-tab-preload.ts'),
        },
        formats: ['cjs'],
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname, 'src/renderer'),
    build: {
      outDir: path.resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: path.resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
