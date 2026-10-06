# CLI vault selection and Prisma schema engine

## What was found

On macOS, the installed Electron app stores its vault in `~/Library/Application Support/hydra`, while the raw CLI previously defaulted to the repository's `data` directory after the app exited. The two local databases can therefore show different account counts, balances, and management-key availability. A live runtime file made the CLI appear consistent only while Electron was running.

The local Prisma 6.19 SQLite schema engine also returned an empty `Schema engine error:` during `db push` with the host's `RUST_LOG=warn`. Setting `RUST_LOG=info` let the same operation finish. This matches [prisma/orm#29355](https://github.com/prisma/prisma/issues/29355).

## How it was checked

1. Compared the installed app's data path with `hydra data-dir` after Electron exited.
2. Compared account counts and management-key presence in each local SQLite database. No keys or account identifiers were copied into this document.
3. Ran the CLI balance command against the installed app vault and confirmed it could read all expected account records.
4. Reproduced Prisma `db push` with the host logging setting, then retried with `RUST_LOG=info`.
5. Ran the full test chain, lint, build, integration gate, packaged macOS build, and packaged resource smoke test.

## Why it matters

The CLI must select the same vault as the installed app when no explicit development vault is requested. Otherwise a user can see missing accounts and stale balances even though the records are still present. The Prisma workaround makes local tests and packaging repeatable on affected macOS hosts.

## Redacted evidence and reproducibility

Observed vault roots: `~/Library/Application Support/hydra` (installed app) and `<repo>/data` (source checkout). The vaults contained different account sets, and some repository records lacked management keys. The corrected `hydra data-dir` selects the installed app vault after Electron exits, and `hydra balance --json` reads the expected account set.

To reproduce safely, create two disposable vault directories with a `hydra.db` file, add `local-secrets.json` to the app-style directory, and run `node --test server/tests/cli-data-dir.test.mjs`. The test uses temporary paths and no real credentials. To verify an installation, run `hydra data-dir` and compare it with the app's data path before running any mutation command.
