import pkg from '@prisma/client';
const { PrismaClient } = pkg;

// ─── ELECTRON_MIGRATION ───
// TODO: PAIN_POINTS.md #8 — PrismaClient loads a native query engine binary
// via require(). In Electron's asar, dlopen() cannot load .node files from
// the read-only archive. Fix: add electron-builder.yml asarUnpack for:
//   node_modules/.prisma/**
//   node_modules/@prisma/client/**
// Also DATABASE_URL must be set BEFORE this file is imported (see electron/main.js).
// ─── END ELECTRON_MIGRATION ───
export const prisma = new PrismaClient();
