import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const DEFAULT_HYDRA_PORT = 3001;
export const RUNTIME_STATE_FILENAME = 'hydra-runtime.json';

function asPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function envPort(env = process.env) {
  const explicit = env.HYDRA_PORT || env.PORT || null;
  const port = explicit ? asPort(explicit) : null;
  return {
    port: port ?? DEFAULT_HYDRA_PORT,
    source: port ? (env.HYDRA_PORT ? 'HYDRA_PORT' : 'PORT') : 'default',
    explicit: Boolean(port),
  };
}

function platformUserDataDir(env = process.env, platformName = process.platform) {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (platformName === 'darwin') return join(home, 'Library', 'Application Support', 'Hydra');
  if (platformName === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Hydra');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Hydra');
}

export function runtimeStatePaths({ root = process.cwd(), dataDir = null, env = process.env } = {}) {
  const candidates = [];
  if (env.HYDRA_RUNTIME_STATE_PATH) candidates.push(env.HYDRA_RUNTIME_STATE_PATH);
  if (env.HYDRA_DATA_DIR) candidates.push(join(resolve(env.HYDRA_DATA_DIR), RUNTIME_STATE_FILENAME));
  if (dataDir) candidates.push(join(resolve(dataDir), RUNTIME_STATE_FILENAME));
  if (root) candidates.push(join(resolve(root), 'data', RUNTIME_STATE_FILENAME));
  candidates.push(join(platformUserDataDir(env), RUNTIME_STATE_FILENAME));

  const seen = new Set();
  return candidates
    .filter(Boolean)
    .map((candidate) => resolve(candidate))
    .filter((candidate) => {
      if (seen.has(candidate)) return false;
      seen.add(candidate);
      return true;
    });
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRuntimeStateFile(filePath) {
  if (!existsSync(filePath)) return null;
  let payload;
  try {
    payload = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    return { ok: false, path: filePath, reason: `unreadable runtime state: ${err?.message || err}` };
  }

  const port = asPort(payload?.port);
  if (!port) return { ok: false, path: filePath, reason: 'runtime state has no valid port' };

  const pid = Number(payload?.pid);
  if (Number.isInteger(pid) && pid > 0 && !pidAlive(pid)) {
    return { ok: false, path: filePath, reason: `runtime state owner pid ${pid} is not alive` };
  }

  return {
    ok: true,
    path: filePath,
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    port,
    url: typeof payload?.url === 'string' ? payload.url : `http://localhost:${port}`,
    proxyUrl: typeof payload?.proxyUrl === 'string' ? payload.proxyUrl : `http://localhost:${port}/v1`,
    source: typeof payload?.source === 'string' ? payload.source : 'runtime-state',
    mode: typeof payload?.mode === 'string' ? payload.mode : null,
    writtenAt: typeof payload?.writtenAt === 'string' ? payload.writtenAt : null,
  };
}

export function readRuntimePortStateSync(options = {}) {
  const ignored = [];
  for (const statePath of runtimeStatePaths(options)) {
    const state = readRuntimeStateFile(statePath);
    if (!state) continue;
    if (state.ok) return { ...state, ignored };
    ignored.push(state);
  }
  return null;
}

export function probePort(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise((resolveProbe) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolveProbe(value);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

export function resolveRuntimePortCandidateSync(options = {}) {
  const envInfo = envPort(options.env || process.env);
  if (envInfo.explicit) {
    return {
      port: envInfo.port,
      source: envInfo.source,
      state: null,
      ignored: [],
    };
  }

  const state = readRuntimePortStateSync(options);
  if (state) {
    return {
      port: state.port,
      source: state.source,
      state,
      ignored: state.ignored || [],
    };
  }

  return {
    port: envInfo.port,
    source: envInfo.source,
    state: null,
    ignored: [],
  };
}

export async function resolveLocalRuntimeEndpoint(options = {}) {
  const candidate = resolveRuntimePortCandidateSync(options);
  const running = await probePort(candidate.port);
  return {
    ...candidate,
    running,
    baseUrl: `http://localhost:${candidate.port}/v1`,
    url: running ? `http://localhost:${candidate.port}/v1` : null,
  };
}
