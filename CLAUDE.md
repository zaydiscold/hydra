# Hydra — Claude Code Instructions

## Agent reading order

1. Read this file for repo-level rules.
2. Read `~/.claude/plans/hydra_plan.md` for the current living plan and research log.
3. Read task-relevant docs and code before making changes.

## gstack

gstack is installed globally at `~/.claude/skills/gstack`. Also installed in Hermes.

**Browser tools — use in this order:**
1. `/browse` (gstack) — fast headless Chromium, ~100ms/cmd, best for QA/scraping/testing
2. `mcp__chrome-devtools__*` — DevTools protocol, good for JS eval, network inspection
3. `mcp__claude-in-chrome__*` — only when login session is strictly required (has access to your Chrome cookies/sessions); slower
4. `mcp__executeautomation-playwright-server__*` — Playwright MCP, full browser automation
5. CamoFox — if installed, use for fingerprint-resistant browsing

**Never use** `mcp__claude-in-chrome__*` for basic browsing — use `/browse` instead. Reserve chrome-in-claude for authenticated sessions only.

Available gstack skills:
`/office-hours` `/plan-ceo-review` `/plan-eng-review` `/plan-design-review` `/design-consultation` `/design-shotgun` `/design-html` `/review` `/ship` `/land-and-deploy` `/canary` `/benchmark` `/browse` `/connect-chrome` `/qa` `/qa-only` `/design-review` `/setup-browser-cookies` `/setup-deploy` `/retro` `/investigate` `/document-release` `/codex` `/cso` `/autoplan` `/plan-devex-review` `/devex-review` `/careful` `/freeze` `/guard` `/unfreeze` `/gstack-upgrade` `/learn` `/pair-agent` `/health` `/checkpoint`

## Master Plan
**→ `~/.claude/plans/hydra_plan.md`** — the living todo/plan/research log. Always read this before starting work. Append new findings, mark completed items, keep it current.

**When the user says "display plan", "show plan", "show status", "what's the plan", or similar:** read `~/.claude/plans/hydra_plan.md` and output a status table grouped by P0/P1/P2/P3/P4 showing ✅ done / 🟡 in progress / ❌ not started for every item.

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
- **`/v1` proxy, rotation policy, or optional gateway/sidecar documentation** → update `docs/API_REFERENCE.md` (proxy tables + behavior), `docs/ARCHITECTURE_DEEP_DIVE.md` (proxy/rotation), and `docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md` when the operator story or runbook changes; keep `SERVER_ARCHITECTURE.md` / `PROJECT_STRUCTURE.md` / root `README.md` links consistent if you add or rename docs.

Also update the **relevant** doc(s) under `docs/` when a change is **material** to **UX**, **operator workflows**, or **audit/observability surfaces** (dashboards, tables, wizards, log viewers)—even when no HTTP route or JSON response shape changes.

When making changes to server routes or controllers, update `docs/SERVER_ARCHITECTURE.md`. If you change **`/v1` proxy** behavior, contracts, or rotation policy, also update `docs/API_REFERENCE.md` (Proxy Routes + behavior bullets), `docs/ARCHITECTURE_DEEP_DIVE.md` (proxy/rotation sections), and—when the optional gateway story or sidecar runbook changes—`docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md` plus cross-links in `SERVER_ARCHITECTURE.md` / `PROJECT_STRUCTURE.md` as needed.

When changing operator-facing UI or workflows in a material way (pages, tables, observability/audit views, multi-step flows), update the relevant `docs/*.md` files—typically `docs/API_REFERENCE.md`, `docs/PROJECT_STRUCTURE.md`, and any architecture or security doc that describes that surface.

## Research & Recon Documentation (MANDATORY)

Every discovery — endpoint, session quirk, auth loophole, creative technique, UI trick — MUST be documented in `docs/`. Context windows die; files live. Use all available system tools for research: MCP servers, browser automation, DevTools, network capture, CLI recon tools.

Each finding needs: what, how, why it matters, raw evidence (redact secrets), reproducibility. Write for a skilled operator who's never seen the system.

**Triggers:** undocumented endpoints, auth/session mechanics differing from docs, creative approaches, rate limits or fingerprinting, reusable patterns, cookie/token scope discoveries.

## Docs Map

- [**Architecture Deep Dive**](docs/ARCHITECTURE_DEEP_DIVE.md) — best starting point: routes, services, proxying, aggregation, automation.
- [**Server Architecture**](docs/SERVER_ARCHITECTURE.md) — middleware stack, route bindings, controller patterns, response shapes.
- [**API Reference**](docs/API_REFERENCE.md) — internal server routes and data models.
- [**CLIProxyAPI & gateway synthesis**](docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md) — Hydra vs sidecar vs LiteLLM decision; optional CLIProxyAPI ports/config.
- [**Security**](docs/SECURITY.md) — AES-256-GCM encryption, local auth.
- [**Dashboard Account States**](docs/DASHBOARD_ACCOUNT_STATES.md) — card badge logic, session labels.
- [**Management Key Provision**](docs/MANAGEMENT_KEY_PROVISION_AUTOMATION.md) — operator playbook for key provisioning.
- [**Server Action Capture/Replay**](docs/SERVER_ACTION_CAPTURE_REPLAY.md) — Next.js SA hash capture.
- [**Cookie & Session Tricks**](docs/COOKIE_SESSION_TRICKS.md) — living hive mind of auth/cookie exploits and techniques.
- [**Session Lifecycle**](docs/SESSION_LIFECYCLE.md) — session creation, storage, validation, refresh flows.
- [**Docker Plan**](docs/DOCKER_PLAN.md) — Dockerfile, compose, static serving, ghcr.io distribution.
- [**Electron Plan**](docs/ELECTRON_PLAN.md) — native desktop app packaging, BrowserWindow + Express architecture.

## Parallel Work (Multi-Lane Plans)

When a plan splits into mostly independent streams (e.g. a small util module, a modal, a page refactor, doc updates), dispatch parallel subagents so lanes run together rather than one agent doing everything in order. After merges, run a short reconciliation pass: docs match validation and copy, `PROJECT_STRUCTURE.md` lists new files, `npm run lint`.

## Stack

- **Backend**: Node.js + Express 5, Prisma/SQLite, Zod validation
- **Frontend**: React 19 + Vite, no UI framework
- **Auth**: JWT (stateless), AES-256-GCM encrypted local storage
- **Port**: 3001 (server), 5173 (Vite dev; if that port is in use Vite picks the next free port — use the URL printed in the terminal)

## Start Dev

```bash
npm run dev        # both server + client
node server/index.js  # server only
```

## Learned Workspace Facts

- **Dashboard account cards:** Per-account badges (SYNCED, NEEDS KEY, SIGN IN, etc.) and "synced / need attention" counts are derived in the client from `GET /api/dashboard` fields — see `docs/DASHBOARD_ACCOUNT_STATES.md`.
- **Pool Manager + models:** **Sync from OpenRouter** reloads account/key metadata (management API). **Refresh Models** calls `POST /api/pool/models/refresh` and updates `CachedModel`. The proxy `GET /v1/models` prefers DB cache, then live OR fetch (write-through), then static fallback; responses may include `X-Hydra-Models-Source` (`cache`, `live`, or `static`).
- A **management key** enables OpenRouter's management API but does not supply raw standard API key strings. **"Need key string"** means standard key material is not stored locally.
- **Session vs management key:** Clerk `__session` (dashboard) is required to *create* a management key via tRPC HTTP or browser UI automation (Playwright). That path is NOT the IDE Playwright MCP — see `docs/MANAGEMENT_KEY_PROVISION_AUTOMATION.md`.
- **Provision order:** `createManagementKey` always tries cookie-authenticated tRPC HTTP first, then Server Action stub, then browser automation. Failures surface `PROVISION_KEY_NOT_CAPTURED` with structured `details` (`stage`, `phasesTried`, `trpcLastRoute`, etc.).
- **`sessionExpiry` is realistic Clerk session TTL (~7 days), NOT the JWT `exp` (~2.5 min).** Never use `getJwtExpiry()` for session lifecycle. The only valid use is `account-generator.js:240`. See `docs/SESSION_LIFECYCLE.md`.
- **`getSessionStatus`** reports `active` / `expiring` / `expired` / `none` — not `unknown` for "token without expiry".
- **`npm run dev`** runs `scripts/free-dev-ports.mjs` first to release listeners on ports 3001/5173. Vite uses `strictPort: true`. Run `npm` from the repository root.
- **Zod 4** exposes validation problems on `issues`, not `errors`. Use `err.issues ?? err.errors ?? []` (see `BaseController.validate`).
- **Clerk FAPI from Node:** Session-critical hops use `clerkHttpsJson` in `server/services/clerk-auth.js` (raw `https`) so `res.headers['set-cookie']` is always visible; Undici `fetch` can omit `Set-Cookie`. The persisted `clientCookie` is a device cookie jar (`__client`, `__client_uat`, etc.) merged from `Set-Cookie` and replayed on later FAPI and dashboard requests.
- **Email OTP send:** Clerk expects `prepare_first_factor` with `strategy: email_code` + `email_address_id`. Do not use `attempt_first_factor` without a `code` as the send step.
- **Bulk code redemption** uses per-account dashboard session (`ensureSession` → tRPC), not the management API. `POST /api/codes/preflight` flags session gaps before `POST /api/codes/bulk`.
- **Provision management key:** Treat inner `success: false` as failure — do not toast success from `source` alone when the payload says the operation failed.
- **Management key docs vs runtime:** Opening the OpenRouter management-keys page in an IDE browser records selectors/tRPC for `docs/recon/`; it does NOT store keys in Hydra. `POST /api/accounts/:id/provision` captures the key from upstream JSON or page text, not the site's Copy button.
- **Optional CLIProxyAPI / LiteLLM** are NOT part of the Hydra process; documented as optional sidecars in `docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md`. Hydra's OpenAI-compatible entry remains `http://localhost:3001/v1` with `sk-hydra-...`.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill tool as your FIRST action. Do NOT answer directly, do NOT use other tools first. The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
