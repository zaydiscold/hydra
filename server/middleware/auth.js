import { validateToken } from '../services/auth.js';

export async function requireUnlocked(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = await validateToken(token);

  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.user = user;
  next();
}
