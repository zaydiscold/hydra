/**
 * Prisma error classifier — maps cryptic ORM errors to one-line, actionable messages.
 *
 * Usage:
 *   import { classifyPrismaError } from './lib/prisma-error.js';
 *   try { await prisma.requestLog.findMany(...); }
 *   catch (err) {
 *     const { tag, summary, fix } = classifyPrismaError(err);
 *     logger.error(`[${tag}] ${summary}${fix ? ' — fix: ' + fix : ''}`);
 *   }
 *
 * Reference: https://www.prisma.io/docs/orm/reference/error-reference
 */

const CODES = {
  // Schema drift / DB-vs-schema mismatch
  P2021: { tag: 'DB_SCHEMA', summary: 'table does not exist', fix: 'run `npm run pretest` (prisma db push) or relaunch the app to trigger schema sync' },
  P2022: { tag: 'DB_SCHEMA', summary: 'column does not exist', fix: 'run `npm run pretest` (prisma db push) or relaunch the app to trigger schema sync' },

  // Constraint violations
  P2002: { tag: 'DB_CONFLICT', summary: 'unique constraint violation', fix: 'check duplicate values in input data' },
  P2003: { tag: 'DB_CONFLICT', summary: 'foreign key constraint violation', fix: 'verify referenced record exists' },
  P2014: { tag: 'DB_CONFLICT', summary: 'relational constraint violation', fix: 'check related record cardinality' },

  // Lookup failures
  P2025: { tag: 'DB_NOT_FOUND', summary: 'record not found', fix: 'verify the id/where clause' },

  // Connection / runtime
  P1000: { tag: 'DB_AUTH', summary: 'database authentication failed', fix: 'check DATABASE_URL credentials' },
  P1001: { tag: 'DB_CONN', summary: 'cannot reach database', fix: 'check DATABASE_URL host/port' },
  P1008: { tag: 'DB_TIMEOUT', summary: 'query timeout', fix: 'add an index or paginate results' },
  P1017: { tag: 'DB_CONN', summary: 'connection closed by server', fix: 'reconnect; if recurring, check pool size' },
};

/**
 * Classify a thrown Prisma error.
 * @param {Error} err - the caught error
 * @returns {{tag: string, summary: string, fix?: string, code?: string, raw: string, columnHint?: string}}
 */
export function classifyPrismaError(err) {
  const raw = err?.message || String(err);
  const code = err?.code;

  // First: known Prisma error codes
  if (code && CODES[code]) {
    const known = CODES[code];
    // For P2022, try to extract the column name from the message
    let extra = {};
    if (code === 'P2022') {
      const m = raw.match(/column\s+`?([\w.]+)`?\s+does not exist/i);
      if (m) extra.columnHint = m[1];
    } else if (code === 'P2021') {
      const m = raw.match(/table\s+`?([\w.]+)`?\s+does not exist/i);
      if (m) extra.columnHint = m[1];
    }
    return { ...known, code, raw, ...extra };
  }

  // Second: pattern-match the message text for unknown-code errors
  // Prisma sometimes throws PrismaClientKnownRequestError without a `.code`,
  // or PrismaClientValidationError where the message is the only signal.
  if (/column\s+.+?does not exist/i.test(raw)) {
    const m = raw.match(/column\s+`?([\w.]+)`?\s+does not exist/i);
    return {
      tag: 'DB_SCHEMA',
      summary: 'column does not exist',
      fix: 'relaunch the app or run `npx prisma db push` to apply schema',
      code: code || 'P2022?',
      raw,
      columnHint: m?.[1],
    };
  }

  if (/no such table/i.test(raw)) {
    return { tag: 'DB_SCHEMA', summary: 'table does not exist', fix: 'run `npx prisma db push`', code: code || 'P2021?', raw };
  }

  // Unknown
  return { tag: 'DB_ERROR', summary: 'prisma error', code, raw };
}

/**
 * Format a classified error as a single log line.
 * @example "[DB_SCHEMA] RequestLog.clientHint column missing — fix: relaunch the app..."
 */
export function formatPrismaError(err, context = '') {
  const c = classifyPrismaError(err);
  const ctx = context ? ` ${context}:` : '';
  const detail = c.columnHint ? ` ${c.columnHint}` : '';
  const fix = c.fix ? ` — fix: ${c.fix}` : '';
  return `[${c.tag}]${ctx} ${c.summary}${detail}${fix}`;
}
