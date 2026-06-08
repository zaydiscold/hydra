import { validateToken, getBypassUser } from '../services/auth.js';
import { logger } from '../services/logger.js';
import { config } from '../config.js';

export const AUTH_TOKEN_COOKIE = 'hydra_token';
const AUTH_TOKEN_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

function parseCookies(header) {
  if (!header || typeof header !== 'string') return {};
  return Object.fromEntries(header.split(';').map((entry) => {
    const [rawName, ...rawValue] = entry.trim().split('=');
    if (!rawName) return null;
    const encodedValue = rawValue.join('=') || '';
    try {
      return [rawName, decodeURIComponent(encodedValue)];
    } catch (err) {
      logger.warn(`[auth] malformed cookie ignored: ${rawName} (${err.message})`);
      return [rawName, encodedValue];
    }
  }).filter(Boolean));
}

export function extractAuthToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return parseCookies(req.headers.cookie)[AUTH_TOKEN_COOKIE] || null;
}

export function extractAuthTokenCandidates(req) {
  const tokens = [];
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) tokens.push(header.slice(7));
  const cookieToken = parseCookies(req.headers.cookie)[AUTH_TOKEN_COOKIE] || null;
  if (cookieToken && !tokens.includes(cookieToken)) tokens.push(cookieToken);
  return tokens;
}

export async function validateRequestAuth(req) {
  const tokens = extractAuthTokenCandidates(req);
  for (const token of tokens) {
    const user = await validateToken(token);
    if (user) return user;
  }
  return null;
}

export function setAuthTokenCookie(res, token) {
  res.cookie(AUTH_TOKEN_COOKIE, token, {
    maxAge: AUTH_TOKEN_COOKIE_MAX_AGE_SECONDS * 1000,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
  });
}

export function clearAuthTokenCookie(res) {
  res.clearCookie(AUTH_TOKEN_COOKIE, {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
  });
}

export async function requireUnlocked(req, res, next) {
  const user = await validateRequestAuth(req);

  if (user) {
    req.user = user;
    return next();
  }

  // No valid session. Fall back to the bypass admin identity when password
  // gating has been turned off — either via the deployment env flag
  // (HYDRA_DISABLE_AUTH, headless/always-on) or the persisted Settings toggle
  // (User.authDisabled, interactive). A valid session above always wins. /v1
  // proxy auth (master sk- key) is a separate gate, unaffected by either.
  const bypass = await getBypassUser();
  if (config.HYDRA_DISABLE_AUTH || bypass.authDisabled) {
    req.user = bypass;
    return next();
  }

  return res.status(401).json({ error: 'Not authenticated' });
}
