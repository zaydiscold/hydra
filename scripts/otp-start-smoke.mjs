#!/usr/bin/env node
/**
 * Smoke test: mint local JWT → GET /api/accounts → POST .../otp/start.
 * Requires a running API (default http://127.0.0.1:3001) and DATABASE_URL in env.
 *
 * Optional: HYDRA_OTP_CODE=123456 (digits only, spaces allowed) to also POST .../otp/verify
 * after start (uses code from the same email send as this run).
 *
 * Usage:
 *   node scripts/otp-start-smoke.mjs
 *   SMOKE_API_BASE=http://127.0.0.1:3001 HYDRA_OTP_CODE=123456 node scripts/otp-start-smoke.mjs
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { prisma } from '../server/services/db.js';
import { config } from '../server/config.js';

const base = process.env.SMOKE_API_BASE || 'http://127.0.0.1:3001';

const user = await prisma.user.findFirst();
if (!user) {
  console.error('otp-start-smoke: no user in database');
  process.exit(1);
}

const token = jwt.sign(
  { id: user.id, username: user.username, tokenVersion: user.tokenVersion },
  config.JWT_SECRET,
  { expiresIn: '1h' },
);

const listRes = await fetch(`${base}/api/accounts`, {
  headers: { Authorization: `Bearer ${token}` },
});

if (!listRes.ok) {
  console.error('otp-start-smoke: GET /api/accounts', listRes.status, await listRes.text());
  process.exit(1);
}

const listJson = await listRes.json();
const accounts = listJson.data;
if (!Array.isArray(accounts) || accounts.length === 0) {
  console.error('otp-start-smoke: no accounts');
  process.exit(1);
}

const withEmail = accounts.find((a) => a.email);
const account = withEmail || accounts[0];

const startRes = await fetch(`${base}/api/accounts/${account.id}/otp/start`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email: account.email || undefined }),
});

const startText = await startRes.text();
let startJson;
try {
  startJson = JSON.parse(startText);
} catch {
  console.error('otp-start-smoke: non-JSON from otp/start', startText);
  process.exit(1);
}

if (!startRes.ok || !startJson.success) {
  console.error('otp-start-smoke: otp/start failed', startRes.status, startJson);
  process.exit(1);
}

if (!startJson.data?.signInId) {
  console.error('otp-start-smoke: missing signInId', startJson);
  process.exit(1);
}

console.log('otp-start-smoke: start ok signInId=', startJson.data.signInId);

const rawCode = process.env.HYDRA_OTP_CODE;
if (rawCode && String(rawCode).replace(/\s/g, '').length >= 6) {
  const code = String(rawCode).replace(/\s/g, '');
  const verifyRes = await fetch(`${base}/api/accounts/${account.id}/otp/verify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signInId: startJson.data.signInId,
      code,
    }),
  });
  const verifyText = await verifyRes.text();
  let verifyJson;
  try {
    verifyJson = JSON.parse(verifyText);
  } catch {
    console.error('otp-start-smoke: verify non-JSON', verifyText);
    process.exit(1);
  }
  if (!verifyRes.ok || !verifyJson.success) {
    console.error('otp-start-smoke: verify failed', verifyRes.status, verifyJson);
    process.exit(1);
  }
  console.log('otp-start-smoke: verify ok sessionExpiry=', verifyJson.data?.sessionExpiry);
}

await prisma.$disconnect();
process.exit(0);
