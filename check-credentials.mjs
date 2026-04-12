#!/usr/bin/env node
/**
 * Check stored credentials for accounts
 */

import { prisma } from './server/services/db.js';
import { decryptConfig, decrypt } from './server/services/storage-codec.js';

const ACCOUNTS = [
  { id: '6f1d28e8-bc8d-4557-b589-66b6db341f8c', alias: 'admin@zayd.world' },
  { id: 'cecff6a9-cbcc-4110-93ec-409299474b82', alias: 'iam@zayd.wtf' },
  { id: '09f8cc49-9308-4977-9f18-15d1a7e13216', alias: 'zayd@zayd.wtf' },
  { id: '529c3bc9-d8b4-49c7-8fee-957e54db4c50', alias: 'delilah@zayd.wtf' },
];

async function main() {
  console.log('Checking stored credentials for accounts...\n');

  // Get first user
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user found');
    return;
  }
  console.log(`Found user: ${user.id} (${user.username})\n`);

  for (const acc of ACCOUNTS) {
    console.log(`Account: ${acc.alias} (${acc.id})`);

    try {
      const account = await prisma.account.findFirst({
        where: { id: acc.id, userId: user.id }
      });

      if (!account) {
        console.log('  ❌ Account not found in database');
        continue;
      }

      console.log(`  ✅ Found in database`);
      console.log(`  Alias: ${account.alias}`);
      console.log(`  Created: ${account.createdAt}`);

      // Decrypt config
      try {
        const config = decryptConfig(account.config);
        console.log(`  📧 Email: ${config.email || 'N/A'}`);
        console.log(`  🔑 Has password: ${config.password ? 'Yes' : 'No'}`);
        console.log(`  🔐 Auth method: ${config.authMethod || 'N/A'}`);
        console.log(`  🗝️  Has managementKey: ${config.managementKey ? 'Yes (corrupted)' : 'No'}`);

        if (config.managementKey) {
          console.log(`  🗝️  Management key preview: ${config.managementKey.substring(0, 30)}...`);
        }
      } catch (err) {
        console.log(`  ⚠️  Could not decrypt config: ${err.message}`);
      }

      // Check session token
      try {
        const sessionToken = decrypt(account.sessionToken);
        console.log(`  🍪 Has session token: ${sessionToken ? 'Yes' : 'No'}`);
        if (sessionToken) {
          console.log(`  🍪 Session token preview: ${sessionToken.substring(0, 50)}...`);
        }
      } catch (err) {
        console.log(`  ⚠️  Could not decrypt session token: ${err.message}`);
      }

    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
    }

    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
