#!/usr/bin/env node
// Populates src/renderer/.vite-public/ with runtime static assets that the
// renderer's index.html references via <link>/<img>: xterm.css, gridstack CSS,
// icon, CHANGELOG, provider assets. Vite serves this directory at the root in
// dev and copies it into dist/renderer/ during `vite build`.
const fs = require('fs');
const path = require('path');

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  mkdirp(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'src', 'renderer', '.vite-public');

mkdirp(publicDir);

copyFile(
  path.join(root, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'),
  path.join(publicDir, 'xterm.css')
);
copyFile(
  path.join(root, 'node_modules', 'gridstack', 'dist', 'gridstack.min.css'),
  path.join(publicDir, 'vendor', 'gridstack.min.css')
);
copyFile(path.join(root, 'build', 'icon.png'), path.join(publicDir, 'icon.png'));
copyFile(path.join(root, 'CHANGELOG.md'), path.join(publicDir, 'CHANGELOG.md'));

copyDir(
  path.join(root, 'src', 'renderer', 'assets', 'providers'),
  path.join(publicDir, 'assets', 'providers')
);

console.log('Vite publicDir populated.');
