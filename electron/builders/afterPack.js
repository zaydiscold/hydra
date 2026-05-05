/**
 * afterPack — Post-packaging hook for electron-builder.
 * Verifies that Prisma native binaries exist outside the asar archive.
 * Fails the build if binaries are missing.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

export default async function afterPack(context) {
  const { appOutDir, packager } = context;
  const platform = packager.platform?.nodeName || process.platform;

  const engineName = platform === 'darwin'
    ? 'libquery_engine-darwin.dylib.node'
    : platform === 'win32'
      ? 'query_engine-windows.dll.node'
      : 'libquery_engine-linux.so.node';

  // The binary lives outside asar, in the unpacked directory
  const unpackDir = path.join(appOutDir, '..', 'unpacked');
  const expectedPath = path.join(unpackDir, 'node_modules', '.prisma', 'client', engineName);

  if (!existsSync(expectedPath)) {
    throw new Error(`Prisma native binary not found at ${expectedPath}. Check asarUnpack config.`);
  }

  console.log(`[afterPack] ✅ Prisma ${platform} engine verified: ${expectedPath}`);
}
