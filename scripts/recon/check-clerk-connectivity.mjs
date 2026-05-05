#!/usr/bin/env node
/**
 * Quick HTTPS check: can this machine reach Clerk FAPI and see Set-Cookie headers?
 * Uses the same Origin/Referer defaults as Hydra (override with CLERK_ORIGIN / CLERK_REFERER in .env).
 */
import 'dotenv/config';
import https from 'node:https';
import { URL } from 'node:url';

const CLERK_BASE = 'https://clerk.openrouter.ai/v1';
const origin = process.env.CLERK_ORIGIN || 'https://openrouter.ai';
const referer = process.env.CLERK_REFERER || 'https://openrouter.ai/sign-in';

const u = new URL(`${CLERK_BASE}/client`);
u.searchParams.set('_clerk_js_version', '5.0.0');

const req = https.request(
  {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Hydra clerk connectivity check)',
      Origin: origin,
      Referer: referer,
    },
  },
  (res) => {
    res.resume();
    const raw = res.headers['set-cookie'];
    const lines = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    const names = lines.map((l) => l.split('=')[0]?.trim()).filter(Boolean);
    console.log(`GET ${u.href}`);
    console.log(`HTTP ${res.statusCode}`);
    console.log(`Set-Cookie header count: ${lines.length}`);
    console.log(`Cookie names: ${names.length ? names.join(', ') : '(none)'}`);
    if (names.includes('__client')) {
      console.log('OK: __client present (typical bootstrap cookie).');
    } else if (lines.length === 0) {
      console.warn(
        'Warning: no Set-Cookie — proxy/VPN/SSL inspection may be stripping headers, or Clerk returned an error body.',
      );
    }
    process.exit(res.statusCode && res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
  },
);

req.on('error', (err) => {
  console.error('Request failed:', err.message);
  process.exit(1);
});

req.end();
