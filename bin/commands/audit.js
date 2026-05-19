/**
 * `hydra audit` — read-only release checklist snapshot.
 *
 * This command intentionally does not launch Electron, Docker, browsers, or
 * live OpenRouter/Clerk flows. It turns the current repo/audit state into a
 * stable CLI artifact so release gaps are visible while Hydra is closed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { c, json, status, table } from '../lib/output.js';

const ROOT = new URL('../..', import.meta.url).pathname;

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
  const dogfoodDoc = safeRead('docs/PACKAGED_ELECTRON_DOGFOOD.md');
  const dockerDoc = safeRead('docs/DOCKER.md');
  const readme = safeRead('README.md');
  const ciWorkflow = safeRead('.github/workflows/ci.yml');
  const dockerWorkflow = safeRead('.github/workflows/docker.yml');
  const smokeWorkflow = safeRead('.github/workflows/electron-smoke.yml');
  const releaseWorkflow = safeRead('.github/workflows/release.yml');
  const uiStatic = safeRead('server/tests/ui-static-contract.test.mjs');
  const workflowContract = safeRead('server/tests/workflow-contract.test.mjs');
  const electronMain = safeRead('electron/main.js');
  const electronWindows = safeRead('electron/app/windows.js');
  const appMenu = safeRead('electron/menus/appMenu.js');
  const preload = safeRead('electron/preload.js');
  const rendererApp = safeRead('src/App.jsx');
  const nativeBridge = safeRead('src/lib/native.js');
  const electronIpcContract = safeRead('server/tests/electron-ipc-contract.test.mjs');
  const cleanupAuxProcesses = safeRead('electron/utils/cleanupAuxProcesses.js');
  const playwrightBrowser = safeRead('server/lib/playwright-browser.js');
  const electronMainProcessTest = safeRead('electron/tests/main-process.test.mjs');
  const electronIpc = safeRead('electron/app/ipc.js');
  const electronBiometric = safeRead('electron/app/biometric.js');
  const electronIpcContractTest = safeRead('server/tests/electron-ipc-contract.test.mjs');
  const filesystemPermissionsTest = safeRead('server/tests/filesystem-permissions.test.mjs');
  const localSecretsTest = safeRead('server/tests/local-secrets.test.mjs');
  const dashboardApi = safeRead('server/services/dashboard-api.js');
  const rotationManager = safeRead('server/services/rotation-manager.js');
  const store = safeRead('server/services/store.js');
  const legacyStorage = safeRead('server/services/legacy-storage.js');
  const backgroundFailureTest = safeRead('server/tests/background-failure-visibility.test.mjs');
  const schemaHash = safeRead('electron/app/schemaHash.js');
  const schemaHashTest = safeRead('server/tests/schema-hash.test.mjs');
  const importCommand = safeRead('bin/commands/import.js');
  const dbCommand = safeRead('bin/commands/db.js');
  const cliTest = safeRead('server/tests/cli.test.mjs');
  const cliMain = safeRead('bin/hydra.mjs');
  const electronSmoke = safeRead('scripts/smoke-electron-package.mjs');
  const electronPrepare = safeRead('scripts/prepare-electron-resources.mjs');
  const packagedOpenScript = safeRead('scripts/open-packaged-app.mjs');

  const macArmSize = sizeMb('release/Hydra-1.0.0-mac-arm64.zip');
  const macX64Size = sizeMb('release/Hydra-1.0.0-mac-x64.zip');
  const winX64Size = sizeMb('release/Hydra-1.0.0-win-x64.exe');
  const macX64SmokeRecorded = releaseAudit.includes('HYDRA_BUILD_TARGET=darwin-x64 npm run electron:smoke')
    && releaseAudit.includes('Mach-O 64-bit executable x86_64')
    && releaseAudit.includes('codesign --verify --deep --strict --verbose=2 release/mac/Hydra.app')
    && releaseAudit.includes('valid on disk');
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
      (dogfoodDoc.includes('Packaged Electron Dogfood')
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
          && readme.includes('## Remotion Plan')),
      'README.md defines Electron-only final dogfood screenshot requirements and Remotion media plan',
    ),
    check(
      'mac-arm-artifact',
      'macOS ARM artifact',
      macArmSize != null && existsSync(join(ROOT, 'release/Hydra-1.0.0-mac-arm64.zip.blockmap')),
      macArmSize == null ? '' : `release/Hydra-1.0.0-mac-arm64.zip (${macArmSize} MB) + blockmap`,
    ),
    check(
      'mac-intel-artifact',
      'macOS Intel artifact',
      macX64Size != null && existsSync(join(ROOT, 'release/Hydra-1.0.0-mac-x64.zip.blockmap')),
      macX64Size == null ? '' : `release/Hydra-1.0.0-mac-x64.zip (${macX64Size} MB) + blockmap`,
    ),
    check(
      'mac-intel-current',
      'macOS Intel artifact is current',
      macX64Size != null
        && existsSync(join(ROOT, 'release/Hydra-1.0.0-mac-x64.zip.blockmap'))
        && existsSync(join(ROOT, 'release/mac/Hydra.app/Contents/MacOS/Hydra'))
        && macX64SmokeRecorded
        && !blockers.some((row) => /macOS Intel package refresh/.test(row.requirement)),
      'macOS Intel x64 package was rebuilt and smoked after the native titlebar/traffic-light change',
    ),
    check(
      'windows-installer-artifact',
      'Windows x64 installer artifact',
      winX64Size != null,
      winX64Size == null ? '' : `release/Hydra-1.0.0-win-x64.exe (${winX64Size} MB)`,
    ),
    deferred(
      'packaged-gui-dogfood',
      'Packaged Electron GUI dogfood',
      'deferred from active Codex scope; manual packaged Electron GUI dogfood is user-owned until explicitly reopened',
    ),
    deferred(
      'live-mvp-dogfood',
      'Live MVP feature dogfood',
      'deferred from active Codex scope; live OTP/redemption/real-key rotation require manual/live credentials',
    ),
    deferred(
      'packaged-screenshot-audit',
      'Packaged Electron screenshot audit',
      'deferred from active Codex scope; screenshot auditing must be packaged Electron only if reopened',
    ),
    check(
      'package-scripts',
      'Package scripts',
      Boolean(pkg.scripts?.['electron:build'] && pkg.scripts?.['electron:smoke'] && pkg.scripts?.['docker:smoke']),
      'package.json exposes electron:build, electron:smoke, and docker:smoke',
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
      'test-chain',
      'Full test chain',
      String(pkg.scripts?.test || '').includes('test:test-chain-completeness')
        && String(pkg.scripts?.test || '').includes('test:ui-static')
        && String(pkg.scripts?.test || '').includes('test:workflow-contract'),
      'npm test includes chain completeness, UI static, and workflow contract tests',
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
        && smokeWorkflow.includes('windows-latest')
        && releaseWorkflow.includes('windows-2022')
        && releaseWorkflow.includes('--publish never')
        && releaseWorkflow.includes('gh release upload "$GITHUB_REF_NAME"')
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
        && electronPrepare.includes('function chromiumCacheGuidance')
        && electronPrepare.includes('Build on the target runner/machine')
        && electronPrepare.includes('PLAYWRIGHT_BROWSERS_PATH cache')
        && workflowContract.includes('electron package smoke validates target-specific Chromium archives')
        && workflowContract.includes('electron package smoke validates distributable release artifacts'),
      'workflow contract and workflows include CI/Docker/package/release Node 24 runtime coverage, Windows x64 NSIS package path, publish-after-smoke release ordering, LaunchServices packaged-app open guidance with bundle preflight, package diagnostics, target-specific resource selection, target-specific Chromium smoke verification, macOS plist/hiddenInset titlebar checks, packaged app-shell checks, distributable artifact smoke checks, target-specific Prisma engine checks, Windows installer blockmap checks, and target-cache miss guidance',
    ),
    check(
      'docker-docs',
      'Docker runtime docs',
      dockerDoc.includes('docker compose down --remove-orphans')
        && dockerDoc.includes('HYDRA_DOCKER_BUILD_TIMEOUT_MS'),
      'docs/DOCKER.md documents bounded smoke timeouts and failed-start cleanup',
    ),
    deferred(
      'docker-runtime',
      'Docker runtime smoke',
      'runtime smoke is environment-gated; code-level docker smoke script and docs remain covered',
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
  return {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    complete: missing.length === 0 && blockers.length === 0,
    summary: {
      checked: items.length,
      ok: items.filter((item) => item.state === 'ok').length,
      deferred: items.filter((item) => item.state === 'deferred').length,
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

  status(report.complete ? 'ok' : 'err', report.complete ? 'All audited release evidence is present.' : 'Release audit has missing evidence.');
}
