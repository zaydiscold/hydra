import { rateLimit } from 'express-rate-limit';

export const highCostRouteLimiter = rateLimit({
  windowMs: 60 * 1000,
  // A normal fleet operation can legitimately touch every account once. The
  // previous cap of 12 made account 13 fail locally and misleadingly pushed
  // operators into OTP re-auth even though Clerk refresh was healthy.
  // Upstream fan-out remains concurrency-limited by the controllers.
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many operations in one minute. Wait for the retry timer; your session is still valid and does not need OTP.' },
});
