import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs/promises';

import { prisma } from './db.js';
import { config } from '../config.js';
import { logger } from './logger.js';
import { getDataDir } from '../lib/data-dir.js';

const SALT_ROUNDS = 12;
const ADMIN_USERNAME = 'admin';
const DATA_DIR = getDataDir();
// Written into passwordHash when the operator disables password protection. It
// is not a bcrypt hash, so bcrypt.compare() against it always returns false —
// no password can satisfy a disabled account. Re-enabling overwrites it with a
// fresh hash, so a forgotten old password can never lock the operator out.
const DISABLED_PASSWORD_SENTINEL = 'auth-disabled-no-password';
let restartRequired = false;

// IMPORTANT: The admin password is stored as a bcrypt hash (SALT_ROUNDS=12) in
// data/hydra.db → User.passwordHash. The default dev password is "1111".
//
// If a refactor/migration changes the User table or re-creates the DB from scratch,
// the hash won't match "1111" and the login screen will show "Invalid credentials"
// with no way in (Nuclear Reset wipes all data — avoid it).
//
// Recovery without wiping data:
//   node -e "
//     const {PrismaClient}=require('./node_modules/.prisma/client');
//     const b=require('./node_modules/bcryptjs');
//     const p=new PrismaClient();
//     b.hash('1111',12).then(h=>p.user.updateMany({data:{passwordHash:h}})).then(r=>{console.log('reset ok',r);p.\$disconnect()});
//   "
//
// See also: CLAUDE.md "Password Recovery" section.

function buildNukeTransaction() {
  return [
    prisma.requestLog.deleteMany(),
    prisma.key.deleteMany(),
    prisma.cachedModel.deleteMany(),
    prisma.discovery.deleteMany(),
    prisma.account.deleteMany(),
    prisma.user.deleteMany(),
  ];
}

export async function getSetupStatus() {
  try {
    const [adminUser, accountCount] = await Promise.all([
      prisma.user.findUnique({
        where: { username: ADMIN_USERNAME },
        select: { authDisabled: true },
      }),
      prisma.account.count(),
    ]);
    const hasUser = !!adminUser;
    const hasAccounts = accountCount > 0;
    return {
      setup: hasUser,
      hasUser,
      hasAccounts,
      // When true the frontend skips the login screen — password gating is off.
      authDisabled: !!adminUser?.authDisabled,
      needsFirstAccount: hasUser && !hasAccounts,
      bootstrapRequired: false,
    };
  } catch (err) {
    logger.error(`[AUTH] Failed to check setup status: ${err.message}`);
    return { setup: false, error: 'AUTH_STATUS_UNAVAILABLE' };
  }
}

export function isRestartRequired() {
  return restartRequired;
}

export async function nukeSystem() {
  await prisma.$transaction(buildNukeTransaction());

  // Remove the entire runtime data directory so any secrets/artifacts from
  // older storage layouts disappear in one pass.
  await fs.rm(DATA_DIR, { force: true, recursive: true });
  restartRequired = true;

  return {
    clearedTables: ['RequestLog', 'Key', 'CachedModel', 'Discovery', 'Account', 'User'],
    removedPaths: [DATA_DIR],
    restartRequired: true,
  };
}

export async function signup(password) {
  if (!password || password.length < 1) throw new Error('Password must be at least 1 character');

  const existingUser = await prisma.user.findUnique({ where: { username: ADMIN_USERNAME } });
  const accountCount = await prisma.account.count();
  if (existingUser && accountCount > 0) throw new Error('Username already taken');

  if (existingUser && accountCount === 0) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
      },
    });
    return generateToken(user);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      username: ADMIN_USERNAME,
      passwordHash,
      tokenVersion: 0,
    },
  });

  return generateToken(user);
}

export async function login(password) {
  const user = await prisma.user.findUnique({ where: { username: ADMIN_USERNAME } });
  if (!user) throw new Error('Invalid credentials');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error('Invalid credentials');

  return generateToken(user);
}

export async function changePassword(userId, currentPassword, newPassword) {
  // NOTE: Changing the password here updates the bcrypt hash in data/hydra.db.
  // The dev default "1111" will no longer work after this. If you lose the new
  // password, use the recovery command in CLAUDE.md (or the comment block above).
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new Error('Current password is incorrect');
  if (!newPassword || newPassword.length < 1) throw new Error('New password must be at least 1 character');

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      tokenVersion: { increment: 1 },
    },
  });

  return true;
}

/**
 * Turn OFF dashboard password protection. Requires the current password (proves
 * the operator owns the account), then blanks passwordHash to an unusable
 * sentinel and flips authDisabled on. tokenVersion is bumped so any live
 * sessions are invalidated. Only valid once a real password exists (post-setup).
 * The /v1 proxy (master sk- key) is unaffected.
 */
export async function disableAuth(currentPassword) {
  const user = await prisma.user.findUnique({ where: { username: ADMIN_USERNAME } });
  if (!user) throw new Error('Set up a password before disabling protection');
  if (user.authDisabled) return true; // already off — idempotent

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new Error('Current password is incorrect');

  await prisma.user.update({
    where: { id: user.id },
    data: {
      authDisabled: true,
      passwordHash: DISABLED_PASSWORD_SENTINEL,
      tokenVersion: { increment: 1 },
    },
  });
  return true;
}

/**
 * Turn password protection back ON by creating a BRAND-NEW password. There is
 * deliberately no "reuse the old password" path — re-enabling always sets a
 * fresh hash, so an operator who forgot the disabled password can never lock
 * themselves out. Bumps tokenVersion to invalidate the bypass session.
 */
export async function enableAuth(newPassword) {
  if (!newPassword || newPassword.length < 1) throw new Error('New password must be at least 1 character');

  const user = await prisma.user.findUnique({ where: { username: ADMIN_USERNAME } });
  if (!user) throw new Error('Complete setup before enabling protection');

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      authDisabled: false,
      tokenVersion: { increment: 1 },
    },
  });
  return true;
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      tokenVersion: user.tokenVersion,
    },
    config.JWT_SECRET,
    { expiresIn: config.HYDRA_MASTER_JWT_TTL }
  );
}

/**
 * Identity used when HYDRA_DISABLE_AUTH bypasses dashboard auth. Returns the
 * real admin user when present (so downstream id-scoped queries still resolve),
 * otherwise a synthetic admin identity so a headless request can proceed.
 */
export async function getBypassUser() {
  try {
    const user = await prisma.user.findUnique({
      where: { username: ADMIN_USERNAME },
      select: { id: true, username: true, tokenVersion: true, authDisabled: true },
    });
    if (user) return user;
  } catch (err) {
    logger.warn(`[AUTH] getBypassUser fell back to synthetic identity: ${err.message}`);
  }
  return { id: 'headless-admin', username: ADMIN_USERNAME, tokenVersion: 0, authDisabled: false };
}

export async function validateToken(token) {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, username: true, tokenVersion: true },
    });

    if (!user || user.tokenVersion !== payload.tokenVersion) {
      return null;
    }

    return user;
  } catch (err) {
    logger.error(`[AUTH] Token validation failed: ${err.message}`);
    return null;
  }
}
