/**
 * `hydra ai models` — closed-app model catalog read.
 *
 * Reads Hydra's CachedModel table directly. No Electron, no Express, no
 * OpenRouter request, and no proxy/API key required.
 */
import { c, json, table } from '../lib/output.js';
import { loadServices, shutdown } from '../lib/services.js';
import {
  extractAssistantText,
  requestOpenRouter,
  resolveOpenRouterKey,
} from './openrouter.js';

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function valueFor(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}

function valuesAfterAction(argv) {
  const values = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      i += valueFor(argv, arg) != null && !['--json', '--quiet'].includes(arg) ? 1 : 0;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function usage() {
  process.stdout.write(`Hydra AI

  hydra ai chat "prompt"
  hydra ai chat "prompt" --model anthropic/claude-sonnet-4-5-20250514
  hydra ai chat "prompt" --base-url http://localhost:3001/v1 --key sk-hydra-...
  hydra ai chat "prompt" --route auto|proxy|direct
  hydra ai chat "prompt" --route direct --openrouter-key sk-or-v1-...
  hydra ai chat "prompt" --timeout-ms 60000
  hydra ai chat "prompt" --json
  hydra ai models
  hydra ai models --json
  hydra ai models --filter claude
  hydra ai models --limit 25

models reads the local cached model catalog while Hydra is closed.
chat defaults to auto routing: local Hydra /v1 first, then direct OpenRouter
when OPENROUTER_API_KEY or --openrouter-key is available. Use --route proxy or
--route direct for deterministic behavior.
`);
}

function positiveLimit(raw) {
  if (raw == null) return 50;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    const err = new Error(`invalid --limit value: ${raw}`);
    err.code = 'INVALID_LIMIT';
    throw err;
  }
  return n;
}

function numericFlag(raw, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, name }) {
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    const err = new Error(`invalid ${name} value: ${raw}`);
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  return value;
}

function normalizeBaseUrl(raw) {
  const value = (raw || process.env.HYDRA_BASE_URL || `http://localhost:${process.env.HYDRA_PORT || process.env.PORT || 3001}/v1`).trim();
  return value.replace(/\/+$/, '');
}

async function resolveProxyKey(argv) {
  const explicit = (valueFor(argv, '--key') || process.env.HYDRA_PROXY_KEY || process.env.OPENAI_API_KEY || '').trim();
  if (explicit) return { key: explicit, source: valueFor(argv, '--key') ? 'flag' : 'env' };

  const { store } = await loadServices();
  return { key: store.getMasterProxyKey(), source: 'local-vault' };
}

function normalizeRoute(raw) {
  const route = (raw || process.env.HYDRA_AI_ROUTE || 'auto').trim().toLowerCase();
  if (!['auto', 'proxy', 'direct'].includes(route)) {
    const err = new Error(`invalid --route value: ${raw}`);
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  return route;
}

function openRouterArgv(argv) {
  const args = [...argv];
  const directKey = valueFor(argv, '--openrouter-key');
  if (directKey) args.push('--key', directKey);
  const directBaseUrl = valueFor(argv, '--openrouter-base-url');
  if (directBaseUrl) args.push('--base-url', directBaseUrl);
  return args;
}

async function requestHydraProxy({ baseUrl, key, model, prompt, temperature, maxTokens, timeoutMs }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': 'hydra-cli',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const raw = await res.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { /* preserve raw below */ }

  if (!res.ok) {
    const message = payload?.error?.message || raw || `Hydra proxy returned HTTP ${res.status}`;
    const err = new Error(message);
    err.code = payload?.error?.code || 'PROXY_REQUEST_FAILED';
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

async function runChat(argv) {
  const wantJson = hasFlag(argv, '--json');
  const quiet = hasFlag(argv, '--quiet');
  const prompt = valuesAfterAction(argv).join(' ').trim();
  if (!prompt) {
    const report = { ok: false, error: 'PROMPT_REQUIRED', message: 'hydra ai chat requires a prompt' };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${report.message}\n`);
    process.exitCode = 2;
    return;
  }

  let maxTokens;
  let temperature;
  let timeoutMs;
  let route;
  try {
    maxTokens = numericFlag(valueFor(argv, '--max-tokens'), 512, { min: 1, max: 32000, name: '--max-tokens' });
    temperature = numericFlag(valueFor(argv, '--temperature'), 0.2, { min: 0, max: 2, name: '--temperature' });
    timeoutMs = numericFlag(valueFor(argv, '--timeout-ms'), 120000, { min: 500, max: 600000, name: '--timeout-ms' });
    route = normalizeRoute(valueFor(argv, '--route'));
  } catch (err) {
    if (wantJson) json({ ok: false, error: err.code || 'INVALID_ARGUMENT', message: err.message });
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  const baseUrl = normalizeBaseUrl(valueFor(argv, '--base-url'));
  const model = (valueFor(argv, '--model') || process.env.HYDRA_MODEL || 'openai/gpt-4o-mini').trim();
  const directArgv = openRouterArgv(argv);
  const directKeyInfo = resolveOpenRouterKey(directArgv);

  const attempts = [];
  if (route !== 'direct') {
    attempts.push(async () => {
      const keyInfo = await resolveProxyKey(argv);
      const payload = await requestHydraProxy({ baseUrl, key: keyInfo.key, model, prompt, temperature, maxTokens, timeoutMs });
      return { source: 'hydra-v1', baseUrl, keySource: keyInfo.source, payload };
    });
  }
  if (route !== 'proxy' && directKeyInfo) {
    attempts.push(async () => {
      const directBaseUrl = (valueFor(argv, '--openrouter-base-url') || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
      const { payload } = await requestOpenRouter('/chat/completions', {
        baseUrl: directBaseUrl,
        key: directKeyInfo.key,
        method: 'POST',
        timeoutMs,
        body: {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
          stream: false,
        },
      });
      return { source: 'openrouter-direct', baseUrl: directBaseUrl, keySource: directKeyInfo.source, payload };
    });
  }
  if (attempts.length === 0) {
    const report = {
      ok: false,
      error: route === 'direct' ? 'OPENROUTER_KEY_REQUIRED' : 'PROXY_KEY_UNAVAILABLE',
      message: route === 'direct'
        ? 'Set OPENROUTER_API_KEY or pass --openrouter-key for direct OpenRouter routing.'
        : 'Could not derive a Hydra proxy key and no direct OpenRouter key is available.',
      hint: 'Use --route proxy with hydra serve, or --route direct with OPENROUTER_API_KEY.',
    };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${report.message}\n`);
    process.exitCode = 2;
    return;
  }

  const failures = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const payload = result.payload;
    const text = extractAssistantText(payload);
    const report = {
      ok: true,
        source: result.source,
        baseUrl: result.baseUrl,
      model: payload?.model || model,
        route,
        keySource: result.keySource,
        fallbackCount: failures.length,
      text,
      usage: payload?.usage || null,
      id: payload?.id || null,
    };

    if (wantJson) {
      json(report);
      return;
    }

    if (!quiet) process.stdout.write(`${c.bold('Hydra AI')} ${c.dim(report.model)}\n\n`);
    process.stdout.write(`${text}\n`);
      return;
    } catch (err) {
      failures.push({
        error: err.code || (route === 'direct' ? 'OPENROUTER_REQUEST_FAILED' : 'SERVER_UNAVAILABLE'),
        status: err.status || null,
        message: err.message,
      });
      if (route !== 'auto') break;
    }
  }

  {
    const last = failures.at(-1) || {};
    const report = {
      ok: false,
      error: last.error || 'AI_REQUEST_FAILED',
      baseUrl,
      route,
      failures,
      message: last.message || 'No AI route completed successfully.',
      hint: route === 'proxy'
        ? 'Start the closed-app proxy with: hydra serve'
        : 'Use --route proxy with hydra serve, or --route direct with OPENROUTER_API_KEY.',
    };
    if (wantJson) json(report);
    else {
      process.stderr.write(`${c.err('✗')} ${report.message}\n`);
      process.stderr.write(`  ${report.hint}\n`);
    }
    process.exitCode = 2;
  }
}

export async function run(argv) {
  const action = argv[0] || 'help';
  if (action === 'help' || action === '--help' || action === '-h') {
    usage();
    return;
  }

  if (action === 'chat') {
    try {
      await runChat(argv);
    } finally {
      await shutdown();
    }
    return;
  }

  if (action !== 'models') {
    process.stderr.write(`${c.err('✗')} unknown ai command: ${action}\n`);
    usage();
    process.exitCode = 1;
    return;
  }

  const wantJson = hasFlag(argv, '--json');
  const filter = (valueFor(argv, '--filter') || '').trim().toLowerCase();
  let limit;
  try {
    limit = positiveLimit(valueFor(argv, '--limit'));
  } catch (err) {
    if (wantJson) json({ ok: false, error: err.code || 'INVALID_ARGUMENT', message: err.message });
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    const { db } = await loadServices();
    const rows = await db.prisma.cachedModel.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        ctx: true,
        category: true,
        ownedBy: true,
        updatedAt: true,
      },
    });

    const filtered = filter
      ? rows.filter((row) => {
        const haystack = `${row.id} ${row.name} ${row.category || ''} ${row.ownedBy || ''}`.toLowerCase();
        return haystack.includes(filter);
      })
      : rows;
    const models = filtered.slice(0, limit).map((row) => ({
      id: row.id,
      name: row.name,
      context: row.ctx,
      category: row.category,
      ownedBy: row.ownedBy,
      updatedAt: row.updatedAt,
    }));

    const summary = {
      source: 'cached-models',
      totalCached: rows.length,
      totalMatched: filtered.length,
      returned: models.length,
      filter: filter || null,
      models,
    };

    if (wantJson) {
      json(summary);
      return;
    }

    process.stdout.write(`${c.bold('Hydra AI models')} ${c.dim('(local cache)')}\n\n`);
    if (models.length === 0) {
      process.stdout.write(c.dim('  (no cached models matched)\n'));
      process.stdout.write(c.dim('  refresh the catalog from Pool Manager or the running /v1/models path\n'));
      return;
    }

    table(models, [
      { key: 'id', label: 'MODEL' },
      { key: 'name', label: 'NAME' },
      { key: 'context', label: 'CTX', align: 'right' },
      { key: 'ownedBy', label: 'OWNER' },
      { key: 'category', label: 'CATEGORY' },
    ]);
    process.stdout.write('\n');
    process.stdout.write(c.dim(`  ${models.length}/${filtered.length} matched · ${rows.length} cached\n`));
  } finally {
    await shutdown();
  }
}
