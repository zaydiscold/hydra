# Hydra CLI & AI API Plan

> **Status:** Plan, not code. Date: 2026-05-05. Branch: `feat/electron-migration`.
> **Goal:** Make Hydra usable from the terminal and from any AI agent without ever opening the React UI.
> **Inspiration:** Peter Steipete's CLIs (`bird`, `Peekaboo`, `xcap`) — subcommand-first, defaults-heavy, JSON-pipeable, zero interactive prompts.

---

## Why this exists

Today Hydra has two interaction surfaces:

1. **React UI** at `http://localhost:5173` (dev) or `:3001` (packaged) — the operator dashboard.
2. **`/v1` OpenAI-compatible proxy** at `http://localhost:3001/v1` with `sk-hydra-…` keys — already production. **Any AI framework that speaks OpenAI can already drive Hydra accounts via this endpoint.**

What's missing:

- **No CLI.** `bin/hydra.mjs` is a shell — `hydra` and `hydra dev` just spawn the existing scripts. There are no commands for `accounts`, `keys`, `balance`, `scan`, `redeem`, etc.
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
  (Vite/Electron)    (new, this doc)      (OpenAI SDK,
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
hydra                              show one-shot status (accounts, balance, server health)
hydra version                      print version

# Server lifecycle
hydra serve [--port N]             start Express server (replaces "hydra" default today)
hydra dev                          npm run dev (already exists)
hydra stop                         POST /api/shutdown to a running server

# Accounts
hydra accounts                     list with health + balance (table)
hydra accounts add [--bulk N]      generate via HTTP signup (Clerk FAPI primary, Playwright fallback)
hydra accounts add --email X       add a specific known account
hydra accounts sync [id]           refresh metadata from OpenRouter (one or all)
hydra accounts purge --dead        remove accounts with status=dead
hydra account <id>                 detail view for one account
hydra account <id> open            open AccountDetail page in default browser

# Keys
hydra keys                         list management keys
hydra keys provision <id>          provision new management key for account id
hydra keys rotate [--all]          rotate management key(s) — invalidate old, issue new

# Balance
hydra balance [id]                 single or aggregate balance check (live)
hydra balance --json               machine output

# Codes (promo redemption)
hydra codes redeem <code>          redeem on first eligible account
hydra codes preflight <code...>    check eligibility without redeeming
hydra codes bulk <file>            redeem from a file of codes (one per line)

# Health & ops
hydra scan                         full health pass: session check + balance + key validity, all accounts
hydra scan --quick                 just session check
hydra session <id>                 show session status; --refresh to force re-auth
hydra logs [--tail]                stream server logs

# AI / proxy
hydra ai chat "<prompt>"           one-shot chat using best available account (rotation)
hydra ai models                    list available models via /v1/models
hydra proxy status                 show local proxy URL + sk-hydra-* key
hydra proxy keys                   list proxy keys
hydra proxy keys new               generate a new sk-hydra-* key

# Data
hydra export [--out path]          export config (no secrets)
hydra import <path>                import config (validates schema)
hydra db reset --confirm           nuclear reset (wipes data/hydra.db)

# Auth (only ever needed when not running locally)
hydra unlock                       prompt for password, derive secrets key, persist for session
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
  hydra.mjs                       # current shell — extend, don't replace
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
| **P0 — read-only** | `accounts`, `account`, `balance`, `scan`, `session`, `keys`, `proxy status`, `version` | 1 day | Inspect entire fleet from terminal |
| **P1 — add/redeem** | `accounts add`, `accounts add --bulk`, `codes redeem`, `codes preflight`, `codes bulk` | 1–2 days | Replace the Generator + Bulk wizard UIs for terminal users |
| **P2 — ops** | `accounts sync`, `accounts purge`, `keys provision`, `keys rotate`, `scan --quick`, `db reset`, `export`, `import` | 1–2 days | Full ops without UI |
| **P3 — AI** | `ai chat`, `ai models`, `proxy keys new` | half day | Direct AI hooks into the CLI |
| **P4 — daemon** | `serve`, `stop`, `unlock` socket, `logs --tail` | 1 day | Long-running CLI sessions |

P0 is the smallest unit that's still worth shipping — operator can see the fleet from a terminal pane.

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

## Implementation order

1. **P0 CLI (read-only).** ~1 day. Smallest shippable thing.
2. **`/api/agent/*` skeleton + OpenAPI spec.** ~half day. Documents the surface, even if all routes initially `501`.
3. **P1 CLI (add/redeem) + matching agent endpoints.** ~2 days.
4. **MCP server.** ~1 day after P0 + P1. Mechanical wrapping of the agent endpoints.
5. **P2/P3 CLI.** Filling in.

Total: ~1 week of focused work to ship a CLI-first Hydra that any AI agent can drive.

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

New files:
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
