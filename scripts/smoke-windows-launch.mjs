#!/usr/bin/env node
// @platform windows
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RELEASE_DIR = join(ROOT, 'release');
const UNPACKED_DIR = join(ROOT, 'release', 'win-unpacked');
const UNPACKED_EXE = join(UNPACKED_DIR, 'Hydra.exe');
const PACKAGE_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const INSTALLER_EXE = join(RELEASE_DIR, `Hydra-${PACKAGE_VERSION}-win-x64.exe`);
const UNINSTALLER_FILENAME = 'Uninstall Hydra.exe';
const STAY_ALIVE_MS = 25_000;
const CLEANUP_GRACE_MS = 3_000;
const UNINSTALL_GRACE_MS = 10_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function powershell(script, env = {}) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
    windowsHide: true,
  });
}

function listOwnedProcesses(appDir) {
  const output = powershell([
    "$ErrorActionPreference = 'Stop';",
    '$prefix = $env:HYDRA_WINDOWS_APP_DIR;',
    '@(Get-CimInstance Win32_Process',
    '| Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) }',
    '| Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine)',
    '| ConvertTo-Json -Compress',
  ].join(' '), { HYDRA_WINDOWS_APP_DIR: appDir }).trim();

  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map((row) => ({
      pid: Number(row.ProcessId),
      parentPid: Number(row.ParentProcessId),
      name: String(row.Name || ''),
      executablePath: String(row.ExecutablePath || ''),
      commandLine: String(row.CommandLine || ''),
    }))
    .filter(({ pid }) => Number.isInteger(pid) && pid > 0);
}

function taskkill(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim();
    console.warn(`[windows-launch-smoke] taskkill ${pid} reported: ${detail}`);
  }
}

function cleanupTempDir(path, label) {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[windows-launch-smoke] failed to clean ${label} ${path}: ${error.message}`);
  }
}

async function waitForMissing(path, timeoutMs = UNINSTALL_GRACE_MS) {
  const deadline = Date.now() + timeoutMs;
  while (existsSync(path) && Date.now() < deadline) {
    await sleep(250);
  }
  return !existsSync(path);
}

function tail(value, length = 2_000) {
  return value.length <= length ? value : value.slice(-length);
}

async function cleanupOwnedProcesses(appDir, rootPid) {
  taskkill(rootPid);
  const before = listOwnedProcesses(appDir);
  const targets = new Set(before.map(({ pid }) => pid));
  for (const pid of targets) taskkill(pid);

  await sleep(CLEANUP_GRACE_MS);
  let survivors = listOwnedProcesses(appDir);
  if (survivors.length) {
    console.warn('[windows-launch-smoke] retrying cleanup for surviving packaged processes:');
    console.warn(JSON.stringify(survivors, null, 2));
    for (const { pid } of survivors) taskkill(pid);
    await sleep(CLEANUP_GRACE_MS);
    survivors = listOwnedProcesses(appDir);
  }

  if (survivors.length) {
    throw new Error(`packaged Hydra processes survived cleanup: ${JSON.stringify(survivors)}`);
  }
}

async function launchAndCleanup(exe, appDir, label) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'hydra-windows-launch-smoke-'));
  console.log(`[windows-launch-smoke] launching ${label}: ${exe}`);
  console.log(`[windows-launch-smoke] isolated userData: ${userDataDir}`);

  let stdout = '';
  let stderr = '';
  let exit = null;
  const child = spawn(exe, [`--user-data-dir=${userDataDir}`], {
    cwd: dirname(exe),
    env: process.env,
    windowsHide: false,
  });
  child.stdout?.on('data', (chunk) => { stdout += chunk; });
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  child.once('error', (error) => { exit = { error: error.message }; });
  child.once('exit', (code, signal) => { exit = { code, signal }; });

  let runError = null;
  try {
    await sleep(STAY_ALIVE_MS);
    if (exit) {
      throw new Error(`packaged Hydra exited before ${STAY_ALIVE_MS}ms: ${JSON.stringify(exit)}`);
    }

    const ownedProcesses = listOwnedProcesses(appDir);
    console.log(`[windows-launch-smoke] ${label} process tree after startup:`);
    console.log(JSON.stringify(ownedProcesses, null, 2));
    if (!ownedProcesses.some(({ pid }) => pid === child.pid)) {
      throw new Error(`spawned Hydra pid ${child.pid} was not present in the packaged process tree`);
    }
  } catch (error) {
    runError = error;
  }

  let cleanupError = null;
  try {
    await cleanupOwnedProcesses(appDir, child.pid);
  } catch (error) {
    cleanupError = error;
  } finally {
    cleanupTempDir(userDataDir, 'isolated userData');
  }

  if (runError || cleanupError) {
    if (stdout) console.error(`[windows-launch-smoke] stdout tail:\n${tail(stdout)}`);
    if (stderr) console.error(`[windows-launch-smoke] stderr tail:\n${tail(stderr)}`);
    throw runError || cleanupError;
  }

  console.log(`[windows-launch-smoke] OK: ${label} stayed alive for ${STAY_ALIVE_MS}ms and left no packaged processes after cleanup`);
}

async function installLaunchAndUninstallNsis() {
  const installRoot = mkdtempSync(join(tmpdir(), 'hydra-windows-nsis-smoke-'));
  const installDir = join(installRoot, 'Hydra');
  const installedExe = join(installDir, 'Hydra.exe');
  const uninstaller = join(installDir, UNINSTALLER_FILENAME);
  const tempUninstaller = join(installRoot, 'hydra-uninstaller-smoke.exe');

  try {
    console.log(`[windows-launch-smoke] silently installing NSIS artifact: ${INSTALLER_EXE}`);
    console.log(`[windows-launch-smoke] isolated NSIS installDir: ${installDir}`);
    execFileSync(INSTALLER_EXE, ['/S', '/currentuser', `/D=${installDir}`], {
      encoding: 'utf8',
      windowsHide: true,
    });

    if (!existsSync(installedExe)) {
      throw new Error(`NSIS installer did not create the installed executable: ${installedExe}`);
    }
    if (!existsSync(uninstaller)) {
      throw new Error(`NSIS installer did not create the uninstaller: ${uninstaller}`);
    }

    await launchAndCleanup(installedExe, installDir, 'NSIS-installed Hydra.exe');

    // electron-builder's own upgrade path runs a copied uninstaller outside
    // INSTDIR with _?=<installDir>, allowing the install tree to be removed.
    copyFileSync(uninstaller, tempUninstaller);
    execFileSync(tempUninstaller, ['/S', '/currentuser', `_?=${installDir}`], {
      encoding: 'utf8',
      windowsHide: true,
    });

    if (!(await waitForMissing(installDir))) {
      throw new Error(`NSIS uninstall left install-directory residue: ${installDir}`);
    }
    if (listOwnedProcesses(installDir).length) {
      throw new Error(`NSIS uninstall left packaged Hydra processes under ${installDir}`);
    }

    console.log('[windows-launch-smoke] OK: NSIS silent install, installed-app launch, cleanup, and uninstall left no residue');
  } finally {
    cleanupTempDir(installRoot, 'isolated NSIS install root');
  }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Windows packaged launch smoke must run on a Windows host');
  }
  if (!existsSync(UNPACKED_EXE)) {
    throw new Error(`Windows unpacked executable is missing: ${UNPACKED_EXE}`);
  }
  if (!existsSync(INSTALLER_EXE)) {
    throw new Error(`Windows NSIS installer is missing: ${INSTALLER_EXE}`);
  }

  await launchAndCleanup(UNPACKED_EXE, UNPACKED_DIR, 'win-unpacked Hydra.exe');
  await installLaunchAndUninstallNsis();
}

main().catch((error) => {
  console.error(`[windows-launch-smoke] FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
