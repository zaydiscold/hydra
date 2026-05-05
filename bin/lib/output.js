/**
 * Hydra CLI — output helpers.
 *
 * Pattern lifted from steipete/bird (subcommand-first, JSON-pipeable):
 *   - Pretty by default, `--json` for machine output.
 *   - Status prefixes (`✓`, `⚠`, `✗`) with `--no-emoji` opt-out.
 *   - Color via ANSI codes; respects NO_COLOR env + non-TTY stdout.
 *   - No deps.
 */
import { styleText } from 'node:util';

const isTTY = process.stdout.isTTY === true;
const noColor = process.env.NO_COLOR != null || process.env.TERM === 'dumb';
const colorOn = isTTY && !noColor;

/** Wrap a string in an ANSI style if color is enabled. */
function tint(style, str) {
  if (!colorOn) return str;
  // node:util.styleText handles the actual ANSI; falls back to identity if unavailable.
  try { return styleText(style, str); }
  catch { return str; }
}

export const c = {
  ok: (s) => tint('green', s),
  warn: (s) => tint('yellow', s),
  err: (s) => tint('red', s),
  dim: (s) => tint('dim', s),
  bold: (s) => tint('bold', s),
  cyan: (s) => tint('cyan', s),
  magenta: (s) => tint('magenta', s),
};

export const STATUS = {
  ok: '✓',
  warn: '⚠',
  err: '✗',
  info: 'ℹ',
};

/**
 * Render an array of objects as an ASCII table. Columns auto-size to widest
 * cell. Headers are passed as the second arg in the order you want them.
 *
 * @example
 *   table(rows, [
 *     { key: 'id', label: 'ID' },
 *     { key: 'email', label: 'EMAIL' },
 *     { key: 'balance', label: 'BAL', align: 'right', fmt: (v) => '$' + v.toFixed(2) },
 *   ]);
 */
export function table(rows, columns) {
  if (rows.length === 0) {
    process.stdout.write(c.dim('  (no rows)\n'));
    return;
  }

  // Compute widths
  const widths = columns.map(col => {
    const headerWidth = col.label.length;
    const cellMax = rows.reduce((max, row) => {
      const formatted = formatCell(row[col.key], col);
      return Math.max(max, stripAnsi(formatted).length);
    }, 0);
    return Math.max(headerWidth, cellMax);
  });

  // Render header
  const headerLine = columns
    .map((col, i) => padCell(col.label, widths[i], col.align || 'left'))
    .join('  ');
  process.stdout.write(c.bold(headerLine) + '\n');

  // Render rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const formatted = formatCell(row[col.key], col);
        return padCell(formatted, widths[i], col.align || 'left');
      })
      .join('  ');
    process.stdout.write(line + '\n');
  }
}

function formatCell(value, col) {
  if (value == null) return col.empty ?? c.dim('—');
  if (col.fmt) return String(col.fmt(value));
  return String(value);
}

function padCell(s, width, align) {
  const visibleLen = stripAnsi(s).length;
  const padLen = Math.max(0, width - visibleLen);
  if (align === 'right') return ' '.repeat(padLen) + s;
  return s + ' '.repeat(padLen);
}

function stripAnsi(s) {
  // Remove CSI sequences (ESC [ ... m). Good enough for column width math.
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Print a one-line status with prefix. */
export function status(kind, msg) {
  const prefix = STATUS[kind] || STATUS.info;
  const colored = kind === 'ok' ? c.ok(prefix)
    : kind === 'warn' ? c.warn(prefix)
    : kind === 'err' ? c.err(prefix)
    : c.dim(prefix);
  const target = kind === 'err' ? process.stderr : process.stdout;
  target.write(`${colored} ${msg}\n`);
}

/** Print as JSON. Always to stdout. */
export function json(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/** Format a USD-ish balance ($x.xx) or em-dash if missing. */
export function fmtBalance(v) {
  if (v == null || Number.isNaN(v)) return c.dim('—');
  return '$' + Number(v).toFixed(2);
}

/** Format account-age in days/hours since the createdAt timestamp. */
export function fmtAge(createdAt) {
  if (!createdAt) return c.dim('—');
  const ms = Date.now() - new Date(createdAt).getTime();
  if (ms < 0) return c.dim('—');
  const hours = ms / 3_600_000;
  if (hours < 24) return Math.floor(hours) + 'h';
  return Math.floor(hours / 24) + 'd';
}

/** Health pip — status-color-coded ●. */
export function fmtHealth(status) {
  if (status === 'healthy' || status === 'active' || status === 'ok') return c.ok('●');
  if (status === 'expiring' || status === 'partial') return c.warn('◐');
  if (status === 'expired' || status === 'dead') return c.err('○');
  return c.dim('?');
}
