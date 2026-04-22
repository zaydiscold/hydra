import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

async function reset() {
  const passwordHash = await bcrypt.hash('pass123', SALT_ROUNDS);
  await prisma.user.update({
    where: { username: 'admin' },
    data: { passwordHash }
  });
  console.log('Password reset to: pass123');
  await prisma.$disconnect();
}

reset();
