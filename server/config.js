import process from 'node:process';
import 'dotenv/config';
import { z } from 'zod';

function parseBoolean(value) {
  if (value === undefined) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const optionalHexSecret = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'must be a 64-character hex string')
  .optional();

const configSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HYDRA_SERVER_PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (url) => url.startsWith('file:') || url.startsWith('postgres://') || url.startsWith('postgresql://'),
      'DATABASE_URL must start with file: (SQLite), postgres://, or postgresql://',
    )
    .refine(
      (url) => !url.includes('#') && !url.includes('?'),
      'DATABASE_URL contains # or ? which can break Prisma file: URL parsing — use URL-encoded paths',
    ),
  JWT_SECRET: z
    .string()
    .min(1, 'JWT_SECRET is required')
    .transform((s) => s.trim())
    .refine((s) => s.length >= 32, 'JWT_SECRET must be at least 32 characters after trimming')
    .default('hydra-dev-secret-unsafe'),
  /** Master lock-screen JWT lifetime (jsonwebtoken `expiresIn`, e.g. 8h, 24h, 7d). */
  HYDRA_MASTER_JWT_TTL: z.string().min(1).max(48).default('24h'),
  LOCAL_STORAGE_KEY: optionalHexSecret,
  VAULT_KEY: optionalHexSecret,
  HYDRA_PROXY_SECRET: optionalHexSecret,
  HYDRA_RESET_LEGACY_STORAGE: z.boolean().default(false),
  RATE_LIMIT_WINDOW: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  /**
   * Swarm #27: rate limit on /v1/* (the OpenAI-compat proxy ingress).
   * Defaults: 60 requests per 60s per IP. Disable via HYDRA_DISABLE_PROXY_RATELIMIT=1.
   */
  PROXY_RATE_LIMIT_WINDOW: z.coerce.number().default(60 * 1000),
  PROXY_RATE_LIMIT_MAX: z.coerce.number().default(60),
  OR_BASE: z.string().url().default('https://openrouter.ai'),
  /** Browser-parity headers for Clerk FAPI (OpenRouter dashboard origin). */
  CLERK_ORIGIN: z.string().url().default('https://openrouter.ai'),
  CLERK_REFERER: z.string().url().default('https://openrouter.ai/sign-in'),
  /** Run server-side Playwright with a visible browser (local debugging). */
  HYDRA_PLAYWRIGHT_HEADED: z.boolean().default(false),
  /** Optional Playwright browser channel, e.g. `chrome` for system Chrome (less bot friction than bundled Chromium). */
  HYDRA_PLAYWRIGHT_CHANNEL: z.string().min(1).optional(),
  /** Explicit path to Chromium/Chrome executable for Playwright. Overrides channel and bundled Chromium lookup. */
  HYDRA_PLAYWRIGHT_EXECUTABLE_PATH: z.string().min(1).optional(),
  /**
   * Chrome DevTools endpoint for Playwright `connectOverCDP` (e.g. `http://127.0.0.1:9222` or the `webSocketDebuggerUrl` from `/json/version`).
   * When set, Hydra does not launch bundled Chromium for provision.
   */
  HYDRA_PLAYWRIGHT_CDP_ENDPOINT: z.string().min(1).optional(),
  /** Save screenshots on management-key provision failure (also on in development). */
  HYDRA_PROVISION_DEBUG: z.boolean().default(false),
  /** Log OpenRouter POST URLs + postData + status during management-key Playwright (no response bodies). */
  HYDRA_PROVISION_NETWORK_LOG: z.boolean().default(false),
  /** Extra step-level stderr logs during management-key Playwright (goto, click, fill milestones). */
  HYDRA_PROVISION_VERBOSE: z.boolean().default(false),
  /**
   * Reserved: when OpenRouter uses Server Actions for create, operators may enable after capturing URL/body.
   * Currently logs a pointer to docs only — no replay is implemented until capture-derived wiring exists.
   */
  HYDRA_PROVISION_SERVER_ACTION_REPLAY: z.boolean().default(false),
  /**
   * Next.js Server Action ID for management key creation.
   * Capture this from the dashboard using scripts/capture-mgmt-key-network.mjs
   * when creating a management key (Next-Action header value).
   */
  HYDRA_MGMT_KEY_SERVER_ACTION_ID: z.string().min(1).optional(),
  /** Next.js Server Action hash for code redemption on /redeem. Override if OR redeploys. */
  HYDRA_REDEEM_ACTION_HASH: z.string().min(1).optional(),
});

let parsedConfig;
try {
  parsedConfig = configSchema.parse({
    PORT: process.env.PORT,
    HYDRA_SERVER_PORT: process.env.HYDRA_SERVER_PORT,
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    HYDRA_MASTER_JWT_TTL: process.env.HYDRA_MASTER_JWT_TTL,
    LOCAL_STORAGE_KEY: process.env.LOCAL_STORAGE_KEY,
    VAULT_KEY: process.env.VAULT_KEY,
    HYDRA_PROXY_SECRET: process.env.HYDRA_PROXY_SECRET,
    HYDRA_RESET_LEGACY_STORAGE: parseBoolean(process.env.HYDRA_RESET_LEGACY_STORAGE),
    RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW,
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX,
    PROXY_RATE_LIMIT_WINDOW: process.env.PROXY_RATE_LIMIT_WINDOW,
    PROXY_RATE_LIMIT_MAX: process.env.PROXY_RATE_LIMIT_MAX,
    OR_BASE: process.env.OR_BASE,
    CLERK_ORIGIN: process.env.CLERK_ORIGIN,
    CLERK_REFERER: process.env.CLERK_REFERER,
    HYDRA_PLAYWRIGHT_HEADED: parseBoolean(process.env.HYDRA_PLAYWRIGHT_HEADED),
    HYDRA_PLAYWRIGHT_CHANNEL: process.env.HYDRA_PLAYWRIGHT_CHANNEL?.trim() || undefined,
    HYDRA_PLAYWRIGHT_EXECUTABLE_PATH: process.env.HYDRA_PLAYWRIGHT_EXECUTABLE_PATH?.trim() || undefined,
    HYDRA_PLAYWRIGHT_CDP_ENDPOINT: process.env.HYDRA_PLAYWRIGHT_CDP_ENDPOINT?.trim() || undefined,
    HYDRA_PROVISION_DEBUG: parseBoolean(process.env.HYDRA_PROVISION_DEBUG),
    HYDRA_PROVISION_NETWORK_LOG: parseBoolean(process.env.HYDRA_PROVISION_NETWORK_LOG),
    HYDRA_PROVISION_VERBOSE: parseBoolean(process.env.HYDRA_PROVISION_VERBOSE),
    HYDRA_PROVISION_SERVER_ACTION_REPLAY: parseBoolean(process.env.HYDRA_PROVISION_SERVER_ACTION_REPLAY),
    HYDRA_MGMT_KEY_SERVER_ACTION_ID: process.env.HYDRA_MGMT_KEY_SERVER_ACTION_ID?.trim() || undefined,
    HYDRA_REDEEM_ACTION_HASH: process.env.HYDRA_REDEEM_ACTION_HASH?.trim() || undefined,
  });
} catch (err) {
  // In Electron, caught by electron/main.js try/catch which shows a native dialog.
  const msg = `Invalid environment variables: ${JSON.stringify(err.issues ?? err.errors ?? err.message)}`;
  console.error(msg);
  throw new Error(msg);
}

export const config = parsedConfig;
// Rotated per FAPI call — Clerk fingerprints device strings at scale (10+ accounts same UA = risk)
const _USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];
export const USER_AGENT = _USER_AGENTS[0]; // static default for non-FAPI uses
export function randomUserAgent() {
  return _USER_AGENTS[Math.floor(Math.random() * _USER_AGENTS.length)];
}
export const CLERK_BASE = 'https://clerk.openrouter.ai/v1';
export const OR_BASE = config.OR_BASE;
export const CLERK_ORIGIN = config.CLERK_ORIGIN;
export const CLERK_REFERER = config.CLERK_REFERER;

/**
 * DEPRECATED: Config validation runs at module load via configSchema.parse().
 * Kept as a no-op for backward compatibility with callers that expect a
 * pre-boot validation gate (e.g. server/index.js). Safe to remove once the
 * call site is migrated.
 */
export function validateConfig() {
  return true;
}
