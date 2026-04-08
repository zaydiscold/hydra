# Hydra — Claude Code Instructions

Read `docs/AGENTS.md` first for full project context.

## Master Plan
**→ `~/.claude/plans/merry-chasing-naur.md`** — the living todo/plan/research doc. Always read this before starting work.

## Critical Rules

### Route/Controller Binding
ALL Express route handlers that call controller methods MUST use one of these patterns:
- `controller.method.bind(controller)` — for singleton-exported controllers
- `(req, res) => controller.method(req, res)` — for instance-per-file controllers

**Never** pass a bare method reference like `Controller.method` without `.bind()`. In ES module strict mode, `this` will be `undefined` inside the handler, causing `TypeError: Cannot read properties of undefined (reading '...')` for any `this.success()` / `this.error()` call.

### API Key Validation
Do not add format-based pre-validation for OpenRouter management keys or standard keys beyond checking that the value is non-empty. Let the OpenRouter API be the authority — it returns descriptive errors if a key is invalid.

### Encrypted Account Data
`store.getAllAccountsWithKeys()` and related functions use `readConfig()` / `readSessionToken()` which decrypt AES-256-GCM blobs. These can fail if secrets have been rotated. Handle failures per-account (skip corrupt record, don't throw for the whole list).

## When to Update Docs

After making changes to:
- Server routes → update `docs/SERVER_ARCHITECTURE.md`
- API contracts → update `docs/API_REFERENCE.md`
- Architecture/services → update `docs/ARCHITECTURE_DEEP_DIVE.md`
- Project structure → update `docs/PROJECT_STRUCTURE.md`
- **`/v1` proxy, rotation policy, or optional gateway/sidecar documentation** → update `docs/API_REFERENCE.md` (proxy tables + behavior), `docs/ARCHITECTURE_DEEP_DIVE.md` (proxy/rotation), and `docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md` when the operator story or runbook changes; keep `SERVER_ARCHITECTURE.md` / `PROJECT_STRUCTURE.md` / `AGENTS.md` / root `README.md` links consistent if you add or rename docs.

Also update the **relevant** doc(s) under `docs/` when a change is **material** to **UX**, **operator workflows**, or **audit/observability surfaces** (dashboards, tables, wizards, log viewers)—even when no HTTP route or JSON response shape changes. Example: Traffic Console column layout and labels should stay aligned with `docs/API_REFERENCE.md` and `docs/PROJECT_STRUCTURE.md`.

## Research & Recon Documentation (MANDATORY)

Every discovery — endpoint, session quirk, auth loophole, creative technique, UI trick — MUST be documented in `docs/`. Context windows die; files live. Use all available system tools for research: MCP servers, browser automation, DevTools, network capture, CLI recon tools.

Each finding needs: what, how, why it matters, raw evidence (redact secrets), reproducibility. Write for a skilled operator who's never seen the system.

**Triggers:** undocumented endpoints, auth/session mechanics differing from docs, creative approaches, rate limits or fingerprinting, reusable patterns, cookie/token scope discoveries.

## Stack

- **Backend**: Node.js + Express 5, Prisma/SQLite, Zod validation
- **Frontend**: React 19 + Vite, no UI framework
- **Auth**: JWT (stateless), AES-256-GCM encrypted local storage
- **Port**: 3001 (server), 5173 (Vite dev; if that port is in use Vite picks the next free port — use the URL printed in the terminal, e.g. `http://localhost:5174/`)

## Start Dev

```bash
npm run dev        # both server + client
node server/index.js  # server only
```
