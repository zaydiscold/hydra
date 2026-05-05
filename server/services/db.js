import pkg from '@prisma/client';
const { PrismaClient } = pkg;

export const prisma = new PrismaClient();

export async function disconnectPrisma() {
  try { await prisma.$disconnect(); } catch { /* best effort */ }
}
