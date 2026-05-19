# Hydra API Map and CLI Plan

Hydra is a private local app. Any Printing Press reference in this repo means methodology only: map the API from source, keep the map executable, and use it to drive a better Hydra-owned CLI. Do not upload Hydra, register Hydra, publish a public package, sync it into a public library, or generate public-library tooling for it.

The operating model is private and local:

- `scripts/generate-hydra-openapi.mjs` is the source-owned API-map generator.
- `docs/hydra-api.openapi.json` is the local artifact that agents and scripts inspect.
- `hydra api-map` is the operator-facing map reader.
- `bin/commands/*` is where useful map findings become Hydra-native CLI commands.
- `docs/` is the durable record for discoveries, exact commands, redacted evidence, and reproducibility.

## Current Artifacts

- `docs/hydra-api.openapi.json` — generated local OpenAPI map of Hydra's Express routes.
- `scripts/generate-hydra-openapi.mjs` — repo-owned generator for the API map.
- `npm run openapi:hydra` — refreshes the API map.
- `hydra api-map` — reads the generated map while Hydra is closed.
- `hydra api-map --json` — machine-readable route inventory.
- `hydra api-map --tag accounts` — route inventory filtered by tag.
- `hydra account <id> --json` — redacted detail view for one account.
- `hydra accounts sync --dry-run` — checks which accounts can sync OpenRouter balance/key metadata without live writes.
- `hydra accounts sync --yes` — guarded live OpenRouter balance/key metadata sync via stored management keys.
- `hydra codes preflight <code> --json` — checks local account readiness for promo-code redemption while Hydra is closed.
- `hydra codes redeem <code> --account <id> --yes` — guarded live redemption path.
- `hydra codes bulk <file> --account <id> --yes` — guarded live bulk redemption path.
- `hydra keys --json` — lists stored management-key records while keeping decrypted key material hidden.
- `hydra keys provision <id> --dry-run` — checks whether an account can provision a management key without live OpenRouter writes.
- `hydra keys provision <id> --yes` — guarded live management-key provision path; key material is stored, not printed.
- `hydra keys rotate <id> --dry-run` — checks whether an account has a current management key and a re-auth path before live rotation.
- `hydra keys rotate <id> --yes` — guarded live replacement-key creation; the previous local management-key row is marked revoked only after the replacement is stored.
- `hydra session <id> --json` — reports stored session readiness while keeping session/client cookies hidden.
- `hydra session <id> --refresh --json` — forces a live session probe while still redacting session/client cookies.
- `hydra proxy status --json` — reports listener state, gate state, and masked proxy keys.
- `hydra proxy keys new --yes --json` — guarded local proxy-key rotation; normal status output remains masked.
- `hydra scan --quick --json` — summarizes local fleet health while Hydra is closed.
- `hydra export --out <file> --json` — writes redacted fleet metadata for handoff/audit.
- `hydra import <file> --dry-run --json` — validates redacted exports without writing local data.
- `hydra import <file> --yes --json` — imports redacted metadata only; sessions, passwords, management-key secrets, proxy keys, and API-key plaintext remain absent.
- `hydra db reset --dry-run --json` — previews a reversible local database reset without moving files.
- `hydra db reset --yes --json` — moves `hydra.db`, `hydra.db-wal`, and `hydra.db-shm` into `reset-backups/<timestamp>`; no files are deleted.
- `hydra serve [--port N]` — starts `server/standalone.js` without opening Electron, Chrome, or Vite.
- `hydra stop [--port N] [--token <jwt>]` — authenticated shutdown through the locked `/api/shutdown` route.
- `hydra logs --tail --lines N` — follows appended log lines for closed-app/server debugging.
- `hydra unlock --password <password> --json` — verifies the local password and emits a bearer token for locked local endpoints.
- `hydra ai models --json` — lists locally cached OpenRouter models while Hydra is closed.
- `hydra ai chat "<prompt>" --json` — sends a non-streaming chat request through a running local Hydra `/v1` proxy.
- `hydra accounts purge --dead --dry-run` — previews inert placeholder accounts with no credentials, session material, client-cookie stack, or management key.
- `hydra accounts purge --dead --yes` — deletes only those inert placeholder accounts after explicit confirmation.

The map currently covers auth, accounts, keys, dashboard, promo codes, generator tasks, pool/proxy management, system health, debug probes, Clerk webhooks, shutdown, and the primary OpenAI-compatible `/v1` proxy surface. The running `/v1` proxy is a catch-all router; the map names the operator-facing proxy routes instead of generating a noisy endpoint mirror for every possible OpenAI-compatible path.

## Why This Exists

The goal is an operator CLI that still works when the Electron window is closed. That means:

- Prefer direct local service/database imports for trusted same-machine commands.
- Use the API map as a contract/reference, not as a dependency on a running HTTP server.
- Keep `--json` output on commands so agents and scripts can use Hydra without scraping UI.
- Keep network/live-account actions explicit, guarded, and noisy.

## Implementation Learnings

The useful part of the Printing Press work was the method, not publication.
Hydra is private, so the right adaptation was to generate a local route map,
study the real Express/controller surface, and then write curated Hydra CLI
commands for workflows an operator actually needs. Endpoint-per-tool generation
would expose too much internal surface area and would be worse for agents than a
small command tree with stable `--json` output.

The OpenRouter split is intentional:

- Local Hydra proxy commands (`hydra ai ...`) are best when Hydra is serving and
  the operator wants pooled-key behavior, routing, and local accounting.
- Direct OpenRouter commands (`hydra openrouter ...`) are best when the app is
  closed or an agent needs a fast provider probe without booting Electron. Those
  commands accept explicit keys/base URLs, use OpenRouter-compatible endpoints,
  and keep account/key/credit calls separate from local proxy state.
- Request paths that talk to OpenRouter now need bounded timeouts and explicit
  degraded-state evidence. A zero balance, empty key list, or stale model cache
  must not look like confirmed truth when the upstream request actually failed.

The CLI shape follows those lessons:

- Read-only commands first: `api-map`, `account`, `session`, `scan`, `status`,
  `logs`, `doctor`, `export`, and `ai models` work without opening Electron.
- Live write commands are guarded: `codes redeem`, `codes bulk`, `accounts sync`,
  `keys provision`, `keys rotate`, `proxy keys new`, and `db reset` require
  `--yes` or run as dry-run/preflight.
- Bulk code redemption fans a file of codes across selected accounts, skips blank
  and comment lines, requires confirmation, and records per-account failures
  instead of aborting the whole batch on the first bad redemption.
- Redaction is part of the command contract. Account/session/key/detail outputs
  report ids, counts, status, booleans, masked labels, and metadata; they do not
  print session cookies, client cookies, passwords, management keys, proxy keys,
  or decrypted API-key plaintext.

The Dashboard Command Center work follows the same rule: adapt the third local
design concept into source-owned React/CSS, but bind the donut, fleet status,
activity feed, and compact account cards to real dashboard/account/session data
instead of leaving a static design mock in the product.

## Printing Press Boundary

This repository should not run any public Printing Press ship path for Hydra.

Do not run or add workflows that:

- Upload Hydra or its OpenAPI map.
- Register Hydra in a public or shared CLI/library catalog.
- Write Hydra into `~/printing-press/library` as a reusable public package.
- Publish endpoint tools generated from Hydra's private API surface.
- Treat public-library validation as a release gate.
- Call Printing Press upload/register/sync commands as part of Hydra release,
  packaging, Docker, or verification work.

What is allowed:

- Use the same private-source methodology: extract route truth from code, generate a local API artifact, and keep it test-covered.
- Use the local API map to decide which Hydra-owned CLI command should exist next.
- Keep endpoint-per-tool generation out of the default path. Hydra's raw API surface is large and private; agent workflows should go through curated commands like `hydra account`, `hydra session`, `hydra proxy`, `hydra scan`, `hydra export`, and future `hydra accounts add` slices.
- Preserve `x-mcp` hints in the local OpenAPI file as private orchestration notes only.

Historical local validation confirmed the map shape, but the continuing workflow is repo-owned: `npm run openapi:hydra`, `hydra api-map`, CLI tests, and documentation updates in this directory.

## Documentation Rules

Every new private API-map discovery needs a short docs update before it is considered done. Use the smallest fitting document:

- `docs/HYDRA_API_MAP.md` for route inventory, local artifact behavior, and API-map/CLI evidence.
- `docs/HYDRA_CLI_AND_AI_API_PLAN.md` for command tree, shipped CLI behavior, and future command sequencing.
- `docs/ARCHITECTURE_DEEP_DIVE.md` for auth/session/proxy mechanics that explain how Hydra works.
- `docs/recon/*.md` for raw OpenRouter/Clerk/dashboard reconnaissance.
- `docs/RELEASE_AUDIT.md` for release-relevant implementation status and verification evidence.

Each discovery note should include:

- What was found.
- How it was found, including exact command names or file paths.
- Why it matters for the closed-app CLI or local API map.
- Redacted evidence. Never paste passwords, session cookies, management keys, proxy keys, or full bearer tokens.
- Reproduction steps that work while Electron is closed when possible.

## Next CLI Work

High-value commands that should use direct local services where possible:

- `hydra codes preflight --account <id> --code <code>`
- `hydra codes redeem --account <id> --code <code>`
- `hydra keys provision --account <id>`
- Persistent unlock socket / agent daemon

Commands that require live OpenRouter/Clerk sessions should clearly report preflight state before attempting writes.

## 2026-05-16 CLI Evidence

`hydra account 529c3bc9 --json` was run against the local Hydra data directory without launching Electron. It returned redacted account detail with 25 stacked client cookies, 2 management-key records, and 3 API-key records. The command reports counts and booleans instead of session cookies, passwords, management keys, or API key plaintext.

`hydra accounts sync --dry-run --json` is test-covered against isolated password, OTP, and keyed accounts. It reports keyed accounts as `management_key_available` and blocks accounts missing management keys before any live OpenRouter calls. The confirmed `--yes` path uses the best stored management key to refresh balance and key metadata; it does not print management-key material.

`hydra codes preflight TEST-CODE --json` was run against the local Hydra data directory without launching Electron. It selected all stored accounts and returned 5 ready accounts and 7 blocked accounts. Blocked accounts reported the existing dashboard-session message: no dashboard session and no stored password, so the operator should re-auth in Hydra or add password auth before attempting redemption. No promo-code redemption was attempted during this check.

`hydra keys --json` was also run against the same local data directory and returned 11 management-key rows. The command reports ids, account labels, status, metadata, and timestamps; it does not decrypt or print the key strings.

`hydra keys provision <id> --dry-run --json` is test-covered against isolated password, OTP, and already-keyed accounts. It reports `password_reauth` as ready, OTP without session material as blocked, and already-keyed accounts as `already_has_management_key`. The confirmed `--yes` path is live and intentionally confirmation-gated; it stores created key material but does not print the full key.

`hydra keys rotate <id> --dry-run --json` is test-covered against isolated password and already-keyed accounts. It rejects missing confirmation with `CONFIRMATION_REQUIRED`, reports keyed password accounts as ready via `password_reauth`, and reports accounts without a current management key as `missing_management_key`. The confirmed `--yes` path is live and intentionally confirmation-gated; after a replacement key is captured and stored, Hydra marks the previous local management-key row revoked. This does not claim upstream revocation of the old OpenRouter management key.

`hydra session 529c3bc9 --json` was run against the same local data directory and returned an active stored session, 25 stacked client cookies, and a 2026-05-22 session expiry. The command intentionally reports booleans/counts for session and client-cookie state, not token values.

`hydra proxy status --json` was run while Electron was closed and returned `running: false`, `gateEnabled: true`, and masked Hydra/generic proxy keys. It does not print full proxy key values.

`hydra scan --quick --json` was run while Electron was closed and returned 12 accounts, 4 active stored sessions, 4 accounts with management keys, 4 immediately redemption-ready accounts, and 0 hard-blocked accounts. The scan is intentionally local-only; it does not refresh Clerk or call OpenRouter.

`hydra export --out /private/tmp/hydra-redacted-export.json --json` wrote a mode `0600` redacted export with 12 accounts, 11 management-key records, and 11 API-key records. The export excludes passwords, session/client cookies, decrypted management keys, proxy key values, and key-shaped labels. Follow-up `rg` checks found no `sk-*` key-shaped strings and no raw Clerk cookie assignments.

`hydra import /private/tmp/hydra-import-check.json --dry-run --json` validated a redacted export and returned the expected schema/count summary without writing local data. `hydra import <file> --yes --json` is confirmation-gated and test-covered against isolated data: it restores account metadata plus disabled/unpooled API-key metadata, skips management-key secrets, and restores no sessions, passwords, proxy keys, or API-key plaintext.

`hydra db reset --dry-run --json` and `hydra db reset --yes --json` are test-covered against an isolated temp data directory. The confirmed path moves `hydra.db` plus WAL/SHM sidecars into `reset-backups/reset-<timestamp>`, reports `deleted: 0`, and leaves backup files recoverable.

`hydra serve help` confirms the closed-app server entrypoint is `server/standalone.js` and does not open Electron, Chrome, or Vite. `hydra stop --port <closed-port> --json` reports `running: false` without requiring auth. A running local listener without `HYDRA_TOKEN` or `--token <jwt>` returns `AUTH_TOKEN_REQUIRED`, which keeps shutdown explicit and avoids scraping browser/Electron session state.

`hydra logs --json --lines 2` reads a bounded log tail, while `hydra logs --tail --lines 1 --quiet` follows appended log lines. Streaming JSON is intentionally rejected for `--tail`; scripts should use finite `--json` snapshots or pretty streaming, not a mixed stream.

`hydra unlock --password <password> --json` verifies the same local admin password used by the UI and returns a JWT bearer token. `hydra unlock --token-only` prints only the token for shell piping. Missing-password paths return `PASSWORD_REQUIRED` rather than prompting indefinitely.

`hydra proxy keys new --yes --json` rotates the local proxy secret in an isolated test data directory and returns the new `sk-hydra-*` and `sk-proj-*` keys. Without `--yes`, it returns `CONFIRMATION_REQUIRED`. The regular status command continues to return only masked key previews.

`hydra session <id> --refresh --json` uses `store.probeSessionLive()` so it follows the same explicit live session-check contract as the UI. The regression test creates an isolated OTP account with no stored session material, exercises the command path without contacting Clerk, and verifies no cookie/token fields are returned.

`hydra ai models --filter claude --json` reads `CachedModel` rows directly from SQLite in an isolated test database. This gives agents a model catalog while Electron is closed without needing OpenRouter credentials or a running `/v1` server.

`hydra ai chat "say hi" --base-url <local-v1> --key <proxy-key> --model test/model --json` is test-covered against a fake OpenAI-compatible local `/v1` server. The command sends `POST /v1/chat/completions` with a bearer Hydra proxy key, non-stream body, requested model, prompt, max token, and temperature settings, then returns assistant text and usage. Closed-proxy failure is explicit: `SERVER_UNAVAILABLE` with a `hydra serve` hint.

`hydra accounts purge --dead --dry-run` and `hydra accounts purge --dead --yes` are test-covered against an isolated Prisma database with one inert placeholder account and one OTP account that can still be reauthenticated. The dry-run path reports `CONFIRMATION_REQUIRED` without `--dry-run` or `--yes`; the confirmed path deletes only the placeholder and keeps the OTP account.
