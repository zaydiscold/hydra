#!/usr/bin/env node
// @platform windows
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UNPACKED_DIR = join(ROOT, 'release', 'win-unpacked');
const EXE = join(UNPACKED_DIR, 'Hydra.exe');
const STAY_ALIVE_MS = 25_000;
const CLEANUP_GRACE_MS = 3_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HYDRA_WINDOWS_UNPACKED_DIR: UNPACKED_DIR,
    },
    windowsHide: true,
  });
}

function listOwnedProcesses() {
  const output = powershell([
    "$ErrorActionPreference = 'Stop';",
    '$prefix = $env:HYDRA_WINDOWS_UNPACKED_DIR;',
    '@(Get-CimInstance Win32_Process',
    '| Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) }',
    '| Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine)',
    '| ConvertTo-Json -Compress',
  ].join(' ')).trim();

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

function tail(value, length = 2_000) {
  return value.length <= length ? value : value.slice(-length);
}

async function cleanupOwnedProcesses(rootPid) {
  taskkill(rootPid);
  const before = listOwnedProcesses();
  const targets = new Set(before.map(({ pid }) => pid));
  for (const pid of targets) taskkill(pid);

  await sleep(CLEANUP_GRACE_MS);
  let survivors = listOwnedProcesses();
  if (survivors.length) {
    console.warn('[windows-launch-smoke] retrying cleanup for surviving packaged processes:');
    console.warn(JSON.stringify(survivors, null, 2));
    for (const { pid } of survivors) taskkill(pid);
    await sleep(CLEANUP_GRACE_MS);
    survivors = listOwnedProcesses();
  }

  if (survivors.length) {
    throw new Error(`packaged Hydra processes survived cleanup: ${JSON.stringify(survivors)}`);
  }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Windows packaged launch smoke must run on a Windows host');
  }
  if (!existsSync(EXE)) {
    throw new Error(`Windows packaged executable is missing: ${EXE}`);
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'hydra-windows-launch-smoke-'));
  console.log(`[windows-launch-smoke] launching ${EXE}`);
  console.log(`[windows-launch-smoke] isolated userData: ${userDataDir}`);

  let stdout = '';
  let stderr = '';
  let exit = null;
  const child = spawn(EXE, [`--user-data-dir=${userDataDir}`], {
    cwd: dirname(EXE),
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

    const ownedProcesses = listOwnedProcesses();
    console.log('[windows-launch-smoke] packaged process tree after startup:');
    console.log(JSON.stringify(ownedProcesses, null, 2));
    if (!ownedProcesses.some(({ pid }) => pid === child.pid)) {
      throw new Error(`spawned Hydra pid ${child.pid} was not present in the packaged process tree`);
    }
  } catch (error) {
    runError = error;
  }

  let cleanupError = null;
  try {
    await cleanupOwnedProcesses(child.pid);
  } catch (error) {
    cleanupError = error;
  }

  if (runError || cleanupError) {
    if (stdout) console.error(`[windows-launch-smoke] stdout tail:\n${tail(stdout)}`);
    if (stderr) console.error(`[windows-launch-smoke] stderr tail:\n${tail(stderr)}`);
    throw runError || cleanupError;
  }

  console.log(`[windows-launch-smoke] OK: Hydra stayed alive for ${STAY_ALIVE_MS}ms and left no packaged processes after cleanup`);
}

main().catch((error) => {
  console.error(`[windows-launch-smoke] FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
