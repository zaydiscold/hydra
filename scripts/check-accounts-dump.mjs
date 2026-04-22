import { PrismaClient } from '@prisma/client';
import { decrypt, decryptConfig } from '../server/services/storage-codec.js';
const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.account.findMany();
  for (const acc of accounts) {
    const decToken = decrypt(acc.sessionToken) || '';
    let conf = {};
    if (acc.config) {
      try {
        conf = decryptConfig(acc.config);
      } catch (e) { conf = { error: 'parse error' }; }
    }
    console.log(`\nAccount: ${acc.alias}`);
    console.log(`Config keys: ${Object.keys(conf).join(', ')}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
