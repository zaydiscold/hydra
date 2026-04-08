/**
 * redemption-log.js — P16
 * File-based append log for code redemption history.
 * Stores last 100 redemption records in data/redemption-log.json.
 * Never stores full code strings — only first 4 chars + ****.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
const LOG_PATH = join(DATA_DIR, 'redemption-log.json');
const MAX_RECORDS = 100;

function ensureDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Add a redemption record. Code is truncated to first 4 chars for display.
 * @param {{ code: string, accountId: string, accountAlias: string, success: boolean, message?: string, creditsAdded?: number }} record
 */
export function addRedemptionRecord({ code, accountId, accountAlias, success, message, creditsAdded }) {
  try {
    ensureDir();
    const existing = getRedemptionRecords();
    existing.unshift({
      codePreview: code ? `${code.slice(0, 4)}****` : '????',
      accountId: accountId ?? null,
      accountAlias: accountAlias ?? '—',
      success: !!success,
      message: message ?? null,
      creditsAdded: creditsAdded ?? null,
      at: new Date().toISOString(),
    });
    writeFileSync(LOG_PATH, JSON.stringify(existing.slice(0, MAX_RECORDS), null, 2), 'utf-8');
  } catch (err) {
    // Non-fatal — log write failures should never break the redemption flow
    console.warn('[REDEMPTION-LOG] Failed to write log:', err.message);
  }
}

/**
 * Read all stored redemption records (newest first).
 * @returns {Array}
 */
export function getRedemptionRecords() {
  if (!existsSync(LOG_PATH)) return [];
  try {
    return JSON.parse(readFileSync(LOG_PATH, 'utf-8'));
  } catch {
    return [];
  }
}
