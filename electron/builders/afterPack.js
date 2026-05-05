/**
 * afterPack — Post-packaging hook for electron-builder.
 * Verifies that Prisma native binaries exist outside the asar archive.
 * Fails the build if binaries are missing.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

export default async function afterPack(context) {
  const { appOutDir, packager } = context;

  // HIGH #12: Use platformToTargets for reliable cross-compile detection.
  // packager.platformToTargets is a Map<Platform, Map<Arch, Target[]>>.
  // Iterate its keys to discover the actual target platform(s) being built,
  // which is more robust than packager.platform?.nodeName when cross-compiling.
  const targetPlatforms = context.packager.platformToTargets;
  const platform = targetPlatforms.size > 0
    ? [...targetPlatforms.keys()][0].nodeName
    : packager.platform?.nodeName || process.platform;

  const engineName = platform === 'darwin'
    ? 'libquery_engine-darwin.dylib.node'
    : platform === 'win32'
      ? 'query_engine-windows.dll.node'
      : 'libquery_engine-linux.so.node';

  // LOW #22: Use packager.getResourcesDir() if available for reliable path resolution.
  // Fall back to the manual path construction for older electron-builder versions.
  const resourcesDir = typeof packager.getResourcesDir === 'function'
    ? packager.getResourcesDir(appOutDir)
    : path.join(appOutDir, '..', 'unpacked');

  // The binary lives outside asar, in the unpacked directory (i.e., inside the resources dir)
  const expectedPath = path.join(resourcesDir, 'node_modules', '.prisma', 'client', engineName);

  if (!existsSync(expectedPath)) {
    throw new Error(`Prisma native binary not found at ${expectedPath}. Check asarUnpack config.`);
  }

  console.log(`[afterPack] ✅ Prisma ${platform} engine verified: ${expectedPath}`);
}
