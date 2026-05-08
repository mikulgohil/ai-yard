import { defineConfig } from 'vite';
import * as path from 'path';

// Renderer-only Vite config. Main and preload stay on tsc (see tsconfig.main.json
// and tsconfig.preload.json) — Vite owns only `src/renderer/`.
//
// Dev server: `npm run dev` starts vite + electron concurrently. Electron loads
// `process.env.VITE_DEV_SERVER_URL` instead of the file:// path.
//
// Static assets that index.html references via <link>/<img> live in
// src/renderer/.vite-public/ (gitignored), populated by scripts/copy-vite-public.js.
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  publicDir: path.resolve(__dirname, 'src/renderer/.vite-public'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
