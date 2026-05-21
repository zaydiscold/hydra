/**
 * Smoke-check an unpacked Electron package contract.
 *
 * This is intentionally local and file-system based so it can run in CI for
 * mac/win/linux without driving a GUI. It verifies the runtime files that
 * packaged startup depends on: Prisma client engine, migrations/schema,
 * prebuilt empty DB, bundled Chromium, and package size.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const RELEASE = resolve(ROOT, 'release');
const MAX_APP_BYTES = Number(process.env.HYDRA_MAX_PACKAGED_APP_MB || 900) * 1024 * 1024;
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function findResourcesDir() {
  if (process.env.ELECTRON_APP_RESOURCES) {
    return resolve(process.env.ELECTRON_APP_RESOURCES);
  }

  const target = process.env.HYDRA_BUILD_TARGET || null;
  const targetResources = {
    'darwin-arm64': join(RELEASE, 'mac-arm64/Hydra.app/Contents/Resources'),
    'darwin-x64': join(RELEASE, 'mac/Hydra.app/Contents/Resources'),
    'linux-x64': join(RELEASE, 'linux-unpacked/resources'),
    'linux-arm64': join(RELEASE, 'linux-unpacked/resources'),
    'win32-x64': join(RELEASE, 'win-unpacked/resources'),
    'win32-ia32': join(RELEASE, 'win-unpacked/resources'),
    'win32-arm64': join(RELEASE, 'win-unpacked/resources'),
  };
  if (target && targetResources[target]) {
    return targetResources[target];
  }

  const candidates = [
    join(RELEASE, 'mac-arm64/Hydra.app/Contents/Resources'),
    join(RELEASE, 'mac/Hydra.app/Contents/Resources'),
    join(RELEASE, 'linux-unpacked/resources'),
    join(RELEASE, 'win-unpacked/resources'),
  ];

  const existing = candidates
    .filter((candidate) => existsSync(candidate))
    .map((candidate) => ({ path: candidate, mtimeMs: statSync(candidate).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return existing[0]?.path || null;
}

function dirSizeBytes(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stats = statSync(full);
    total += stats.isDirectory() ? dirSizeBytes(full) : stats.size;
  }
  return total;
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing at ${path}`);
  }
}

function assertExecutable(path, label) {
  assertExists(path, label);
  const mode = statSync(path).mode;
  if (process.platform !== 'win32' && (mode & 0o111) === 0) {
    throw new Error(`${label} is not executable at ${path}`);
  }
}

function assertFileNonEmpty(path, label) {
  assertExists(path, label);
  const stats = statSync(path);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error(`${label} is empty or not a file at ${path}`);
  }
}

function walkFiles(root, visitor) {
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const stats = statSync(full);
    visitor(full, stats);
    if (stats.isDirectory()) walkFiles(full, visitor);
  }
}

function assertNoNestedChromiumApps(resourcesDir) {
  const nestedApps = [];
  walkFiles(resourcesDir, (entry, stats) => {
    if (stats.isDirectory() && entry.endsWith('.app')) {
      nestedApps.push(relative(resourcesDir, entry));
    }
  });
  if (nestedApps.length > 0) {
    throw new Error(`[electron-smoke] nested .app bundle(s) found under Resources: ${nestedApps.join(', ')}`);
  }
}

function readMacPlistValue(infoPlist, key) {
  return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPlist], {
    encoding: 'utf8',
  }).trim();
}

function assertMacPlistContract(infoPlist) {
  const executable = readMacPlistValue(infoPlist, 'CFBundleExecutable');
  const packageType = readMacPlistValue(infoPlist, 'CFBundlePackageType');
  const bundleId = readMacPlistValue(infoPlist, 'CFBundleIdentifier');
  if (executable !== 'Hydra') {
    throw new Error(`[electron-smoke] macOS CFBundleExecutable must be Hydra, got ${executable}`);
  }
  if (packageType !== 'APPL') {
    throw new Error(`[electron-smoke] macOS CFBundlePackageType must be APPL, got ${packageType}`);
  }
  if (bundleId !== 'com.zayd.hydra') {
    throw new Error(`[electron-smoke] macOS CFBundleIdentifier must be com.zayd.hydra, got ${bundleId}`);
  }
}

function assertMacCodeSigningContract(contentsDir) {
  if (process.platform !== 'darwin') return;

  const mainExecutable = join(contentsDir, 'MacOS', 'Hydra');
  const entitlements = execFileSync('codesign', ['-d', '--entitlements', ':-', mainExecutable], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!entitlements.includes('com.apple.security.cs.disable-library-validation')) {
    throw new Error('[electron-smoke] macOS hardened runtime package must disable library validation so Electron Framework loads under ad-hoc/dev signing');
  }
}

function assertPackagedMacChromeContract(resourcesDir) {
  const windowsSourcePath = join(resourcesDir, 'app/electron/app/windows.js');
  assertExists(windowsSourcePath, 'packaged Electron window source');
  const windowsSource = readFileSync(windowsSourcePath, 'utf8');

  if (!windowsSource.includes("const isMac = process.platform === 'darwin'")) {
    throw new Error('[electron-smoke] packaged macOS window source must detect macOS');
  }
  if (!windowsSource.includes("titleBarStyle: 'hiddenInset'")) {
    throw new Error('[electron-smoke] packaged macOS main window must use hiddenInset titlebar');
  }
  if (!windowsSource.includes('trafficLightPosition: { x: 14, y: 12 }')) {
    throw new Error('[electron-smoke] packaged macOS main window must keep traffic lights clear of renderer chrome');
  }
  if (!windowsSource.includes('frame: true')) {
    throw new Error('[electron-smoke] packaged non-macOS main window must keep a framed window');
  }
}

function findReleaseArtifact(pattern) {
  if (!existsSync(RELEASE)) return null;
  return readdirSync(RELEASE)
    .map((name) => join(RELEASE, name))
    .find((artifact) => pattern.test(artifact)) || null;
}

function assertReleaseArtifact() {
  const target = process.env.HYDRA_BUILD_TARGET || null;
  if (!target) return null;
  const escapedVersion = String(pkg.version || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let artifact;
  switch (target) {
    case 'darwin-arm64':
      artifact = findReleaseArtifact(new RegExp(`Hydra-${escapedVersion}-mac-arm64\\.zip$`));
      assertExists(artifact || '', 'macOS ARM zip artifact');
      if (!/Hydra\.app\/Contents\/MacOS\/Hydra/.test(listZipEntries(artifact))) {
        throw new Error(`[electron-smoke] macOS ARM zip artifact does not contain Hydra.app executable: ${artifact}`);
      }
      break;
    case 'darwin-x64':
      artifact = findReleaseArtifact(new RegExp(`Hydra-${escapedVersion}-mac-x64\\.zip$`));
      assertExists(artifact || '', 'macOS Intel zip artifact');
      if (!/Hydra\.app\/Contents\/MacOS\/Hydra/.test(listZipEntries(artifact))) {
        throw new Error(`[electron-smoke] macOS Intel zip artifact does not contain Hydra.app executable: ${artifact}`);
      }
      break;
    case 'win32-x64':
      artifact = findReleaseArtifact(new RegExp(`Hydra-${escapedVersion}-win-x64\\.exe$`));
      assertExists(artifact || '', 'Windows x64 installer artifact');
      assertExists(`${artifact}.blockmap`, 'Windows x64 installer blockmap');
      break;
    case 'linux-x64':
      artifact = findReleaseArtifact(new RegExp(`Hydra-${escapedVersion}(?:-linux-x64|-linux-x86_64|-x86_64)?\\.AppImage$`));
      assertExecutable(artifact || '', 'Linux x64 AppImage artifact');
      break;
    default:
      return null;
  }
  if (statSync(artifact).size <= 0) {
    throw new Error(`[electron-smoke] release artifact is empty: ${artifact}`);
  }
  return artifact;
}

function assertPackagedShell(resourcesDir) {
  if (/Hydra\.app[/\\]Contents[/\\]Resources$/.test(resourcesDir)) {
    const contentsDir = dirname(resourcesDir);
    const appBundleDir = dirname(contentsDir);
    const infoPlist = join(contentsDir, 'Info.plist');
    const pkgInfo = join(contentsDir, 'PkgInfo');
    const mainExecutable = join(contentsDir, 'MacOS', 'Hydra');
    const helperExecutables = [
      join(contentsDir, 'Frameworks', 'Hydra Helper.app', 'Contents', 'MacOS', 'Hydra Helper'),
      join(contentsDir, 'Frameworks', 'Hydra Helper (GPU).app', 'Contents', 'MacOS', 'Hydra Helper (GPU)'),
      join(contentsDir, 'Frameworks', 'Hydra Helper (Plugin).app', 'Contents', 'MacOS', 'Hydra Helper (Plugin)'),
      join(contentsDir, 'Frameworks', 'Hydra Helper (Renderer).app', 'Contents', 'MacOS', 'Hydra Helper (Renderer)'),
    ];

    assertExists(infoPlist, 'macOS Info.plist');
    assertMacPlistContract(infoPlist);
    assertMacCodeSigningContract(contentsDir);
    assertPackagedMacChromeContract(resourcesDir);
    assertExists(pkgInfo, 'macOS PkgInfo');
    assertExecutable(mainExecutable, 'macOS main executable');
    for (const helper of helperExecutables) {
      assertExecutable(helper, 'macOS helper executable');
    }
    assertNoNestedChromiumApps(resourcesDir);
    return appBundleDir;
  }

  if (/win-unpacked[/\\]resources$/.test(resourcesDir)) {
    assertFileNonEmpty(join(dirname(resourcesDir), 'Hydra.exe'), 'Windows main executable');
    return dirname(resourcesDir);
  }

  if (/linux-unpacked[/\\]resources$/.test(resourcesDir)) {
    assertExecutable(join(dirname(resourcesDir), 'hydra'), 'Linux main executable');
    return dirname(resourcesDir);
  }

  return null;
}

function findPrismaEngine(resourcesDir) {
  const clientDir = join(resourcesDir, 'app/node_modules/.prisma/client');
  assertExists(clientDir, 'Prisma generated client');
  const engine = readdirSync(clientDir).find((name) =>
    name.endsWith('.node') && /query_engine/.test(name)
  );
  if (!engine) throw new Error(`Prisma query engine missing in ${clientDir}`);
  const enginePath = join(clientDir, engine);
  const target = process.env.HYDRA_BUILD_TARGET || null;
  if (target?.startsWith('win32-') && engine !== 'query_engine-windows.dll.node') {
    throw new Error(`[electron-smoke] Windows package must contain query_engine-windows.dll.node, got ${engine}`);
  }
  if (target === 'darwin-arm64' && !/darwin-arm64/.test(engine)) {
    throw new Error(`[electron-smoke] macOS ARM package must contain darwin-arm64 Prisma engine, got ${engine}`);
  }
  if (target === 'darwin-x64' && !/darwin[^-]/.test(engine)) {
    throw new Error(`[electron-smoke] macOS Intel package must contain darwin Prisma engine, got ${engine}`);
  }
  return enginePath;
}

function listZipEntries(archive) {
  if (process.platform === 'win32') {
    // Use $env:HYDRA_SMOKE_ZIP instead of $args[0]; PowerShell does not
    // reliably populate $args when invoked via `powershell.exe -Command
    // "<script>" arg`, which silently yields $null and an empty listing.
    return execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      [
        '$ErrorActionPreference = "Stop";',
        'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
        '$zip = [IO.Compression.ZipFile]::OpenRead($env:HYDRA_SMOKE_ZIP);',
        'try { $zip.Entries | ForEach-Object { $_.FullName } } finally { $zip.Dispose() }',
      ].join(' '),
    ], {
      encoding: 'utf8',
      env: { ...process.env, HYDRA_SMOKE_ZIP: archive },
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  return execFileSync('unzip', ['-l', archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function expectedChromiumChildrenForTarget() {
  const target = process.env.HYDRA_BUILD_TARGET || null;
  if (!target) return [];
  switch (target) {
    case 'darwin-arm64':
      return ['chrome-mac-arm64'];
    case 'darwin-x64':
      return ['chrome-mac-x64', 'chrome-mac'];
    case 'linux-x64':
    case 'linux-arm64':
      return ['chrome-linux', 'chrome-linux64'];
    case 'win32-x64':
    case 'win32-ia32':
    case 'win32-arm64':
      return ['chrome-win', 'chrome-win64'];
    default:
      throw new Error(`[electron-smoke] unsupported HYDRA_BUILD_TARGET: ${target}`);
  }
}

function hasBundledChromium(resourcesDir) {
  const archive = join(resourcesDir, 'chromium.zip');
  const expectedChildren = expectedChromiumChildrenForTarget();
  if (existsSync(archive)) {
    try {
      const listing = listZipEntries(archive);
      const hasExpectedTarget = expectedChildren.length === 0 ||
        expectedChildren.some((child) => listing.includes(`${child}/`));
      if (!hasExpectedTarget) {
        throw new Error(
          `[electron-smoke] Chromium archive target mismatch for HYDRA_BUILD_TARGET=${process.env.HYDRA_BUILD_TARGET}; ` +
          `expected one of ${expectedChildren.join(', ')} in ${archive}`
        );
      }
      return hasExpectedTarget &&
        /chrome-(?:mac|mac-x64|mac-arm64|linux|linux64|win|win64)\//.test(listing) &&
        /(Google Chrome for Testing|Chromium|chrome(?:\.exe)?)/.test(listing);
    } catch (err) {
      if (/Chromium archive target mismatch/.test(err?.message || '')) throw err;
      return false;
    }
  }

  const candidates = [
    join(resourcesDir, 'chromium/Chromium.app/Contents/MacOS/Chromium'),
    join(resourcesDir, 'chromium/chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
    join(resourcesDir, 'chromium/chrome-mac-x64/Chromium.app/Contents/MacOS/Chromium'),
    join(resourcesDir, 'chromium/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'),
    join(resourcesDir, 'chromium/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(resourcesDir, 'chromium/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(resourcesDir, 'chromium/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(resourcesDir, 'chromium/chrome-linux/chrome'),
    join(resourcesDir, 'chromium/chrome-linux64/chrome'),
    join(resourcesDir, 'chromium/chrome-win/chrome.exe'),
    join(resourcesDir, 'chromium/chrome-win64/chrome.exe'),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

console.log(`[electron-smoke] start target=${process.env.HYDRA_BUILD_TARGET || '(host)'} platform=${process.platform} arch=${process.arch}`);
const resourcesDir = findResourcesDir();
console.log(`[electron-smoke] resourcesDir=${resourcesDir}`);
if (!resourcesDir) {
  throw new Error('No unpacked Electron resources directory found under release/. Build with electron-builder first.');
}

console.log(`[electron-smoke] -> assertPackagedShell`);
const packageShell = assertPackagedShell(resourcesDir);
console.log(`[electron-smoke] -> assertReleaseArtifact`);
const releaseArtifact = assertReleaseArtifact();
console.log(`[electron-smoke] -> assert Prisma schema/migrations/empty-db`);
assertExists(join(resourcesDir, 'prisma/schema.prisma'), 'Prisma schema resource');
assertExists(join(resourcesDir, 'prisma/migrations'), 'Prisma migrations resource');
assertExists(join(resourcesDir, 'data/empty-hydra.db'), 'Empty packaged DB');
console.log(`[electron-smoke] -> findPrismaEngine`);
const engine = findPrismaEngine(resourcesDir);
console.log(`[electron-smoke] -> hasBundledChromium`);
if (!hasBundledChromium(resourcesDir)) {
  throw new Error(`Bundled Chromium missing under ${join(resourcesDir, 'chromium')} or ${join(resourcesDir, 'chromium.zip')}`);
}

const appDir = join(resourcesDir, 'app');
const appSize = existsSync(appDir) ? dirSizeBytes(appDir) : dirSizeBytes(resourcesDir);
if (appSize > MAX_APP_BYTES) {
  throw new Error(`Packaged app is too large: ${Math.round(appSize / 1024 / 1024)} MB`);
}

const prisma = new PrismaClient({
  datasources: { db: { url: `file:${join(resourcesDir, 'data/empty-hydra.db')}` } },
  log: [],
});
try {
  await prisma.$queryRaw`SELECT 1`;
} finally {
  await prisma.$disconnect();
}

console.log(`[electron-smoke] resources: ${resourcesDir}`);
if (packageShell) console.log(`[electron-smoke] package shell: ${packageShell}`);
if (releaseArtifact) console.log(`[electron-smoke] release artifact: ${releaseArtifact}`);
console.log(`[electron-smoke] prisma engine: ${engine}`);
console.log(`[electron-smoke] app size: ${Math.round(appSize / 1024 / 1024)} MB`);
console.log('[electron-smoke] packaged resource contract OK');
