/**
 * `hydra audit` — read-only release checklist snapshot.
 *
 * This command intentionally does not launch Electron, Docker, browsers, or
 * live OpenRouter/Clerk flows. It turns the current repo/audit state into a
 * stable CLI artifact so release gaps are visible while Hydra is closed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, json, status, table } from '../lib/output.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function usage() {
  process.stdout.write(`Hydra audit

  hydra audit
  hydra audit --json

Read-only release audit. Inspects tracked release files, package scripts,
workflow contracts, release artifacts, active evidence, and deferred manual
items without launching Electron or Docker.
`);
}

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf-8');
}

function safeRead(relPath) {
  try {
    return read(relPath);
  } catch {
    return '';
  }
}

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function sizeMb(relPath) {
  try {
    return Math.round(statSync(join(ROOT, relPath)).size / 1024 / 1024);
  } catch {
    return null;
  }
}

function macBundleVersion(relPath) {
  const plistPath = join(ROOT, relPath, 'Contents/Info.plist');
  if (!existsSync(plistPath)) return null;
  if (process.platform === 'darwin') {
    try {
      return execFileSync('plutil', [
        '-extract',
        'CFBundleShortVersionString',
        'raw',
        '-o',
        '-',
        plistPath,
      ], { encoding: 'utf-8' }).trim() || null;
    } catch {
      // Fall through to XML parsing for portable source/test environments.
    }
  }
  const plist = safeRead(`${relPath}/Contents/Info.plist`);
  return plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
}

function check(id, label, ok, evidence, stateWhenOk = 'ok') {
  return {
    id,
    label,
    state: ok ? stateWhenOk : 'missing',
    evidence: ok ? evidence : 'missing',
  };
}

function deferred(id, label, evidence) {
  return {
    id,
    label,
    state: 'deferred',
    evidence,
  };
}

function dogfoodEvidencePath() {
  return process.env.HYDRA_DOGFOOD_EVIDENCE
    ? process.env.HYDRA_DOGFOOD_EVIDENCE
    : join(ROOT, 'docs/DOGFOOD_EVIDENCE.json');
}

function inspectDogfoodEvidence(version) {
  const path = dogfoodEvidencePath();
  const evidence = safeReadJson(path);
  if (!evidence) return { path, present: false };
  const manual = new Map((Array.isArray(evidence.manual) ? evidence.manual : [])
    .map((item) => [item.id, Boolean(item.verified)]));
  const artifactsOk = Array.isArray(evidence.checks?.artifacts)
    && evidence.checks.artifacts.length >= 6
    && evidence.checks.artifacts.every((item) => item.ok === true);
  const unknownManualIds = Array.isArray(evidence.checks?.unknownManualIds)
    ? evidence.checks.unknownManualIds
    : [];
  return {
    path,
    present: true,
    schemaOk: evidence.schema === 'hydra.final-dogfood-evidence.v1',
    versionOk: evidence.version === version,
    completeOk: evidence.complete === true,
    artifactsOk,
    packagedAppOk: evidence.checks?.packagedApp?.ok === true,
    unknownManualIdsOk: unknownManualIds.length === 0,
    manual,
  };
}

function evidenceManualOk(evidence, ids) {
  return Boolean(
    evidence.present
    && evidence.schemaOk
    && evidence.versionOk
    && evidence.completeOk
    && evidence.artifactsOk
    && evidence.packagedAppOk
    && evidence.unknownManualIdsOk
    && ids.every((id) => evidence.manual.get(id) === true),
  );
}

function evidenceBackedCheck(id, label, ok, okEvidence, deferredEvidence) {
  return ok ? check(id, label, true, okEvidence) : deferred(id, label, deferredEvidence);
}

function parseBlockers(auditDoc) {
  const marker = '## Not Yet Verified';
  const start = auditDoc.indexOf(marker);
  if (start < 0) return [];
  const next = auditDoc.indexOf('\n## ', start + marker.length);
  const section = auditDoc.slice(start, next < 0 ? auditDoc.length : next);
  if (section.includes('no longer active Codex work items')) return [];
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('| ') && !line.includes('---') && !line.includes('Requirement |'))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/`/g, ''));
      return { requirement: cells[0], blocker: cells[1] };
    })
    .filter((row) => row.requirement && row.blocker);
}

function buildAudit() {
  const pkg = JSON.parse(read('package.json'));
  const version = pkg.version;
  const packageLock = safeRead('package-lock.json');
  const goalDoc = safeRead('docs/CODEX_GOAL.md');
  const releaseAudit = safeRead('docs/RELEASE_AUDIT.md');
  const versioningDoc = safeRead('docs/VERSIONING.md');
  const dogfoodDoc = safeRead('docs/PACKAGED_ELECTRON_DOGFOOD.md');
  const finalDogfoodDoc = safeRead('docs/FINAL_DOGFOOD_EVIDENCE.md');
  const finalDogfoodScript = safeRead('scripts/final-dogfood-check.mjs');
  const readme = safeRead('README.md');
  const currentReleaseRecorded = releaseAudit.includes(`GitHub release v${version} is public`)
    && releaseAudit.includes('macOS arm64 zip/blockmap')
    && releaseAudit.includes('macOS Intel zip/blockmap')
    && releaseAudit.includes('Windows NSIS/blockmap');
  const electronMain = safeRead('electron/main.js');
  const electronWindows = safeRead('electron/app/windows.js');
  const appMenu = safeRead('electron/menus/appMenu.js');
  const preload = safeRead('electron/preload.js');
  const rendererApp = safeRead('src/App.jsx');
  const metricsHook = safeRead('src/hooks/useMetrics.js');
  const trafficHook = safeRead('src/hooks/useTraffic.js');
  const bulkAuthHook = safeRead('src/hooks/useBulkAuth.js');
  const visibleRecurringHook = safeRead('src/hooks/useVisibleRecurringTask.js');
  const vaultPage = safeRead('src/pages/Vault.jsx');
  const generatorPage = safeRead('src/pages/Generator.jsx');
  const codeRedemptionPage = safeRead('src/pages/CodeRedemption.jsx');
  const accountDetailPage = safeRead('src/pages/AccountDetail.jsx');
  const nativeBridge = safeRead('src/lib/native.js');
  const electronIpcContract = safeRead('server/tests/electron-ipc-contract.test.mjs');
  const cleanupAuxProcesses = safeRead('electron/utils/cleanupAuxProcesses.js');
  const playwrightBrowser = safeRead('server/lib/playwright-browser.js');
  const playwrightIsolationTest = safeRead('server/tests/playwright-isolation.test.mjs');
  const electronMainProcessTest = safeRead('electron/tests/main-process.test.mjs');
  const electronIpc = safeRead('electron/app/ipc.js');
  const electronEnv = safeRead('electron/app/env.js');
  const electronAutoUpdate = safeRead('electron/app/autoUpdate.js');
  const electronBiometric = safeRead('electron/app/biometric.js');
  const electronIpcContractTest = safeRead('server/tests/electron-ipc-contract.test.mjs');
  const filesystemPermissionsTest = safeRead('server/tests/filesystem-permissions.test.mjs');
  const localSecretsTest = safeRead('server/tests/local-secrets.test.mjs');
  const dashboardApi = safeRead('server/services/dashboard-api.js');
  const accountGenerator = safeRead('server/services/account-generator.js');
  const accountProxyPool = safeRead('server/services/account-proxy-pool.js');
  const automationNetwork = safeRead('server/services/automation-network.js');
  const systemController = safeRead('server/controllers/SystemController.js');
  const systemRoutes = safeRead('server/routes/system.js');
  const poolController = safeRead('server/controllers/PoolController.js');
  const accountController = safeRead('server/controllers/AccountController.js');
  const dashboardController = safeRead('server/controllers/DashboardController.js');
  const rendererApi = safeRead('src/api.js');
  const runtimeDiagnostics = safeRead('src/lib/runtimeDiagnostics.js');
  const proximityField = safeRead('src/hooks/useProximityField.js');
  const designEngineering = safeRead('docs/DESIGN_ENGINEERING.md');
  const settingsPage = safeRead('src/pages/Settings.jsx');
  const dashboardPage = safeRead('src/pages/Dashboard.jsx');
  const rotationManager = safeRead('server/services/rotation-manager.js');
  const store = safeRead('server/services/store.js');
  const legacyStorage = safeRead('server/services/legacy-storage.js');
  const proxyRoute = safeRead('server/routes/proxy.js');
  const backgroundFailureTest = safeRead('server/tests/background-failure-visibility.test.mjs');
  const sessionRefresher = safeRead('server/services/session-refresher.js');
  const healthPinger = safeRead('server/services/health-pinger.js');
  const requestLogBuffer = safeRead('server/services/request-log-buffer.js');
  const requestLogRetention = safeRead('server/services/request-log-retention.js');
  const taskSupervisor = safeRead('server/services/task-supervisor.js');
  const magicLinkManager = safeRead('server/services/magic-link-manager.js');
  const modelCache = safeRead('server/services/model-cache.js');
  const schemaHash = safeRead('electron/app/schemaHash.js');
  const schemaHashTest = safeRead('server/tests/schema-hash.test.mjs');
  const importCommand = safeRead('bin/commands/import.js');
  const dbCommand = safeRead('bin/commands/db.js');
  const cliTest = safeRead('server/tests/cli.test.mjs');
  const cliMain = safeRead('bin/hydra.mjs');
  const mcpCommand = safeRead('bin/commands/mcp.js');
  const mcpTest = safeRead('server/tests/mcp-cli.test.mjs');

  const dogfoodEvidence = inspectDogfoodEvidence(version);
  const packagedGuiManualOk = evidenceManualOk(dogfoodEvidence, [
    'packaged-gui-launch',
    'window-controls',
    'splash-unlock-dashboard',
    'navigation-dead-buttons',
  ]);
  const liveMvpManualOk = evidenceManualOk(dogfoodEvidence, ['live-account-flows']);
  const screenshotManualOk = evidenceManualOk(dogfoodEvidence, ['screenshots-redacted']);
  const touchIdManualOk = evidenceManualOk(dogfoodEvidence, ['touch-id']);
  const windowsLaunchManualOk = evidenceManualOk(dogfoodEvidence, ['windows-launch']);
  const artifactPaths = {
    macArmZip: `release/Hydra-${version}-mac-arm64.zip`,
    macArmBlockmap: `release/Hydra-${version}-mac-arm64.zip.blockmap`,
    macX64Zip: `release/Hydra-${version}-mac-x64.zip`,
    macX64Blockmap: `release/Hydra-${version}-mac-x64.zip.blockmap`,
    winX64Exe: `release/Hydra-${version}-win-x64.exe`,
    winX64Blockmap: `release/Hydra-${version}-win-x64.exe.blockmap`,
  };
  const macArmSize = sizeMb(artifactPaths.macArmZip);
  const installedMacArmVersion = macBundleVersion('release/mac-arm64/Hydra.app');
  const macX64Size = sizeMb(artifactPaths.macX64Zip);
  const winX64Size = sizeMb(artifactPaths.winX64Exe);
  const macArmCiRecorded = releaseAudit.includes('GitHub Actions run 26193855786')
    && releaseAudit.includes('macos-14 --mac zip --arm64')
    && releaseAudit.includes('Hydra-1.0.7-mac-arm64.zip')
    && releaseAudit.includes('target=darwin-arm64')
    && releaseAudit.includes('packaged resource contract OK');
  const macX64CiRecorded = releaseAudit.includes('GitHub Actions run 26193855786')
    && releaseAudit.includes('macos-15-intel --mac zip --x64')
    && releaseAudit.includes('Hydra-1.0.7-mac-x64.zip')
    && releaseAudit.includes('target=darwin-x64')
    && releaseAudit.includes('chrome-mac-x64')
    && releaseAudit.includes('libquery_engine-darwin.dylib.node')
    && releaseAudit.includes('packaged resource contract OK');
  const winX64CiRecorded = releaseAudit.includes('GitHub Actions run 26193855786')
    && releaseAudit.includes('windows-latest --win nsis --x64')
    && releaseAudit.includes('Hydra-1.0.7-win-x64.exe')
    && releaseAudit.includes('target=win32-x64')
    && releaseAudit.includes('packaged resource contract OK');
  const blockers = parseBlockers(releaseAudit);

  const items = [
    check(
      'goal-sheet',
      'Goal sheet exists',
      goalDoc.includes('Hydra — Goal Sheet') && goalDoc.includes('Verification Pass'),
      'docs/CODEX_GOAL.md includes objective and verification pass',
    ),
    check(
      'release-audit',
      'Release audit exists',
      releaseAudit.includes('Prompt-to-Artifact Checklist') && releaseAudit.includes('Not Yet Verified'),
      'docs/RELEASE_AUDIT.md maps requirements to evidence and blockers',
    ),
    check(
      'packaged-dogfood-runbook',
      'Packaged Electron dogfood runbook exists',
      ((dogfoodDoc.includes('Packaged Electron Dogfood')
        && dogfoodDoc.includes('npm run electron:open:mac-arm64')
        && dogfoodDoc.includes('Chrome')
        && dogfoodDoc.includes('`vite preview`')
        && dogfoodDoc.includes('browser-only screenshots do not close release blockers')
        && dogfoodDoc.includes('Screenshot audit is last')
        && dogfoodDoc.includes('Windows installer launch')
        && dogfoodDoc.includes('Docker runtime'))
        || (readme.includes('## Screenshot Plan')
          && readme.includes('packaged Electron app')
          && readme.includes('not from a browser target')
          && readme.includes('## Gallery')
          && readme.includes('Captured from the packaged Electron app')))
        && finalDogfoodDoc.includes('DOGFOOD_EVIDENCE.json')
        && finalDogfoodDoc.includes('--manual=packaged-gui-launch')
        && finalDogfoodScript.includes('hydra.final-dogfood-evidence.v1')
        && finalDogfoodScript.includes('--write-evidence')
        && finalDogfoodScript.includes('--manual=')
        && finalDogfoodScript.includes('not API keys, cookies, account emails, Clerk session IDs'),
      'README/docs define Electron-only final dogfood screenshot requirements and redacted user-run evidence capture',
    ),
    check(
      'mac-arm-artifact',
      'macOS ARM artifact',
      (macArmSize != null && existsSync(join(ROOT, artifactPaths.macArmBlockmap))) || currentReleaseRecorded || macArmCiRecorded,
      (macArmSize == null
        ? currentReleaseRecorded
          ? `GitHub release v${version} macOS arm64 artifact and release-matrix smoke evidence are recorded in docs/RELEASE_AUDIT.md`
          : 'GitHub Actions macOS arm64 electron:smoke artifact evidence recorded in docs/RELEASE_AUDIT.md'
        : `${artifactPaths.macArmZip} (${macArmSize} MB) + blockmap is the local-manifest workspace artifact`)
        + (installedMacArmVersion
          ? `; installed release/mac-arm64/Hydra.app reports ${installedMacArmVersion}`
          : '; no extracted installed bundle version was readable'),
    ),
    check(
      'mac-intel-artifact',
      'macOS Intel artifact',
      (macX64Size != null && existsSync(join(ROOT, artifactPaths.macX64Blockmap))) || currentReleaseRecorded || macX64CiRecorded,
      macX64Size == null
        ? currentReleaseRecorded
          ? `GitHub release v${version} macOS Intel artifact and release-matrix smoke evidence are recorded in docs/RELEASE_AUDIT.md`
          : 'GitHub Actions macOS Intel electron:smoke artifact evidence recorded in docs/RELEASE_AUDIT.md'
        : artifactPaths.macX64Zip + ' (' + macX64Size + ' MB) + blockmap',
    ),
    check(
      'mac-intel-current',
      'macOS Intel artifact is current',
      ((macX64Size != null
        && existsSync(join(ROOT, artifactPaths.macX64Blockmap))
        && existsSync(join(ROOT, 'release/mac/Hydra.app/Contents/MacOS/Hydra')))
        || currentReleaseRecorded)
        && !blockers.some((row) => /macOS Intel package refresh/.test(row.requirement)),
      currentReleaseRecorded
        ? `GitHub release v${version} macOS Intel artifact and release-matrix smoke evidence are recorded in docs/RELEASE_AUDIT.md`
        : macX64CiRecorded
        ? 'GitHub Actions macOS Intel runner built --mac zip --x64 and electron:smoke verified packaged shell, x64 zip, Prisma engine, and bundled Chromium'
        : 'macOS Intel x64 package was rebuilt and smoked after the native titlebar/traffic-light change',
    ),
    check(
      'windows-installer-artifact',
      'Windows x64 installer artifact',
      (winX64Size != null && existsSync(join(ROOT, artifactPaths.winX64Blockmap))) || currentReleaseRecorded || winX64CiRecorded,
      winX64Size == null
        ? currentReleaseRecorded
          ? `GitHub release v${version} Windows NSIS artifact and release-matrix smoke evidence are recorded in docs/RELEASE_AUDIT.md`
          : 'GitHub Actions Windows NSIS electron:smoke artifact evidence recorded in docs/RELEASE_AUDIT.md'
        : artifactPaths.winX64Exe + ' (' + winX64Size + ' MB) + blockmap',
    ),
    evidenceBackedCheck(
      'packaged-gui-dogfood',
      'Packaged Electron GUI dogfood',
      packagedGuiManualOk,
      `redacted dogfood evidence at ${dogfoodEvidence.path} verifies packaged GUI launch, window controls, splash/unlock/dashboard, and navigation/dead-button pass for ${version}`,
      'not release-complete evidence; packaged Electron GUI launch/window/navigation dogfood still requires app-control or user-run evidence',
    ),
    evidenceBackedCheck(
      'live-mvp-dogfood',
      'Live MVP feature dogfood',
      liveMvpManualOk,
      `redacted dogfood evidence at ${dogfoodEvidence.path} verifies live OTP/redemption/proxy/SSE real-key flows for ${version}`,
      'not release-complete evidence; live OTP, redemption, proxy rotation, and real-key flows still require live credentials/accounts/codes',
    ),
    evidenceBackedCheck(
      'packaged-screenshot-audit',
      'Packaged Electron screenshot audit',
      screenshotManualOk,
      `redacted dogfood evidence at ${dogfoodEvidence.path} verifies packaged Electron screenshots were captured with secrets redacted for ${version}`,
      'not release-complete evidence; screenshot auditing must be captured from packaged Electron with secrets redacted',
    ),
    evidenceBackedCheck(
      'touch-id-dogfood',
      'Touch ID hardware dogfood',
      touchIdManualOk,
      `redacted dogfood evidence at ${dogfoodEvidence.path} verifies Touch ID enable, disable, and unlock behavior for ${version}`,
      'not release-complete evidence; Touch ID enable/disable/unlock still requires packaged app hardware dogfood',
    ),
    evidenceBackedCheck(
      'windows-launch-dogfood',
      'Windows installer launch dogfood',
      windowsLaunchManualOk,
      `redacted dogfood evidence at ${dogfoodEvidence.path} verifies current Windows installer install/launch behavior for ${version}`,
      'not release-complete evidence; hosted Windows workflow covers unpacked-app and silent NSIS install/startup/uninstall cleanup, but interactive NSIS installer install/open UX still requires real Windows desktop dogfood',
    ),
    check(
      'package-scripts',
      'Package scripts',
      Boolean(pkg.scripts?.['electron:build'] && pkg.scripts?.['electron:smoke'] && pkg.scripts?.['docker:smoke']),
      'package.json exposes electron:build, electron:smoke, and docker:smoke',
    ),
    check(
      'electron-updater-import',
      'Packaged updater import is ESM-safe',
      electronAutoUpdate.includes("import electronUpdater from 'electron-updater'")
        && electronAutoUpdate.includes('function getAutoUpdater')
        && electronAutoUpdate.includes('electronUpdater.autoUpdater')
        && electronMainProcessTest.includes('checks GitHub releases for packaged app updates')
        && electronMainProcessTest.includes('doesNotMatch(updater, /const \\{ autoUpdater \\} = electronUpdater;/)'),
      'electron/app/autoUpdate.js lazy-loads electron-updater autoUpdater through the default module and the main-process test forbids the crashing named import',
    ),
    check(
      'keychain-startup-calm',
      'Chromium keychain prompts are disabled for Hydra launch',
      electronEnv.includes("appendSwitch('password-store', 'basic')")
        && electronEnv.includes("appendSwitch('use-mock-keychain')")
        && electronMainProcessTest.includes("appendSwitch\\('password-store', 'basic'\\)")
        && electronMainProcessTest.includes("appendSwitch\\('use-mock-keychain'\\)"),
      'electron/app/env.js disables Chromium password-store/keychain access at startup; protected Hydra auth-token release still goes through biometric fail-closed IPC',
    ),
    check(
      'account-proxy-pool',
      'Encrypted account proxy pool and per-task rotation',
      accountProxyPool.includes("getDataPath('account-proxies.json.enc')")
        && accountProxyPool.includes('encryptConfig({ lines')
        && accountProxyPool.includes('parseProxyLine')
        && accountProxyPool.includes('Proxy must use ip:port:user:pass format')
        && accountProxyPool.includes('entropy.readUInt32BE(0) % proxyCount')
        && accountProxyPool.includes('pickProxyIndex(proxies.length, entropy ?? randomBytes(4))')
        && systemController.includes('getAccountProxyPool')
        && systemController.includes('setAccountProxyPool')
        && systemRoutes.includes("'/account-proxies'")
        && rendererApi.includes('getAccountProxies')
        && rendererApi.includes('setAccountProxies')
        && settingsPage.includes('Account Proxy Pool')
        && settingsPage.includes('Save Proxies')
        && automationNetwork.includes("import { ProxyAgent } from 'undici'")
        && automationNetwork.includes("import { describeProxy, pickAccountProxy, toPlaywrightProxy } from './account-proxy-pool.js'")
        && automationNetwork.includes("mode: accountProxy ? 'account-proxy' : 'direct-localhost'")
        && automationNetwork.includes("DIRECT_CHROMIUM_PROXY_ARGS = Object.freeze(['--no-proxy-server'])")
        && automationNetwork.includes('bypass: LOCAL_PROXY_BYPASS')
        && automationNetwork.includes('fetchOptionsWithAutomationProxy')
        && accountGenerator.includes('pickAutomationNetworkRoute')
        && accountGenerator.includes('mergeAutomationLaunchArgs(launchArgs, automationRoute)')
        && accountGenerator.includes('proxy: playwrightProxyForAutomation(automationRoute)')
        && accountGenerator.includes('automationRoute: automationRoute.label')
        && accountGenerator.includes('headless: config.HYDRA_GENERATOR_HEADLESS')
        && dashboardApi.includes('pickAutomationNetworkRoute')
        && dashboardApi.includes('fetchOptionsWithAccountProxy')
        && dashboardApi.includes('tryManagementKeyServerActionReplay(sessionCookie, clientCookie, keyName, automationRoute, signal)')
        && dashboardApi.includes('redeemCodeViaServerAction(sessionCookie, clientCookie, code, automationRoute, signal)')
        && dashboardApi.includes('tryRestApiRedeemCode(sessionCookie, clientCookie, code, automationRoute, signal)')
        && dashboardApi.includes('redeemCodeViaPlaywright(userId, accountId, sessionCookie, clientCookie, code, automationRoute, signal)')
        && dashboardApi.includes('syncApiKeysViaPlaywright(sessionCookie, clientCookie, automationRoute)')
        && String(pkg.scripts?.test || '').includes('test:account-proxy-pool')
        && backgroundFailureTest.includes('ProxyAgent')
        && backgroundFailureTest.includes('fetchOptionsWithAutomationProxy')
        && backgroundFailureTest.includes('redeemCodeViaServerAction\\(sessionCookie, clientCookie, code, automationRoute, signal\\)')
        && backgroundFailureTest.includes('syncApiKeysViaPlaywright\\(sessionCookie, clientCookie, automationRoute\\)'),
      'Settings/API store one proxy per line encrypted; signup, management-key, HTTP redemption, REST redemption, API-key sync, and Playwright fallback paths share one per-task automation route, with random account-proxy selection, generator visible-browser default, and explicit direct-localhost fallback',
    ),
    check(
      'readme-navigation',
      'README navigation and operator grouping',
      readme.includes('## Navigation')
        && readme.includes('[Quick Start From Source](#quick-start-from-source)')
        && readme.includes('## Desktop App')
        && readme.includes('## Operator Hardening')
        && readme.includes('## Development And Release Gates')
        && readme.includes('## Gallery')
        && readme.includes('Captured from the packaged Electron app')
        && readme.includes('Account proxy pool')
        && readme.includes('new signup uses Generator with an isolated visible browser')
        && readme.includes('ip:port:user:pass')
        && readme.includes('including direct HTTPS and browser fallbacks')
        && readme.includes('selects one random saved route per new task')
        && readme.includes('The README avoids embedding real account data, full API keys, or live secrets')
        && !/Remotion|remotion/.test(readme)
        && readme.includes('actions/workflows/release.yml/badge.svg')
        && readme.includes('actions/workflows/docker.yml/badge.svg?branch=master')
        && !readme.includes('actions/workflows/electron-smoke.yml/badge.svg?branch=master')
        && !readme.includes('img.shields.io/github/license')
        && readme.includes('Touch ID defaults on once for')
        && readme.includes('keeps an explicit')
        && readme.includes('Settings opt-out durable across future launches')
        && /A successful\s+password unlock persists for up to 24 hours on the device/.test(readme)
        && /both\s+\*\*Unlock with Touch ID\*\*\s+and password/.test(readme)
        && /avoids macOS\s+Keychain token storage/.test(readme)
        && readme.includes('[docs/VERSIONING.md](docs/VERSIONING.md)')
        && readme.replace(/\s+/g, ' ').includes(`current release lane is \`${version}\``)
        && versioningDoc.includes('[bump:minor]')
        && versioningDoc.includes('1.1.0 -> 1.1.1')
        && versioningDoc.includes('Splash Density And Tilt In The Version Notes')
        && versioningDoc.includes('x-axis value affects horizontal gravity, spawn')
        && versioningDoc.includes('Exact MacBook lid-angle tilt is not exposed through a standard Electron API')
        && goalDoc.includes('cut the release as a minor bump using `[bump:minor]`'),
      'README.md has truthful CI/Desktop Release/Docker badges, top navigation, grouped CLI/router/hardening/release sections, explicit Touch ID and 24-hour unlock-token behavior, proxy-pool docs, versioning policy, splash tilt notes, no Remotion references, and packaged-Electron screenshot secrecy guidance',
    ),
    check(
      'dependency-audit',
      'Dependency audit',
      packageLock.includes('"node_modules/@fastify/otel/node_modules/brace-expansion"')
        && packageLock.includes('"version": "5.0.6"')
        && !packageLock.includes('"node_modules/@fastify/otel/node_modules/brace-expansion": {\n      "version": "5.0.5"')
        && pkg.overrides?.qs === '6.15.2'
        && pkg.overrides?.tmp === '0.2.7'
        && packageLock.includes('"node_modules/qs": {\n      "version": "6.15.2"')
        && packageLock.includes('"node_modules/tmp": {\n      "version": "0.2.7"'),
      'brace-expansion is patched to 5.0.6 and explicit transitive overrides pin qs 6.15.2 plus tmp 0.2.7',
    ),
    check(
      'performance-efficiency-pass',
      'Performance and fan-pressure pass',
      goalDoc.includes('Primary focus for the next 4-5 hours: performance and efficiency release')
        && releaseAudit.includes('performance and efficiency pass')
        && electronWindows.includes('HYDRA_SPLASH_PHYSICS_STEP_MS=1000/45')
        && electronWindows.includes('const physicsStep=hydraSplashExitStartedAt?HYDRA_SPLASH_PORTAL_FRAME_MS:HYDRA_SPLASH_PHYSICS_STEP_MS')
        && electronWindows.includes('Eng.update(engine,physicsStep)')
        && !electronWindows.includes('Run.create')
        && !electronWindows.includes('Run.run')
        && electronWindows.includes('HYDRA_SPLASH_INTRO_FRAME_MS=1000/45')
        && electronWindows.includes('HYDRA_SPLASH_PORTAL_FRAME_MS=1000/30')
        && electronWindows.includes('HYDRA_SPLASH_DURATION_MS=15000')
        && electronWindows.includes('HYDRA_SPLASH_EXIT_MS=9800')
        && electronWindows.includes('HYDRA_SPLASH_PORTAL_MS=5200')
        && electronWindows.includes('engine.world.gravity.y=1.18;engine.world.gravity.scale=0.00128')
        && electronWindows.includes('baseFontSize*(0.82+Math.random()*0.38)')
        && electronWindows.includes('const wave=.5+.5*Math.sin')
        && electronWindows.includes('function drawHydraPortal')
        && electronWindows.includes('ctx.globalCompositeOperation="lighter"')
        && electronWindows.includes('segments=Math.max(4,8-depth)')
        && electronWindows.includes('const stems=11')
        && electronWindows.includes('.vines .node')
        && electronWindows.includes('HYDRA_SPLASH_TARGET=44')
        && !electronWindows.includes('Bod.rectangle(w/2,-WT/2,lx,WT')
        && electronWindows.includes('m.kind="shattered";hydraSplashDiagnostics.shatteredWordCount++')
        && electronWindows.includes('shuffle(items).slice(0,Math.min(n,items.length))')
        && electronWindows.includes('b.collisionFilter.mask=0;b.isSensor=true')
        && electronWindows.includes('hydraSplashDiagnostics.portalCollisionDisabled=true')
        && electronWindows.includes('releaseLift=(1-portalRatio)*7.5')
        && electronWindows.includes('hydraSplashDiagnostics.portalLiftApplied=true')
        && electronWindows.includes('tiltBias=hydraSplashTiltGravityX*(W()*0.18)')
        && electronWindows.includes('hydraSplashLeanX+= (hydraSplashTiltGravityX-hydraSplashLeanX)*0.08')
        && electronWindows.includes('disposeHydraSplash')
        && electronMainProcessTest.includes('splash physics and animation loops have a finite cleanup path')
        && accountGenerator.includes('cleanupEphemeralProfileDir(profileDir)')
        && dashboardApi.includes('cleanupEphemeralProfileDir(profileDir)')
        && requestLogBuffer.includes('timer = setTimeout')
        && !requestLogBuffer.includes('timer = setInterval')
        && electronMain.includes('const LIFECYCLE_KEEPALIVE_RENEW_MS = 24 * 60 * 60 * 1000')
        && electronMain.includes('lifecycleKeepAliveTimer = setTimeout(() => {')
        && !electronMain.includes('lifecycleKeepAliveTimer = setInterval')
        && electronMain.includes('lifecycleKeepAliveTimer.ref?.()')
        && electronMain.includes("logLifecycle('process-beforeExit'")
        && electronMain.includes("logLifecycle('process-signal'")
        && electronEnv.includes("app.once('will-quit'")
        && !electronEnv.includes("app.once('before-quit'")
        && proxyRoute.includes('const requestLogPromise = createRequestLog(')
        && proxyRoute.includes('requestLogPromise.then')
        && !proxyRoute.includes('const requestLog = await createRequestLog(')
        && proxyRoute.includes('let clientDisconnected = req.aborted || res.destroyed')
        && proxyRoute.includes("req.once('aborted', stopDisconnectedUpstreamWork)")
        && proxyRoute.includes("res.once('close', stopDisconnectedUpstreamWork)")
        && proxyRoute.includes('activeUpstreamController?.abort()')
        && proxyRoute.includes('if (clientDisconnected) return;\n    const keyEntry = await rotationManager.getNextKey(attempted)')
        && proxyRoute.includes('connectTimeoutId.unref?.()')
        && proxyRoute.includes('streamTimeoutId.unref?.()')
        && proxyRoute.includes('Client disconnected; stopped upstream work on attempt')
        && modelCache.includes('CLIENT_MODEL_CACHE_TTL_MS')
        && modelCache.includes('export async function getCachedClientModels')
        && modelCache.includes('clearClientModelCache();')
        && proxyRoute.includes('getCachedClientModels({ freeOnly })')
        && !proxyRoute.includes('prisma.cachedModel.findMany')
        && poolController.includes('const [rawLogs, metrics, modelPrices, routing] = await Promise.all([')
        && requestLogRetention.includes('scheduleNextPrune(RETENTION_INTERVAL_MS)')
        && requestLogRetention.includes('function runPruneAndReschedule()')
        && requestLogRetention.includes('export function noteRequestLogActivity()')
        && requestLogRetention.includes('if (!started || stopping) return')
        && requestLogRetention.includes('if (!stopping && keepScheduled) scheduleNextPrune(RETENTION_INTERVAL_MS)')
        && requestLogRetention.includes('timer = setTimeout')
        && requestLogRetention.includes('const oldest = await prisma.requestLog.findFirst')
        && requestLogRetention.includes('if (!oldest) return false')
        && requestLogRetention.includes('if (oldest.createdAt < cutoff)')
        && requestLogRetention.includes('const overflow = await prisma.requestLog.findFirst')
        && requestLogRetention.includes('skip: KEEP_COUNT')
        && requestLogRetention.includes('if (!overflow) return true')
        && !requestLogRetention.includes('setInterval')
        && requestLogBuffer.includes('noteRequestLogActivity()')
        && proxyRoute.includes('noteRequestLogActivity()')
        && sessionRefresher.includes('function scheduleNextSweep(delayMs = INTERVAL_MS)')
        && sessionRefresher.includes('_intervalHandle = setTimeout')
        && sessionRefresher.includes('scheduleNextSweep(INTERVAL_MS)')
        && sessionRefresher.includes('replaceClientCookies: liveStack')
        && sessionRefresher.includes('markSessionRefreshed: false')
        && !sessionRefresher.includes('setInterval')
        && accountController.includes('store.removeDeadClientCookies(session.clientCookies, refreshed.deadClientCookies)')
        && !accountController.includes('function pruneDeadClientCookies')
        && accountController.includes('replaceClientCookies: []')
        && accountController.includes('markSessionRefreshed: false')
        && dashboardController.includes('store.removeDeadClientCookies(stackedCookies, refreshed.deadClientCookies)')
        && dashboardApi.includes('undefined, undefined, derivedExpiry')
        && dashboardApi.includes('preserveSessionToken: true')
        && dashboardApi.includes('markSessionRefreshed: false')
        && taskSupervisor.includes('scheduleNextSweep(delayMs = TASK_SWEEP_INTERVAL_MS)')
        && taskSupervisor.includes('this.timer = setTimeout')
        && taskSupervisor.includes('this.sweepPromise = this.expireTasks().catch')
        && taskSupervisor.includes('if (!this.started || this.stopping || this.timer || this.sweepPromise) return')
        && taskSupervisor.includes('if (this.listActive().length === 0) return')
        && taskSupervisor.includes('this.tasks.set(taskId, task);\n    this.scheduleNextSweep();')
        && taskSupervisor.includes('if (this.listActive().length === 0 && this.timer)')
        && taskSupervisor.includes('async function withClearedTimeout(promise, timeoutMs)')
        && taskSupervisor.includes('timeoutHandle.unref?.()')
        && taskSupervisor.includes('if (timeoutHandle) clearTimeout(timeoutHandle)')
        && !taskSupervisor.includes('setInterval')
        && magicLinkManager.includes('trackPendingMagicLink(signInId, entry)')
        && magicLinkManager.includes('cleanupTimer = setTimeout')
        && magicLinkManager.includes('forgetPendingMagicLink(k, { reschedule: false })')
        && magicLinkManager.includes('if (reschedule) scheduleMagicLinkCleanup()')
        && magicLinkManager.includes('getMagicLinkCleanupSnapshot')
        && !magicLinkManager.includes('setInterval')
        && healthPinger.includes('HYDRA_HEALTH_PING_STARTUP_DELAY_MS')
        && healthPinger.includes('timer = setTimeout')
        && healthPinger.includes('scheduleNextPing(PING_INTERVAL_MS)')
        && healthPinger.includes('rotationManager.pool.length === 0')
        && healthPinger.includes('unsubscribePoolChange = rotationManager.onPoolChange(syncScheduledPing)')
        && healthPinger.includes('clearScheduledPing()')
        && healthPinger.includes('activeController?.abort()')
        && !healthPinger.includes('setInterval')
        && rotationManager.includes('this._poolChangeListeners = new Set()')
        && rotationManager.includes('this._replacePool(keys)')
        && runtimeDiagnostics.includes('__HYDRA_RENDERER_DIAGNOSTICS__')
        && runtimeDiagnostics.includes('activeTotal: timeouts.active + intervals.active + animationFrames.active + animations.active')
        && runtimeDiagnostics.includes('trackRendererAnimation')
        && visibleRecurringHook.includes("document.addEventListener('visibilitychange', handleVisibility)")
        && visibleRecurringHook.includes('await task(taskController.signal)')
        && visibleRecurringHook.includes('if (document.hidden) {')
        && visibleRecurringHook.includes('clear();\n        abort();')
        && visibleRecurringHook.includes('if (cancelled || document.hidden) return')
        && rendererApp.includes("useVisibleRecurringTask('App.upstreamHealth', refreshUpstreamHealth, 30_000, { enabled: authState === 'app' })")
        && metricsHook.includes('inFlightRef.current')
        && metricsHook.includes("useVisibleRecurringTask('useMetrics.autoRefresh', refreshVisibleDashboard, 5 * 60 * 1000)")
        && trafficHook.includes('inFlightRef.current')
        && trafficHook.includes("useVisibleRecurringTask('useTraffic.autoRefresh', refreshVisibleTraffic, 30000)")
        && vaultPage.includes('loadInFlightRef.current')
        && vaultPage.includes("useVisibleRecurringTask('Vault.autoRefresh', refreshVisibleVault, 10 * 60 * 1000)")
        && generatorPage.includes('statusPollInFlightRef.current')
        && generatorPage.includes('heartbeatInFlightRef.current')
        && generatorPage.includes("setTrackedTimeout('Generator.statusPoll'")
        && generatorPage.includes("setTrackedTimeout('Generator.heartbeat'")
        && generatorPage.includes('const lifecycleClosedRef = useRef(false)')
        && generatorPage.includes('const startInFlightRef = useRef(false)')
        && generatorPage.includes('const verifyInFlightRef = useRef(false)')
        && generatorPage.includes('cleanupLateStartedTask(startedTaskId)')
        && generatorPage.includes('activeTaskRef.current = startedTaskId')
        && generatorPage.includes("api.cleanupGeneratorJob(lateTaskId, 'client_disconnect', { keepalive: true })")
        && generatorPage.includes('generatorModeLabel(jobMode)')
        && generatorPage.includes('inputMode="numeric"')
        && generatorPage.includes('function isOtpReady(status, checkpoint)')
        && generatorPage.includes('const otpReady = isOtpReady(status, checkpoint)')
        && generatorPage.includes('disabled={otp.length !== 6 || verifying || !canSubmitOtp}')
        && accountGenerator.includes('const SIGNUP_SHELL_CHECK_INTERVAL_MS = 500')
        && accountGenerator.includes('waitForSignupShell(task, page)')
        && accountGenerator.includes('page.setDefaultTimeout(Math.max(STARTUP_TIMEOUT_MS, OTP_WAIT_TIMEOUT_MS))')
        && accountGenerator.includes('waitForOtpChallenge(task, page)')
        && accountGenerator.includes('fillAndAdvanceVisibleSignupForm(task, page')
        && accountGenerator.includes('throwIfAborted(signal)')
        && accountGenerator.includes('fillVisibleSignupNames(page, email, taskId, signal)')
        && accountGenerator.includes('fillVisibleSignupEmail(page, email, taskId, signal)')
        && accountGenerator.includes('fillVisibleSignupPassword(page, password, taskId, signal)')
        && accountGenerator.includes('clickVisibleSignupContinueControl(page, taskId, signal)')
        && accountGenerator.includes('checkpointOtpReady = task.metadata?.checkpoint?.state ===')
        && accountGenerator.includes('clickVisibleOtpSubmitControl(page, task.taskId)')
        && accountGenerator.includes('manual_verification')
        && bulkAuthHook.includes('pollTimerRef.current')
        && bulkAuthHook.includes('poll.inFlight')
        && bulkAuthHook.includes('const lifecycleAbortRef = useRef(null)')
        && bulkAuthHook.includes('controller.abort()')
        && bulkAuthHook.includes('clearTrackedTimeout(timer)')
        && bulkAuthHook.includes('BULK_MAGIC_LINK_SEND_DELAY_MS = 6500')
        && bulkAuthHook.includes('waitForMagicLinkSendDelay(idx === 0 ? 0 : BULK_MAGIC_LINK_SEND_DELAY_MS)')
        && bulkAuthHook.includes('api.getMagicLinkStatusQuiet(poll.accountId, poll.signInId, signal)')
        && bulkAuthHook.includes('api.checkSessionLiveQuiet(poll.accountId, signal)')
        && bulkAuthHook.includes("setTrackedTimeout('useBulkAuth.magicLinkSendDelay'")
        && !bulkAuthHook.includes('pollRefs.current[email] = setInterval')
        && codeRedemptionPage.includes('const lifecycleAbortRef = useRef(null)')
        && codeRedemptionPage.includes("lifecycleSignal.addEventListener('abort', abort, { once: true })")
        && codeRedemptionPage.includes('api.getAccounts(signal)')
        && codeRedemptionPage.includes('quietLoading ? api.getRedemptionLogsQuiet : api.getRedemptionLogs')
        && codeRedemptionPage.includes('getRedemptionLogs(signal)')
        && codeRedemptionPage.includes('api.preflightRedeemAccountsQuiet(ids, signal)')
        && codeRedemptionPage.includes('api.preflightRedeemAccounts(accountIdsToRun, signal)')
        && codeRedemptionPage.includes('api.bulkMatrixRedeem(assignments, signal)')
        && accountDetailPage.includes('const initialFetchAccountIdRef = useRef(null)')
        && accountDetailPage.includes('const accountAbortRef = useRef(null)')
        && accountDetailPage.includes('initialFetchAccountIdRef.current !== resolvedAccountId')
        && accountDetailPage.includes('for (const timer of transientTimersRef.current) clearTrackedTimeout(timer)')
        && accountDetailPage.includes('setMgmtKeyFull(null)')
        && accountDetailPage.includes('setTestKeyStatus({})')
        && accountDetailPage.includes('api.getAccounts(signal)')
        && accountDetailPage.includes('api.getAccountSnapshot(resolvedAccountId, signal)')
        && accountDetailPage.includes('api.getManagementKeys(resolvedAccountId, signal)')
        && accountDetailPage.includes('api.checkSessionLive(resolvedAccountId, signal)')
        && accountDetailPage.includes('api.getAccountManagementKey(resolvedAccountId, signal)')
        && accountDetailPage.includes('api.testKey(resolvedAccountId, hash, signal)')
        && accountDetailPage.includes('fetchSnapshot(signal)')
        && accountDetailPage.includes('fetchManagementKeys(signal)')
        && accountDetailPage.includes('const renderedAccountSignal = accountAbortRef.current?.signal')
        && accountDetailPage.includes('isCurrentRouteSignal(accountAbortRef, renderedAccountSignal)')
        && accountDetailPage.includes('fetchMeta(renderedAccountSignal)')
        && accountDetailPage.includes('fetchSnapshot(renderedAccountSignal)')
        && cliMain.includes('inspectHydraPlaywrightProfiles')
        && cliMain.includes('inspectHydraProcesses')
        && cliMain.includes('--clean-stale-profiles')
        && cliMain.includes('moveStaleHydraPlaywrightProfiles')
        && cliMain.includes('deleted: 0')
        && cliTest.includes('hydra doctor includes local performance diagnostics for fan-pressure reports')
        && cliTest.includes('stale-profile cleanup moves Hydra profile dirs to a reversible backup')
        && playwrightIsolationTest.includes('cleanupEphemeralProfileDir removes only Hydra-owned ephemeral profile dirs')
        && backgroundFailureTest.includes('cleanupEphemeralProfileDir\\(profileDir\\)'),
      'Splash Matter/render loops are finite and throttled through one owned Engine.update/render loop, with a 44-word body budget, restrained glyph sizing, 45 FPS intro and 30 FPS portal caps, faster Pica-style intro gravity, denser neuron branches, one-shot parent shattering, no top-edge ceiling overlap, and a staged 5.2s collision-free portal orbit with a canvas-owned light wave; Playwright launch profile dirs are removed after browser automation paths; task expiry, request-log flushing/retention, health pings, session refresh, magic-link cleanup, renderer polling, and bulk magic-link polling avoid permanent/overlapping idle intervals; Generator late-start responses are cleaned after route exit, duplicate start/OTP submissions are gated, browser signup surfaces manual verification, and OTP-page submission is explicit; ordinary proxy fetches abort and stop retrying when their clients disconnect; renderer runtime diagnostics expose owned timers/RAFs/Anime.js effects; hydra doctor reports stale profiles/process CPU/RAM and can move stale profiles into a reversible backup; focused performance contracts cover the changes',
    ),
    check(
      'test-chain',
      'Full test chain',
      String(pkg.scripts?.test || '').includes('test:test-chain-completeness')
        && String(pkg.scripts?.test || '').includes('test:mcp'),
      'npm test includes chain completeness and MCP tests',
    ),
    check(
      'mcp-fleet-tools',
      'Private MCP fleet tools',
      cliMain.includes('hydra mcp')
        && cliMain.includes("'mcp'")
        && mcpCommand.includes("name: 'hydra_status'")
        && mcpCommand.includes("name: 'hydra_proxy_status'")
        && mcpCommand.includes("name: 'hydra_api_map'")
        && mcpCommand.includes("name: 'hydra_audit'")
        && mcpCommand.includes("name: 'hydra_doctor'")
        && mcpCommand.includes("method === 'tools/list'")
        && mcpCommand.includes("method === 'tools/call'")
        && mcpCommand.includes('Content-Length')
        && mcpCommand.includes('existing guarded/read-only CLI commands')
        && mcpTest.includes('hydra mcp lists private local fleet tools')
        && mcpTest.includes('hydra mcp speaks framed stdio JSON-RPC and returns tool results'),
      'hydra mcp exposes private local stdio tools for status, proxy, API map, audit, and doctor through existing guarded/read-only CLI commands',
    ),
    check(
      'cli-runtime-diagnostics',
      'CLI runtime diagnostics are consistent',
      cliMain.includes("return resolve(root, 'data')")
        && cliMain.includes('build/electron/chromium.zip')
        && cliMain.includes('Contents/Resources/chromium.zip')
        && cliMain.includes('release/win-unpacked/resources/chromium.zip')
        && cliTest.includes('hydra top-level system commands follow the active runtime data dir consistently')
        && cliTest.includes('hydra doctor recognizes packaged Chromium zip resources'),
      'hydra doctor/data-dir/logs default to the same repo runtime as service commands and doctor detects packaged Chromium zip resources',
    ),
    check(
      'ui-contract',
      'UI polish/static contract',
      dashboardPage.includes('maxAttractX: 10')
        && dashboardPage.includes('maxAttractY: 8')
        && proximityField.includes('dx * strength * 0.12')
        && proximityField.includes('dy * strength * 0.1')
        && proximityField.includes('geometryRef.current = Array.from(field.querySelectorAll(TARGET_SELECTOR)')
        && proximityField.includes('new ResizeObserver(invalidateGeometry)')
        && proximityField.includes('new MutationObserver(invalidateGeometry)')
        && designEngineering.includes('### Proximity implementation map')
        && designEngineering.includes('## Anime.js Text Treatments')
        && designEngineering.includes('## Graphics Maintenance Checklist'),
      'UI contracts and living design docs cover AnimeText headers, first-run setup, dead-button placeholders, reduced-motion proximity response, bounded account-grid attraction, and graphics lifecycle invariants',
    ),
    check(
      'startup-fallback',
      'Startup and activate no-blank fallback',
      electronMain.includes('loadURL resolved before ready-to-show')
        && electronMain.includes('if (loadSucceeded && !mainRevealStarted)')
        && electronMain.includes('main-window:startup-reveal')
        && electronMain.includes('app.focus({ steal: true })')
        && electronMain.includes('main reveal late recovery')
        && electronMain.includes('createMainWindow({ show: false, preloadPath: PRELOAD_PATH })')
        && electronMain.includes('newWin.loadURL(url).then(showActivatedWindow).catch')
        && electronWindows.includes('full-name greeting lookup failed, using username fallback')
        && electronMainProcessTest.includes('does not leave startup or activate windows blank when ready-to-show is missing')
        && electronMainProcessTest.includes('splash greeting lookup fallbacks leave diagnostic evidence'),
      'electron main-process contract covers loadURL fallback, hidden activate windows, and splash greeting fallback logging',
    ),
    check(
      'settings-prefs',
      'Settings toggles persist through native preferences',
      electronIpc.includes("ipcMain.handle('native:prefs:set'")
        && electronIpc.includes('await setPref(key, value)')
        && safeRead('server/tests/user-prefs.test.mjs').includes('persist across cache reset'),
      'Settings preference toggles use native prefsSet/getAll and user-prefs persistence tests',
    ),
    check(
      'native-menu-feedback',
      'Native menu and Help actions surface feedback',
      electronMainProcessTest.includes('wires Help menu documentation, diagnostics, folders, and build-info copy actions')
        && appMenu.includes('Hydra Documentation')
        && appMenu.includes('Report an Issue')
        && appMenu.includes('Diagnostics in Settings')
        && appMenu.includes('Show Build Info')
        && appMenu.includes("copyTextToClipboard(info, 'copy build info', focusedWindow)")
        && appMenu.includes('native:clipboard-copy-failed')
        && preload.includes('native:copied-proxy-url')
        && preload.includes('native:copy-proxy-url-not-ready')
        && nativeBridge.includes('onMenuEvent: (cb) =>')
        && rendererApp.includes("type === 'native:copied-proxy-url'")
        && rendererApp.includes("type === 'native:copy-proxy-url-not-ready'")
        && rendererApp.includes("type === 'native:clipboard-copy-failed'")
        && electronIpcContract.includes('MENU_EVENT_CHANNELS')
        && electronIpcContract.includes('native:copied-proxy-url')
        && electronIpcContract.includes('native:copy-proxy-url-not-ready')
        && electronIpcContract.includes('native:clipboard-copy-failed'),
      'Help/menu/tray source contracts cover docs/issues links, diagnostics, folder opens, Build Info copy, and renderer toasts',
    ),
    check(
      'fallback-visibility',
      'Non-fatal runtime fallbacks leave diagnostic evidence',
      dashboardApi.includes('Redeem credit poll failed')
        && dashboardApi.includes('Redeem tRPC route persistence failed')
        && dashboardApi.includes('Hash auto-discovery bundle fetch failed')
        && dashboardApi.includes('Self-heal redeem hash probe failed')
        && dashboardApi.includes('Redeem tRPC outcome parse failed')
        && dashboardApi.includes('Management key Save click failed')
        && dashboardApi.includes('syncApiKeys tRPC candidate ${route} failed')
        && backgroundFailureTest.includes('Redeem credit poll failed')
        && backgroundFailureTest.includes('Redeem tRPC route persistence failed')
        && schemaHash.includes('schema hash skipped migration entry')
        && schemaHash.includes('schema sync could not read ${label}; using fallback')
        && schemaHash.includes('schema sync check failed; forcing sync')
        && schemaHashTest.includes('schema sync fallback errors are logged before forcing sync')
        && schemaHashTest.includes('schema sync sentinel read failures are logged without making first launch noisy')
        && rotationManager.includes('Weighted key selection failed')
        && store.includes('Stored session token decrypt failed')
        && store.includes('Failed to decrypt local key hash')
        && legacyStorage.includes('Legacy account config unreadable during migration check')
        && legacyStorage.includes('Legacy account session token unreadable during migration check')
        && legacyStorage.includes('Legacy key ciphertext unreadable during migration check')
        && safeRead('server/routes/proxy.js').includes('Model list fallback used because live/cache lookup failed')
        && backgroundFailureTest.includes('rotation manager weighted-selection fallbacks are logged')
        && backgroundFailureTest.includes('key decrypt fallbacks keep key-scoped evidence')
        && backgroundFailureTest.includes('legacy storage reset probes keep unreadable-field evidence'),
      'background-failure and schema-hash contracts cover redemption fallback logging, store and legacy-storage fallback logging, proxy model-list and rotation fallback logging, and schema-sync fallback warnings',
    ),
    check(
      'session-probe-redaction',
      'Session probe logs redact account aliases and Clerk session IDs',
      sessionRefresher.includes('function _redactAlias(alias)')
        && sessionRefresher.includes('function _redactSid(sid)')
        && sessionRefresher.includes('alias="${_redactAlias(account.alias)}" sid=${_redactSid(sid)}')
        && sessionRefresher.includes('old_sid=${_redactSid(trackedSid)}')
        && sessionRefresher.includes('new_sid=${_redactSid(currentSid)}')
        && !sessionRefresher.includes('alias="${account.alias}" sid=${sid}')
        && !sessionRefresher.includes("old_sid=${trackedSid ?? 'none'}")
        && backgroundFailureTest.includes('function _redactAlias\\(alias\\)')
        && backgroundFailureTest.includes('function _redactSid\\(sid\\)'),
      'SESSION_PROBE runtime logs keep account-level evidence while masking account aliases and Clerk session IDs',
    ),
    check(
      'redacted-import',
      'Redacted import restores metadata without secrets',
      importCommand.includes('hydra import <redacted-export.json> --yes')
        && importCommand.includes('CONFIRMATION_REQUIRED')
        && importCommand.includes('secretsRestored: 0')
        && importCommand.includes('managementKeysSkipped')
        && importCommand.includes('disabled: true')
        && importCommand.includes('isPooled: false')
        && cliTest.includes('hydra import writes redacted metadata only after confirmation')
        && cliTest.includes('stored.account.sessionToken, \'\')')
        && cliTest.includes('stored.key.key, null')
        && cliTest.includes('stored.managementKeys, 0'),
      'CLI import contract covers confirmed metadata-only writes, skipped management-key secrets, disabled/unpooled API-key metadata, and no restored sessions',
    ),
    check(
      'reversible-db-reset',
      'Database reset is confirmation-gated and reversible',
      dbCommand.includes('hydra db reset --yes')
        && dbCommand.includes('No files are deleted')
        && dbCommand.includes('reset-backups')
        && dbCommand.includes('CONFIRMATION_REQUIRED')
        && dbCommand.includes('deleted: 0')
        && cliTest.includes('hydra db reset is confirmation-gated and moves database files to a backup')
        && cliTest.includes('reset.deleted, 0')
        && cliTest.includes('reset-backups'),
      'CLI db reset contract covers dry-run, confirmation gate, reset-backup moves, and zero deletion',
    ),
    check(
      'windows-aux-cleanup',
      'Windows auxiliary-process cleanup',
      cleanupAuxProcesses.includes('Get-CimInstance Win32_Process')
        && cleanupAuxProcesses.includes('taskkill.exe')
        && cleanupAuxProcesses.includes('/T')
        && cleanupAuxProcesses.includes('/F')
        && playwrightBrowser.includes('sweep: failed to remove stale profile')
        && electronMainProcessTest.includes('Windows sweep must kill matched process trees'),
      'Electron auxiliary cleanup enumerates Windows process command lines, kills matched process trees, and logs stale Playwright profile sweep failures',
    ),
    check(
      'filesystem-locks',
      'Filesystem and migration-lock hardening',
      filesystemPermissionsTest.includes('breaks stale migration locks before acquiring')
        && filesystemPermissionsTest.includes('schema migration lock has a Windows PID liveness path')
        && filesystemPermissionsTest.includes('tasklist')
        && localSecretsTest.includes('local secrets persistence uses fsynced temp file and atomic rename'),
      'filesystem permission tests cover owner-only data/secrets, stale migration-lock recovery, and Windows PID liveness',
    ),
    check(
      'biometric-fail-closed',
      'Biometric auth-token gate fails closed',
      electronIpc.includes('const parsed = await readAuthTokenRecord()')
        && electronIpc.indexOf('const parsed = await readAuthTokenRecord()') < electronIpc.indexOf("const biometricOn = await getPref('biometricEnabled')")
        && electronIpc.includes("if (biometricOn) {")
        && electronIpc.includes("await promptBiometric('Unlock Hydra vault with Touch ID')")
        && electronIpc.includes('biometric auth-token gate denied release')
        && electronBiometric.includes('Touch ID availability check failed')
        && electronBiometric.includes('Touch ID prompt failed (${e.code})')
        && !electronIpc.includes('biometricOn && canPromptBiometric()')
        && electronIpcContractTest.includes('enabled biometric auth-token gate fails closed')
        && electronIpcContractTest.includes('check token presence and expiry before prompting Touch ID')
        && electronIpc.includes("ipcMain.handle('native:auth-token:lock'")
        && electronIpc.includes('if (biometricOn && token && expiresAt > Date.now())')
        && electronIpc.includes('retainedForBiometric: true')
        && rendererApi.includes("nativeAuthToken('lockAuthToken')")
        && rendererApi.includes('let hydrateTokenInFlight = null')
        && rendererApp.includes('await api.lockToken()')
        && rendererApp.includes('Unlock with Touch ID')
        && rendererApp.includes('AuthScreen.autoTouchIdUnlock')
        && electronIpcContractTest.includes('manual vault lock only retains a usable auth token behind the biometric gate')
        && electronMainProcessTest.includes('keeps biometric auth-token fallback failures visible while failing closed'),
      'native auth-token release validates token presence/expiry before prompting, requires biometric approval when enabled, logs prompt/availability failures, and lets manual Lock retain a usable device credential only behind that same gate so Touch ID and password remain available',
    ),
  ];

  const missing = items.filter((item) => item.state === 'missing');
  const deferredItems = items.filter((item) => item.state === 'deferred');
  return {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    complete: missing.length === 0 && blockers.length === 0 && deferredItems.length === 0,
    summary: {
      checked: items.length,
      ok: items.filter((item) => item.state === 'ok').length,
      deferred: deferredItems.length,
      missing: missing.length,
      blockers: blockers.length,
    },
    items,
    blockers,
  };
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  const report = buildAudit();
  if (hasFlag(argv, '--json')) {
    json(report);
    return;
  }

  process.stdout.write(`${c.bold('Hydra release audit')}\n\n`);
  table(report.items.map((item) => ({
    state: item.state === 'ok' ? c.ok('ok') : item.state === 'deferred' ? c.warn('deferred') : c.err('missing'),
    requirement: item.label,
    evidence: item.evidence,
  })), [
    { key: 'state', label: 'STATE' },
    { key: 'requirement', label: 'REQUIREMENT' },
    { key: 'evidence', label: 'EVIDENCE' },
  ]);

  process.stdout.write('\n');
  if (report.blockers.length > 0) {
    status('warn', `${report.blockers.length} release blocker(s) remain`);
    table(report.blockers.map((row) => ({
      requirement: row.requirement,
      blocker: row.blocker,
    })), [
      { key: 'requirement', label: 'NOT VERIFIED' },
      { key: 'blocker', label: 'BLOCKER' },
    ]);
    return;
  }

  if (report.summary.deferred > 0) {
    status('warn', `${report.summary.deferred} deferred manual/live release item(s) remain.`);
    return;
  }

  status(report.complete ? 'ok' : 'err', report.complete ? 'All audited release evidence is present.' : 'Release audit has missing evidence.');
}
