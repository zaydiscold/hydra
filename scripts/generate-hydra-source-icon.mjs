#!/usr/bin/env node
/**
 * Generate Hydra's source app icon and favicon.
 *
 * The source image feeds scripts/generate-icons.mjs, which then produces the
 * macOS .icns, Windows .ico, and Linux PNG app icons.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const publicDir = path.join(ROOT, 'public');
const sourcePng = path.join(publicDir, 'hydra_dragon.png');
const faviconSvg = path.join(publicDir, 'favicon.svg');

const svg = String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="160" y1="96" x2="864" y2="928" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#07111f"/>
      <stop offset="0.48" stop-color="#11152a"/>
      <stop offset="1" stop-color="#020711"/>
    </linearGradient>
    <linearGradient id="ring" x1="184" y1="112" x2="850" y2="900" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#77fff1"/>
      <stop offset="0.48" stop-color="#eb3cff"/>
      <stop offset="1" stop-color="#7cf9ff"/>
    </linearGradient>
    <linearGradient id="cyan" x1="250" y1="214" x2="774" y2="808" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#b5fff7"/>
      <stop offset="0.55" stop-color="#31e6ff"/>
      <stop offset="1" stop-color="#1660ff"/>
    </linearGradient>
    <linearGradient id="magenta" x1="260" y1="220" x2="820" y2="816" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff8aff"/>
      <stop offset="0.52" stop-color="#ff2ed6"/>
      <stop offset="1" stop-color="#8029ff"/>
    </linearGradient>
    <filter id="softGlow" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="18" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.43 0 0 0 0 0.95 0 0 0 0 1 0 0 0 0.7 0"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="hotGlow" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="16" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 1 0 0 0 0 0.12 0 0 0 0 0.92 0 0 0 0.78 0"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="34" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>

  <rect width="1024" height="1024" rx="228" fill="transparent"/>
  <g filter="url(#shadow)">
    <rect x="94" y="94" width="836" height="836" rx="205" fill="url(#bg)"/>
    <rect x="126" y="126" width="772" height="772" rx="178" fill="none" stroke="url(#ring)" stroke-width="13" opacity="0.95"/>
    <rect x="156" y="156" width="712" height="712" rx="150" fill="none" stroke="#d8fbff" stroke-width="4" opacity="0.18"/>
  </g>

  <g opacity="0.4" stroke="#5ef7ff" stroke-width="4" fill="none">
    <path d="M192 702c118-78 217-113 345-99 107 12 194-19 296-91"/>
    <path d="M189 314c100 36 184 40 284 10 117-36 221-17 365 66"/>
    <path d="M290 184v655M733 201v628" opacity="0.24"/>
  </g>

  <g filter="url(#softGlow)" stroke-linecap="round" stroke-linejoin="round">
    <path d="M292 724V300" stroke="url(#cyan)" stroke-width="80"/>
    <path d="M732 724V300" stroke="url(#magenta)" stroke-width="80"/>
    <path d="M300 516h424" stroke="url(#ring)" stroke-width="78"/>
    <path d="M292 724V300M732 724V300M300 516h424" stroke="#07111f" stroke-width="30"/>
  </g>

  <g filter="url(#hotGlow)" stroke-linecap="round" stroke-linejoin="round">
    <path d="M256 385c40-80 103-123 186-129 71-5 111 31 128 84" fill="none" stroke="url(#cyan)" stroke-width="34"/>
    <path d="M518 344c42-70 97-103 164-99 60 4 99 42 112 92" fill="none" stroke="url(#magenta)" stroke-width="32"/>
    <path d="M368 548c50 91 122 138 214 137 91-1 157-49 196-143" fill="none" stroke="url(#ring)" stroke-width="36"/>
    <path d="M272 371l-82-38 74-22-30-68 83 53" fill="#07111f" stroke="url(#cyan)" stroke-width="23"/>
    <path d="M509 319l-72-70 84 10 20-78 34 88" fill="#07111f" stroke="url(#ring)" stroke-width="23"/>
    <path d="M778 324l83-54-31 70 77 20-93 41" fill="#07111f" stroke="url(#magenta)" stroke-width="23"/>
  </g>

  <g fill="#f6ffff">
    <circle cx="347" cy="328" r="16"/>
    <circle cx="600" cy="308" r="15"/>
    <circle cx="760" cy="357" r="14"/>
  </g>
  <g fill="#07111f" opacity="0.95">
    <path d="M218 385l74 18-59 27z"/>
    <path d="M488 370l70 14-52 31z"/>
    <path d="M810 405l74-11-55 43z"/>
  </g>

  <g stroke="#77fff1" stroke-width="12" stroke-linecap="round" opacity="0.78">
    <path d="M300 731c50 45 111 68 184 68"/>
    <path d="M720 731c-50 45-111 68-184 68"/>
  </g>
  <g fill="#ff42e7" opacity="0.78">
    <circle cx="214" cy="617" r="8"/>
    <circle cx="818" cy="602" r="7"/>
    <circle cx="682" cy="219" r="6"/>
  </g>
</svg>`;

mkdirSync(publicDir, { recursive: true });
writeFileSync(faviconSvg, svg);
await sharp(Buffer.from(svg)).png().toFile(sourcePng);
console.log(`[generate-hydra-source-icon] wrote ${sourcePng}`);
console.log(`[generate-hydra-source-icon] wrote ${faviconSvg}`);
