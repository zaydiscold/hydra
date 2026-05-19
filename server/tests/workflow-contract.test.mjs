import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf-8');
}

test('CI and Docker workflows run on the supported Node 24 action runtime', () => {
  const ci = read('.github/workflows/ci.yml');
  const docker = read('.github/workflows/docker.yml');

  assert.match(ci, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*"true"/, 'CI must opt GitHub actions into the Node 24 runtime');
  assert.match(ci, /node-version:\s*24/, 'CI must install supported Node 24 for repo commands');
  assert.match(ci, /npm ci/, 'CI must install from lockfile');
  assert.match(ci, /npm run lint/, 'CI must run lint');
  assert.match(ci, /npm run build[\s\S]*npm test[\s\S]*npm run gate[\s\S]*npm run build/, 'CI must build before tests, then run tests, gate, and final build');

  assert.match(docker, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*"true"/, 'Docker publish workflow must opt GitHub actions into the Node 24 runtime');
  assert.match(docker, /platforms:\s*linux\/amd64,linux\/arm64/, 'Docker publish workflow must build amd64 and arm64 images');
  assert.match(docker, /push:\s*true/, 'Docker publish workflow must push images');
  assert.match(docker, /cache-from:\s*type=registry/, 'Docker publish workflow must reuse registry cache');
  assert.match(docker, /cache-to:\s*type=registry/, 'Docker publish workflow must refresh registry cache');
});

test('electron package smoke workflow covers macOS, Windows, and Linux packages', () => {
  const workflow = read('.github/workflows/electron-smoke.yml');

  assert.match(workflow, /pull_request:/, 'package smoke must run on pull requests');
  assert.match(workflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*"true"/, 'package smoke must opt into the supported Actions Node 24 runtime');
  assert.match(workflow, /node-version:\s*24/, 'package smoke must use supported Node 24');
  assert.match(workflow, /npm ci/, 'package smoke must install from lockfile');
  assert.match(workflow, /npm run lint/, 'package smoke must run lint');
  assert.match(workflow, /npm test/, 'package smoke must run the full test suite');
  assert.match(workflow, /npm run gate/, 'package smoke must run integration gate');
  assert.match(workflow, /npm run electron:prepare/, 'package smoke must prepare packaged resources');
  assert.match(workflow, /npm run electron:smoke/, 'package smoke must verify packaged resources');
  assert.match(workflow, /npm run electron:smoke[\s\S]*HYDRA_BUILD_TARGET:\s*\$\{\{ matrix\.build_target \}\}/, 'package smoke must verify the target-specific Chromium payload');

  assert.match(workflow, /build_target:\s*darwin-arm64[\s\S]*target:\s*--mac zip --arm64/, 'must package Apple Silicon macOS zip');
  assert.match(workflow, /build_target:\s*darwin-x64[\s\S]*target:\s*--mac zip --x64/, 'must package Intel macOS zip');
  assert.match(workflow, /build_target:\s*win32-x64[\s\S]*target:\s*--win nsis --x64/, 'must package Windows x64 NSIS installer');
  assert.match(workflow, /build_target:\s*linux-x64[\s\S]*target:\s*--linux AppImage --x64/, 'must package Linux AppImage');
});

test('release workflow uploads desktop artifacts for every release target', () => {
  const workflow = read('.github/workflows/release.yml');

  assert.match(workflow, /tags:\s*\n\s*-\s*'v\*\.\*\.\*'/, 'release workflow must run on version tags');
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*write/, 'release workflow must be allowed to publish releases');
  assert.match(workflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*"true"/, 'release workflow must opt into the supported Actions Node 24 runtime');
  assert.match(workflow, /node-version:\s*24/, 'release workflow must use supported Node 24');
  assert.match(workflow, /npx electron-builder \$\{\{ matrix\.target \}\} --publish never/, 'release workflow must build before publishing verified artifacts');
  assert.match(workflow, /npm run electron:smoke/, 'release workflow must smoke-check packaged resources before upload');
  assert.match(workflow, /npm run electron:smoke[\s\S]*HYDRA_BUILD_TARGET:\s*\$\{\{ matrix\.build_target \}\}/, 'release smoke must verify the target-specific Chromium payload');
  assert.match(workflow, /gh release upload "\$GITHUB_REF_NAME" "\$\{files\[@\]\}" --clobber/, 'release workflow must upload only after package smoke passes');
  assert.ok(
    workflow.indexOf('npm run electron:smoke') < workflow.indexOf('gh release upload "$GITHUB_REF_NAME"'),
    'release workflow must run smoke before GitHub Release upload',
  );
  assert.match(workflow, /actions\/upload-artifact@v4/, 'release workflow must upload built artifacts');

  assert.match(workflow, /name:\s*macOS arm64 zip[\s\S]*artifact:\s*release\/Hydra-\*\.zip/, 'must upload macOS arm64 zip');
  assert.match(workflow, /name:\s*macOS Intel x64 zip[\s\S]*artifact:\s*release\/Hydra-\*\.zip/, 'must upload macOS Intel zip');
  assert.match(workflow, /name:\s*Windows x64 NSIS[\s\S]*artifact:\s*\|\s*\n\s*release\/Hydra-\*-win-x64\.exe/, 'must upload Windows x64 installer');
  assert.match(workflow, /name:\s*Linux x64 AppImage[\s\S]*artifact:\s*release\/Hydra-\*\.AppImage/, 'must upload Linux AppImage');
});

test('dev port cleanup includes preview ports and preserves failed-kill evidence', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/free-dev-ports.mjs');

  assert.match(pkg.scripts.dev, /node scripts\/free-dev-ports\.mjs/, 'npm run dev must run port cleanup first');
  assert.match(script, /HYDRA_PREVIEW_PORT\s*\?\?\s*4173/, 'cleanup must cover default Vite preview port');
  assert.match(script, /HYDRA_EXTRA_DEV_PORTS/, 'cleanup must allow explicit extra ports');
  assert.match(script, /warnPortCleanup\('failed to kill Unix listener'/, 'Unix kill failures must be visible');
  assert.match(script, /warnPortCleanup\('failed to kill Windows listener'/, 'Windows kill failures must be visible');
  assert.match(script, /port may still be occupied after cleanup attempt/, 'uncleared ports must be reported');
  assert.doesNotMatch(script, /catch\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/, 'port cleanup must not silently ignore failures');
});

test('utility probes do not hide diagnostic failures', () => {
  const iconScript = read('scripts/generate-icons.mjs');
  const trpcProbe = read('scripts/testing/test-trpc-routes.mjs');

  assert.match(iconScript, /Could not list generated icon files/, 'icon generation listing failures must be visible');
  assert.doesNotMatch(iconScript, /catch\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/, 'icon generation must not silently ignore listing failures');

  assert.match(trpcProbe, /\.\.\/\.\.\/server\/services\/store\.js/, 'tRPC probe must import server services from the repo root');
  assert.match(trpcProbe, /failed to refresh Clerk JWT/, 'tRPC probe must report JWT refresh failures');
  assert.match(trpcProbe, /failed to parse JSON response body/, 'tRPC probe must report malformed JSON responses');
  assert.doesNotMatch(trpcProbe, /catch\s*\{\s*\}/, 'tRPC probe must not silently ignore failures');
});

test('electron package smoke validates target-specific Chromium archives', () => {
  const script = read('scripts/smoke-electron-package.mjs');
  const prepareScript = read('scripts/prepare-electron-resources.mjs');

  assert.match(script, /const target = process\.env\.HYDRA_BUILD_TARGET \|\| null/, 'smoke must read the requested build target before choosing resources');
  assert.match(script, /'darwin-arm64': join\(RELEASE, 'mac-arm64\/Hydra\.app\/Contents\/Resources'\)/, 'smoke must choose ARM resources for darwin-arm64');
  assert.match(script, /'darwin-x64': join\(RELEASE, 'mac\/Hydra\.app\/Contents\/Resources'\)/, 'smoke must choose x64 resources for darwin-x64');
  assert.match(script, /'win32-x64': join\(RELEASE, 'win-unpacked\/resources'\)/, 'smoke must choose Windows resources for win32-x64');
  assert.match(script, /expectedChromiumChildrenForTarget/, 'smoke must map HYDRA_BUILD_TARGET to expected Chromium zip children');
  assert.match(script, /darwin-arm64[\s\S]*chrome-mac-arm64/, 'smoke must verify Apple Silicon Chromium payloads');
  assert.match(script, /darwin-x64[\s\S]*chrome-mac-x64/, 'smoke must verify Intel macOS Chromium payloads');
  assert.match(script, /linux-x64[\s\S]*chrome-linux/, 'smoke must verify Linux Chromium payloads');
  assert.match(script, /win32-x64[\s\S]*chrome-win/, 'smoke must verify Windows Chromium payloads');
  assert.match(script, /Chromium archive target mismatch/, 'smoke must explain wrong-target Chromium archives directly');
  assert.match(script, /unsupported HYDRA_BUILD_TARGET/, 'smoke must reject unknown target names');
  assert.match(prepareScript, /function chromiumCacheGuidance/, 'prepare must explain target-cache misses');
  assert.match(prepareScript, /Build on the target runner\/machine/, 'prepare must distinguish cross-target cache misses from local install misses');
  assert.match(prepareScript, /win32-x64\s+-> Windows x64 GitHub runner or Windows machine/, 'prepare must give Windows runner guidance');
  assert.match(prepareScript, /PLAYWRIGHT_BROWSERS_PATH cache/, 'prepare must document the explicit cache escape hatch');
});

test('electron package smoke validates the packaged app shell without launching GUI', () => {
  const script = read('scripts/smoke-electron-package.mjs');

  assert.match(script, /function assertPackagedShell/, 'smoke must validate the platform shell');
  assert.match(script, /function assertMacPlistContract/, 'smoke must validate macOS LaunchServices plist keys');
  assert.match(script, /function assertPackagedMacChromeContract/, 'smoke must validate packaged macOS native titlebar source');
  assert.match(script, /frame: useNativeMacChrome/, 'smoke must require packaged macOS AppKit frame ownership');
  assert.match(script, /titleBarStyle\\s\*:/, 'smoke must reject packaged hidden-titlebar overrides');
  assert.match(script, /macOS Info\.plist/, 'smoke must require macOS Info.plist');
  assert.match(script, /CFBundleExecutable must be Hydra/, 'smoke must verify the macOS bundle executable name');
  assert.match(script, /CFBundlePackageType must be APPL/, 'smoke must verify the macOS bundle package type');
  assert.match(script, /CFBundleIdentifier must be com\.zayd\.hydra/, 'smoke must verify the macOS bundle identifier');
  assert.match(script, /macOS PkgInfo/, 'smoke must require macOS PkgInfo');
  assert.match(script, /macOS main executable/, 'smoke must require the macOS main executable');
  assert.match(script, /Hydra Helper \(Renderer\)/, 'smoke must require Electron helper executables');
  assert.match(script, /nested \.app bundle\(s\) found under Resources/, 'smoke must reject nested .app bundles under Resources');
  assert.match(script, /function assertFileNonEmpty/, 'smoke must support non-POSIX executable checks for Windows artifacts from macOS/Linux hosts');
  assert.match(script, /assertFileNonEmpty\(join\(dirname\(resourcesDir\), 'Hydra\.exe'\), 'Windows main executable'\)/, 'smoke must not require a POSIX executable bit on Windows .exe files');
  assert.match(script, /Windows main executable/, 'smoke must require the Windows executable');
  assert.match(script, /Linux main executable/, 'smoke must require the Linux executable');
});

test('electron package smoke validates distributable release artifacts', () => {
  const script = read('scripts/smoke-electron-package.mjs');

  assert.match(script, /function assertReleaseArtifact/, 'smoke must validate the distributable artifact');
  assert.match(script, /macOS ARM zip artifact/, 'smoke must require the macOS ARM zip artifact');
  assert.match(script, /macOS Intel zip artifact/, 'smoke must require the macOS Intel zip artifact');
  assert.match(script, /Windows x64 installer artifact/, 'smoke must require the Windows installer artifact');
  assert.match(script, /Windows x64 installer blockmap/, 'smoke must require the Windows installer blockmap');
  assert.match(script, /Linux x64 AppImage artifact/, 'smoke must require the Linux AppImage artifact');
  assert.match(script, /query_engine-windows\.dll\.node/, 'smoke must require the Windows Prisma engine for Windows packages');
  assert.match(script, /macOS ARM package must contain darwin-arm64 Prisma engine/, 'smoke must reject wrong macOS ARM Prisma engines');
  assert.match(script, /macOS Intel package must contain darwin Prisma engine/, 'smoke must reject wrong macOS Intel Prisma engines');
  assert.match(script, /zip artifact does not contain Hydra\.app executable/, 'smoke must inspect macOS zip contents for the app executable');
  assert.match(script, /release artifact is empty/, 'smoke must reject empty artifacts');
});

test('packaged app dogfood launcher uses LaunchServices instead of direct executable spawn', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/open-packaged-app.mjs');

  assert.equal(pkg.scripts['electron:open:mac-arm64'], 'node scripts/open-packaged-app.mjs release/mac-arm64/Hydra.app');
  assert.match(script, /spawn\('open', args/, 'packaged GUI dogfood must launch through macOS open');
  assert.match(script, /function preflightBundle/, 'launcher must verify the app bundle before asking LaunchServices to open it');
  assert.match(script, /function runPreLaunchDiagnostics/, 'launcher must collect pre-launch package diagnostics');
  assert.match(script, /CFBundleExecutable/, 'launcher must report the executable declared in Info.plist');
  assert.match(script, /CFBundlePackageType/, 'launcher must verify the bundle is an APPL package');
  assert.match(script, /codesign.*--verify.*--deep.*--strict/, 'launcher must verify codesign before GUI dogfood');
  assert.match(script, /com\.apple\.quarantine/, 'launcher must report quarantine xattrs when present');
  assert.match(script, /function runProcessDiagnostics/, 'launcher must look for the app process after LaunchServices handoff');
  assert.match(script, /Do not launch\s+Contents\/MacOS\/Hydra directly/, 'launcher must warn against direct binary launch');
  assert.doesNotMatch(script, /Contents\/MacOS\/Hydra['"`]/, 'launcher must not spawn the packaged executable directly');
});