/**
 * `hydra import <file>` — validate or import a redacted export.
 *
 * Redacted exports intentionally exclude session cookies, passwords,
 * management-key secrets, API-key plaintext, and proxy secrets. Confirmed
 * imports restore metadata only; they never recreate usable credentials.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { c, json, status } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function positional(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) continue;
    out.push(arg);
  }
  return out;
}

function usage() {
  process.stdout.write(`Hydra import

  hydra import <redacted-export.json> --dry-run
  hydra import <redacted-export.json> --dry-run --json
  hydra import <redacted-export.json> --yes
  hydra import <redacted-export.json> --yes --json

Validates or imports a hydra.redacted-export.v1 file. Confirmed imports restore
redacted metadata only; sessions, passwords, management-key secrets, proxy
secrets, and API-key plaintext remain absent.
`);
}

function assertArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
}

function validateNoSecrets(raw) {
  const forbidden = [
    [/sk-(?:or-v1|hydra|proj)-/i, 'key-shaped string'],
    [/__session=/i, 'raw __session cookie'],
    [/__client=/i, 'raw __client cookie'],
    [/"encryptedKey"\s*:/, 'encryptedKey field'],
    [/"sessionToken"\s*:/, 'sessionToken field'],
    [/"clientCookie"\s*:/, 'clientCookie field'],
    [/"clientCookies"\s*:/, 'clientCookies field'],
    [/"password"\s*:/, 'password field'],
  ];
  const hit = forbidden.find(([pattern]) => pattern.test(raw));
  if (hit) throw new Error(`Export contains forbidden secret material: ${hit[1]}`);
}

function validateExport(payload, raw) {
  validateNoSecrets(raw);
  if (payload?.schema !== 'hydra.redacted-export.v1') {
    throw new Error('Unsupported export schema. Expected hydra.redacted-export.v1');
  }
  assertArray(payload.accounts, 'accounts');
  assertArray(payload.managementKeys, 'managementKeys');
  assertArray(payload.apiKeys, 'apiKeys');
  if (!payload.summary || typeof payload.summary !== 'object') {
    throw new Error('summary is required');
  }
  if (Number(payload.summary.accounts) !== payload.accounts.length) {
    throw new Error('summary.accounts does not match accounts length');
  }
  if (Number(payload.summary.managementKeys) !== payload.managementKeys.length) {
    throw new Error('summary.managementKeys does not match managementKeys length');
  }
  if (Number(payload.summary.apiKeyRecords) !== payload.apiKeys.length) {
    throw new Error('summary.apiKeyRecords does not match apiKeys length');
  }
  return {
    schema: payload.schema,
    generatedAt: payload.generatedAt || null,
    accounts: payload.accounts.length,
    managementKeys: payload.managementKeys.length,
    apiKeyRecords: payload.apiKeys.length,
    activeSessions: Number(payload.summary.activeSessions || 0),
    pooledKeys: Number(payload.summary.pooledKeys || 0),
    redacted: true,
  };
}

function asDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function cleanOptionalString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function cleanJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function importRedactedMetadata(payload) {
  const { db } = await loadServices();
  const user = await resolveUser();
  const [{ encrypt, encryptConfig }] = await Promise.all([
    import('../../server/services/storage-codec.js'),
  ]);

  const report = {
    accountsCreated: 0,
    accountsUpdated: 0,
    apiKeysCreated: 0,
    apiKeysUpdated: 0,
    accountsSkipped: 0,
    apiKeysSkipped: 0,
    managementKeysSkipped: payload.managementKeys.length,
    secretsRestored: 0,
  };

  await db.prisma.$transaction(async (tx) => {
    for (const account of payload.accounts) {
      const id = cleanString(account.id);
      if (!id) continue;
      const alias = cleanString(account.alias, `imported-${id.slice(0, 8)}`);
      const email = cleanOptionalString(account.email);
      const authMethod = cleanOptionalString(account.authMethod);
      const existing = await tx.account.findFirst({ where: { id, userId: user.id } });
      const occupied = existing ? null : await tx.account.findUnique({ where: { id }, select: { userId: true } });
      if (occupied && occupied.userId !== user.id) {
        report.accountsSkipped += 1;
        continue;
      }
      const config = encryptConfig({
        email,
        authMethod,
        password: null,
        importedRedacted: true,
        importedAt: new Date().toISOString(),
        originalSessionStatus: cleanOptionalString(account.sessionStatus),
        originalSessionExpiry: cleanOptionalString(account.sessionExpiry),
        originalPasswordOnFile: Boolean(account.passwordOnFile),
      });
      const data = {
        alias,
        config,
        openRouterId: null,
        lastKnownBalance: null,
        totalCredits: null,
        lastKnownBalanceAt: null,
      };

      if (existing) {
        await tx.account.update({ where: { id }, data });
        report.accountsUpdated += 1;
      } else {
        await tx.account.create({
          data: {
            id,
            ...data,
            sessionToken: encrypt(''),
            userId: user.id,
            createdAt: asDateOrNull(account.createdAt) || undefined,
          },
        });
        report.accountsCreated += 1;
      }
    }

    for (const key of payload.apiKeys) {
      const hash = cleanString(key.hash);
      const accountId = cleanString(key.accountId);
      if (!hash || !accountId) continue;
      const account = await tx.account.findFirst({ where: { id: accountId, userId: user.id } });
      if (!account) {
        report.apiKeysSkipped += 1;
        continue;
      }
      const data = {
        accountId,
        key: null,
        label: cleanString(key.label, key.name || 'Imported redacted key'),
        name: cleanString(key.name, key.label || 'Imported redacted key'),
        disabled: true,
        isPooled: false,
        limit: typeof key.limit === 'number' ? key.limit : null,
        limitRemaining: typeof key.limitRemaining === 'number' ? key.limitRemaining : null,
        limitReset: cleanOptionalString(key.limitReset),
        usage: typeof key.usage === 'number' ? key.usage : null,
        usageMonthly: typeof key.usageMonthly === 'number' ? key.usageMonthly : null,
        isProvisioningKey: false,
      };
      const existing = await tx.key.findUnique({
        where: { hash },
        include: { account: { select: { userId: true } } },
      });
      if (existing && existing.account.userId !== user.id) {
        report.apiKeysSkipped += 1;
        continue;
      }
      if (existing) {
        await tx.key.update({ where: { hash }, data });
        report.apiKeysUpdated += 1;
      } else {
        await tx.key.create({
          data: {
            hash,
            ...data,
            createdAt: asDateOrNull(key.createdAt) || undefined,
          },
        });
        report.apiKeysCreated += 1;
      }
    }
  });

  return {
    ...report,
    redacted: true,
    managementKeyMetadataSeen: payload.managementKeys.length,
    note: 'Imported metadata only. Secrets, sessions, management keys, proxy keys, and API-key plaintext were not restored.',
    sourceSummary: cleanJsonObject(payload.summary),
  };
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }
  const wantJson = hasFlag(argv, '--json');
  const dryRun = hasFlag(argv, '--dry-run');
  const confirmed = hasFlag(argv, '--yes');
  const file = positional(argv)[0];

  if (!file) {
    process.stderr.write(`${c.err('✗')} import file is required\n`);
    usage();
    process.exitCode = 1;
    return;
  }
  if (!dryRun && !confirmed) {
    const message = 'CONFIRMATION_REQUIRED: redacted metadata imports require --yes; use --dry-run to validate without writing';
    if (wantJson) json({ ok: false, error: message, code: 'CONFIRMATION_REQUIRED' });
    else process.stderr.write(`${c.err('✗')} ${message}\n`);
    process.exitCode = 1;
    return;
  }

  let shouldShutdown = false;
  try {
    const target = resolve(file);
    const raw = readFileSync(target, 'utf-8');
    const payload = JSON.parse(raw);
    const report = { path: target, ...validateExport(payload, raw) };
    if (dryRun) {
      if (wantJson) json(report);
      else status('ok', `Valid redacted Hydra export: ${report.accounts} accounts, ${report.managementKeys} management keys, ${report.apiKeyRecords} API key records`);
      return;
    }

    shouldShutdown = true;
    const importReport = await importRedactedMetadata(payload);
    const result = { ...report, imported: true, ...importReport };
    if (wantJson) json(result);
    else status('ok', `Imported redacted metadata: ${importReport.accountsCreated} account(s) created, ${importReport.accountsUpdated} updated, ${importReport.apiKeysCreated} API key record(s) created, ${importReport.managementKeysSkipped} management key secret(s) skipped`);
  } catch (err) {
    if (wantJson) json({ ok: false, error: err.message });
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    if (shouldShutdown) await shutdown();
  }
}
