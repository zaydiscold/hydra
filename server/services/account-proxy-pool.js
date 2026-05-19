import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';

import { ensureDataDirSync, getDataDir, getDataPath } from '../lib/data-dir.js';
import { decryptConfig, encryptConfig } from './storage-codec.js';
import { logger } from './logger.js';

const PROXY_POOL_PATH = getDataPath('account-proxies.json.enc');
const PROXY_LINE_RE = /^([^:\s]+):(\d{1,5}):([^:\s]+):(.+)$/;

function fsyncDataDirBestEffort() {
  let fd = null;
  try {
    fd = openSync(getDataDir(), 'r');
    fsyncSync(fd);
  } catch (err) {
    logger.warn(`[ACCOUNT_PROXY_POOL] Directory fsync skipped: ${err?.message || err}`);
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch (err) {
        logger.warn(`[ACCOUNT_PROXY_POOL] Directory fsync handle close failed: ${err?.message || err}`);
      }
    }
  }
}

function atomicWriteOwnerOnly(path, text) {
  ensureDataDirSync();
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;
  let fd = null;
  try {
    fd = openSync(tempPath, 'wx', 0o600);
    writeSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, path);
    try {
      chmodSync(path, 0o600);
    } catch (err) {
      logger.warn(`[ACCOUNT_PROXY_POOL] chmod failed for ${path}: ${err?.message || err}`);
    }
    fsyncDataDirBestEffort();
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch (closeErr) {
        logger.warn(`[ACCOUNT_PROXY_POOL] Temp file close failed for ${tempPath}: ${closeErr?.message || closeErr}`);
      }
    }
    try {
      unlinkSync(tempPath);
    } catch (unlinkErr) {
      if (unlinkErr?.code !== 'ENOENT') {
        logger.warn(`[ACCOUNT_PROXY_POOL] Temp file cleanup failed for ${tempPath}: ${unlinkErr?.message || unlinkErr}`);
      }
    }
    throw err;
  }
}

export function parseProxyLine(line) {
  const raw = String(line || '').trim();
  const match = raw.match(PROXY_LINE_RE);
  if (!match) {
    const err = new Error('Proxy must use ip:port:user:pass format');
    err.code = 'INVALID_ACCOUNT_PROXY';
    throw err;
  }

  const [, host, portText, username, password] = match;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const err = new Error(`Proxy port must be between 1 and 65535: ${host}:${portText}`);
    err.code = 'INVALID_ACCOUNT_PROXY_PORT';
    throw err;
  }

  return {
    raw,
    host,
    port,
    username,
    password,
    server: `http://${host}:${port}`,
  };
}

export function parseProxyLines(text) {
  const proxies = [];
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let proxy;
    try {
      proxy = parseProxyLine(trimmed);
    } catch (err) {
      err.message = `Line ${index + 1}: ${err.message}`;
      throw err;
    }
    if (seen.has(proxy.raw)) continue;
    seen.add(proxy.raw);
    proxies.push(proxy);
  }

  return proxies;
}

function maskCredential(value) {
  const text = String(value || '');
  if (text.length <= 2) return '*'.repeat(text.length || 1);
  return `${text.slice(0, 1)}${'*'.repeat(Math.min(6, text.length - 2))}${text.slice(-1)}`;
}

export function describeProxy(proxy) {
  if (!proxy) return null;
  return `${proxy.host}:${proxy.port}:${maskCredential(proxy.username)}:${maskCredential(proxy.password)}`;
}

function publicProxy(proxy) {
  return {
    host: proxy.host,
    port: proxy.port,
    username: maskCredential(proxy.username),
    masked: describeProxy(proxy),
  };
}

function loadStoredLines() {
  if (!existsSync(PROXY_POOL_PATH)) return [];
  const encrypted = readFileSync(PROXY_POOL_PATH, 'utf8').trim();
  const parsed = decryptConfig(encrypted);
  if (!Array.isArray(parsed.lines)) return [];
  return parsed.lines.filter((line) => typeof line === 'string');
}

export function getAccountProxyPool() {
  const lines = loadStoredLines();
  const proxies = parseProxyLines(lines.join('\n'));
  return {
    count: proxies.length,
    lines: lines.join('\n'),
    proxies: proxies.map(publicProxy),
  };
}

export function setAccountProxyPool(text) {
  const proxies = parseProxyLines(text);
  const lines = proxies.map((proxy) => proxy.raw);
  atomicWriteOwnerOnly(PROXY_POOL_PATH, `${encryptConfig({ lines, updatedAt: new Date().toISOString() })}\n`);
  return {
    count: proxies.length,
    lines: lines.join('\n'),
    proxies: proxies.map(publicProxy),
  };
}

export function pickAccountProxy() {
  const proxies = parseProxyLines(loadStoredLines().join('\n'));
  if (proxies.length === 0) return null;
  const index = randomBytes(4).readUInt32BE(0) % proxies.length;
  return proxies[index];
}

export function toPlaywrightProxy(proxy) {
  if (!proxy) return undefined;
  return {
    server: proxy.server,
    username: proxy.username,
    password: proxy.password,
  };
}
