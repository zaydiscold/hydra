/**
 * afterPack — Post-packaging hook for electron-builder.
 *
 * Workaround for a long-standing electron-builder bug: dotfile directories
 * inside `node_modules` (notably `.prisma/client/`) are filtered out by the
 * default node_modules glob and there's no reliable YAML pattern to opt them
 * back in. We copy the directory in manually after packaging completes.
 *
 * https://github.com/electron-userland/electron-builder/issues/3537
 */
import { existsSync, mkdirSync, cpSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Map (platform, arch) → Prisma engine binary filename. */
function engineNameFor(platform, arch) {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'libquery_engine-darwin-arm64.dylib.node' : 'libquery_engine-darwin.dylib.node';
  }
  if (platform === 'win32') return 'query_engine-windows.dll.node';
  if (arch === 'arm64') return 'libquery_engine-linux-arm64-openssl-3.0.x.so.node';
  return 'libquery_engine-debian-openssl-3.0.x.so.node';
}

function prunePrismaClientRuntime(unpackedNodeModules) {
  const runtimeDir = path.join(unpackedNodeModules, '@prisma', 'client', 'runtime');
  if (!existsSync(runtimeDir)) return;

  const removable = [
    /^query_engine_bg\./,
    /^query_compiler_bg\./,
    /^wasm-/,
    /^edge(?:-|\.|$)/,
    /^index-browser\./,
    /^react-native\./,
    /\.map$/,
  ];

  let removed = 0;
  for (const file of readdirSync(runtimeDir)) {
    if (!removable.some((pattern) => pattern.test(file))) continue;
    rmSync(path.join(runtimeDir, file), { force: true });
    removed += 1;
  }
  if (removed > 0) {
    console.log(`[afterPack] ✅ pruned ${removed} unused @prisma/client runtime files`);
  }
}

export default async function afterPack(context) {
  const { appOutDir, packager } = context;

  // Reliable platform/arch detection: prefer platformToTargets, fall back gracefully.
  const targetPlatforms = packager.platformToTargets;
  const platform = targetPlatforms?.size > 0
    ? [...targetPlatforms.keys()][0].nodeName
    : (packager.platform?.nodeName || process.platform);
  // electron-builder Arch enum: ia32=0, x64=1, armv7l=2, arm64=3, universal=4
  // #46: Universal builds (arch=4) need BOTH x64 and arm64 engines. Detect
  // the build arch and include all needed engines for the target platform.
  const arch = context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : context.arch === 4 ? 'universal' : (process.arch === 'arm64' ? 'arm64' : 'x64');

  const resourcesDir = typeof packager.getResourcesDir === 'function'
    ? packager.getResourcesDir(appOutDir)
    : path.join(appOutDir, 'Contents', 'Resources');

  // Detect asar:true vs asar:false layout.
  // asar:true  → Resources/app.asar.unpacked/node_modules/
  // asar:false → Resources/app/node_modules/
  const asarUnpackedRoot = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');
  const noAsarRoot = path.join(resourcesDir, 'app', 'node_modules');
  const unpackedNodeModules = existsSync(path.dirname(noAsarRoot)) ? noAsarRoot : asarUnpackedRoot;
  const targetPrismaDir = path.join(unpackedNodeModules, '.prisma');
  const sourcePrismaDir = path.join(REPO_ROOT, 'node_modules', '.prisma');

  // Step 1: copy node_modules/.prisma into the packaged node_modules layout.
  if (!existsSync(sourcePrismaDir)) {
    throw new Error(`[afterPack] source .prisma not found at ${sourcePrismaDir} — run \`npx prisma generate\` first`);
  }
  mkdirSync(unpackedNodeModules, { recursive: true });
  // Only ship the engine binary for THIS build's platform+arch; the others
  // are ~20 MB each and uselessly inflate the package.
  // #46: For universal builds, keep BOTH x64 and arm64 engines.
  const isUniversal = arch === 'universal';
  const wantedEngine = isUniversal ? null : engineNameFor(platform, arch);
  const universalEngines = isUniversal
    ? new Set([engineNameFor(platform, 'arm64'), engineNameFor(platform, 'x64')])
    : null;
  // Generated bundler-specific JS shims that ship inside .prisma/client/.
  // We use only the native Node engine — these are dead weight and confuse
  // bundlers that follow conditional exports.
  const deadPrismaClientJs = new Set(['browser.js', 'edge.js', 'wasm.js']);
  let keptCount = 0;
  cpSync(sourcePrismaDir, targetPrismaDir, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      // Drop foreign engine binaries (keep only platform-appropriate ones)
      if (src.endsWith('.dylib.node') || src.endsWith('.so.node') || src.endsWith('.dll.node')) {
        const base = path.basename(src);
        const keep = isUniversal ? universalEngines.has(base) : base === wantedEngine;
        if (keep) keptCount += 1;
        return keep;
      }
      // Drop wasm/edge-runtime variants — we only use the native engine
      if (src.endsWith('.wasm') || src.includes('wasm-')) return false;
      // Drop dead JS shims for non-Node runtimes (browser/edge/wasm)
      const base = path.basename(src);
      if (deadPrismaClientJs.has(base)) return false;
      // Drop generated wasm/edge query_engine_bg.* sidecars (e.g. .js, .wasm-base64.js, .d.ts)
      if (base.startsWith('query_engine_bg.')) return false;
      keptCount += 1;
      return true;
    },
  });
  console.log(`[afterPack] ✅ copied .prisma → ${targetPrismaDir} (${isUniversal ? `${[...universalEngines].join(' + ')} (universal)` : wantedEngine} only, ${keptCount} files kept)`);

  prunePrismaClientRuntime(unpackedNodeModules);

  // Step 2: verify the engine binary for THIS build's platform+arch is present
  const engineName = engineNameFor(platform, arch);
  const expected = path.join(targetPrismaDir, 'client', engineName);
  if (!existsSync(expected)) {
    let present = [];
    try {
      present = readdirSync(path.join(targetPrismaDir, 'client'));
    } catch { /* dir doesn't exist */ }
    throw new Error(`[afterPack] expected Prisma engine ${engineName} at ${expected}; found: ${present.join(', ') || '(none)'}`);
  }
  console.log(`[afterPack] ✅ Prisma engine verified: ${expected}`);
}
