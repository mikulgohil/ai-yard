#!/usr/bin/env node
// Resets the inputs to the `dev` script's wait-on step so it can't satisfy on
// stale outputs from a previous build. Without this, wait-on fires Electron
// before tsc has emitted newly-added modules — producing "Cannot find module"
// crashes on first run after pulling a branch that adds shared modules.
//
// We delete two things:
//   1) The sentinel .js files that wait-on watches.
//   2) The matching .tsbuildinfo files. Both tsconfigs have `composite: true`,
//      which makes tsc skip emit when the buildinfo says "up-to-date" — even
//      if the output files are gone. Deleting buildinfo forces a real first
//      pass so the sentinel files are guaranteed to be re-emitted.
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const targets = [
  path.join(repoRoot, 'dist', 'main', 'main', 'main.js'),
  path.join(repoRoot, 'dist', 'preload', 'preload', 'preload.js'),
  path.join(repoRoot, 'dist', 'tsconfig.main.tsbuildinfo'),
  path.join(repoRoot, 'dist', 'tsconfig.preload.tsbuildinfo'),
];

for (const file of targets) {
  fs.rmSync(file, { force: true });
}
