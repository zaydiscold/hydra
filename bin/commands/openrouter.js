/**
 * `hydra openrouter` — direct OpenRouter API probes.
 *
 * This is the no-Express path for agents and scripts that already have an
 * OpenRouter key. It keeps secrets out of stdout and mirrors the upstream
 * OpenAI-compatible endpoints Hydra proxies through /v1.
 */
import { c, json, table, fmtBalance } from '../lib/output.js';
import { shutdown } from '../lib/services.js';

export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

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
      if (!['--json', '--quiet', '--cache'].includes(arg) && valueFor(argv, arg) != null) i += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function normalizeBaseUrl(raw) {
  return (raw || process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).trim().replace(/\/+$/, '');
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

function maskKeyLabel(label) {
  if (!label || typeof label !== 'string') return null;
  if (label.length <= 16) return label;
  return `${label.slice(0, 10)}...${label.slice(-4)}`;
}

export function resolveOpenRouterKey(argv = []) {
  const explicit = (valueFor(argv, '--key') || process.env.OPENROUTER_API_KEY || '').trim();
  if (!explicit) return null;
  return { key: explicit, source: valueFor(argv, '--key') ? 'flag' : 'env' };
}

export function extractAssistantText(payload) {
  const message = payload?.choices?.[0]?.message;
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('');
  }
  if (typeof payload?.choices?.[0]?.text === 'string') return payload.choices[0].text;
  return '';
}

export async function requestOpenRouter(path, {
  baseUrl = DEFAULT_OPENROUTER_BASE_URL,
  key = null,
  method = 'GET',
  body = null,
  timeoutMs = 120000,
} = {}) {
  const headers = {
    'User-Agent': 'hydra-cli',
    'HTTP-Referer': 'http://localhost:3001',
  };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body != null) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const wrapped = new Error(`Could not reach OpenRouter at ${baseUrl}: ${err.message}`);
    wrapped.code = 'OPENROUTER_UNAVAILABLE';
    throw wrapped;
  }

  const raw = await res.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { /* keep raw */ }

  if (!res.ok) {
    const message = payload?.error?.message || payload?.message || raw || `OpenRouter returned HTTP ${res.status}`;
    const err = new Error(message);
    err.code = payload?.error?.code || 'OPENROUTER_REQUEST_FAILED';
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return { status: res.status, payload, raw };
}

async function runModels(argv) {
  const wantJson = hasFlag(argv, '--json');
  const filter = (valueFor(argv, '--filter') || '').trim().toLowerCase();
  const outputModalities = valueFor(argv, '--output-modalities');
  const supportedParameters = valueFor(argv, '--supported-parameters');
  const cache = hasFlag(argv, '--cache');
  let limit;
  let timeoutMs;
  try {
    limit = positiveLimit(valueFor(argv, '--limit'));
    timeoutMs = numericFlag(valueFor(argv, '--timeout-ms'), 30000, { min: 500, max: 120000, name: '--timeout-ms' });
  } catch (err) {
    if (wantJson) json({ ok: false, error: err.code || 'INVALID_ARGUMENT', message: err.message });
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  const params = new URLSearchParams();
  if (outputModalities) params.set('output_modalities', outputModalities);
  if (supportedParameters) params.set('supported_parameters', supportedParameters);
  const suffix = params.toString() ? `?${params}` : '';
  const keyInfo = resolveOpenRouterKey(argv);
  const baseUrl = normalizeBaseUrl(valueFor(argv, '--base-url'));

  try {
    const { payload } = await requestOpenRouter(`/models${suffix}`, {
      baseUrl,
      key: keyInfo?.key || null,
      timeoutMs,
    });
    const all = Array.isArray(payload?.data) ? payload.data : [];
    const matched = filter
      ? all.filter((model) => `${model.id || ''} ${model.name || ''} ${model.description || ''}`.toLowerCase().includes(filter))
      : all;
    const models = matched.slice(0, limit).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      context: model.context_length ?? model.top_provider?.context_length ?? null,
      input: Array.isArray(model.architecture?.input_modalities) ? model.architecture.input_modalities.join(',') : null,
      output: Array.isArray(model.architecture?.output_modalities) ? model.architecture.output_modalities.join(',') : null,
    }));
    let cachedRows = 0;
    if (cache) {
      const { upsertModelsFromUpstream } = await import('../../server/services/model-cache.js');
      cachedRows = await upsertModelsFromUpstream(all);
    }
    const report = {
      ok: true,
      source: 'openrouter-live',
      baseUrl,
      total: all.length,
      matched: matched.length,
      returned: models.length,
      cachedRows,
      models,
    };
    if (wantJson) {
      json(report);
      return;
    }
    process.stdout.write(`${c.bold('OpenRouter models')} ${c.dim(`${models.length}/${matched.length} matched · ${all.length} live`)}\n\n`);
    table(models, [
      { key: 'id', label: 'MODEL' },
      { key: 'name', label: 'NAME' },
      { key: 'context', label: 'CTX', align: 'right' },
      { key: 'input', label: 'IN' },
      { key: 'output', label: 'OUT' },
    ]);
    if (cachedRows) process.stdout.write(c.dim(`\n  cached ${cachedRows} models locally\n`));
  } finally {
    if (cache) await shutdown();
  }
}

async function runKey(argv) {
  const wantJson = hasFlag(argv, '--json');
  const keyInfo = resolveOpenRouterKey(argv);
  if (!keyInfo) {
    const report = { ok: false, error: 'OPENROUTER_KEY_REQUIRED', message: 'Set OPENROUTER_API_KEY or pass --key.' };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${report.message}\n`);
    process.exitCode = 2;
    return;
  }
  const baseUrl = normalizeBaseUrl(valueFor(argv, '--base-url'));
  const timeoutMs = numericFlag(valueFor(argv, '--timeout-ms'), 30000, { min: 500, max: 120000, name: '--timeout-ms' });
  const { payload } = await requestOpenRouter('/key', { baseUrl, key: keyInfo.key, timeoutMs });
  const data = payload?.data || {};
  const report = {
    ok: true,
    source: 'openrouter-live',
    keySource: keyInfo.source,
    label: maskKeyLabel(data.label),
    isManagementKey: Boolean(data.is_management_key),
    isFreeTier: Boolean(data.is_free_tier),
    limit: data.limit ?? null,
    limitRemaining: data.limit_remaining ?? null,
    usage: data.usage ?? null,
    usageMonthly: data.usage_monthly ?? null,
    expiresAt: data.expires_at ?? null,
  };
  if (wantJson) json(report);
  else {
    process.stdout.write(`${c.bold('OpenRouter key')}\n\n`);
    process.stdout.write(`  Label:        ${report.label || c.dim('unknown')}\n`);
    process.stdout.write(`  Management:   ${report.isManagementKey ? 'yes' : 'no'}\n`);
    process.stdout.write(`  Limit left:   ${report.limitRemaining == null ? c.dim('unknown') : fmtBalance(report.limitRemaining)}\n`);
    process.stdout.write(`  Usage month:  ${report.usageMonthly == null ? c.dim('unknown') : fmtBalance(report.usageMonthly)}\n`);
  }
}

async function runCredits(argv) {
  const wantJson = hasFlag(argv, '--json');
  const keyInfo = resolveOpenRouterKey(argv);
  if (!keyInfo) {
    const report = { ok: false, error: 'OPENROUTER_KEY_REQUIRED', message: 'Set OPENROUTER_API_KEY or pass --key.' };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${report.message}\n`);
    process.exitCode = 2;
    return;
  }
  const baseUrl = normalizeBaseUrl(valueFor(argv, '--base-url'));
  const timeoutMs = numericFlag(valueFor(argv, '--timeout-ms'), 30000, { min: 500, max: 120000, name: '--timeout-ms' });
  const { payload } = await requestOpenRouter('/credits', { baseUrl, key: keyInfo.key, timeoutMs });
  const data = payload?.data || {};
  const total = data.total_credits ?? data.total ?? 0;
  const used = data.total_usage ?? data.used ?? 0;
  const report = { ok: true, source: 'openrouter-live', total, used, remaining: total - used };
  if (wantJson) json(report);
  else {
    process.stdout.write(`${c.bold('OpenRouter credits')}\n\n`);
    process.stdout.write(`  Total:      ${fmtBalance(total)}\n`);
    process.stdout.write(`  Used:       ${fmtBalance(used)}\n`);
    process.stdout.write(`  Remaining:  ${fmtBalance(total - used)}\n`);
  }
}

export async function runChat(argv) {
  const wantJson = hasFlag(argv, '--json');
  const quiet = hasFlag(argv, '--quiet');
  const keyInfo = resolveOpenRouterKey(argv);
  if (!keyInfo) {
    const report = { ok: false, error: 'OPENROUTER_KEY_REQUIRED', message: 'Set OPENROUTER_API_KEY or pass --key.' };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${report.message}\n`);
    process.exitCode = 2;
    return;
  }
  const prompt = valuesAfterAction(argv).join(' ').trim();
  if (!prompt) {
    const report = { ok: false, error: 'PROMPT_REQUIRED', message: 'hydra openrouter chat requires a prompt' };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${report.message}\n`);
    process.exitCode = 2;
    return;
  }
  let maxTokens;
  let temperature;
  let timeoutMs;
  try {
    maxTokens = numericFlag(valueFor(argv, '--max-tokens'), 512, { min: 1, max: 32000, name: '--max-tokens' });
    temperature = numericFlag(valueFor(argv, '--temperature'), 0.2, { min: 0, max: 2, name: '--temperature' });
    timeoutMs = numericFlag(valueFor(argv, '--timeout-ms'), 120000, { min: 500, max: 600000, name: '--timeout-ms' });
  } catch (err) {
    if (wantJson) json({ ok: false, error: err.code || 'INVALID_ARGUMENT', message: err.message });
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  const baseUrl = normalizeBaseUrl(valueFor(argv, '--base-url'));
  const model = (valueFor(argv, '--model') || process.env.OPENROUTER_MODEL || process.env.HYDRA_MODEL || 'openai/gpt-4o-mini').trim();
  const { payload } = await requestOpenRouter('/chat/completions', {
    baseUrl,
    key: keyInfo.key,
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
  const text = extractAssistantText(payload);
  const report = {
    ok: true,
    source: 'openrouter-direct',
    baseUrl,
    model: payload?.model || model,
    keySource: keyInfo.source,
    text,
    usage: payload?.usage || null,
    id: payload?.id || null,
  };
  if (wantJson) json(report);
  else {
    if (!quiet) process.stdout.write(`${c.bold('OpenRouter')} ${c.dim(report.model)}\n\n`);
    process.stdout.write(`${text}\n`);
  }
}

function usage() {
  process.stdout.write(`Hydra OpenRouter

  hydra openrouter models
  hydra openrouter models --filter claude --limit 25 --json
  hydra openrouter models --output-modalities text,image --supported-parameters tools
  hydra openrouter models --cache
  hydra openrouter key --json
  hydra openrouter credits --json
  hydra openrouter chat "prompt" --model openai/gpt-4o-mini --json

Direct commands use https://openrouter.ai/api/v1 by default.
Set OPENROUTER_API_KEY or pass --key for authenticated calls.
Use --base-url for tests or compatible OpenRouter mirrors.
`);
}

export async function run(argv) {
  const action = argv[0] || 'help';
  if (action === 'help' || action === '--help' || action === '-h') {
    usage();
    return;
  }

  try {
    if (action === 'models') return await runModels(argv);
    if (action === 'key') return await runKey(argv);
    if (action === 'credits') return await runCredits(argv);
    if (action === 'chat') return await runChat(argv);
    process.stderr.write(`${c.err('✗')} unknown openrouter command: ${action}\n`);
    usage();
    process.exitCode = 1;
  } catch (err) {
    const wantJson = hasFlag(argv, '--json');
    const report = {
      ok: false,
      error: err.code || 'OPENROUTER_REQUEST_FAILED',
      status: err.status || null,
      message: err.message,
    };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${report.message}\n`);
    process.exitCode = err.status === 401 || err.status === 403 ? 2 : 1;
  } finally {
    if (action !== 'models' || hasFlag(argv, '--cache')) await shutdown();
  }
}
