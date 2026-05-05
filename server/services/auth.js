import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs/promises';
import path from 'node:path';

import { prisma } from './db.js';
import { config } from '../config.js';
import { logger } from './logger.js';

const SALT_ROUNDS = 12;
const ADMIN_USERNAME = 'admin';
// ─── ELECTRON_MIGRATION ───
// TODO: PAIN_POINTS.md #5 — Replace process.cwd() with:
//   process.env.HYDRA_DATA_DIR || path.join(process.cwd(), 'data')
// Same pattern needed in: local-secrets.js, proxy-gate.js, redemption-log.js
// ─── END ELECTRON_MIGRATION ───
const DATA_DIR = process.env.HYDRA_DATA_DIR || path.join(process.cwd(), 'data');
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
    const [userCount, accountCount] = await Promise.all([
      prisma.user.count(),
      prisma.account.count(),
    ]);
    return {
      setup: userCount > 0 && accountCount > 0,
      hasUser: userCount > 0,
      hasAccounts: accountCount > 0,
      bootstrapRequired: userCount > 0 && accountCount === 0,
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
