import { validateToken } from '../services/auth.js';

export const AUTH_TOKEN_COOKIE = 'hydra_token';
const AUTH_TOKEN_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

function parseCookies(header) {
  if (!header || typeof header !== 'string') return {};
  return Object.fromEntries(header.split(';').map((entry) => {
    const [rawName, ...rawValue] = entry.trim().split('=');
    if (!rawName) return null;
    return [rawName, decodeURIComponent(rawValue.join('=') || '')];
  }).filter(Boolean));
}

export function extractAuthToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return parseCookies(req.headers.cookie)[AUTH_TOKEN_COOKIE] || null;
}

export function setAuthTokenCookie(res, token) {
  res.cookie(AUTH_TOKEN_COOKIE, token, {
    maxAge: AUTH_TOKEN_COOKIE_MAX_AGE_SECONDS * 1000,
    path: '/',
    sameSite: 'lax',
  });
}

export function clearAuthTokenCookie(res) {
  res.clearCookie(AUTH_TOKEN_COOKIE, {
    path: '/',
    sameSite: 'lax',
  });
}

export async function requireUnlocked(req, res, next) {
  const token = extractAuthToken(req);
  const user = await validateToken(token);

  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.user = user;
  next();
}
