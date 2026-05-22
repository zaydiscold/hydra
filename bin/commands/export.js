/**
 * `hydra export` — redacted closed-app fleet metadata export.
 *
 * Excludes decrypted management keys, API key plaintext, passwords, session
 * tokens, and client cookies. This is for operational handoff/audit, not a
 * restore-grade secret backup.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { json, status } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function valueFor(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : null;
}

function usage() {
  process.stdout.write(`Hydra export

  hydra export --json
  hydra export --out hydra-export.json

Exports redacted account, session, key, and proxy metadata.
Secrets are intentionally excluded.
`);
}

function parseMetadata(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { parseError: true };
  }
}

function redactKeyLikeLabel(value) {
  if (!value || typeof value !== 'string') return value ?? null;
  if (/sk-(?:or-v1|hydra|proj)-/i.test(value)) return '[redacted-key-label]';
  return value;
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  const wantJson = hasFlag(argv, '--json');
  const outPath = valueFor(argv, '--out');

  try {
    const { db, store } = await loadServices();
    const user = await resolveUser();
    const [{ proxyGate }, accounts, managementKeys, pooledKeys] = await Promise.all([
      import('../../server/services/proxy-gate.js'),
      store.getAccounts(user.id),
      db.prisma.managementKey.findMany({
        where: { account: { userId: user.id } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          accountId: true,
          name: true,
          status: true,
          metadata: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.prisma.key.findMany({
        where: { account: { userId: user.id } },
        orderBy: [{ isPooled: 'desc' }, { createdAt: 'desc' }],
        select: {
          hash: true,
          label: true,
          name: true,
          disabled: true,
          isPooled: true,
          limit: true,
          limitRemaining: true,
          limitReset: true,
          usage: true,
          usageMonthly: true,
          accountId: true,
          createdAt: true,
        },
      }),
    ]);

    const payload = {
      schema: 'hydra.redacted-export.v1',
      generatedAt: new Date().toISOString(),
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
      },
      summary: {
        accounts: accounts.length,
        activeSessions: accounts.filter((account) => account.sessionStatus === 'active').length,
        managementKeys: managementKeys.length,
        apiKeyRecords: pooledKeys.length,
        pooledKeys: pooledKeys.filter((key) => key.isPooled).length,
      },
      proxy: {
        gateEnabled: proxyGate.enabled,
        hydraKeyAvailable: Boolean(store.getMasterProxyKey()),
        genericKeyAvailable: Boolean(store.getGenericProxyKey()),
      },
      accounts: accounts.map((account) => ({
        id: account.id,
        alias: account.alias,
        email: account.email,
        authMethod: account.authMethod,
        sessionStatus: account.sessionStatus,
        sessionExpiry: account.sessionExpiry || null,
        sessionRefreshedAt: account.sessionRefreshedAt || null,
        lastLoginAt: account.lastLoginAt || null,
        hasManagementKey: account.hasManagementKey,
        passwordOnFile: account.passwordOnFile,
        createdAt: account.createdAt,
      })),
      managementKeys: managementKeys.map((key) => ({
        id: key.id,
        accountId: key.accountId,
        name: key.name,
        status: key.status,
        metadata: parseMetadata(key.metadata),
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
        updatedAt: key.updatedAt,
      })),
      apiKeys: pooledKeys.map((key) => ({
        hash: key.hash,
        accountId: key.accountId,
        label: redactKeyLikeLabel(key.label),
        name: redactKeyLikeLabel(key.name),
        disabled: key.disabled,
        isPooled: key.isPooled,
        limit: key.limit,
        limitRemaining: key.limitRemaining,
        limitReset: key.limitReset,
        usage: key.usage,
        usageMonthly: key.usageMonthly,
        createdAt: key.createdAt,
      })),
      redaction: {
        excluded: ['passwords', 'sessionToken', 'sessionCookie', 'clientCookie', 'clientCookies', 'encryptedKey', 'apiKeyPlaintext', 'proxyKeyPlaintext', 'key-shaped labels'],
      },
    };

    if (outPath) {
      const target = resolve(outPath);
      writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
      if (wantJson) json({ path: target, ...payload.summary });
      else status('ok', `Wrote redacted export to ${target}`);
      return;
    }

    json(payload);
  } finally {
    await shutdown();
  }
}
