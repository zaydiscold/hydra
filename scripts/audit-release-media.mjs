#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const mediaFiles = [
  'videos/assets/vault.png',
  'videos/assets/dashboard.png',
  'videos/assets/pool.png',
  'videos/assets/traffic.png',
  'videos/remotion-project/public/vault.png',
  'videos/remotion-project/public/dashboard.png',
  'videos/remotion-project/public/pool.png',
  'videos/remotion-project/public/traffic.png',
  'videos/hydra_showreel.gif',
  'videos/hydra_showreel.mp4',
];

const suspiciousPatterns = [
  { id: 'openrouter-key', pattern: /\bsk-or-v1-[a-z0-9_-]{12,}\b/i },
  { id: 'hydra-proxy-key', pattern: /\bsk-(?:hydra|proj)-[a-z0-9_-]{12,}\b/i },
  { id: 'jwt', pattern: /\beyJ[a-z0-9_-]{12,}\.[a-z0-9_-]{12,}\.[a-z0-9_-]{12,}\b/i },
  { id: 'clerk-session', pattern: /\bsess_[a-z0-9_-]{12,}\b/i },
  { id: 'uuid', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i },
  { id: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    ...options,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

function commandExists(command) {
  return run('sh', ['-c', `command -v ${command}`]).ok;
}

function scanText(text) {
  const matches = [];
  for (const { id, pattern } of suspiciousPatterns) {
    const match = text.match(pattern);
    if (match) matches.push({ id, sample: redact(match[0]) });
  }
  return matches;
}

function redact(value) {
  if (value.includes('@')) return value.replace(/^(.).+(@.+)$/, '$1***$2');
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function fileStrings(path) {
  const result = run('strings', [path], { maxBuffer: 8 * 1024 * 1024 });
  return result.ok ? result.stdout : '';
}

function ocrImage(path, tesseractAvailable) {
  if (!tesseractAvailable || !path.endsWith('.png')) return { skipped: true, text: '' };
  const tempDir = mkdtempSync(join(tmpdir(), 'hydra-media-ocr-'));
  const outBase = join(tempDir, 'ocr');
  try {
    const result = run('tesseract', [path, outBase, '--psm', '6'], { timeout: 60_000 });
    if (!result.ok) return { skipped: false, error: (result.stderr || result.error?.message || 'tesseract failed').trim() };
    return { skipped: false, text: readFileSync(`${outBase}.txt`, 'utf8') };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function dimensions(path) {
  const result = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path]);
  if (!result.ok) return null;
  const width = result.stdout.match(/pixelWidth:\s*(\d+)/)?.[1];
  const height = result.stdout.match(/pixelHeight:\s*(\d+)/)?.[1];
  return width && height ? { width: Number(width), height: Number(height) } : null;
}

const flags = new Set(process.argv.slice(2));
const writeJson = flags.has('--json');
const tesseractAvailable = commandExists('tesseract');

const results = [];
for (const relative of mediaFiles) {
  const path = join(ROOT, relative);
  const exists = existsSync(path);
  const result = {
    path: relative,
    exists,
    sizeBytes: exists ? statSync(path).size : 0,
    dimensions: exists ? dimensions(path) : null,
    checks: [],
  };

  if (exists) {
    const embeddedMatches = scanText(fileStrings(path));
    if (embeddedMatches.length) result.checks.push({ source: 'strings', matches: embeddedMatches });

    const ocr = ocrImage(path, tesseractAvailable);
    if (ocr.error) {
      result.checks.push({ source: 'ocr', warning: ocr.error.slice(0, 500) });
    } else if (!ocr.skipped) {
      const ocrMatches = scanText(ocr.text);
      if (ocrMatches.length) result.checks.push({ source: 'ocr', matches: ocrMatches });
    }
  }

  results.push(result);
}

const missing = results.filter((item) => !item.exists);
const leaks = results.flatMap((item) => item.checks
  .filter((check) => check.matches?.length)
  .map((check) => ({ path: item.path, source: check.source, matches: check.matches })));
const warnings = results.flatMap((item) => item.checks
  .filter((check) => check.warning)
  .map((check) => ({ path: item.path, source: check.source, warning: check.warning })));

const report = {
  schema: 'hydra.release-media-audit.v1',
  generatedAt: new Date().toISOString(),
  tesseractAvailable,
  checked: results.length,
  missing: missing.map((item) => item.path),
  leaks,
  warnings,
  complete: missing.length === 0 && leaks.length === 0,
  files: results,
};

if (writeJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Hydra release media audit');
  console.log(`checked=${report.checked} missing=${report.missing.length} leaks=${report.leaks.length} warnings=${report.warnings.length}`);
  for (const item of results) {
    const dims = item.dimensions ? `${item.dimensions.width}x${item.dimensions.height}` : 'unknown';
    console.log(`${item.exists ? 'OK' : 'WAIT'} ${item.path} ${item.exists ? `${Math.round(item.sizeBytes / 1024)} KB ${dims}` : 'missing'}`);
  }
  for (const leak of leaks) {
    console.log(`LEAK ${leak.path} ${leak.source}: ${leak.matches.map((match) => `${match.id}=${match.sample}`).join(', ')}`);
  }
  for (const warning of warnings) {
    console.log(`WARN ${warning.path} ${warning.source}: ${warning.warning}`);
  }
}

if (!report.complete) process.exitCode = 1;
