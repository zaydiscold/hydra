// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

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
  assert.match(ci, /npm run build[\s\S]*npm run test:ci[\s\S]*npm run gate[\s\S]*npm run build/, 'CI must build before tests, then run tests, gate, and final build');

  assert.match(docker, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*"true"/, 'Docker publish workflow must opt GitHub actions into the Node 24 runtime');
  assert.match(docker, /platforms:\s*linux\/amd64,linux\/arm64/, 'Docker publish workflow must build amd64 and arm64 images');
  assert.match(docker, /push:\s*true/, 'Docker publish workflow must push images');
  assert.match(docker, /cache-from:\s*type=registry/, 'Docker publish workflow must reuse registry cache');
  assert.match(docker, /cache-to:\s*type=registry/, 'Docker publish workflow must refresh registry cache');
});

test('electron package smoke workflow covers macOS and Linux packages on PRs', () => {
  const workflow = read('.github/workflows/electron-smoke.yml');

  assert.match(workflow, /pull_request:/, 'package smoke must run on pull requests');
  assert.match(workflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*"true"/, 'package smoke must opt into the supported Actions Node 24 runtime');
  assert.match(workflow, /node-version:\s*24/, 'package smoke must use supported Node 24');
  assert.match(workflow, /npm ci/, 'package smoke must install from lockfile');
  assert.match(workflow, /npm run lint/, 'package smoke must run lint');
  assert.match(workflow, /npm run test:ci/, 'package smoke must run the CI test summary suite');
  assert.match(workflow, /npm run gate/, 'package smoke must run integration gate');
  assert.match(workflow, /npm run electron:prepare/, 'package smoke must prepare packaged resources');
  assert.match(workflow, /npm run electron:smoke/, 'package smoke must verify packaged resources');
  assert.match(workflow, /npm run electron:smoke[\s\S]*HYDRA_BUILD_TARGET:\s*\$\{\{ matrix\.build_target \}\}/, 'package smoke must verify the target-specific Chromium payload');

  assert.match(workflow, /build_target:\s*darwin-arm64[\s\S]*target:\s*--mac zip --arm64/, 'must package Apple Silicon macOS zip');
  assert.match(workflow, /build_target:\s*darwin-x64[\s\S]*target:\s*--mac zip --x64/, 'must package Intel macOS zip');
  assert.match(workflow, /build_target:\s*linux-x64[\s\S]*target:\s*--linux AppImage --x64/, 'must package Linux AppImage');
  assert.doesNotMatch(workflow, /-\s*os:\s*windows-latest/, 'Windows is not in PR smoke matrix; release.yml still builds Windows installers on tag pushes');
});

test('release workflow uploads desktop artifacts for every release target', () => {
  const workflow = read('.github/workflows/release.yml');

  assert.match(workflow, /tags:\s*\n\s*-\s*'v\*\.\*\.\*'/, 'release workflow must run on version tags');
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*write/, 'release workflow must be allowed to publish releases');
  assert.match(workflow, /DATABASE_URL:\s*"file:\.\/prisma\/ci\.db"/, 'release workflow tests must have a deterministic SQLite URL');
  assert.match(workflow, /HYDRA_DATA_DIR:\s*"\.hydra-ci-data"/, 'release workflow tests must isolate app data');
  assert.match(workflow, /JWT_SECRET:\s*"ci-test-secret-32-characters-long"/, 'release workflow tests must have a deterministic JWT secret');
  assert.match(workflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*"true"/, 'release workflow must opt into the supported Actions Node 24 runtime');
  assert.match(workflow, /node-version:\s*24/, 'release workflow must use supported Node 24');
  assert.match(workflow, /verify:\s*\n\s*name:\s*lint, test, gate/, 'release workflow must run repository verification before packaging');
  assert.match(workflow, /verify:[\s\S]*npm run lint[\s\S]*npm run build[\s\S]*npm run test:ci[\s\S]*npm run gate[\s\S]*npm run build/, 'release verification must build dist before tests that inspect dist assets');
  assert.match(workflow, /build:[\s\S]*needs:\s*verify/, 'release packaging matrix must wait for verification');
  assert.match(workflow, /npx electron-builder \$\{\{ matrix\.target \}\} --publish never/, 'release workflow must build before publishing verified artifacts');
  assert.match(workflow, /npm run electron:smoke/, 'release workflow must smoke-check packaged resources before upload');
  assert.match(workflow, /npm run electron:smoke[\s\S]*HYDRA_BUILD_TARGET:\s*\$\{\{ matrix\.build_target \}\}/, 'release smoke must verify the target-specific Chromium payload');
  assert.match(workflow, /gh release upload "\$GITHUB_REF_NAME" "\$\{files\[@\]\}" --clobber/, 'release workflow must upload only after package smoke passes');
  assert.ok(
    workflow.indexOf('npm run electron:smoke') < workflow.indexOf('gh release upload "$GITHUB_REF_NAME"'),
    'release workflow must run smoke before GitHub Release upload',
  );
  assert.match(workflow, /actions\/upload-artifact@v4/, 'release workflow must upload built artifacts');
  assert.match(workflow, /mac-update-metadata:[\s\S]*needs:\s*build/, 'release workflow must merge macOS updater metadata after both mac packages build');
  assert.match(workflow, /scripts\/merge-mac-update-yml\.mjs/, 'release workflow must use the checked-in mac updater metadata merge script');
  assert.match(workflow, /artifacts\/mac-arm64\/latest-mac\.yml[\s\S]*artifacts\/mac-x64\/latest-mac\.yml/, 'release workflow must merge both macOS arch metadata files');
  assert.match(workflow, /grep -q 'mac-arm64\.zip' release\/latest-mac\.yml[\s\S]*grep -q 'mac-x64\.zip' release\/latest-mac\.yml/, 'release workflow must assert merged metadata covers both macOS architectures');
  assert.match(workflow, /gh release upload "\$GITHUB_REF_NAME" release\/latest-mac\.yml --clobber/, 'release workflow must replace latest-mac.yml with the merged file');

  assert.match(workflow, /name:\s*macOS arm64 zip[\s\S]*artifact:\s*\|[\s\S]*release\/Hydra-\*-mac-arm64\.zip[\s\S]*release\/latest-mac\.yml/, 'must upload macOS arm64 zip and update metadata');
  assert.match(workflow, /name:\s*macOS Intel x64 zip[\s\S]*artifact:\s*\|[\s\S]*release\/Hydra-\*-mac-x64\.zip[\s\S]*release\/latest-mac\.yml/, 'must upload macOS Intel zip and update metadata');
  assert.match(workflow, /name:\s*Windows x64 NSIS[\s\S]*artifact:\s*\|\s*\n\s*release\/Hydra-\*-win-x64\.exe/, 'must upload Windows x64 installer');
  assert.match(workflow, /name:\s*Linux x64 AppImage[\s\S]*artifact:\s*release\/Hydra-\*\.AppImage/, 'must upload Linux AppImage');
});

test('auto-version dispatches the release workflow after creating tags', () => {
  const workflow = read('.github/workflows/auto-version.yml');

  assert.match(workflow, /permissions:\s*\n\s*contents:\s*write\s*\n\s*actions:\s*write/, 'auto-version must be allowed to dispatch workflows');
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/, 'auto-version must authenticate gh workflow dispatch');
  assert.match(workflow, /git push origin "\$NEW"[\s\S]*gh workflow run release\.yml --ref "\$NEW"/, 'auto-version must dispatch release.yml on the tag ref after pushing the tag');
  assert.match(workflow, /Tags pushed by the default[\s\S]*GITHUB_TOKEN[\s\S]*do not reliably trigger another workflow run/, 'auto-version must document why explicit dispatch exists');
});

test('mac updater metadata merge keeps both architectures', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/merge-mac-update-yml.mjs');

  assert.ok(pkg.devDependencies['js-yaml'], 'mac updater merge script must declare js-yaml directly');
  assert.match(script, /yaml\.load/, 'merge script must parse electron-builder update YAML');
  assert.match(script, /version mismatch/i, 'merge script must reject mismatched versions');
  assert.match(script, /missing an arm64 zip entry/i, 'merge script must require arm64 update files');
  assert.match(script, /missing an x64 zip entry/i, 'merge script must require x64 update files');
  assert.match(script, /merged\.files\.sort/, 'merge script must write a stable files array');
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
  assert.match(script, /linux-x64[\s\S]*chrome-linux[\s\S]*chrome-linux64/, 'smoke must verify Linux Chromium payloads');
  assert.match(script, /win32-x64[\s\S]*chrome-win[\s\S]*chrome-win64/, 'smoke must verify Windows Chromium payloads');
  assert.match(script, /Chromium archive target mismatch/, 'smoke must explain wrong-target Chromium archives directly');
  assert.match(script, /unsupported HYDRA_BUILD_TARGET/, 'smoke must reject unknown target names');
  assert.match(prepareScript, /function chromiumCacheGuidance/, 'prepare must explain target-cache misses');
  assert.match(prepareScript, /Build on the target runner\/machine/, 'prepare must distinguish cross-target cache misses from local install misses');
  assert.match(prepareScript, /win32-x64\s+-> Windows x64 GitHub runner or Windows machine/, 'prepare must give Windows runner guidance');
  assert.match(prepareScript, /PLAYWRIGHT_BROWSERS_PATH cache/, 'prepare must document the explicit cache escape hatch');
  assert.match(prepareScript, /Compress-Archive/, 'prepare must create Chromium zip archives on Windows without requiring zip.exe');
  assert.match(prepareScript, /chrome-linux64/, 'prepare must accept current Playwright Linux Chromium payload names');
  assert.match(prepareScript, /chrome-win64/, 'prepare must accept current Playwright Windows Chromium payload names');
});

test('empty database generation is portable across release runners', () => {
  const script = read('scripts/build-empty-db.mjs');

  assert.match(script, /function prismaFileUrl/, 'empty DB generation must create portable Prisma SQLite URLs');
  assert.match(script, /const tempDb = resolve\(PRISMA_DIR, '\.hydra-empty-temp\.db'\)/, 'empty DB generation must use a schema-relative temporary SQLite file');
  assert.match(script, /file:\.\/\$\{basename\(path\)\}/, 'empty DB generation must use the unambiguous file:./<name> relative URL that Windows Prisma accepts');
  assert.match(script, /PRISMA_CLI, 'generate'/, 'empty DB validation must generate Prisma Client before importing it on packaging runners');
  assert.match(script, /new PrismaClient/, 'empty DB validation must use Prisma instead of a host sqlite3 binary');
  assert.match(script, /\$queryRawUnsafe\([\s\S]*sqlite_master/, 'empty DB validation must still inspect generated SQLite tables');
  assert.doesNotMatch(script, /execFileSync\(\s*['"]sqlite3['"][\s\S]*sqlite_master/, 'empty DB table validation must not require sqlite3 on Windows runners');
  const smoke = read('scripts/smoke-electron-package.mjs');
  assert.match(smoke, /linux-x64\|-linux-x86_64\|-x86_64/, 'release smoke must accept electron-builder Linux AppImage arch suffixes');
});

test('electron package smoke validates the packaged app shell without launching GUI', () => {
  const script = read('scripts/smoke-electron-package.mjs');
  const entitlements = read('desktop/entitlements.mac.plist');

  assert.match(script, /function assertPackagedShell/, 'smoke must validate the platform shell');
  assert.match(script, /function assertMacPlistContract/, 'smoke must validate macOS LaunchServices plist keys');
  assert.match(script, /function assertMacCodeSigningContract/, 'smoke must validate macOS hardened-runtime signing requirements');
  assert.match(script, /skipping signed-entitlements library-validation check/, 'smoke must allow unsigned PR bundles while still checking signed packages');
  assert.match(script, /com\.apple\.security\.cs\.disable-library-validation/, 'smoke must reject macOS packages that can dyld-fail loading Electron Framework under ad-hoc/dev signing');
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation[\s\S]*<true\/>/, 'macOS entitlements must disable library validation for Electron Framework under hardened runtime');
  assert.match(script, /function assertPackagedMacChromeContract/, 'smoke must validate packaged macOS titlebar source');
  assert.match(script, /titleBarStyle: 'hiddenInset'/, 'smoke must require packaged macOS hiddenInset titlebar');
  assert.match(script, /trafficLightPosition: \{ x: 14, y: 12 \}/, 'smoke must keep macOS traffic lights clear of renderer chrome');
  assert.match(script, /frame: true/, 'smoke must keep non-macOS windows framed');
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
  assert.match(script, /function runLaunchFailureBaselines/, 'launcher must compare failed Hydra handoffs against baseline system-app handoffs');
  assert.match(script, /Calculator\.app/, 'launcher failure diagnostics must include a known Apple app baseline');
  assert.match(script, /Do not launch\s+Contents\/MacOS\/Hydra directly/, 'launcher must warn against direct binary launch');
  assert.doesNotMatch(script, /Contents\/MacOS\/Hydra['"`]/, 'launcher must not spawn the packaged executable directly');
});

test('final dogfood preflight preserves manual release blockers', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/final-dogfood-check.mjs');

  assert.equal(pkg.scripts['dogfood:final'], 'node scripts/final-dogfood-check.mjs');
  assert.match(script, /node', \['bin\/hydra\.mjs', 'audit', '--json'\]/, 'final dogfood must run the release audit JSON command');
  assert.match(script, /--smoke/, 'final dogfood must expose packaged smoke reruns');
  assert.match(script, /--open-app/, 'final dogfood must expose packaged app launch reruns');
  assert.match(script, /--launch-diagnostics/, 'final dogfood must expose baseline LaunchServices diagnostics');
  assert.match(script, /Baseline Electron runtime --version/, 'LaunchServices diagnostics must include a stock Electron runtime baseline');
  assert.match(script, /node_modules\/electron\/dist\/Electron\.app/, 'Electron runtime baseline must use the installed Electron binary');
  assert.match(script, /Calculator\.app/, 'LaunchServices diagnostics must compare against a known Apple app');
  assert.match(script, /Hydra Finder AppleEvent handoff/, 'LaunchServices diagnostics must test the Finder AppleEvent path for Hydra');
  assert.match(script, /--docker-smoke/, 'final dogfood must expose Docker runtime smoke reruns');
  assert.match(script, /timeout:\s*timeoutMs/, 'final dogfood subprocesses must be timeout-bounded');
  assert.match(script, /result\.error\.message/, 'final dogfood subprocess timeout/errors must stay visible');
  assert.match(script, /Packaged GUI launch/, 'manual checklist must include packaged GUI launch');
  assert.match(script, /Touch ID/, 'manual checklist must include Touch ID validation');
  assert.match(script, /Live account flows/, 'manual checklist must include live account flows');
  assert.match(script, /Screenshots/, 'manual checklist must include packaged screenshot capture');
  assert.match(script, /Windows launch/, 'manual checklist must include Windows launch validation');
  assert.match(script, /not a release-complete signal while any release artifact is missing, the packaged app path is missing, audit has missing\/blocker evidence, any manual checkbox is unchecked, or any unknown --manual id was passed/, 'final dogfood must not claim release completion while release artifacts, packaged app, audit, manual evidence, or manual IDs are invalid');
});
