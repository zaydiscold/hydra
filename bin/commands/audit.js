/**
 * `hydra audit` — read-only release checklist snapshot.
 *
 * This command intentionally does not launch Electron, Docker, browsers, or
 * live OpenRouter/Clerk flows. It turns the current repo/audit state into a
 * stable CLI artifact so release gaps are visible while Hydra is closed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
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
  const packageLock = safeRead('package-lock.json');
  const goalDoc = safeRead('docs/CODEX_GOAL.md');
  const releaseAudit = safeRead('docs/RELEASE_AUDIT.md');
  const versioningDoc = safeRead('docs/VERSIONING.md');
  const dogfoodDoc = safeRead('docs/PACKAGED_ELECTRON_DOGFOOD.md');
  const finalDogfoodDoc = safeRead('docs/FINAL_DOGFOOD_EVIDENCE.md');
  const finalDogfoodScript = safeRead('scripts/final-dogfood-check.mjs');
  const finalDogfoodTest = safeRead('server/tests/final-dogfood-evidence.test.mjs');
  const dockerDoc = safeRead('docs/DOCKER.md');
  const readme = safeRead('README.md');
  const ciWorkflow = safeRead('.github/workflows/ci.yml');
  const dockerWorkflow = safeRead('.github/workflows/docker.yml');
  const dockerRuntimeCiRecorded = releaseAudit.includes('GitHub Actions run 26196262336')
    && releaseAudit.includes('Runtime Smoke')
    && releaseAudit.includes('npm run docker:smoke -- --start')
    && releaseAudit.includes('health endpoint response')
    && releaseAudit.includes('Build & Push');
  const smokeWorkflow = safeRead('.github/workflows/electron-smoke.yml');
  const releaseWorkflow = safeRead('.github/workflows/release.yml');
  const autoVersionWorkflow = safeRead('.github/workflows/auto-version.yml');
  const uiStatic = safeRead('server/tests/ui-static-contract.test.mjs');
  const workflowContract = safeRead('server/tests/workflow-contract.test.mjs');
  const electronMain = safeRead('electron/main.js');
  const electronWindows = safeRead('electron/app/windows.js');
  const appMenu = safeRead('electron/menus/appMenu.js');
  const preload = safeRead('electron/preload.js');
  const rendererApp = safeRead('src/App.jsx');
  const metricsHook = safeRead('src/hooks/useMetrics.js');
  const trafficHook = safeRead('src/hooks/useTraffic.js');
  const bulkAuthHook = safeRead('src/hooks/useBulkAuth.js');
  const vaultPage = safeRead('src/pages/Vault.jsx');
  const generatorPage = safeRead('src/pages/Generator.jsx');
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
  const systemController = safeRead('server/controllers/SystemController.js');
  const systemRoutes = safeRead('server/routes/system.js');
  const rendererApi = safeRead('src/api.js');
  const runtimeDiagnostics = safeRead('src/lib/runtimeDiagnostics.js');
  const settingsPage = safeRead('src/pages/Settings.jsx');
  const rotationManager = safeRead('server/services/rotation-manager.js');
  const store = safeRead('server/services/store.js');
  const legacyStorage = safeRead('server/services/legacy-storage.js');
  const backgroundFailureTest = safeRead('server/tests/background-failure-visibility.test.mjs');
  const sessionRefresher = safeRead('server/services/session-refresher.js');
  const healthPinger = safeRead('server/services/health-pinger.js');
  const requestLogBuffer = safeRead('server/services/request-log-buffer.js');
  const requestLogRetention = safeRead('server/services/request-log-retention.js');
  const schemaHash = safeRead('electron/app/schemaHash.js');
  const schemaHashTest = safeRead('server/tests/schema-hash.test.mjs');
  const importCommand = safeRead('bin/commands/import.js');
  const dbCommand = safeRead('bin/commands/db.js');
  const cliTest = safeRead('server/tests/cli.test.mjs');
  const cliMain = safeRead('bin/hydra.mjs');
  const mcpCommand = safeRead('bin/commands/mcp.js');
  const mcpTest = safeRead('server/tests/mcp-cli.test.mjs');
  const electronSmoke = safeRead('scripts/smoke-electron-package.mjs');
  const electronPrepare = safeRead('scripts/prepare-electron-resources.mjs');
  const electronBuilderConfig = safeRead('electron-builder.yml');
  const packagedOpenScript = safeRead('scripts/open-packaged-app.mjs');

  const version = pkg.version;
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
          && readme.includes('## Remotion Plan')))
        && finalDogfoodDoc.includes('DOGFOOD_EVIDENCE.json')
        && finalDogfoodDoc.includes('--manual=packaged-gui-launch')
        && finalDogfoodScript.includes('hydra.final-dogfood-evidence.v1')
        && finalDogfoodScript.includes('--write-evidence')
        && finalDogfoodScript.includes('--manual=')
        && finalDogfoodScript.includes('not API keys, cookies, account emails, Clerk session IDs')
        && finalDogfoodTest.includes('final dogfood evidence capture is redacted and manually explicit'),
      'README/docs define Electron-only final dogfood screenshot requirements, Remotion plan, and redacted user-run evidence capture',
    ),
    check(
      'mac-arm-artifact',
      'macOS ARM artifact',
      (macArmSize != null && existsSync(join(ROOT, artifactPaths.macArmBlockmap))) || macArmCiRecorded,
      macArmSize == null
        ? 'GitHub Actions macOS arm64 electron:smoke artifact evidence recorded in docs/RELEASE_AUDIT.md'
        : artifactPaths.macArmZip + ' (' + macArmSize + ' MB) + blockmap',
    ),
    check(
      'mac-intel-artifact',
      'macOS Intel artifact',
      (macX64Size != null && existsSync(join(ROOT, artifactPaths.macX64Blockmap))) || macX64CiRecorded,
      macX64Size == null
        ? 'GitHub Actions macOS Intel electron:smoke artifact evidence recorded in docs/RELEASE_AUDIT.md'
        : artifactPaths.macX64Zip + ' (' + macX64Size + ' MB) + blockmap',
    ),
    check(
      'mac-intel-current',
      'macOS Intel artifact is current',
      ((macX64Size != null
        && existsSync(join(ROOT, artifactPaths.macX64Blockmap))
        && existsSync(join(ROOT, 'release/mac/Hydra.app/Contents/MacOS/Hydra')))
        || macX64CiRecorded)
        && !blockers.some((row) => /macOS Intel package refresh/.test(row.requirement)),
      macX64CiRecorded
        ? 'GitHub Actions macOS Intel runner built --mac zip --x64 and electron:smoke verified packaged shell, x64 zip, Prisma engine, and bundled Chromium'
        : 'macOS Intel x64 package was rebuilt and smoked after the native titlebar/traffic-light change',
    ),
    check(
      'windows-installer-artifact',
      'Windows x64 installer artifact',
      (winX64Size != null && existsSync(join(ROOT, artifactPaths.winX64Blockmap))) || winX64CiRecorded,
      winX64Size == null
        ? 'GitHub Actions Windows NSIS electron:smoke artifact evidence recorded in docs/RELEASE_AUDIT.md'
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
      'not release-complete evidence; Windows installer install/launch still requires Windows host or runner dogfood',
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
        && accountProxyPool.includes('randomBytes(4).readUInt32BE(0) % proxies.length')
        && systemController.includes('getAccountProxyPool')
        && systemController.includes('setAccountProxyPool')
        && systemRoutes.includes("'/account-proxies'")
        && rendererApi.includes('getAccountProxies')
        && rendererApi.includes('setAccountProxies')
        && settingsPage.includes('Account Proxy Pool')
        && settingsPage.includes('Save Proxies')
        && accountGenerator.includes('pickAccountProxy')
        && accountGenerator.includes('proxy: toPlaywrightProxy(accountProxy)')
        && dashboardApi.includes('ProxyAgent')
        && dashboardApi.includes('fetchOptionsWithAccountProxy')
        && dashboardApi.includes('redeemCodeViaServerAction(sessionCookie, clientCookie, code, accountProxy)')
        && dashboardApi.includes('tryRestApiRedeemCode(sessionCookie, clientCookie, code, accountProxy)')
        && dashboardApi.includes('redeemCodeViaPlaywright(userId, accountId, sessionCookie, clientCookie, code, accountProxy)')
        && String(pkg.scripts?.test || '').includes('test:account-proxy-pool')
        && backgroundFailureTest.includes('ProxyAgent')
        && backgroundFailureTest.includes('fetchOptionsWithAccountProxy')
        && backgroundFailureTest.includes('redeemCodeViaServerAction\\(sessionCookie, clientCookie, code, accountProxy\\)'),
      'Settings/API store one proxy per line encrypted; signup, management-key, HTTP redemption, REST redemption, and Playwright redemption paths select and use a redacted random account proxy with empty-list fallback',
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
        && readme.includes('ip:port:user:pass')
        && readme.includes('The README avoids embedding real account data, full API keys, or live secrets')
        && readme.includes('[docs/VERSIONING.md](docs/VERSIONING.md)')
        && versioningDoc.includes('[bump:minor]')
        && versioningDoc.includes('1.0.20 -> 1.1.0')
        && versioningDoc.includes('Splash Density And Tilt In The Version Notes')
        && versioningDoc.includes('x-axis value affects horizontal gravity, spawn')
        && versioningDoc.includes('Exact MacBook lid-angle tilt is not exposed through a standard Electron API')
        && goalDoc.includes('cut the release as a minor bump using `[bump:minor]`'),
      'README.md has top navigation, grouped CLI/router/hardening/release sections, proxy-pool docs, versioning policy, splash tilt notes, and packaged-Electron screenshot secrecy guidance',
    ),
    check(
      'dependency-audit',
      'Dependency audit',
      packageLock.includes('"node_modules/@fastify/otel/node_modules/brace-expansion"')
        && packageLock.includes('"version": "5.0.6"')
        && !packageLock.includes('"node_modules/@fastify/otel/node_modules/brace-expansion": {\n      "version": "5.0.5"'),
      'Sentry/@fastify/otel nested brace-expansion lockfile entry is patched to 5.0.6',
    ),
    check(
      'performance-efficiency-pass',
      'Performance and fan-pressure pass',
      goalDoc.includes('Primary focus for the next 4-5 hours: performance and efficiency release')
        && releaseAudit.includes('performance and efficiency pass')
        && electronWindows.includes('HYDRA_SPLASH_PHYSICS_STEP_MS=1000/45')
        && electronWindows.includes('Eng.update(engine,HYDRA_SPLASH_PHYSICS_STEP_MS)')
        && !electronWindows.includes('Run.create')
        && !electronWindows.includes('Run.run')
        && electronWindows.includes('HYDRA_SPLASH_RENDER_FRAME_MS=1000/30')
        && electronWindows.includes('HYDRA_SPLASH_DURATION_MS=12000')
        && electronWindows.includes('HYDRA_SPLASH_TARGET=92')
        && electronWindows.includes('tiltBias=hydraSplashTiltGravityX*(W()*0.18)')
        && electronWindows.includes('hydraSplashLeanX+= (hydraSplashTiltGravityX-hydraSplashLeanX)*0.08')
        && electronWindows.includes('disposeHydraSplash')
        && electronMainProcessTest.includes('splash physics and animation loops have a finite cleanup path')
        && accountGenerator.includes('cleanupEphemeralProfileDir(profileDir)')
        && dashboardApi.includes('cleanupEphemeralProfileDir(profileDir)')
        && requestLogBuffer.includes('timer = setTimeout')
        && !requestLogBuffer.includes('timer = setInterval')
        && requestLogRetention.includes('scheduleNextPrune(RETENTION_INTERVAL_MS)')
        && requestLogRetention.includes('timer = setTimeout')
        && !requestLogRetention.includes('setInterval')
        && sessionRefresher.includes('function scheduleNextSweep(delayMs = INTERVAL_MS)')
        && sessionRefresher.includes('_intervalHandle = setTimeout')
        && sessionRefresher.includes('scheduleNextSweep(INTERVAL_MS)')
        && !sessionRefresher.includes('setInterval')
        && healthPinger.includes('HYDRA_HEALTH_PING_STARTUP_DELAY_MS')
        && healthPinger.includes('timer = setTimeout')
        && healthPinger.includes('scheduleNextPing(PING_INTERVAL_MS)')
        && healthPinger.includes('activeController?.abort()')
        && !healthPinger.includes('setInterval')
        && runtimeDiagnostics.includes('__HYDRA_RENDERER_DIAGNOSTICS__')
        && runtimeDiagnostics.includes('activeTotal: timeouts.active + intervals.active + animationFrames.active + animations.active')
        && runtimeDiagnostics.includes('trackRendererAnimation')
        && uiStatic.includes('__HYDRA_RENDERER_DIAGNOSTICS__')
        && uiStatic.includes('short-lived renderer feedback timers are cleared on unmount')
        && uiStatic.includes('ScrambleText clears delayed intervals on unmount')
        && rendererApp.includes('if (document.hidden || inFlight) return')
        && rendererApp.includes("setTrackedTimeout('App.upstreamHealth'")
        && metricsHook.includes('inFlightRef.current')
        && metricsHook.includes("setTrackedTimeout('useMetrics.autoRefresh'")
        && trafficHook.includes('inFlightRef.current')
        && trafficHook.includes("setTrackedTimeout('useTraffic.autoRefresh'")
        && vaultPage.includes('loadInFlightRef.current')
        && vaultPage.includes("setTrackedTimeout('Vault.autoRefresh'")
        && generatorPage.includes('statusPollInFlightRef.current')
        && generatorPage.includes('heartbeatInFlightRef.current')
        && generatorPage.includes("setTrackedTimeout('Generator.statusPoll'")
        && generatorPage.includes("setTrackedTimeout('Generator.heartbeat'")
        && bulkAuthHook.includes('pollTimerRef.current')
        && bulkAuthHook.includes('poll.inFlight')
        && bulkAuthHook.includes("setTrackedTimeout('useBulkAuth.magicLinkSendDelay'")
        && !bulkAuthHook.includes('pollRefs.current[email] = setInterval')
        && cliMain.includes('inspectHydraPlaywrightProfiles')
        && cliMain.includes('inspectHydraProcesses')
        && cliMain.includes('--clean-stale-profiles')
        && cliMain.includes('moveStaleHydraPlaywrightProfiles')
        && cliMain.includes('deleted: 0')
        && cliTest.includes('hydra doctor includes local performance diagnostics for fan-pressure reports')
        && cliTest.includes('stale-profile cleanup moves Hydra profile dirs to a reversible backup')
        && playwrightIsolationTest.includes('cleanupEphemeralProfileDir removes only Hydra-owned ephemeral profile dirs')
        && backgroundFailureTest.includes('cleanupEphemeralProfileDir\\(profileDir\\)'),
      'Splash Matter/render loops are finite and throttled through one owned Engine.update/render loop, the front animation is extended to 12s with 92 words and stronger sensor/fallback side lean, Playwright launch profile dirs are removed after browser automation paths; request-log flushing/retention, health pings, session refresh, renderer polling, and bulk magic-link polling avoid permanent/overlapping idle intervals; renderer runtime diagnostics expose owned timers/RAFs/Anime.js effects; hydra doctor reports stale profiles/process CPU/RAM and can move stale profiles into a reversible backup; focused performance contracts cover the changes',
    ),
    check(
      'test-chain',
      'Full test chain',
      String(pkg.scripts?.test || '').includes('test:test-chain-completeness')
        && String(pkg.scripts?.test || '').includes('test:ui-static')
        && String(pkg.scripts?.test || '').includes('test:mcp')
        && String(pkg.scripts?.test || '').includes('test:workflow-contract'),
      'npm test includes chain completeness, MCP, UI static, and workflow contract tests',
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
        && cliTest.includes('hydra top-level system commands default to the same repo data dir as service commands')
        && cliTest.includes('hydra doctor recognizes packaged Chromium zip resources'),
      'hydra doctor/data-dir/logs default to the same repo runtime as service commands and doctor detects packaged Chromium zip resources',
    ),
    check(
      'ui-contract',
      'UI polish/static contract',
      uiStatic.includes('primary page headers use the shared AnimeText treatment')
        && uiStatic.includes('first-run setup is a guided password key tour instead of a login dead end')
        && uiStatic.includes('active renderer UI does not ship obvious dead-button placeholders'),
      'server/tests/ui-static-contract.test.mjs covers AnimeText headers, first-run setup, and dead-button placeholders',
    ),
    check(
      'startup-fallback',
      'Startup and activate no-blank fallback',
      electronMain.includes('loadURL resolved before ready-to-show')
        && electronMain.includes('if (loadSucceeded && !mainShown)')
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
      uiStatic.includes('settings toggles are backed by persisted native preferences')
        && uiStatic.includes("togglePref\\('biometricEnabled'")
        && uiStatic.includes("togglePref\\('telemetryEnabled'")
        && electronIpc.includes("ipcMain.handle('native:prefs:set'")
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
        && electronIpcContract.includes('native:clipboard-copy-failed')
        && uiStatic.includes('native menu action feedback reaches renderer toasts'),
      'Help/menu/tray source contracts cover docs/issues links, diagnostics, folder opens, Build Info copy, and renderer toasts',
    ),
    check(
      'fallback-visibility',
      'Non-fatal runtime fallbacks leave diagnostic evidence',
      dashboardApi.includes('Redeem credit poll failed')
        && dashboardApi.includes('Redeem tRPC route persistence failed')
        && dashboardApi.includes('Hash auto-discovery bundle fetch failed')
        && dashboardApi.includes('Self-heal ${kind} hash probe failed')
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
      'workflow-contract',
      'Windows/release workflow contract',
      workflowContract.includes('Windows x64 NSIS')
        && workflowContract.includes('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24')
        && workflowContract.includes('node-version:\\s*24')
        && ciWorkflow.includes('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"')
        && ciWorkflow.includes('node-version: 24')
        && dockerWorkflow.includes('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"')
        && smokeWorkflow.includes('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"')
        && smokeWorkflow.includes('node-version: 24')
        && releaseWorkflow.includes('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"')
        && releaseWorkflow.includes('node-version: 24')
        && autoVersionWorkflow.includes('[bump:minor]')
        && autoVersionWorkflow.includes('[bump:major]')
        && autoVersionWorkflow.includes('minor=$((minor + 1))')
        && autoVersionWorkflow.includes('major=$((major + 1))')
        && autoVersionWorkflow.includes('patch=0')
        && smokeWorkflow.includes('windows-latest')
        && releaseWorkflow.includes('windows-2022')
        && releaseWorkflow.includes('--publish never')
        && releaseWorkflow.includes('gh release upload "$GITHUB_REF_NAME"')
        && releaseWorkflow.includes('mac-update-metadata')
        && releaseWorkflow.includes('scripts/merge-mac-update-yml.mjs')
        && releaseWorkflow.includes('artifacts/mac-arm64/latest-mac.yml')
        && releaseWorkflow.includes('artifacts/mac-x64/latest-mac.yml')
        && releaseWorkflow.includes("grep -q 'mac-arm64.zip' release/latest-mac.yml")
        && releaseWorkflow.includes("grep -q 'mac-x64.zip' release/latest-mac.yml")
        && smokeWorkflow.includes('HYDRA_BUILD_TARGET: ${{ matrix.build_target }}')
        && releaseWorkflow.includes('HYDRA_BUILD_TARGET: ${{ matrix.build_target }}')
        && pkg.scripts?.['electron:open:mac-arm64'] === 'node scripts/open-packaged-app.mjs release/mac-arm64/Hydra.app'
        && packagedOpenScript.includes("spawn('open', args")
        && packagedOpenScript.includes('function preflightBundle')
        && packagedOpenScript.includes('function runPreLaunchDiagnostics')
        && packagedOpenScript.includes('function runProcessDiagnostics')
        && packagedOpenScript.includes('CFBundleExecutable')
        && packagedOpenScript.includes('CFBundlePackageType')
        && packagedOpenScript.includes('com.apple.quarantine')
        && packagedOpenScript.includes("codesign', ['--verify', '--deep', '--strict'")
        && packagedOpenScript.includes('Do not launch')
        && electronSmoke.includes('expectedChromiumChildrenForTarget')
        && electronSmoke.includes("'darwin-arm64': join(RELEASE, 'mac-arm64/Hydra.app/Contents/Resources')")
        && electronSmoke.includes("'darwin-x64': join(RELEASE, 'mac/Hydra.app/Contents/Resources')")
        && electronSmoke.includes("'win32-x64': join(RELEASE, 'win-unpacked/resources')")
        && electronSmoke.includes('function assertPackagedShell')
        && electronSmoke.includes('function assertMacPlistContract')
        && electronSmoke.includes('function assertPackagedMacChromeContract')
        && electronSmoke.includes("titleBarStyle: 'hiddenInset'")
        && electronSmoke.includes('trafficLightPosition: { x: 14, y: 12 }')
        && electronSmoke.includes('function assertReleaseArtifact')
        && electronSmoke.includes('Windows x64 installer blockmap')
        && electronSmoke.includes('query_engine-windows.dll.node')
        && electronSmoke.includes('macOS ARM package must contain darwin-arm64 Prisma engine')
        && electronSmoke.includes('macOS Intel package must contain darwin Prisma engine')
        && electronSmoke.includes('nested .app bundle(s) found under Resources')
        && electronBuilderConfig.includes('!release/**')
        && electronPrepare.includes('function chromiumCacheGuidance')
        && electronPrepare.includes('Build on the target runner/machine')
        && electronPrepare.includes('PLAYWRIGHT_BROWSERS_PATH cache')
        && workflowContract.includes('electron package smoke validates target-specific Chromium archives')
        && workflowContract.includes('electron package smoke validates distributable release artifacts'),
      'workflow contract and workflows include CI/Docker/package/release Node 24 runtime coverage, Windows x64 NSIS package path, publish-after-smoke release ordering, patch/minor/major auto-version controls, merged multi-arch latest-mac.yml auto-update metadata, LaunchServices packaged-app open guidance with bundle preflight, package diagnostics, target-specific resource selection, target-specific Chromium smoke verification, macOS plist/hiddenInset titlebar checks, packaged app-shell checks, stale release-output exclusion, distributable artifact smoke checks, target-specific Prisma engine checks, Windows installer blockmap checks, and target-cache miss guidance',
    ),
    check(
      'docker-docs',
      'Docker runtime docs',
      dockerDoc.includes('docker compose down --remove-orphans')
        && dockerDoc.includes('HYDRA_DOCKER_BUILD_TIMEOUT_MS'),
      'docs/DOCKER.md documents bounded smoke timeouts and failed-start cleanup',
    ),
    check(
      'docker-runtime',
      'Docker runtime smoke',
      dockerRuntimeCiRecorded,
      'GitHub Actions run 26196262336 Runtime Smoke ran npm run docker:smoke -- --start, started the Docker container, received a local health endpoint response, cleaned up compose resources, and Build & Push also passed',
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
      electronIpc.includes("if (biometricOn) {")
        && electronIpc.includes("await promptBiometric('Unlock Hydra')")
        && electronIpc.includes('biometric auth-token gate denied release')
        && electronBiometric.includes('Touch ID availability check failed')
        && electronBiometric.includes('Touch ID prompt failed (${e.code})')
        && !electronIpc.includes('biometricOn && canPromptBiometric()')
        && electronIpcContractTest.includes('enabled biometric auth-token gate fails closed')
        && electronMainProcessTest.includes('keeps biometric auth-token fallback failures visible while failing closed'),
      'native auth-token release requires the biometric prompt whenever biometricEnabled is true and logs prompt/availability failures',
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
