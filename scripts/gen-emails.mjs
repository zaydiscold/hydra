#!/usr/bin/env node
/**
 * gen-emails.mjs
 * Generate email forwarding aliases for use as OpenRouter account emails.
 *
 * Usage:
 *   node scripts/gen-emails.mjs                        # generate 35 curated aliases at zayd.wtf
 *   node scripts/gen-emails.mjs *@zayd.wtf             # generate 1 random alias at zayd.wtf
 *   node scripts/gen-emails.mjs *@zayd.wtf 20          # generate 20 random aliases at zayd.wtf
 *   node scripts/gen-emails.mjs *@preheat.cc 10        # generate 10 random at preheat.cc
 *   node scripts/gen-emails.mjs --plain                # one-per-line output (no table, paste-ready)
 *
 * All addresses should be added via Cloudflare Email Routing.
 * Free tier: up to 200 routes per domain.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Username pools ────────────────────────────────────────────────────────────

const CURATED = [
  // cyberpunk
  'neonpulse', 'voidcraft', 'hexshift', 'bytewarden', 'signalfault',
  'glitchwave', 'nullvector', 'kernelpanic', 'cryptoflare', 'dataraven',
  // absurdist
  'blandocelot', 'crispynull', 'softwrench', 'gentlemalware', 'blurrylogic',
  'mildreboot', 'softcorrupt', 'tangentialerror', 'slightlybroken', 'ambiguousbit',
  // old-internet
  'dialup_ghost', 'pingpogger', 'buffering_dreams', 'aol_refugee', 'modemwhisperer',
  'fourohfour', 'geocitiessurvivor', 'flashbackflash', 'netscapenavigator', 'clippy_lives',
  // short/memo
  'coldvault', 'inkframe', 'zapbyte', 'deepecho', 'ironfolio',
];

const RANDOM_WORDS = [
  'azure', 'cipher', 'comet', 'cosmic', 'crystal', 'cyber', 'delta', 'echo',
  'ember', 'flash', 'frost', 'ghost', 'helix', 'ion', 'jade', 'karma',
  'laser', 'lunar', 'mango', 'matrix', 'nexus', 'nova', 'onyx', 'orbit',
  'pixel', 'plasma', 'prism', 'pulse', 'quartz', 'raven', 'sigma', 'solar',
  'sonic', 'spark', 'storm', 'swift', 'titan', 'turbo', 'ultra', 'vapor',
  'vector', 'venom', 'vibe', 'void', 'wave', 'xenon', 'zeal', 'zero', 'zeta',
  'drift', 'flare', 'forge', 'glyph', 'haze', 'invoke', 'kite', 'loop',
  'moss', 'node', 'peak', 'rift', 'salt', 'shade', 'tide', 'trace',
];

function randomUsername() {
  const word = RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)];
  const suffix = String(Math.floor(Math.random() * 9000) + 1000);
  return `${word}${suffix}`;
}

function generateRandom(domain, count) {
  const seen = new Set();
  const result = [];
  while (result.length < count) {
    const u = randomUsername();
    const email = `${u}@${domain}`;
    if (!seen.has(email)) { seen.add(email); result.push(email); }
  }
  return result;
}

// ─── CLI parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const plainMode = args.includes('--plain');
const filtered = args.filter(a => a !== '--plain');

// Detect *@domain pattern
const FORWARD_TO = 'zaydkhan3@gmail.com';
let emails;
let domainUsed = 'zayd.wtf';

const wildcardArg = filtered.find(a => a.startsWith('*@'));
if (wildcardArg) {
  const domain = wildcardArg.slice(2);
  const count = parseInt(filtered.find(a => /^\d+$/.test(a)) ?? '1', 10);
  domainUsed = domain;
  emails = generateRandom(domain, count);
} else {
  // Default: curated 35
  emails = CURATED.slice(0, 35).map(u => `${u}@${domainUsed}`);
}

// ─── Output ────────────────────────────────────────────────────────────────────

if (plainMode) {
  // Plain one-per-line — paste directly into BulkAuthWizard or Cloudflare
  emails.forEach(e => console.log(e));
} else {
  console.log(`\n=== ${emails.length} email alias${emails.length === 1 ? '' : 'es'} @ ${domainUsed} ===\n`);
  console.log(`Forward target: ${FORWARD_TO}\n`);
  emails.forEach((e, i) => console.log(`  ${String(i + 1).padStart(2, '0')}. ${e}`));
  console.log('');

  // Write docs if it's the default curated run or an explicit bulk run (not just 1 alias)
  if (emails.length > 1) {
    const now = new Date().toISOString().slice(0, 10);
    const tableRows = emails.map((e, i) =>
      `| ${String(i + 1).padStart(2)} | \`${e}\` | ${FORWARD_TO} | pending |`
    ).join('\n');

    const doc = `# Generated Email Aliases

Generated: ${now}
Domain: \`${domainUsed}\`
Forward to: \`${FORWARD_TO}\`
Total: ${emails.length}

## Setup

Add each alias via **Cloudflare Dashboard → Email → Email Routing → Add address**.
Free tier: up to 200 routes per domain. No MX changes needed if domain is already on Cloudflare.

## One-per-line (paste into BulkAuthWizard)

\`\`\`
${emails.join('\n')}
\`\`\`

## Table

| # | Address | Forwards To | Status |
|---|---------|-------------|--------|
${tableRows}

## Cloudflare bulk-add (API)

\`\`\`bash
# CF_API_TOKEN=your_token
# CF_ZONE_ID=your_${domainUsed}_zone_id

${emails.map(e => `curl -s -X POST "https://api.cloudflare.com/client/v4/zones/\${CF_ZONE_ID}/email/routing/rules" \\
  -H "Authorization: Bearer \${CF_API_TOKEN}" -H "Content-Type: application/json" \\
  -d '{"matchers":[{"type":"literal","field":"to","value":"${e}"}],"actions":[{"type":"forward","value":["${FORWARD_TO}"]}],"enabled":true}'`).join('\n\n')}
\`\`\`
`;

    const outPath = path.join(ROOT, 'docs', 'generated-emails.md');
    writeFileSync(outPath, doc, 'utf8');
    console.log(`Wrote ${outPath}`);
  }
}
