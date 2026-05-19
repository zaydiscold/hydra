#!/usr/bin/env node
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const appPath = resolve(process.argv[2] || 'release/mac-arm64/Hydra.app');

function plistValue(plistPath, key) {
  return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function preflightBundle(bundlePath) {
  const plistPath = resolve(bundlePath, 'Contents/Info.plist');
  const executableName = plistValue(plistPath, 'CFBundleExecutable');
  const packageType = plistValue(plistPath, 'CFBundlePackageType');
  const bundleId = plistValue(plistPath, 'CFBundleIdentifier');
  const executablePath = resolve(bundlePath, 'Contents/MacOS', executableName);

  if (packageType !== 'APPL') {
    throw new Error(`CFBundlePackageType must be APPL, got ${packageType || '<empty>'}`);
  }

  accessSync(executablePath, constants.X_OK);
  const executableStats = statSync(executablePath);
  if (!executableStats.isFile()) {
    throw new Error(`CFBundleExecutable is not a file: ${executablePath}`);
  }

  return { bundleId, executableName, executablePath, packageType, plistPath };
}

function printCommandOutput(output, maxLines = 80) {
  const text = String(output || '').trim();
  if (!text) return;
  const lines = text.split('\n');
  for (const line of lines.slice(0, maxLines)) {
    console.log(`[open-packaged-app]   ${line}`);
  }
  if (lines.length > maxLines) {
    console.log(`[open-packaged-app]   ... ${lines.length - maxLines} more line(s) omitted`);
  }
}

function runDiagnostic(label, command, args, { stderrOnly = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const output = stderrOnly ? result.stderr : `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status === 0) {
    console.log(`[open-packaged-app] ${label}: OK`);
    printCommandOutput(output);
    return true;
  }

  const message = result.error ? result.error.message : `exit ${result.status}`;
  const prefix = allowFailure ? 'WARN' : 'FAILED';
  console.error(`[open-packaged-app] ${label}: ${prefix} (${message})`);
  printCommandOutput(output);
  return false;
}

function runPreLaunchDiagnostics(bundlePath, bundle) {
  console.log('[open-packaged-app] pre-launch diagnostics');
  console.log(`[open-packaged-app]   Info.plist: ${bundle.plistPath}`);
  console.log(`[open-packaged-app]   CFBundleIdentifier=${bundle.bundleId}`);
  runDiagnostic('main executable type', 'file', [bundle.executablePath]);
  runDiagnostic('bundle root xattrs', 'xattr', [bundlePath], { allowFailure: true });
  runDiagnostic('main executable xattrs', 'xattr', [bundle.executablePath], { allowFailure: true });
  runDiagnostic('bundle quarantine xattr', 'xattr', ['-p', 'com.apple.quarantine', bundlePath], { allowFailure: true });
  runDiagnostic('main executable quarantine xattr', 'xattr', ['-p', 'com.apple.quarantine', bundle.executablePath], {
    allowFailure: true,
  });
  runDiagnostic('codesign verify', 'codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundlePath]);
  runDiagnostic('codesign details', 'codesign', ['-dv', '--verbose=4', bundlePath], {
    stderrOnly: true,
    allowFailure: true,
  });
}

function runProcessDiagnostics(bundle) {
  const pattern = `${bundle.bundleId}|${bundle.executableName}`;
  console.log(`[open-packaged-app] process lookup after LaunchServices handoff: pgrep -fl ${pattern}`);
  runDiagnostic('running process lookup', 'pgrep', ['-fl', pattern], { allowFailure: true });
}

function usage() {
  console.log(`Hydra packaged app launcher

Usage:
  node scripts/open-packaged-app.mjs [path/to/Hydra.app]

Launches the macOS packaged .app through LaunchServices. Do not launch
Contents/MacOS/Hydra directly for GUI dogfood; that path can abort during
macOS application registration and does not represent the normal packaged app
launch path.
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  usage();
  process.exit(0);
}

if (platform() !== 'darwin') {
  console.error('[open-packaged-app] macOS LaunchServices launch is only available on darwin');
  process.exit(1);
}

if (!appPath.endsWith('.app')) {
  console.error(`[open-packaged-app] expected a .app bundle path, got: ${appPath}`);
  process.exit(1);
}

if (!existsSync(appPath)) {
  console.error(`[open-packaged-app] app bundle does not exist: ${appPath}`);
  process.exit(1);
}

let bundle;
try {
  bundle = preflightBundle(appPath);
} catch (err) {
  console.error(`[open-packaged-app] app bundle preflight failed: ${err.message}`);
  process.exit(1);
}

console.log(
  `[open-packaged-app] bundle OK: CFBundlePackageType=${bundle.packageType}, CFBundleExecutable=${bundle.executableName}`,
);
console.log(`[open-packaged-app] executable OK: ${bundle.executablePath}`);
runPreLaunchDiagnostics(appPath, bundle);

const args = ['-n', appPath];
console.log(`[open-packaged-app] open ${args.join(' ')}`);

const child = spawn('open', args, {
  cwd: ROOT,
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error(`[open-packaged-app] failed to start open: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (code === 0) {
    console.log('[open-packaged-app] launch request handed to LaunchServices');
    setTimeout(() => {
      runProcessDiagnostics(bundle);
      process.exit(0);
    }, 2000);
    return;
  }
  const reason = signal ? `signal ${signal}` : `exit ${code}`;
  console.error(`[open-packaged-app] LaunchServices open failed with ${reason}`);
  console.error('[open-packaged-app] launch failed after bundle preflight; compare with a known system app from the same shell before treating this as app-bundle evidence');
  process.exit(code || 1);
});
