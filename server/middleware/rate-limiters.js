import { rateLimit } from 'express-rate-limit';

export const highCostRouteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many high-cost operations. Please wait before retrying.' },
});
