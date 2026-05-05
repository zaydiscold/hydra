#!/usr/bin/env node
/**
 * session-lifetime-probe.js
 *
 * Standalone probe that polls GET /v1/client at a fixed interval using a
 * real __client cookie to measure the actual Clerk session lifetime.
 *
 * Usage:
 *   node server/scripts/session-lifetime-probe.js \
 *     --cookie "__client=xxxx" \
 *     --interval 360     # poll frequency in minutes (default 360 = 6 h)
 *     --out docs/recon/SESSION_LIFETIME_RESULTS.md
 *
 * The script logs to stdout AND appends timestamped rows to the output file.
 * Kill it with Ctrl-C when you have your answer.
 */

import { parseArgs } from 'node:util';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── CLI args ──────────────────────────────────────────────────────────────────
const { values } = parseArgs({
  options: {
    cookie:   { type: 'string' },   // raw cookie header value, e.g. "__client=eyJ..."
    interval: { type: 'string', default: '360' }, // minutes between probes
    out:      { type: 'string', default: 'docs/recon/SESSION_LIFETIME_RESULTS.md' },
  },
  allowPositionals: true,
});

if (!values.cookie) {
  console.error('[probe] --cookie is required. Copy the __client cookie value from DevTools → Application → Cookies.');
  process.exit(1);
}

const COOKIE_HEADER  = values.cookie;
const INTERVAL_MS    = parseInt(values.interval, 10) * 60 * 1000;
const OUT_PATH       = resolve(process.env.HYDRA_DATA_DIR || process.cwd(), values.out);
const CLERK_FRONTEND = 'https://clerk.openrouter.ai'; // adjust if different env

// ── Output file bootstrap ─────────────────────────────────────────────────────
if (!existsSync(OUT_PATH)) {
  writeFileSync(OUT_PATH, [
    '# Clerk Session Lifetime Probe Results',
    '',
    `Started: ${new Date().toISOString()}`,
    `Cookie (first 40 chars): ${COOKIE_HEADER.slice(0, 40)}...`,
    `Poll interval: ${values.interval} minutes`,
    '',
    '| Timestamp (UTC) | Elapsed | Status | HTTP | Notes |',
    '|---|---|---|---|---|',
  ].join('\n') + '\n');
  console.log(`[probe] Created output file: ${OUT_PATH}`);
}

const startMs = Date.now();

function elapsed() {
  const ms = Date.now() - startMs;
  const h  = Math.floor(ms / 3600000);
  const m  = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// ── Probe function ────────────────────────────────────────────────────────────
async function probe() {
  const now = new Date().toISOString();
  let httpStatus = '?';
  let status = 'unknown';
  let notes = '';

  try {
    const res = await fetch(`${CLERK_FRONTEND}/v1/client`, {
      headers: {
        'Cookie': COOKIE_HEADER,
        'Accept': 'application/json',
        'User-Agent': 'HydraSessionProbe/1.0',
      },
    });
    httpStatus = res.status;

    if (res.status === 200) {
      const body = await res.json();
      // Clerk returns { response: { sessions: [...] } }
      const sessions = body?.response?.sessions ?? [];
      const active = sessions.find((s) => s.status === 'active');
      if (active) {
        status = 'active';
        const expire = active.expire_at
          ? new Date(active.expire_at * 1000).toISOString()
          : 'unknown';
        notes = `session_id=${active.id} expire_at=${expire}`;
      } else {
        status = 'no-active-session';
        notes = `sessions in response: ${sessions.length}`;
      }
    } else if (res.status === 401 || res.status === 403) {
      status = 'expired';
      notes = `Clerk rejected the cookie (${res.status})`;
    } else {
      status = `http-${res.status}`;
      notes = res.statusText;
    }
  } catch (err) {
    status = 'error';
    notes = err.message;
  }

  const elap = elapsed();
  const row = `| ${now} | ${elap} | ${status} | ${httpStatus} | ${notes} |`;
  console.log(`[probe] ${now} | elapsed=${elap} | status=${status} | http=${httpStatus} | ${notes}`);
  appendFileSync(OUT_PATH, row + '\n');

  if (status === 'expired' || status === 'no-active-session') {
    const summary = `\n**Session confirmed dead at ${now} (elapsed: ${elap})**\n`;
    appendFileSync(OUT_PATH, summary);
    console.log('[probe] ⚠️  Session is dead. Stopping probe.');
    process.exit(0);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
console.log(`[probe] Starting. Poll every ${values.interval} min → ${OUT_PATH}`);
console.log(`[probe] Cookie prefix: ${COOKIE_HEADER.slice(0, 60)}...`);

probe(); // fire immediately
setInterval(probe, INTERVAL_MS);
