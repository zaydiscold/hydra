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

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
let server = null;
let shutdownInFlight = false;

// Proxy kill switch state lives in services/proxy-gate.js to avoid circular imports

// Trust the Docker internal bridge / reverse proxy to prevent rate-limit global lockouts
// (Gotcha #1: Without this, all Docker requests appear from 172.x.x.x → rate limiter locks out ALL users)
if (process.env.NODE_ENV === 'production' || process.env.HYDRA_DOCKERIZED === '1') {
  app.set('trust proxy', 1);
}

// Standard middleware
app.use(cors());
app.use(express.json());

// --- Rate Limiting ---
const authLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW,
  max: config.RATE_LIMIT_MAX,
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' }
});

// --- Public Routes & Misc ---
app.use('/api/auth/', authLimiter, authRoutes);
app.use('/api/webhooks', webhookRoutes);

// --- System Routes ---
app.post('/api/shutdown', requireUnlocked, (req, res) => {
  res.json({ success: true, message: 'Server shutting down' });
  void gracefulShutdown('api');
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
app.use('/v1', (req, res, next) => {
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
      // In dev, 404 is fine. In prod, this is a configuration issue.
      next();
    }
  });
});

// Global Error Handler (Last stage)
app.use(errorHandler);

async function gracefulShutdown(source = 'unknown') {
  if (shutdownInFlight) return;
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

  if (!server) {
    process.exit(0);
    return;
  }

  server.close(err => {
    if (err) {
      logger.error(`[SHUTDOWN] HTTP server close failed: ${err.message}`);
      process.exit(1);
      return;
    }
    logger.info('[SHUTDOWN] Hydra stopped cleanly');
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('[SHUTDOWN] Forced exit after timeout');
    process.exit(1);
  }, 5000).unref();
}

async function bootstrap() {
  try {
    validateConfig();
    await enforceLegacyStorageReset();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  taskSupervisor.start();
  startPinger();
  startRequestLogRetention();
  startSessionRefresher(); // P13 — auto-refresh sessions approaching expiry

  server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info(`  🐉 Hydra Server live on port ${config.PORT}`);
    logger.info(`  Environment: ${config.NODE_ENV}`);
    logger.info(`  Network: http://0.0.0.0:${config.PORT}`);
    try {
      const hydraKey    = getMasterProxyKey();
      const genericKey  = getGenericProxyKey();
      const base        = `http://localhost:${config.PORT}/v1`;
      logger.info('');
      logger.info('  ┌─ Proxy Keys ──────────────────────────────────────────────────────────────┐');
      logger.info(`  │  Hydra branded   : ${hydraKey}`);
      logger.info(`  │  OpenAI-compat   : ${genericKey}`);
      logger.info(`  │  Base URL        : ${base}`);
      logger.info('  │  Use either key as "Authorization: Bearer <key>" in Cursor / any client.  │');
      logger.info('  └───────────────────────────────────────────────────────────────────────────┘');
      logger.info('');
    } catch (keyErr) {
      logger.warn(`  [PROXY] Could not derive proxy keys (vault not yet initialised?): ${keyErr.message}`);
    }
  });
}

bootstrap();

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
