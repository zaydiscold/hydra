#!/usr/bin/env node
/**
 * Cross-platform Electron build orchestrator.
 *
 * Replaces bash-style inline env assignment in the package.json build scripts
 * (`HYDRA_BUILD_TARGET=win32-x64 npm run electron:prepare && electron-builder ...`).
 * That syntax silently fails in Windows cmd/PowerShell — cmd tries to execute a
 * program literally named `HYDRA_BUILD_TARGET=win32-x64`. CI never hit it because
 * release.yml sets HYDRA_BUILD_TARGET via the Actions `env:` block and calls
 * electron-builder directly, so the convenience scripts had never run on Windows.
 *
 * Mirrors scripts/dev-electron.mjs, which already avoids shell env for the same
 * reason.
 *
 * Usage:
 *   node scripts/electron-build.mjs <build-target> [electron-builder args...]
 *   node scripts/electron-build.mjs win32-x64 --win nsis --x64
 *   node scripts/electron-build.mjs darwin-arm64 --mac zip --arm64
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const [buildTarget, ...builderArgs] = process.argv.slice(2);

if (!buildTarget) {
  console.error('usage: node scripts/electron-build.mjs <build-target> [electron-builder args...]');
  process.exit(1);
}

const env = { ...process.env, HYDRA_BUILD_TARGET: buildTarget };
// npm/npx are .cmd shims on Windows, so a shell is required there to resolve them.
const useShell = process.platform === 'win32';

function run(command, args) {
  console.log(`[electron-build] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: useShell });
  if (result.error) {
    console.error(`[electron-build] failed to launch ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('npm', ['run', 'build']);
run('npm', ['run', 'electron:prepare']);
run('npx', ['electron-builder', ...builderArgs]);
