import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { logger } from './services/logger.js';
import { config, validateConfig } from './config.js';
import { errorHandler } from './middleware/error-handler.js';
import { requireUnlocked } from './middleware/auth.js';

// Modular Routes
import authRoutes from './routes/auth.js';
import accountsRoutes from './routes/accounts.js';
import keysRoutes from './routes/keys.js';
import dashboardRoutes from './routes/dashboard.js';
import codesRoutes from './routes/codes.js';
import generatorRoutes from './routes/generator.js';
import poolRoutes from './routes/pool.js';
import proxyRoutes from './routes/proxy.js';
import webhookRoutes from './routes/webhooks.js';
import systemRoutes from './routes/system.js';
import debugRoutes from './routes/debug.js';

import { startPinger, stopPinger } from './services/health-pinger.js';
import { startRequestLogRetention, stopRequestLogRetention } from './services/request-log-retention.js';
import { taskSupervisor } from './services/task-supervisor.js';
import { enforceLegacyStorageReset } from './services/legacy-storage.js';
import { getMasterProxyKey, getGenericProxyKey } from './services/store.js';
import { startSessionRefresher, stopSessionRefresher } from './services/session-refresher.js';
import { proxyGate } from './services/proxy-gate.js';
import { rotationManager } from './services/rotation-manager.js';
import { disconnectPrisma } from './services/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
let server = null;
let shutdownInFlight = false;

// Proxy kill switch state lives in services/proxy-gate.js to avoid circular imports

// Trust the Docker internal bridge / reverse proxy to prevent rate-limit global lockouts
// (Gotcha #1: Without this, all Docker requests appear from 172.x.x.x → rate limiter locks out ALL users)
// MEDIUM #20: Also trust proxy when embedded in Electron (HYDRA_EMBEDDED)
if (process.env.NODE_ENV === 'production' || process.env.HYDRA_DOCKERIZED === '1' || process.env.HYDRA_EMBEDDED === '1') {
  app.set('trust proxy', 1);
}

// Standard middleware
app.use(express.json());
app.use(cors(process.env.HYDRA_EMBEDDED === '1'
  ? {
      origin(origin, callback) {
        // Swarm #89: every code path MUST call callback(...). Returning undefined
        // here causes Express CORS to behave inconsistently across versions.
        if (!origin) return callback(null, true);
        try {
          const parsed = new URL(origin);
          // #21: Harmonize IPv6 loopback — ::1 must be allowed alongside
          // localhost/127.0.0.1 to match the LOCAL_UI_HOSTS navigation guard.
          const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
          if (parsed.protocol === 'http:' && isLoopback) {
            return callback(null, true);
          }
          // Parsed but not loopback — explicit denial.
          return callback(new Error(`CORS denied for origin: ${origin}`));
        } catch (parseErr) {
          // Origin header was unparseable — explicit denial.
          return callback(new Error(`CORS denied for unparseable origin: ${origin} (${parseErr.message})`));
        }
      },
      credentials: true,
    }
  : undefined));

// CSP middleware for Electron embedded mode — restrict to self
if (process.env.HYDRA_EMBEDDED) {
  app.use((_req, res, next) => {
    // Vite's production build still emits inline style/script bootstrap in a few places.
    // Keep unsafe-inline documented here until the renderer build is migrated to nonce/hash CSP.
    // #6 / #20: Added missing directives: frame-ancestors, form-action, base-uri, object-src.
    // These lock down embedding, form submission targets, <base> hijacking, and plugin content.
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' ws://localhost:* ws://127.0.0.1:* ws://[::1]:*",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '));
    next();
  });
}

// --- Rate Limiting ---
const authLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW,
  max: config.RATE_LIMIT_MAX,
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' }
});

// Swarm #27: rate limit /v1/* proxy ingress so external AI clients can't hammer
// the OpenAI-compat endpoint. Power users can opt out with HYDRA_DISABLE_PROXY_RATELIMIT=1.
const proxyRateLimitDisabled = process.env.HYDRA_DISABLE_PROXY_RATELIMIT === '1';
const proxyLimiter = proxyRateLimitDisabled
  ? (_req, _res, next) => next()
  : rateLimit({
      windowMs: config.PROXY_RATE_LIMIT_WINDOW,
      max: config.PROXY_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { message: 'Rate limit exceeded for /v1 proxy. Slow down or set HYDRA_DISABLE_PROXY_RATELIMIT=1.', type: 'rate_limit_exceeded' } },
    });
if (proxyRateLimitDisabled) {
  logger.warn('[startup] /v1 proxy rate limit DISABLED via HYDRA_DISABLE_PROXY_RATELIMIT=1');
}

// --- Public Routes & Misc ---
app.use('/api/auth/', authLimiter, authRoutes);
app.use('/api/webhooks', webhookRoutes);

// --- System Routes ---
app.post('/api/shutdown', requireUnlocked, (req, res) => {
  if (process.env.HYDRA_EMBEDDED === '1' && req.body?.confirm !== 'SHUTDOWN_HYDRA') {
    return res.status(400).json({
      success: false,
      error: 'Shutdown confirmation token required',
      code: 'SHUTDOWN_CONFIRM_REQUIRED',
    });
  }
  logger.warn('[SHUTDOWN] API shutdown requested');
  res.json({ success: true, message: 'Server shutting down' });
  void gracefulShutdown('api', { exit: !process.env.HYDRA_EMBEDDED });
});

// --- Protected Routes ---
app.use('/api/accounts', accountsRoutes);
app.use('/api/accounts', keysRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/codes', codesRoutes);
app.use('/api/generator', generatorRoutes);
app.use('/api/pool', poolRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/debug', debugRoutes);

// --- OpenAI-compatible Proxy (must be before SPA catch-all) ---
app.use('/v1', proxyLimiter, (req, res, next) => {
  if (!proxyGate.enabled) {
    return res.status(503).json({ error: 'Proxy disabled', message: 'The Hydra proxy has been turned off by the operator.' });
  }
  next();
}, proxyRoutes);

// --- Static Client (Production) ---
const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// Catch-all for SPA routing
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.url.startsWith('/api/')) return next();
  
  res.sendFile(join(distPath, 'index.html'), (err) => {
    if (err) {
      // MEDIUM #18: Log when dist/index.html is missing (SPA 404).
      // In dev it's normal; in prod/packaged builds it's a configuration issue.
      const indexPath = join(distPath, 'index.html');
      logger.error({
        source: 'spa_handler',
        event: 'index_html_missing',
        message: `[SPA] dist/index.html not found at ${indexPath}: ${err.message}`,
        stack: err.stack,
        code: err.code,
      });
      next();
    }
  });
});

// Global Error Handler (Last stage)
app.use(errorHandler);
// When exit=false, resolves promise instead of calling process.exit().
async function gracefulShutdown(source = 'unknown', { exit = true, timeoutMs = 5000 } = {}) {
  if (shutdownInFlight) return true;
  shutdownInFlight = true;

  logger.info(`[SHUTDOWN] Starting graceful shutdown (${source})`);
  stopPinger();
  stopRequestLogRetention();
  stopSessionRefresher();

  try {
    await taskSupervisor.shutdown();
  } catch (err) {
    logger.error(`[SHUTDOWN] Task supervisor shutdown failed: ${err.message}`);
  }

  // #92: Disconnect the Prisma singleton so active WAL connections are closed
  // and the DB is left in a consistent state. Previously this was never called
  // during shutdown, relying on process exit for cleanup.
  try {
    await disconnectPrisma();
    logger.info('[SHUTDOWN] Prisma disconnected');
  } catch (err) {
    logger.error(`[SHUTDOWN] Prisma disconnect failed: ${err.message}`);
  }

  if (!server) {
    logger.info('[SHUTDOWN] No server to close');
    if (exit) process.exit(0);
    return true;
  }

  return new Promise((resolve) => {
    const forceExitTimer = setTimeout(() => {
      // #23: Log hung subsystem details so operators can tell what's stuck.
      const connections = server ? (typeof server._connections !== 'undefined' ? server._connections : 'unknown') : 'N/A';
      const listening = server?.listening ?? false;
      logger.warn(`[SHUTDOWN] Forced exit after timeout (${timeoutMs}ms) — ${connections} active connection(s), listening=${listening}`);

      // #24: Reset shutdownInFlight so a subsequent shutdown attempt can retry
      // instead of being stuck with a permanent true guard.
      shutdownInFlight = false;

      if (exit) process.exit(1);
      resolve(false);
    }, timeoutMs);
    forceExitTimer.unref?.();

    server.close((err) => {
      clearTimeout(forceExitTimer);
      if (err) {
        logger.error(`[SHUTDOWN] HTTP server close failed: ${err.message}`);
        // #24: Reset flag on failure too so retries aren't blocked.
        shutdownInFlight = false;
        if (exit) process.exit(1);
        resolve(false);
        return;
      }
      logger.info('[SHUTDOWN] Hydra stopped cleanly');
      if (exit) process.exit(0);
      resolve(true);
    });
  });
}

async function bootstrap({ port, silent } = {}) {
  try {
    validateConfig();
    await enforceLegacyStorageReset();
  } catch (err) {
    logger.error(err.message);
    throw err;
  }

  const listenPort = port ?? config.PORT;
  const host = process.env.HYDRA_EMBEDDED ? '127.0.0.1' : '0.0.0.0';

  // #10: Listen FIRST, then start services. If port conflict occurs,
  // the promise rejects before any timers are created — no leak.
  server = await new Promise((resolve, reject) => {
    const s = app.listen(listenPort, host, () => {
      if (!silent) {
        logger.info(`  Hydra Server live on port ${listenPort}`);
        logger.info(`  Environment: ${config.NODE_ENV}`);
        logger.info(`  Network: http://${host}:${listenPort}${host === '127.0.0.1' ? ' (loopback only)' : ''}`);
        try {
          const hydraKey    = getMasterProxyKey();
          const genericKey  = getGenericProxyKey();
          const base        = `http://localhost:${listenPort}/v1`;
          logger.info('');
          logger.info('  Proxy Keys:');
          logger.info(`  Hydra branded   : ${hydraKey}`);
          logger.info(`  OpenAI-compat   : ${genericKey}`);
          logger.info(`  Base URL        : ${base}`);
          logger.info('  Use either key as Authorization: Bearer *** in Cursor / any client.');
          logger.info('');
        } catch (keyErr) {
          logger.warn(`  [PROXY] Could not derive proxy keys (vault not yet initialised?): ${keyErr.message}`);
        }
      }
      resolve(s);
    });
    s.on('error', reject);
  });

  // Services started only after successful listen
  taskSupervisor.start();
  startPinger();
  startRequestLogRetention();
  startSessionRefresher(); // P13 — auto-refresh sessions approaching expiry

  // Eagerly load the rotation pool so it's ready before first proxy request
  rotationManager.reload().catch(err => {
    // HIGH #13: Structured error logging for rotationManager failures
    logger.error({
      source: 'rotationManager.reload',
      event: 'eager_load_failed',
      message: `[POOL] Eager load failed: ${err.message}`,
      stack: err.stack,
      code: err.code,
    });
  });

  return server;
}

export { app, bootstrap, gracefulShutdown, server };
