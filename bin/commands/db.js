/**
 * `hydra db reset` — reversible local database reset.
 *
 * This command never deletes the database. It moves hydra.db plus SQLite
 * sidecars into a timestamped backup directory so the next Hydra launch starts
 * from a fresh database while the old files remain recoverable.
 */
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { c, json, status } from '../lib/output.js';

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function usage() {
  process.stdout.write(`Hydra db

  hydra db reset --dry-run
  hydra db reset --dry-run --json
  hydra db reset --yes
  hydra db reset --yes --json

Moves hydra.db and SQLite sidecars into a timestamped reset-backup directory.
No files are deleted. The next Hydra launch will create a fresh database.
`);
}

function dataDir() {
  if (process.env.HYDRA_DATA_DIR) return resolve(process.env.HYDRA_DATA_DIR);
  const p = platform();
  if (p === 'darwin') return resolve(homedir(), 'Library', 'Application Support', 'Hydra');
  if (p === 'win32') return resolve(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Hydra');
  return resolve(homedir(), '.config', 'hydra');
}

function dbPathFromEnv() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return null;
  const raw = url.slice('file:'.length);
  if (!raw || raw.startsWith(':')) return null;
  return resolve(raw);
}

function activeDbPath() {
  return dbPathFromEnv() || join(dataDir(), 'hydra.db');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function filesForReset(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((path) => ({
    path,
    name: path.split('/').pop(),
    exists: existsSync(path),
    bytes: existsSync(path) ? statSync(path).size : 0,
  }));
}

function buildPlan() {
  const dbPath = activeDbPath();
  const dir = dirname(dbPath);
  const backupDir = join(dir, 'reset-backups', `reset-${timestamp()}`);
  const files = filesForReset(dbPath);
  return {
    dbPath,
    dataDir: dir,
    backupDir,
    files,
    existingFiles: files.filter((file) => file.exists),
  };
}

function executeReset(plan) {
  mkdirSync(plan.backupDir, { recursive: true, mode: 0o700 });
  const moved = [];
  for (const file of plan.existingFiles) {
    const target = join(plan.backupDir, file.name);
    renameSync(file.path, target);
    moved.push({ from: file.path, to: target, bytes: file.bytes });
  }
  return moved;
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }
  const [action] = argv.filter((arg) => !arg.startsWith('--'));
  const wantJson = hasFlag(argv, '--json');
  const dryRun = hasFlag(argv, '--dry-run');
  const confirmed = hasFlag(argv, '--yes');

  if (action !== 'reset') {
    usage();
    process.exitCode = 1;
    return;
  }

  const plan = buildPlan();
  if (!dryRun && !confirmed) {
    const message = 'CONFIRMATION_REQUIRED: database reset requires --yes; use --dry-run to preview moved files';
    if (wantJson) json({ ok: false, code: 'CONFIRMATION_REQUIRED', error: message, dbPath: plan.dbPath, backupDir: plan.backupDir });
    else process.stderr.write(`${c.err('✗')} ${message}\n`);
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    const report = {
      ok: true,
      dryRun: true,
      dbPath: plan.dbPath,
      backupDir: plan.backupDir,
      files: plan.files,
      wouldMove: plan.existingFiles.length,
    };
    if (wantJson) json(report);
    else status('ok', `Would move ${report.wouldMove} database file(s) into ${plan.backupDir}`);
    return;
  }

  try {
    const moved = executeReset(plan);
    const report = {
      ok: true,
      reset: true,
      dbPath: plan.dbPath,
      backupDir: plan.backupDir,
      moved,
      deleted: 0,
    };
    if (wantJson) json(report);
    else status('ok', `Moved ${moved.length} database file(s) into ${plan.backupDir}`);
  } catch (err) {
    if (wantJson) json({ ok: false, error: err.message, dbPath: plan.dbPath, backupDir: plan.backupDir });
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 1;
  }
}
