#!/usr/bin/env node
/**
 * generate-icons.mjs — Generate platform app icons from a source PNG.
 *
 * Source: public/hydra_dragon.png (1024x1024)
 * Output: desktop/icons/
 *   - icon.png   (512x512)          Linux AppImage
 *   - icon.ico   (multi-resolution) Windows
 *   - icon.icns  (multi-resolution  macOS     requires macOS)
 *
 * Usage: node scripts/generate-icons.mjs [--source path/to/source.png]
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI ──────────────────────────────────────────────────────────────────────
const argSource = process.argv
  .find((a, i) => a === '--source' && i + 1 < process.argv.length);
const argIndex = process.argv.indexOf('--source');
const SOURCE = argSource
  ? path.resolve(process.argv[argIndex + 1])
  : path.join(ROOT, 'public', 'hydra_dragon.png');

const ICONS_DIR = path.join(ROOT, 'desktop', 'icons');

// ── Icon sizes ───────────────────────────────────────────────────────────────
const ICNS_SIZES = [16, 32, 64, 128, 256, 512];
const ICNS_2X    = [32, 64, 128, 256, 512, 1024]; // @2x counterparts
const ICO_SIZES  = [16, 32, 48, 64, 128, 256];
const PNG_SIZE   = 512;

// ── Helpers ──────────────────────────────────────────────────────────────────
function info(msg)  { console.log(`  [generate-icons] ${msg}`); }
function ok(msg)    { console.log(`  ✅ ${msg}`); }
function warn(msg)  { console.warn(`  ⚠️  ${msg}`); }

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`❌ Source image not found: ${SOURCE}`);
    process.exit(1);
  }

  info(`Source: ${SOURCE}`);
  mkdirSync(ICONS_DIR, { recursive: true });

  const sourceBuffer = readFileSync(SOURCE);

  // ── Linux: icon.png (512×512) ──────────────────────────────────────────
  info('Generating icon.png (512×512) for Linux…');
  await sharp(sourceBuffer)
    .resize(PNG_SIZE, PNG_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(ICONS_DIR, 'icon.png'));
  ok('icon.png');

  // ── Windows: icon.ico (multi-resolution) ────────────────────────────────
  info('Generating icon.ico (multi-resolution) for Windows…');
  const icoBuffers = await Promise.all(
    ICO_SIZES.map(size =>
      sharp(sourceBuffer)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );

  // Combine PNGs into a multi-resolution ICO by writing each as a raw ICO entry.
  // sharp's native .ico output is single-resolution, so we construct the
  // container manually via a simple ICO packer.
  const icoData = packICO(icoBuffers, ICO_SIZES);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(ICONS_DIR, 'icon.ico'), icoData);
  ok('icon.ico');

  // ── macOS: icon.icns (iconset → iconutil) ──────────────────────────────
  if (process.platform === 'darwin') {
    info('Generating icon.icns for macOS…');

    const iconsetDir = path.join(ICONS_DIR, 'icon.iconset');
    mkdirSync(iconsetDir, { recursive: true });

    // Standard sizes (1x)
    for (const size of ICNS_SIZES) {
      const fname = `icon_${size}x${size}.png`;
      await sharp(sourceBuffer)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(path.join(iconsetDir, fname));
      info(`  ${fname}`);
    }

    // Retina sizes (@2x)
    for (const size of ICNS_2X) {
      const base = size / 2;
      const fname = `icon_${base}x${base}@2x.png`;
      await sharp(sourceBuffer)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(path.join(iconsetDir, fname));
      info(`  ${fname}`);
    }

    // Run iconutil to pack into .icns
    execSync('iconutil -c icns icon.iconset', { cwd: ICONS_DIR, stdio: 'pipe' });
    rmSync(iconsetDir, { recursive: true, force: true });
    ok('icon.icns');
  } else {
    warn('Not on macOS — skipping icon.icns generation.');
    warn('Run this script on macOS to generate the .icns file,');
    warn('or manually convert icon.png to .icns with iconutil / online tool.');
  }

  console.log('');
  console.log('🎨 All icons generated in desktop/icons/');
  await listGenerated();
}

// ── ICO packer (multi-resolution) ────────────────────────────────────────────
function packICO(pngBuffers, sizes) {
  // ICO file structure:
  //   ICONDIR header (6 bytes)
  //   ICONDIRENTRY array (16 bytes each)
  //   Image data

  const count = pngBuffers.length;
  const headerSize = 6;               // reserved(2) + type(2) + count(2)
  const entrySize = 16;
  const dirSize = headerSize + count * entrySize;

  // Calculate image data offsets
  const offsets = [];
  let offset = dirSize;
  for (let i = 0; i < count; i++) {
    offsets.push(offset);
    offset += pngBuffers[i].length;
  }

  const buf = Buffer.alloc(offset);

  // ICONDIR header
  buf.writeUInt16LE(0, 0);          // reserved
  buf.writeUInt16LE(1, 2);          // type: 1 = ICO
  buf.writeUInt16LE(count, 4);      // count

  // ICONDIRENTRY for each image
  for (let i = 0; i < count; i++) {
    const base = headerSize + i * entrySize;
    const w = sizes[i] >= 256 ? 0 : sizes[i]; // 256 → 0 in ICO spec
    const h = sizes[i] >= 256 ? 0 : sizes[i];
    buf.writeUInt8(w,      base + 0);  // width
    buf.writeUInt8(h,      base + 1);  // height
    buf.writeUInt8(0,      base + 2);  // color palette (0 for PNG)
    buf.writeUInt8(0,      base + 3);  // reserved
    buf.writeUInt16LE(1,   base + 4);  // color planes
    buf.writeUInt16LE(32,  base + 6);  // bits per pixel
    buf.writeUInt32LE(pngBuffers[i].length, base + 8);   // image size
    buf.writeUInt32LE(offsets[i],               base + 12); // offset
  }

  // Image data
  for (let i = 0; i < count; i++) {
    pngBuffers[i].copy(buf, offsets[i]);
  }

  return buf;
}

// ── List generated files ─────────────────────────────────────────────────────
async function listGenerated() {
  const fs = await import('node:fs');
  try {
    const files = fs.readdirSync(ICONS_DIR);
    for (const f of files.sort()) {
      const stat = fs.statSync(path.join(ICONS_DIR, f));
      if (stat.isFile()) {
        const kb = (stat.size / 1024).toFixed(1);
        console.log(`    ${f}  (${kb} KB)`);
      }
    }
  } catch (_) { /* ignore */ }
}

main().catch(err => {
  console.error('❌ Icon generation failed:', err.message);
  process.exit(1);
});
