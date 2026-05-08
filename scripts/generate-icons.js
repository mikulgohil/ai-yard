#!/usr/bin/env node
// One-shot generator for AI-yard brand icons.
// Source preference (first match wins):
//   1. build/icon-source.png  — high-res raster master (preferred for generated/illustrated marks)
//   2. build/icon.svg         — vector master (fallback for hand-coded marks)
// Outputs:
//   build/icon.png   1024x1024 PNG (electron-builder linux/mac default)
//   build/icon.ico   multi-resolution Windows ICO
//   build/icon.icns  macOS iconset (built via iconutil if available)
//
// Run manually after editing the source:
//   node scripts/generate-icons.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const pngSourcePath = path.join(buildDir, 'icon-source.png');
const svgPath = path.join(buildDir, 'icon.svg');

let source;
let sourceLabel;
if (fs.existsSync(pngSourcePath)) {
  source = fs.readFileSync(pngSourcePath);
  sourceLabel = 'build/icon-source.png';
} else if (fs.existsSync(svgPath)) {
  source = fs.readFileSync(svgPath);
  sourceLabel = 'build/icon.svg';
} else {
  console.error('Missing source: expected build/icon-source.png or build/icon.svg');
  process.exit(1);
}
console.log(`source: ${sourceLabel}`);

async function renderPng(size) {
  return sharp(source).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

function buildIco(entries) {
  // ICONDIR: reserved(2)=0, type(2)=1, count(2)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dirSize = 16 * entries.length;
  const dir = Buffer.alloc(dirSize);
  const payloads = [];
  let offset = 6 + dirSize;
  entries.forEach((e, i) => {
    const dim = e.size === 256 ? 0 : e.size; // 0 means 256 in ICO
    const base = i * 16;
    dir.writeUInt8(dim, base + 0);          // width
    dir.writeUInt8(dim, base + 1);          // height
    dir.writeUInt8(0, base + 2);            // colorCount (0 = >=256)
    dir.writeUInt8(0, base + 3);            // reserved
    dir.writeUInt16LE(1, base + 4);         // planes
    dir.writeUInt16LE(32, base + 6);        // bitCount
    dir.writeUInt32LE(e.buf.length, base + 8); // size
    dir.writeUInt32LE(offset, base + 12);   // offset
    payloads.push(e.buf);
    offset += e.buf.length;
  });
  return Buffer.concat([header, dir, ...payloads]);
}

async function main() {
  // 1) build/icon.png (1024)
  await sharp(source).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(path.join(buildDir, 'icon.png'));
  console.log('wrote build/icon.png (1024x1024)');

  // 2) build/icon.ico (multi-res for Windows: 16,32,48,64,128,256)
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoEntries = [];
  for (const s of icoSizes) {
    icoEntries.push({ size: s, buf: await renderPng(s) });
  }
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(icoEntries));
  console.log(`wrote build/icon.ico (${icoSizes.join(',')})`);

  // 3) build/icon.icns via iconutil (macOS only)
  const hasIconutil = (() => {
    try { execSync('which iconutil', { stdio: 'ignore' }); return true; } catch { return false; }
  })();
  if (!hasIconutil) {
    console.warn('iconutil not found - skipping icon.icns. Run on macOS to regenerate.');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiyard-iconset-'));
  const iconset = path.join(tmp, 'icon.iconset');
  fs.mkdirSync(iconset);
  // Apple's expected iconset layout:
  // icon_16x16, icon_16x16@2x (32), icon_32x32, icon_32x32@2x (64),
  // icon_128x128, icon_128x128@2x (256), icon_256x256, icon_256x256@2x (512),
  // icon_512x512, icon_512x512@2x (1024)
  const icnsLayout = [
    ['icon_16x16.png',     16],
    ['icon_16x16@2x.png',  32],
    ['icon_32x32.png',     32],
    ['icon_32x32@2x.png',  64],
    ['icon_128x128.png',   128],
    ['icon_128x128@2x.png',256],
    ['icon_256x256.png',   256],
    ['icon_256x256@2x.png',512],
    ['icon_512x512.png',   512],
    ['icon_512x512@2x.png',1024],
  ];
  for (const [name, size] of icnsLayout) {
    await sharp(source).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(iconset, name));
  }
  execSync(`iconutil -c icns -o "${path.join(buildDir, 'icon.icns')}" "${iconset}"`, { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote build/icon.icns');
}

main().catch((e) => { console.error(e); process.exit(1); });
