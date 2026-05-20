#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const manualChecks = [
  ['Packaged GUI launch', 'Open the packaged app with npm run electron:open:mac-arm64 or Finder and confirm Hydra appears as a running app.'],
  ['Window controls', 'Verify traffic lights, close/minimize/zoom, titlebar drag, tray reopen, and quit behavior.'],
  ['Splash/unlock/dashboard', 'Verify splash, vault unlock or first-run setup, and Dashboard landing with no blank window.'],
  ['Navigation/dead buttons', 'Visit Dashboard, Vault, Pool, Traffic, Codes, Generator, Settings, Account Detail, and confirm visible actions give feedback.'],
  ['Touch ID', 'On Touch ID hardware, enable, test, disable, and unlock with biometric gating.'],
  ['Live account flows', 'Run at least one live OTP login, bulk OTP isolation pass, code redemption, and proxy/SSE request with real keys.'],
  ['Screenshots', 'Only after functional dogfood, capture packaged Electron screenshots with secrets redacted.'],
  ['Windows launch', 'Install and launch the current Windows NSIS artifact on a Windows host or runner.'],
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
  const detail = result.error ? result.error.message : output || `exit=${result.status ?? 'unknown'}`;
  printStatus(result.status === 0, label, detail);
  return result.status === 0;
}

function artifact(path) {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return { path, ok: false, detail: 'missing' };
  const mb = Math.round(statSync(abs).size / 1024 / 1024);
  return { path, ok: true, detail: `${mb} MB` };
}

function printStatus(ok, label, detail) {
  const mark = ok ? 'OK' : 'WAIT';
  console.log(`[${mark}] ${label}${detail ? ` - ${detail}` : ''}`);
}

const flags = new Set(process.argv.slice(2));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

console.log('Hydra final dogfood preflight');
console.log(`version=${pkg}`);
console.log('');

const artifacts = [
  artifact(`release/Hydra-${pkg}-mac-arm64.zip`),
  artifact(`release/Hydra-${pkg}-mac-arm64.zip.blockmap`),
  artifact(`release/Hydra-${pkg}-mac-x64.zip`),
  artifact(`release/Hydra-${pkg}-mac-x64.zip.blockmap`),
  artifact(`release/Hydra-${pkg}-win-x64.exe`),
  artifact(`release/Hydra-${pkg}-win-x64.exe.blockmap`),
];
for (const item of artifacts) printStatus(item.ok, item.path, item.detail);

console.log('');
const audit = run('node', ['bin/hydra.mjs', 'audit', '--json']);
if (audit.ok) {
  const report = JSON.parse(audit.stdout);
  printStatus(report.summary.missing === 0 && report.summary.blockers === 0, 'hydra audit missing/blocker evidence', `missing=${report.summary.missing}, blockers=${report.summary.blockers}`);
  printStatus(report.summary.deferred === 0, 'hydra audit deferred manual/live evidence', `deferred=${report.summary.deferred}, complete=${report.complete}`);
} else {
  printStatus(false, 'hydra audit', audit.stderr || audit.stdout);
}

const docker = run('docker', ['info', '--format', '{{json .ServerVersion}}']);
printStatus(docker.ok && docker.stdout && docker.stdout !== '""', 'Docker daemon reachable', docker.ok ? docker.stdout : docker.stderr);

if (flags.has('--smoke')) {
  console.log('');
  printStatus(runPassthrough('npm', ['run', 'electron:smoke'], { HYDRA_BUILD_TARGET: 'darwin-arm64' }), 'macOS ARM package smoke');
  printStatus(runPassthrough('npm', ['run', 'electron:smoke'], { HYDRA_BUILD_TARGET: 'darwin-x64' }), 'macOS Intel package smoke');
  printStatus(runPassthrough('npm', ['run', 'electron:smoke'], { HYDRA_BUILD_TARGET: 'win32-x64' }), 'Windows package smoke');
}

if (flags.has('--open-app')) {
  console.log('');
  printStatus(runPassthrough('npm', ['run', 'electron:open:mac-arm64']), 'Launch packaged macOS app through LaunchServices');
}

if (flags.has('--launch-diagnostics')) {
  console.log('');
  console.log('LaunchServices diagnostics');
  runLaunchDiagnostic('Baseline LaunchServices handoff for Calculator.app', 'open', ['-n', '/System/Applications/Calculator.app']);
  runLaunchDiagnostic('Baseline Finder AppleEvent handoff for Calculator.app', 'osascript', ['-e', 'tell application "Finder" to open POSIX file "/System/Applications/Calculator.app"']);
  runLaunchDiagnostic('Hydra LaunchServices handoff', 'open', ['-n', join(ROOT, 'release/mac-arm64/Hydra.app')]);
  runLaunchDiagnostic('Hydra Finder AppleEvent handoff', 'osascript', ['-e', `tell application "Finder" to open POSIX file "${join(ROOT, 'release/mac-arm64/Hydra.app')}"`]);
}

if (flags.has('--docker-smoke')) {
  console.log('');
  printStatus(runPassthrough('npm', ['run', 'docker:smoke']), 'Docker runtime smoke');
}

console.log('');
console.log('Manual acceptance checklist');
for (const [label, detail] of manualChecks) {
  console.log(`- [ ] ${label}: ${detail}`);
}

console.log('');
console.log('Completion rule: this preflight is not a release-complete signal while any audit item is deferred or any manual checkbox is unchecked.');
