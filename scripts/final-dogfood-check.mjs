#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const manualChecks = [
  { id: 'packaged-gui-launch', label: 'Packaged GUI launch', detail: 'Open the packaged app with npm run electron:open:mac-arm64 or Finder and confirm Hydra appears as a running app.' },
  { id: 'window-controls', label: 'Window controls', detail: 'Verify traffic lights, close/minimize/zoom, titlebar drag, tray reopen, and quit behavior.' },
  { id: 'splash-unlock-dashboard', label: 'Splash/unlock/dashboard', detail: 'Verify splash, vault unlock or first-run setup, and Dashboard landing with no blank window.' },
  { id: 'navigation-dead-buttons', label: 'Navigation/dead buttons', detail: 'Visit Dashboard, Vault, Pool, Traffic, Codes, Generator, Settings, Account Detail, and confirm visible actions give feedback.' },
  { id: 'touch-id', label: 'Touch ID', detail: 'On Touch ID hardware, enable, test, disable, and unlock with biometric gating.' },
  { id: 'live-account-flows', label: 'Live account flows', detail: 'Run at least one live OTP login, bulk OTP isolation pass, code redemption, and proxy/SSE request with real keys.' },
  { id: 'screenshots-redacted', label: 'Screenshots', detail: 'Only after functional dogfood, capture packaged Electron screenshots with secrets redacted.' },
  { id: 'windows-launch', label: 'Windows launch', detail: 'Install and launch the current Windows NSIS artifact on a Windows host or runner.' },
];

function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (err) {
    return {
      ok: false,
      status: err.status ?? 1,
      stdout: String(err.stdout || '').trim(),
      stderr: String(err.stderr || err.message || '').trim(),
    };
  }
}

function runPassthrough(command, args, env = {}, timeoutMs = 120_000) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    timeout: timeoutMs,
  });
  if (result.error) {
    console.log(`[WAIT] ${command} ${args.join(' ')} failed - ${result.error.message}`);
  }
  return result.status === 0;
}

function runLaunchDiagnostic(label, command, args, timeoutMs = 10_000) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const fallbackDetail = result.signal ? `signal=${result.signal}` : `exit=${result.status ?? 'unknown'}`;
  const detail = result.error ? result.error.message : output || fallbackDetail;
  printStatus(result.status === 0, label, detail);
  return {
    label,
    command,
    args,
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    detail: detail.slice(0, 4000),
  };
}

function runElectronRuntimeDiagnostic(timeoutMs = 10_000) {
  const electronBinary = join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  if (!existsSync(electronBinary)) {
    printStatus(false, 'Baseline Electron runtime --version', `${electronBinary} missing; run node -e "require('electron')" or npm ci first`);
    return false;
  }

  return runLaunchDiagnostic(
    'Baseline Electron runtime --version',
    electronBinary,
    ['--version'],
    timeoutMs,
  );
}

function artifact(path, baseDir = ROOT) {
  const abs = join(baseDir, path);
  if (!existsSync(abs)) return { path, ok: false, detail: 'missing' };
  const mb = Math.round(statSync(abs).size / 1024 / 1024);
  return { path, ok: true, detail: `${mb} MB` };
}

function pathCheck(label, path) {
  if (!existsSync(path)) return { label, path, ok: false, detail: 'missing' };
  const stat = statSync(path);
  return {
    label,
    path,
    ok: true,
    detail: stat.isDirectory() ? 'directory present' : `${Math.round(stat.size / 1024 / 1024)} MB`,
  };
}

function printStatus(ok, label, detail) {
  const mark = ok ? 'OK' : 'WAIT';
  console.log(`[${mark}] ${label}${detail ? ` - ${detail}` : ''}`);
}

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((arg) => !arg.includes('=')));
const manualCheckIds = new Set(manualChecks.map((item) => item.id));
const manualVerified = new Set(rawArgs
  .filter((arg) => arg.startsWith('--manual='))
  .map((arg) => arg.slice('--manual='.length))
  .filter(Boolean));
const unknownManualIds = [...manualVerified].filter((id) => !manualCheckIds.has(id));
const writeEvidenceArg = rawArgs.find((arg) => arg.startsWith('--write-evidence='));
const evidencePath = writeEvidenceArg
  ? writeEvidenceArg.slice('--write-evidence='.length)
  : flags.has('--write-evidence')
    ? 'docs/DOGFOOD_EVIDENCE.json'
    : null;
const artifactDirArg = rawArgs.find((arg) => arg.startsWith('--artifact-dir='));
const appPathArg = rawArgs.find((arg) => arg.startsWith('--app='));
const versionArg = rawArgs.find((arg) => arg.startsWith('--version='));
const artifactDir = artifactDirArg
  ? resolve(artifactDirArg.slice('--artifact-dir='.length))
  : join(ROOT, 'release');
const packagedAppPath = appPathArg
  ? resolve(appPathArg.slice('--app='.length))
  : join(ROOT, 'release/mac-arm64/Hydra.app');
const pkg = versionArg
  ? versionArg.slice('--version='.length)
  : JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

console.log('Hydra final dogfood preflight');
console.log(`version=${pkg}`);
console.log(`artifactDir=${artifactDir}`);
console.log(`packagedApp=${packagedAppPath}`);
console.log('');

if (unknownManualIds.length > 0) {
  printStatus(false, 'Unknown manual check id(s)', unknownManualIds.join(', '));
}

const artifacts = [
  artifact(`Hydra-${pkg}-mac-arm64.zip`, artifactDir),
  artifact(`Hydra-${pkg}-mac-arm64.zip.blockmap`, artifactDir),
  artifact(`Hydra-${pkg}-mac-x64.zip`, artifactDir),
  artifact(`Hydra-${pkg}-mac-x64.zip.blockmap`, artifactDir),
  artifact(`Hydra-${pkg}-win-x64.exe`, artifactDir),
  artifact(`Hydra-${pkg}-win-x64.exe.blockmap`, artifactDir),
];
for (const item of artifacts) printStatus(item.ok, item.path, item.detail);
const packagedApp = pathCheck('Packaged macOS app path', packagedAppPath);
printStatus(packagedApp.ok, packagedApp.label, packagedApp.detail);

const evidence = {
  schema: 'hydra.final-dogfood-evidence.v1',
  generatedAt: new Date().toISOString(),
  version: pkg,
  root: ROOT,
  checks: {
    artifacts,
    packagedApp,
    unknownManualIds,
    artifactDir,
    packagedAppPath,
  },
  manual: manualChecks.map((item) => ({
    ...item,
    verified: manualVerified.has(item.id),
  })),
  notes: [
    'This artifact is intentionally redacted. It records checklist status only, not API keys, cookies, account emails, Clerk session IDs, screenshots, or local database contents.',
    'A checked manual item means the operator explicitly passed --manual=<id> after doing that packaged-app step.',
  ],
};

console.log('');
const audit = run('node', ['bin/hydra.mjs', 'audit', '--json']);
if (audit.ok) {
  const report = JSON.parse(audit.stdout);
  evidence.checks.audit = {
    ok: true,
    summary: report.summary,
    complete: report.complete,
    missingAndBlockersOk: report.summary.missing === 0 && report.summary.blockers === 0,
  };
  printStatus(report.summary.missing === 0 && report.summary.blockers === 0, 'hydra audit missing/blocker evidence', `missing=${report.summary.missing}, blockers=${report.summary.blockers}`);
  printStatus(report.summary.deferred === 0, 'hydra audit deferred manual/live evidence', `deferred=${report.summary.deferred}, complete=${report.complete}`);
} else {
  evidence.checks.audit = { ok: false, detail: audit.stderr || audit.stdout };
  printStatus(false, 'hydra audit', audit.stderr || audit.stdout);
}

const docker = run('docker', ['info', '--format', '{{json .ServerVersion}}']);
evidence.checks.docker = { ok: docker.ok && docker.stdout && docker.stdout !== '""', detail: docker.ok ? docker.stdout : docker.stderr };
printStatus(evidence.checks.docker.ok, 'Docker daemon reachable', evidence.checks.docker.detail);

if (flags.has('--smoke')) {
  console.log('');
  printStatus(runPassthrough('npm', ['run', 'electron:smoke'], { HYDRA_BUILD_TARGET: 'darwin-arm64' }), 'macOS ARM package smoke');
  printStatus(runPassthrough('npm', ['run', 'electron:smoke'], { HYDRA_BUILD_TARGET: 'darwin-x64' }), 'macOS Intel package smoke');
  printStatus(runPassthrough('npm', ['run', 'electron:smoke'], { HYDRA_BUILD_TARGET: 'win32-x64' }), 'Windows package smoke');
}

if (flags.has('--open-app')) {
  console.log('');
  const ok = runPassthrough('node', ['scripts/open-packaged-app.mjs', packagedAppPath]);
  evidence.checks.openApp = { ok, method: 'node scripts/open-packaged-app.mjs', app: packagedAppPath };
  printStatus(ok, 'Launch packaged macOS app through LaunchServices', packagedAppPath);
}

if (flags.has('--launch-diagnostics')) {
  console.log('');
  console.log('LaunchServices diagnostics');
  evidence.checks.launchDiagnostics = [
    runElectronRuntimeDiagnostic(),
    runLaunchDiagnostic('Baseline LaunchServices handoff for Calculator.app', 'open', ['-n', '/System/Applications/Calculator.app']),
    runLaunchDiagnostic('Baseline Finder AppleEvent handoff for Calculator.app', 'osascript', ['-e', 'tell application "Finder" to open POSIX file "/System/Applications/Calculator.app"']),
    runLaunchDiagnostic('Hydra LaunchServices handoff', 'open', ['-n', packagedAppPath]),
    runLaunchDiagnostic('Hydra Finder AppleEvent handoff', 'osascript', ['-e', `tell application "Finder" to open POSIX file "${packagedAppPath}"`]),
  ];
}

if (flags.has('--docker-smoke')) {
  console.log('');
  printStatus(runPassthrough('npm', ['run', 'docker:smoke']), 'Docker runtime smoke');
}

console.log('');
console.log('Manual acceptance checklist');
for (const item of evidence.manual) {
  console.log(`- [${item.verified ? 'x' : ' '}] ${item.id}: ${item.label}: ${item.detail}`);
}

console.log('');
const allManualVerified = evidence.manual.every((item) => item.verified);
const allArtifactsPresent = evidence.checks.artifacts.every((item) => item.ok);
evidence.complete = Boolean(
  evidence.checks.audit?.missingAndBlockersOk
  && allArtifactsPresent
  && evidence.checks.packagedApp?.ok
  && evidence.checks.unknownManualIds.length === 0
  && allManualVerified
);

if (evidencePath) {
  const outputPath = isAbsolute(evidencePath) ? evidencePath : join(ROOT, evidencePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log('');
  console.log(`Wrote redacted dogfood evidence to ${evidencePath}`);
}

console.log('Completion rule: this preflight is not a release-complete signal while any release artifact is missing, the packaged app path is missing, audit has missing/blocker evidence, any manual checkbox is unchecked, or any unknown --manual id was passed.');
