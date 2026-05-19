# Hydra CLI & AI API Plan

> **Status:** P0 shipped. Date: 2026-05-05. Branch: `master`.
> **Goal:** Make Hydra usable from the terminal and from any AI agent without ever opening the React UI.
> **Inspiration:** Peter Steipete's CLIs (`bird`, `Peekaboo`, `xcap`) — subcommand-first, defaults-heavy, JSON-pipeable, zero interactive prompts.

---

## SITREP — 2026-05-05 — P0 commands shipped

Three read-only commands ship in `bin/commands/`:

| Command | What it shows | Notes |
|---|---|---|
| `hydra status` | Fleet (accounts, healthy, balance, keys) **+** proxy (port probe, URL, gate state, masked Hydra/Generic keys) **+** storage (data dir) | Tight TCP probe (250 ms) tells you instantly if anything's listening on `:3001`. Shows `● running` / `○ not running` and the `/v1` URL when up. |
| `hydra accounts` | One row per account: short id, email, health pip, balance, session status, key count, age | `--json` swaps to a flat object array suitable for `\| jq` |
| `hydra balance [id]` | Total balance across the fleet, or balance for a single account by id-prefix match | `--json` emits `{ total, breakdown[] }` |

All three call `server/services/store.js` directly via `bin/lib/services.js` — no Express boot, no port, no auth handshake. Cold-start cost ~150 ms, roughly the time it takes Prisma to open the SQLite DB.

**Files added:**
```
bin/lib/output.js          ASCII table + status pips + color (NO_COLOR aware), zero deps
bin/lib/services.js        Lazy-load server/services/* + DB user resolution
bin/commands/status.js     Fleet + proxy + storage overview
bin/commands/accounts.js   Tabular account list
bin/commands/balance.js    Total or per-id balance
```

`bin/hydra.mjs` extends its existing dispatcher to lazy-load any `commands/<verb>.js` file — adding a new command is one new file + one entry in `managerCommands`.

**Known limit (intentional):** `hydra accounts` shows `BALANCE = —` for cached accounts because `store.getAccounts()` returns DB-cached rows (fast, no upstream calls). To get live balances every time, switch to `store.getAllAccountsWithKeys()` (decrypts secrets) or add a `--live` flag in v0.2.

**Proxy/router host story:** `hydra` (no args) keeps its existing behavior of starting `scripts/launch.js` — that boots the Express server which holds `:3001` open and serves `/v1`. So the CLI *already* hosts the proxy when invoked bare; the new manager commands talk to the same DB without needing Express.

### SITREP — 2026-05-16 — API map and code preflight shipped

The private Hydra API map is now generated and test-covered:

- `npm run openapi:hydra` writes `docs/hydra-api.openapi.json`.
- `hydra api-map`, `hydra api-map --json`, and `hydra api-map --tag accounts` work while Hydra is closed.
- `test:openapi-map` compares the generated map against the concrete Express route files.
- `hydra account <id>` and `hydra account <id> --json` show one account's redacted detail view without exposing tokens, cookies, passwords, management keys, or API key plaintext.
- `hydra accounts sync --dry-run` checks which accounts can refresh OpenRouter balance/key metadata without live writes.
- `hydra accounts sync --yes` is the guarded live metadata sync path via stored management keys.

The first P1 codes command is also wired:

- `hydra codes preflight <code>` checks stored account readiness without launching Electron.
- `hydra codes redeem <code> --account <id> --yes` is the guarded live redemption path.
- `hydra codes bulk <file> --account <id> --yes` is the guarded live bulk path.
- `hydra keys` and `hydra keys --json` list stored management-key records without exposing decrypted key material.
- `hydra keys provision <id> --dry-run` checks whether an account has a safe provisioning path without live OpenRouter writes.
- `hydra keys provision <id> --yes` is the guarded live management-key provision path; it stores key material but does not print it.
- `hydra keys rotate <id> --dry-run` checks for a current management key plus a re-auth path before live rotation.
- `hydra keys rotate <id> --yes` is the guarded live replacement path; after a replacement key is stored, the previous local management-key row is marked revoked.
- `hydra session <id>` and `hydra session <id> --json` show stored session readiness, expiry, cookie-stack count, and reauth hints without exposing tokens.
- `hydra session <id> --refresh --json` forces the same live Clerk probe path as the UI's Check Session action and still redacts session/client cookies.
- `hydra proxy status` and `hydra proxy status --json` show local `/v1` listener state, proxy gate state, and masked proxy keys.
- `hydra proxy keys new --yes` rotates the local proxy secret and prints the new `sk-hydra-*` and `sk-proj-*` keys; without `--yes`, it returns `CONFIRMATION_REQUIRED`.
- `hydra scan --quick` and `hydra scan --quick --json` run a closed-app fleet scan from local account/session/key metadata only.
- `hydra export --json` and `hydra export --out <file>` export redacted fleet metadata without passwords, session/client cookies, decrypted management keys, proxy key values, or key-shaped labels.
- `hydra import <file> --dry-run` validates a redacted export without writing local data.
- `hydra import <file> --yes` restores redacted metadata only: account metadata plus disabled/unpooled API-key metadata. It does not restore sessions, passwords, management-key secrets, proxy keys, or API-key plaintext.
- `hydra serve [--port N]` starts `server/standalone.js` directly so `/api` and `/v1` are usable while Electron is closed.
- `hydra stop [--port N] [--token <jwt>]` calls the locked `/api/shutdown` endpoint. It refuses to stop a listener without an explicit unlocked-session bearer token via `--token` or `HYDRA_TOKEN`.
- `hydra ai models --json` reads the local `CachedModel` table while Electron is closed, with optional `--filter` and `--limit`.
- `hydra ai chat "<prompt>" --json` defaults to `--route auto`: it tries a running local Hydra `/v1/chat/completions` proxy first, then falls back to direct OpenRouter when `OPENROUTER_API_KEY` or `--openrouter-key` is available. It also supports deterministic `--route proxy` and `--route direct`, `--base-url`, `--openrouter-base-url`, `--key`, `--model`, `--max-tokens`, `--temperature`, and `--timeout-ms`.
- `hydra openrouter models`, `hydra openrouter key`, `hydra openrouter credits`, and `hydra openrouter chat` provide direct OpenRouter-compatible API probes for agents/scripts that already have an OpenRouter key. They default to `https://openrouter.ai/api/v1`, accept `--base-url` for test mirrors, redact key labels, and keep model cache writes behind explicit `hydra openrouter models --cache`.
- `hydra accounts purge --dead --dry-run` previews inert placeholder rows without deleting them.
- `hydra accounts purge --dead --yes` deletes only placeholder rows with no email, no auth method, no stored password, no session material, no client-cookie stack, and no management key.
- `hydra logs --lines N` reads a bounded log tail without loading the whole file.
- `hydra logs --tail --lines N` follows appended log lines until interrupted.
- `hydra unlock --password <password> --json` verifies the local Hydra password and emits a bearer token for locked local endpoints such as `hydra stop`.
- `hydra audit` and `hydra audit --json` inspect the goal sheet, release audit,
  package scripts, workflows, release artifacts, Docker docs,
  Windows auxiliary-process cleanup, filesystem/migration-lock hardening,
  biometric fail-closed auth-token gating, Settings preference persistence,
  native menu-feedback contracts, non-fatal fallback visibility contracts, and
  active evidence and deferred manual items while Hydra is closed. It is read-only and does not launch
  Electron, Docker, browsers, or live OpenRouter/Clerk flows.

Evidence from local data on 2026-05-16: `hydra codes preflight TEST-CODE --json` returned 5 ready accounts and 7 blocked accounts. No live redemption was attempted.
`hydra account 529c3bc9 --json` returned redacted detail for the local account, including 25 stacked client cookies, 2 management-key records, and 3 API-key records without printing secret values.
`hydra accounts sync --dry-run --json` is test-covered against isolated password, OTP, and keyed rows. It distinguishes `management_key_available` from `missing_management_key` before any live OpenRouter calls; the `--yes` path refreshes balance and key metadata with the stored management key and does not print secret values.
`hydra keys --json` returned 11 stored management-key rows, with secret values hidden.
`hydra keys provision <id> --dry-run --json` is test-covered against isolated password, OTP, and already-keyed rows. It distinguishes `password_reauth`, `blocked`, and `already_has_management_key`, so operators can fix auth/session state before any live provision attempt.
`hydra keys rotate <id> --dry-run --json` is test-covered against isolated missing-key and keyed rows. It distinguishes `missing_management_key` from a keyed account that can rotate via `password_reauth`, and the `--yes` path is confirmation-gated before it creates a replacement key and marks the previous local row revoked.
`hydra session 529c3bc9 --json` returned an active stored session, 25 stacked client cookies, and a 2026-05-22 session expiry without printing session or client-cookie values.
`hydra proxy status --json` returned `running: false`, `gateEnabled: true`, and masked Hydra/generic proxy keys while Electron was closed.
`hydra scan --quick --json` returned 12 accounts, 4 active stored sessions, 4 accounts with management keys, 4 immediately redemption-ready accounts, and 0 hard-blocked accounts because the inactive OTP accounts still have a reauth path.
`hydra export --out /private/tmp/hydra-redacted-export.json --json` wrote a mode `0600` redacted export with 12 accounts, 11 management-key records, and 11 API-key records. Follow-up `rg` checks found no `sk-*` key-shaped strings and no raw Clerk cookie assignments in the export.
`hydra import /private/tmp/hydra-import-check.json --dry-run --json` validated a redacted export and returned the expected schema/count summary without mutating local data. `hydra import <file> --yes --json` is now test-covered against isolated data and imports metadata only: account metadata plus disabled/unpooled API-key metadata, while reporting skipped management-key secrets and `secretsRestored: 0`.
`hydra serve help`, `hydra stop help`, `hydra stop --port <closed-port> --json`, and `hydra stop --port <listening-port> --json` are test-covered. The running-port case returns `AUTH_TOKEN_REQUIRED` unless `HYDRA_TOKEN` or `--token <jwt>` is provided.
`hydra logs --json --lines 2` returned a bounded snapshot, `hydra logs --json --tail` is rejected because streaming JSON would be ambiguous, and `hydra logs --tail --lines 1 --quiet` is test-covered with a real spawned process that follows an appended log line and exits on interrupt.
`hydra unlock --password <password> --json` and `hydra unlock --token-only` are test-covered against an isolated Prisma DB seeded with a bcrypt admin password. Missing-password paths return `PASSWORD_REQUIRED` instead of prompting or hanging.
`hydra proxy keys new --yes --json` is test-covered against an isolated `HYDRA_DATA_DIR` and `DATABASE_URL`. The command rotates the proxy secret, prints the new proxy keys only after explicit confirmation, and the normal `hydra proxy status --json` path continues to return masked keys only.
`hydra session <id> --refresh --json` is test-covered against an isolated account with no stored session material, which exercises the live-probe command path without contacting Clerk and confirms no session/client-cookie fields are printed.
`hydra ai models --filter claude --json` is test-covered against an isolated cached-model table. It does not call OpenRouter or require a running server.
`hydra ai chat --json` is test-covered against a fake OpenAI-compatible local `/v1` server and verifies the request path, bearer key, model, prompt, max token, temperature, non-stream body, returned text, and usage payload. `--route proxy` keeps closed-proxy failures explicit with `SERVER_UNAVAILABLE` and a `hydra serve` hint. `--route direct` is test-covered against a fake OpenRouter-compatible `/api/v1/chat/completions` server with `--openrouter-key` and `--openrouter-base-url`.
`hydra openrouter models/key/credits --json` is test-covered against a fake OpenRouter-compatible API. The models path supports `--filter`, `--limit`, `--output-modalities`, `--supported-parameters`, and optional `--cache`; the key path masks key labels; the credits path reports total/used/remaining without exposing key material.
`hydra accounts purge --dead --dry-run` and `hydra accounts purge --dead --yes` are test-covered against isolated data. The confirmed path deletes only an inert local placeholder row and keeps an OTP account because it still has a reauth path.
`hydra db reset --dry-run --json` previews a reversible reset, and `hydra db reset --yes --json` moves `hydra.db`, `hydra.db-wal`, and `hydra.db-shm` into a timestamped `reset-backups/` directory instead of deleting them. It reports `deleted: 0` and is test-covered against an isolated temp data dir.
`hydra audit --json` now reports the active code-verifiable scope separately from deferred manual GUI/runtime checks. Packaged GUI dogfood, live MVP dogfood, packaged screenshot audit, and Docker runtime smoke are marked `deferred` after the user moved them out of the active Codex plan; active evidence can still complete without launching Electron, Docker, browsers, or live OpenRouter/Clerk flows. `server/tests/cli.test.mjs` verifies the command help, JSON shape, release-artifact checks, dependency-audit evidence, workflow-contract check, first-run UI contract check, startup-fallback check, Settings preference persistence check, native menu-feedback check, fallback-visibility check, redacted-import check, reversible-db-reset check, Windows auxiliary cleanup check, filesystem/migration-lock hardening check, biometric fail-closed auth-token gate check, deferred-item reporting, and that no key-shaped secret strings are printed.

### Private app boundary

Hydra is private. Do not upload it to Printing Press, register it in a public CLI library, publish its OpenAPI map as a public package, run public-library syncs for it, or generate public endpoint tools from its private API surface.

The useful part of the Printing Press workflow here is the methodology:

- Extract the concrete API surface from source instead of hand-writing endpoint lists.
- Generate a local OpenAPI artifact that agents and scripts can inspect while the app is closed.
- Build subcommand-first CLI slices around the real workflows.
- Keep JSON output stable enough for AI agents and shell pipelines.
- Document every new API/session/auth discovery in `docs/` with evidence and reproducibility.

For Hydra, those artifacts stay inside this repo: `docs/hydra-api.openapi.json`, `docs/HYDRA_API_MAP.md`, this CLI plan, and the CLI tests. The workflow is `npm run openapi:hydra` to refresh the private map, `hydra api-map` to inspect it while Electron is closed, and direct Hydra CLI commands for real operator workflows.

When a route finding turns into a command, the implementation should stay curated:

- Prefer direct local service/database imports for same-machine commands.
- Use HTTP only when the target command intentionally talks to a running local server or the `/v1` proxy.
- Keep live OpenRouter/Clerk actions behind explicit verbs and confirmation flags.
- Keep every `--json` response redacted and stable for agents.
- Update `docs/HYDRA_API_MAP.md` or the relevant architecture/recon document in the same pass.

### What's next

The implemented CLI surface is now mostly an operator reference, not a plan.
Remaining CLI ideas have been consolidated into `docs/IDEAS.md`:

- `hydra accounts add` / `hydra accounts add --bulk` for terminal account creation.
- Optional persistent unlock socket for longer CLI sessions.
- Optional private `mcp-hydra` wrapper around curated commands/API-agent routes.

---

## Why this exists

Today Hydra has two interaction surfaces:

1. **React UI** at `http://localhost:5173` (dev) or `:3001` (packaged) — the operator dashboard.
2. **`/v1` OpenAI-compatible proxy** at `http://localhost:3001/v1` with `sk-hydra-…` keys — already production. **Any AI framework that speaks OpenAI can already drive Hydra accounts via this endpoint.**

Remaining gaps:

- **CLI coverage is partial, no longer absent.** `bin/hydra.mjs` now has real closed-app commands for API-map inspection, account detail, code preflight, key inventory, session inspection, proxy status, quick fleet scan, redacted export/import, reversible DB reset, guarded account sync/purge, guarded management-key provision/rotation, server lifecycle, bounded/following logs, AI model lookup/chat against a running local proxy, and non-persistent unlock token issuance. Account creation, broader live redemption coverage, and persistent unlock caching remain future work.
- **`/api/*` is undocumented for external consumers.** It's an internal Express surface for the React UI; there's no formal contract, auth headers, or rate-limit story for "AI agent calling from outside the app."
- **No way to add an account from the terminal.** Today it requires the Generator UI.

This plan closes those gaps without rewriting anything that already works.

---

## Surface map (after this plan)

```
┌──────────────────────────────────────────────────────────────┐
│                       Hydra core (server/)                   │
│  • Express app                                               │
│  • Prisma + SQLite                                           │
│  • Encrypted local secrets                                   │
└──────────────────────────────────────────────────────────────┘
        ▲                ▲                       ▲
        │                │                       │
   Express HTTP     Direct service         OpenAI-compat
   (UI + agents)    imports (CLI fast path) /v1 proxy
        │                │                       │
        ▼                ▼                       ▼
  React SPA          hydra CLI            Any AI client
  (Vite/Electron)    (implemented slices) (OpenAI SDK,
                                           LiteLLM, etc.)
```

Two consumers, three transport options. The CLI talks to the server **directly via service imports** for speed, and falls back to HTTP only when the server is already running. The OpenAI clients always go through HTTP.

---

## Part 1 — CLI: `hydra` command tree

### Design principles (steipete style)

| Principle | Concrete choice |
|---|---|
| Subcommand-first | `hydra accounts add` not `hydra --accounts --add` |
| One-purpose subcommands | `add`, `scan`, `balance` — never one verb that "does everything" |
| Pretty output by default, `--json` for pipes | Render tables to stdout; `--json` swaps for `JSON.stringify` |
| Persisted defaults | Read DB encryption key + base URL from `~/.config/hydra/config.json` on first run; never re-prompt |
| Fail loud, fail short | One-line errors with the fix (`hydra: not unlocked. run: hydra unlock`) |
| No deps if avoidable | Use `node:util.parseArgs`, `node:util.styleText`, `process.stdout.columns` for tables |
| Fast path = no HTTP | Service-level imports (`import { listAccounts } from '../server/services/store.js'`); HTTP only when `--remote` flag set |

### Command tree

```
hydra                              launch Hydra's normal server/proxy entrypoint
hydra version                      print version

# Server lifecycle
hydra serve [--port N]             start Express server without Electron
hydra dev                          npm run dev (already exists)
hydra stop                         POST /api/shutdown to a running server
hydra unlock                       verify local password and emit a bearer token

# Accounts
hydra account <id>                 redacted detail view for one account
hydra accounts                     planned list with health + balance (table)
hydra accounts add [--bulk N]      generate via HTTP signup (Clerk FAPI primary, Playwright fallback)
hydra accounts add --email X       add a specific known account
hydra accounts sync [id]           dry-run or refresh metadata from OpenRouter
hydra accounts purge --dead        dry-run or remove inert placeholder rows
hydra account <id> open            open AccountDetail page in default browser

# Keys
hydra keys                         list redacted management-key inventory
hydra keys provision <id>          dry-run or provision a management key for account id
hydra keys rotate <id>             dry-run or create replacement key, then mark prior local row revoked

# Balance
hydra balance [id]                 single or aggregate balance check (live)
hydra balance --json               machine output

# Codes (promo redemption)
hydra codes redeem <code>          redeem on first eligible account
hydra codes preflight <code...>    check eligibility without redeeming (implemented)
hydra codes bulk <file>            redeem from a file of codes (one per line)

# Health & ops
hydra scan                         full health pass: session check + balance + key validity, all accounts
hydra scan --quick                 local-only fleet summary (implemented)
hydra session <id>                 show redacted stored session status
hydra session <id> --refresh       explicit live session probe
hydra logs [--lines N] [--tail]    read or follow server logs

# AI / proxy
hydra ai chat "<prompt>"           one-shot chat through a running local /v1 proxy
hydra ai models                    list available models via /v1/models
hydra proxy status                 show local proxy URL + masked proxy keys
hydra proxy keys                   list proxy keys
hydra proxy keys new               generate a new sk-hydra-* key

# Data
hydra export [--out path]          export redacted config (no secrets)
hydra import <path> --dry-run      validate redacted export without writes
hydra import <path> --yes          import redacted metadata only, no secrets
hydra db reset --yes               reversible reset: move DB files into reset-backups/

# Auth (only ever needed when not running locally)
hydra unlock                       non-interactive token issuance via --password, HYDRA_PASSWORD, or --stdin
hydra lock                         clear in-memory secrets (no-op when running daemon)
```

### Output examples

**Pretty default (`hydra accounts`):**

```
ID        EMAIL                                  HEALTH   BALANCE   SESSION   AGE
abc123    delilah+1@zayd.wtf                     ●        $11.23    active    2d
abc124    delilah+2@zayd.wtf                     ●        $4.91     expiring  5h
abc125    delilah+3@zayd.wtf                     ◐        —         expired   12d
abc126    delilah+4@zayd.wtf                     ○        —         none      30d

4 accounts · 2 healthy · $16.14 total live balance
```

**JSON (`hydra accounts --json`):**

```json
{
  "accounts": [
    {"id":"abc123","email":"delilah+1@zayd.wtf","health":"healthy","balance":11.23,"sessionStatus":"active","ageDays":2},
    ...
  ],
  "summary": {"count":4,"healthy":2,"liveBalance":16.14}
}
```

### Implementation layout

```
bin/
    hydra.mjs                       # command dispatcher plus default launcher
  commands/
    index.mjs                     # subcommand registry (verb-noun → handler)
    accounts.mjs                  # list/add/sync/purge
    account.mjs                   # detail
    keys.mjs                      # list/provision/rotate
    balance.mjs                   # single/aggregate balance
    codes.mjs                     # redeem/preflight/bulk
    scan.mjs                      # health pass
    session.mjs                   # status/refresh
    logs.mjs                      # tail
    ai.mjs                        # chat/models (delegates to /v1)
    proxy.mjs                     # status/keys
    export.mjs                    # export
    import.mjs                    # import
    db.mjs                        # reset
    serve.mjs                     # bootstrap server
    unlock.mjs                    # password prompt
  lib/
    args.mjs                      # node:util.parseArgs wrapper with --json/-h
    table.mjs                     # ASCII table renderer (no deps)
    color.mjs                     # node:util.styleText wrapper, NO_COLOR aware
    config.mjs                    # ~/.config/hydra/config.json read/write
    services.mjs                  # bootstrap-once service imports for fast path
    http.mjs                      # fetch wrapper for --remote mode
```

### Auth model

The CLI inherits the same trust model as the local server:

- **Local mode (default):** CLI runs in the same machine as the DB. It reads `data/hydra.db` directly via Prisma and the encrypted secrets via `server/services/local-secrets.js`. A `hydra unlock` step prompts for the local password and derives the in-process AES key, cached in a UNIX-domain socket / in-memory daemon for the rest of the shell session (TTL 30 min, configurable). Same trust model as the UI.
- **Remote mode (`--remote https://hydra.box`):** CLI hits HTTP. Auth is via a **bearer token** (`HYDRA_TOKEN` env or `~/.config/hydra/config.json`). Server validates against existing JWT auth.

### Why the fast path matters

Going direct-via-imports avoids:
- Spinning up Express on every command (`hydra accounts` would otherwise cost 200–500 ms of bootstrap).
- Port collisions when the GUI is also running.
- Re-implementing auth twice.

The trick: a single `services.mjs` module that initializes `db.js` + `local-secrets.js` once per process and exposes the service singletons. Every command imports from `services.mjs`. No Express anywhere in the CLI hot path.

### Phase plan (so it ships in increments, not a big bang)

| Phase | Commands | Effort | Value |
|---|---|---|---|
| Phase | Commands | State | Value |
|---|---|---|---|
| **P0 — read-only** | `account`, `codes preflight`, `keys`, `scan --quick`, `session`, `proxy status`, `api-map`, `version` | implemented | Inspect the local fleet from terminal without launching Electron |
| **P1 — add/redeem** | `codes redeem`, `codes preflight`, `codes bulk` | implemented with `--yes` guards; live dogfood still manual | Redeem/preflight codes without UI |
| **P1 backlog** | `accounts add`, `accounts add --bulk` | moved to `docs/IDEAS.md` | Replace Generator/Bulk wizard for terminal users |
| **P2 — ops** | `session --refresh`, `accounts purge --dead`, `accounts sync`, `keys provision`, `keys rotate`, `import --yes`, `db reset --yes` | implemented with dry-run/redaction/confirmation guards | Full ops without UI |
| **P3 — AI** | `ai models`, non-streaming `ai chat`, `openrouter models/key/credits/chat`, `proxy keys new` | implemented; live success depends on keys/proxy availability | Direct AI hooks into the CLI |
| **P4 — daemon** | `serve`, `stop`, `logs --tail`, non-persistent `unlock` | implemented; persistent unlock socket remains backlog | Long-running CLI sessions |

The useful shipped slice today is closed-app inspection and lifecycle control. The next CLI pass should prioritize write paths that can preflight honestly before touching live accounts.

---

## Part 2 — AI API exposure

### What already works

- **OpenAI-compatible chat completions** at `POST http://localhost:3001/v1/chat/completions` with `Authorization: Bearer sk-hydra-...`. Body shape matches OpenAI exactly. Proxied to OpenRouter under the hood with rotation across the fleet.
- **Models list** at `GET /v1/models` — DB-cached with `X-Hydra-Models-Source: cache|live|static`.
- **`sk-hydra-...` keys** are issued by the proxy module; one per agent/integration recommended.

This means **today**, you can already do:

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3001/v1", api_key="sk-hydra-...")
client.chat.completions.create(model="anthropic/claude-3.5-sonnet", messages=[...])
```

…and Hydra picks the cheapest healthy account, rotates if rate-limited, falls back if a key dies. **The AI-exposes-itself-as-OpenAI bit is done.**

### What's missing for "AI manages the fleet"

An agent might want to:

1. List accounts and pick which to use.
2. Add a new account when the fleet runs low.
3. Redeem promo codes it scrapes.
4. Rotate a key after suspicious activity.
5. Read its own balance to budget.

For these, expose the existing `/api/*` routes as a documented, agent-stable API:

#### Proposed `/api/agent/*` namespace

Low-effort: a new router file (`server/routes/agent.js`) that wraps existing controllers but with:

- **Stable JSON response shapes** (versioned: `{"v":1,"data":...}`).
- **Bearer token auth** (`HYDRA_AGENT_TOKEN` — separate from human JWT, scoped, revocable).
- **Tool-friendly error messages** (machine-parsable `{"error":{"code":"NOT_UNLOCKED","fix":"call /api/unlock first"}}`).
- **OpenAPI 3.0 spec** (`docs/agent-api.openapi.yml`) so any agent framework can auto-generate client code.

Endpoints (mirror of CLI):

```
POST   /api/agent/unlock          { password } → token
GET    /api/agent/accounts        list
POST   /api/agent/accounts        add (bulk via { count: N })
GET    /api/agent/accounts/:id    detail
POST   /api/agent/accounts/:id/sync
DELETE /api/agent/accounts/:id
GET    /api/agent/balance         aggregate
POST   /api/agent/keys/provision  { accountId }
POST   /api/agent/keys/rotate     { accountId | "all" }
POST   /api/agent/codes/redeem    { code }
POST   /api/agent/codes/preflight { codes: [...] }
POST   /api/agent/codes/bulk      { codes: [...] }
GET    /api/agent/scan            run health pass
GET    /api/agent/session/:id
POST   /api/agent/session/:id/refresh
```

Most of these already exist under `/api/*` — this is a thin wrapper that locks down the contract.

#### MCP server (optional Phase 5)

The cleanest way to plug Hydra into Claude Code, Cursor, etc. is an **MCP server** that wraps `/api/agent/*` and exposes tools the LLM can pick from. Reference: `mcp-deepwiki`, `mcp__supabase__*` patterns.

```
mcp-hydra/
  server.ts              # FastMCP-style server
  tools/
    listAccounts.ts
    addAccount.ts
    redeemCode.ts
    scanHealth.ts
    chat.ts              # uses /v1 under the hood
```

Run as `npx mcp-hydra --base-url http://localhost:3001 --token $HYDRA_AGENT_TOKEN` and any MCP-aware client gets fleet management as native tools.

---

## Remaining backlog

This file now documents the shipped CLI and AI surface. New implementation work
should be tracked in `docs/IDEAS.md` unless it is a concrete release blocker.
The only sizeable remaining ideas are terminal account creation, a persistent
unlock cache, and the optional private MCP wrapper.

---

## Non-goals

- Replacing the React UI. Keep it. Most operators still want the Pool Manager visualization.
- Auth complexity. Bearer tokens with rotation are enough; OAuth/SAML is overkill for a single-operator local tool.
- Cross-machine clustering. Hydra is one box, one DB. If that ever changes it's a different design doc.

---

## Open questions

- **CLI dependency floor:** zero deps (use `node:util.parseArgs` + ANSI codes) vs. add `commander` + `cli-table3`? Proposal: **zero deps for the CLI.** Hydra already has 30+ deps; this stays lean.
- **Daemon mode:** UNIX-domain socket vs. localhost TCP for the unlocked secrets cache? Proposal: **UNIX socket** — file-perm scoped to the user, no port exposure.
- **`hydra accounts add` UX:** quiet by default vs. live progress (the OTP flow takes 30–60s)? Proposal: **live progress by default**, `--quiet` flag for scripts, `--json` for structured progress events.

---

## File map (after implementation)

Historical target file map from the original plan:
```
bin/commands/*.mjs                       (15 files)
bin/lib/*.mjs                            (6 files)
server/routes/agent.js                   (1 file)
server/middleware/agent-auth.js          (1 file)
docs/agent-api.openapi.yml               (1 file)
docs/HYDRA_CLI.md                        (operator-facing reference)
mcp-hydra/                               (separate package, P5)
```

Modified:
```
bin/hydra.mjs                            (extend dispatch to commands/)
package.json                             (add "hydra-cli" bin entry, no new deps)
README.md                                (add CLI quickstart section)
docs/API_REFERENCE.md                    (link to agent-api.openapi.yml)
```

Deletions: none. This is purely additive.
