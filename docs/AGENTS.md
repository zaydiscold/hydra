# 🐉 Project Context & Agent Briefing

Read this document first if you are an AI assistant working on Hydra.

## 🔎 What is this?

Hydra is an automated multi-account "Fleet Manager" for OpenRouter AI. It lets you manage 20+ accounts from a single dashboard specializing in balances, API keys, and code redemption.

### 🏮 The Vision

Hydra is built for high-performance AI operations. It consolidates multiple OpenRouter identities into a single, locally-secured core.

## 🏗️ Project Structure

Hydra runs locally as an Node.js (Express) + React (Vite) application using Prisma for SQLite data persistence.

- **`server/`** — Express 5 backend with controller-based logic and Zod validation.
- **`src/`** — React 19 frontend with a high-intensity "Neo-Brutalist" design system.
- **`prisma/`** — Database schema and local migration history.
- **`docs/`** — Comprehensive project documentation.

For a detailed map, see [**PROJECT_STRUCTURE.md**](PROJECT_STRUCTURE.md).

## ⚡ Technical Architecture

1. **Local-First Security** — All sensitive credentials are encrypted at rest using AES-256-GCM. See [**SECURITY.md**](SECURITY.md).
2. **Proxy Core** — An OpenAI-compatible endpoint that routes traffic across the pool.
3. **Automated Ops** — Specialized services for key rotation, balance tracking, and bulk redemption.

## 📖 Essential Documentation

- [**Hydra Architecture Deep Dive**](ARCHITECTURE_DEEP_DIVE.md) — The best starting point for understanding how routes, services, proxying, aggregation, and automation work together.
- [**Server Architecture**](SERVER_ARCHITECTURE.md) — Detailed middleware stack, route bindings, controller patterns, and response shapes.
- [**API Reference**](API_REFERENCE.md) — Internal server routes and data models.
- [**Hydra API Map**](HYDRA_API_MAP.md) — Private source-derived OpenAPI map workflow. Hydra must not be uploaded, registered, synced, or published through Printing Press; use that methodology only to maintain the local API map and Hydra-owned CLI.
- [**Hydra CLI and AI API Plan**](HYDRA_CLI_AND_AI_API_PLAN.md) — Closed-app CLI command inventory, implemented slices, and future operator commands.
- [**Release Audit**](RELEASE_AUDIT.md) — Current verification evidence and remaining dogfood/runtime gaps.
- [**CLIProxyAPI & gateway synthesis**](CLIPROXYAPI_GATEWAY_SYNTHESIS.md) — Architecture decision (Hydra vs sidecar vs LiteLLM), optional CLIProxyAPI ports/config, merged research; **no extra Express routes** unless you add them in code.
- [**Development Workflow**](DEVELOPMENT.md) — Setup, Prisma, and build scripts.
- [**Branding & Design**](BRANDING.md) — The Neo-Brutalist / Space-Age design system.

## 🚀 Development Mode

Start the dual-server environment:

```bash
npm run dev
```

After `npm link`, you can also run **`hydra dev`** (see [`bin/hydra.mjs`](../bin/hydra.mjs)). The browser **cannot** start the Node server by itself; current desktop packaging details live in [**PACKAGING.md**](PACKAGING.md).

**Docs map (launch + client errors):** [**DEVELOPMENT.md**](DEVELOPMENT.md) (operator setup), [**ARCHITECTURE_DEEP_DIVE.md**](ARCHITECTURE_DEEP_DIVE.md) (*Startup model*, *backend-down UX*), [**API_REFERENCE.md**](API_REFERENCE.md) (*Frontend API client* — `hydraCopyCommand`, `HYDRA_DEV_*` exports), [**SERVER_ARCHITECTURE.md**](SERVER_ARCHITECTURE.md) (Vite proxy / no new routes for offline UX).

The system requires `.env` configuration. Ensure you have copied `.env.example` to `.env` and set a secure `JWT_SECRET`.

## 🧭 Reading Order for Agents

1. Read `ARCHITECTURE_DEEP_DIVE.md` for the full mental model.
2. Read `SERVER_ARCHITECTURE.md` for middleware, route binding patterns, and controller patterns.
3. Read `API_REFERENCE.md` for exact route contracts.
4. Read `src/api.js` to see the client-side call surface.
5. Read the relevant `server/routes/*.js`, controller, and service files for the area you are changing.
6. **When making changes to server routes or controllers, update `docs/SERVER_ARCHITECTURE.md` to reflect those changes.** If you change **`/v1` proxy** behavior, contracts, or rotation policy, also update `docs/API_REFERENCE.md` (Proxy Routes + behavior bullets), `docs/ARCHITECTURE_DEEP_DIVE.md` (proxy / rotation sections), and—when the **optional gateway story** or sidecar runbook changes—`docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md` plus cross-links in `SERVER_ARCHITECTURE.md` / `PROJECT_STRUCTURE.md` as needed.
7. **When changing operator-facing UI or workflows in a material way** (pages, tables, observability/audit views, multi-step flows), update the relevant `docs/*.md` files—typically `docs/API_REFERENCE.md` (notes for routes the UI calls), `docs/PROJECT_STRUCTURE.md`, and any architecture or security doc that describes that surface—even if the API contract is unchanged.

## Parallel work (multi-lane plans)

When a plan splits into **mostly independent streams** (e.g. a small util module, a modal, a page refactor, doc updates), **dispatch parallel subagents** (or equivalent Task tool) so lanes like **A + B** run together, then **C** integration, then **D** docs—rather than one agent doing everything in order. After merges, run a short **reconciliation pass**: docs match validation and copy (e.g. key prefix rules), `PROJECT_STRUCTURE.md` lists new files, `npm run lint`.

## Learned User Preferences

- Update **relevant `docs/*.md`** when changes affect server routes, **`/v1` proxy** behavior, or **material operator-facing** UI—do not treat documentation as optional for those cases.
- Hydra is a **private local app**. Do not run Printing Press upload, registration, public-library sync, or endpoint-tool publishing flows for it. Use the Printing Press methodology only for private source-derived API mapping and Hydra-native CLI planning.

## Learned Workspace Facts

- **Dashboard account cards:** Per-account badges (SYNCED, NEEDS KEY, SIGN IN, etc.) and “synced / need attention” counts are derived in the client from `GET /api/dashboard` fields — see [**DASHBOARD_ACCOUNT_STATES.md**](DASHBOARD_ACCOUNT_STATES.md).
- **Pool Manager + models:** **Sync from OpenRouter** reloads account/key metadata from OpenRouter (management API). **Refresh Models** calls `POST /api/pool/models/refresh` and updates `CachedModel` (separate from sync). The proxy **`GET /v1/models`** prefers that DB cache, then live OpenRouter fetch (write-through), then a static fallback; responses may include **`X-Hydra-Models-Source`** (`cache`, `live`, or `static`). Clients choose the `model` per request; Hydra does not set a default proxy model except special fallback-on-5xx behavior for certain model ids.
- A **management key** enables OpenRouter’s management API but does not supply raw standard API key strings. **“Need key string”** in the UI means the standard key material is not stored locally—expected when only a management key was provisioned.
- **Session vs management key:** Clerk **`__session`** (dashboard) is required to *create* and store a management key via **tRPC over HTTP** or Hydra’s **server-side browser UI automation** (Chromium via **`playwright` npm**); until that succeeds, Key Manager has no management REST credentials. That path is **not** IDE **Playwright MCP** (see **`ARCHITECTURE_DEEP_DIVE.md`** provision section, **`.env.example`** for **`HYDRA_PLAYWRIGHT_HEADED`** / **`HYDRA_PROVISION_DEBUG`**). Operator playbook for tRPC discovery, headless stack tradeoffs, and debugging: [**MANAGEMENT_KEY_PROVISION_AUTOMATION.md**](MANAGEMENT_KEY_PROVISION_AUTOMATION.md).
- **Provision order of operations:** `createManagementKey` always attempts **cookie-authenticated tRPC HTTP** (`POST …/api/trpc/{route}?batch=1`) **before** optional Server Action stub and **browser automation**. Failures surface **`PROVISION_KEY_NOT_CAPTURED`** with structured **`details`** (`stage` e.g. **`browser_ui`**, **`phasesTried`**, **`trpcLastRoute`**, …); **`legacyCode` `PROVISION_PLAYWRIGHT_EXTRACT`** is a **historical** alias for older clients. Success payloads may still use **`source: playwright`**; the SPA may display **`browser-ui`**. Step logs default in **`NODE_ENV=development`**. Operator recon: **`scripts/capture-mgmt-key-network.mjs`**, **`docs/recon/TRPC_ROUTES.md`**, **`HYDRA_PLAYWRIGHT_CDP_ENDPOINT`** for real Chrome attach — see **`MANAGEMENT_KEY_PROVISION_AUTOMATION.md`**.
- **Clerk `sessionExpiry` backfill (vault):** **`dashboard-api.ensureSession`** treats validity as **`storedExpiry || getJwtExpiry(__session)`**, writes missing expiry to the vault when the JWT is still valid, and persists **`getJwtExpiry`** after OpenRouter **`validateSession`** succeeds. **`refreshSession`** retries Clerk **`GET /client`** up to **three** times. **`getJwtExpiry`** is exported from **`clerk-auth.js`**; **`detect-auth`**, Playwright **account-generator** signup, and similar paths also persist JWT-derived expiry. No new HTTP routes—see [**ARCHITECTURE_DEEP_DIVE.md**](ARCHITECTURE_DEEP_DIVE.md) (*ensureSession and persistent sessionExpiry*). Regression: **`npm run test:session-expiry`**, **`npm run test:ensure-session-backfill`** (mocked **`ensureSession`** backfill).
- **Pool Manager** (`/pool`): use **About keys** in the header for the full operator explanation (management `listKeys` vs pasting `sk-or-v1-…`, OpenRouter keys page). No extra HTTP route—popover-only UX. The **Legend** panel points to **About keys** instead of duplicating paragraphs.
- **Optional CLIProxyAPI / LiteLLM** are **not** part of the Hydra process; they are documented as optional sidecars in **`CLIPROXYAPI_GATEWAY_SYNTHESIS.md`**. Hydra’s OpenAI-compatible entry remains **`http://localhost:3001/v1`** with **`sk-hydra-...`** unless you change `server/index.js` routing.
- **`npm run dev`** runs **`scripts/free-dev-ports.mjs`** first to release listeners on the API and Vite ports (defaults **3001** / **5173**; override with **`PORT`** or **`HYDRA_SERVER_PORT`**, and **`HYDRA_VITE_PORT`**). Vite uses **`strictPort: true`**, so a busy Vite port surfaces an error instead of silently moving to 5174+. Run **`npm`** from the **repository root** (folder with **`package.json`**); from **`~`** you get **ENOENT** / missing **`package.json`**.
- **Zod 4** exposes validation problems on **`issues`**, not **`errors`**. When formatting `ZodError`, use **`err.issues ?? err.errors ?? []`** (see **`BaseController.validate`**).
- **Clerk FAPI from Node** (OTP verify, password complete, 2FA, session refresh): session-critical hops use **`clerkHttpsJson`** in **`server/services/clerk-auth.js`** (raw **`https`**) so **`res.headers['set-cookie']`** is always visible; Undici **`fetch`** can omit **`Set-Cookie`** even when **`getSetCookie()`** exists. **`prepare_first_factor`** (send OTP email) still uses **`fetch`**. The persisted **`clientCookie`** is a **device cookie jar** (e.g. **`__client`**, **`__client_uat`**, **`__client_uat_*`**) merged from **`Set-Cookie`** and replayed on later FAPI and dashboard requests. Browser-parity headers default to **`Origin`/`Referer`** matching the OpenRouter dashboard; override with **`CLERK_ORIGIN`** and **`CLERK_REFERER`** in **`.env`** if needed. On successful session write, **`config.sessionExpiry`** is set from **`getJwtExpiry`** (JWT **`exp`**, else **24h** fallback) and **`store.getSessionStatus`** reports **`active`** / **`expiring`** / **`expired`** / **`none`**—not **`unknown`** for “token without expiry” (see **`docs/ARCHITECTURE_DEEP_DIVE.md`**, **`docs/DASHBOARD_ACCOUNT_STATES.md`**). No extra HTTP routes; list/dashboard/session-status responses carry **`sessionStatus`**. Optional **`CLERK_DEBUG_OTP=1`** logs Set-Cookie **names**, **`sign_in`** session-hint fields (presence only), **`GET /client`** top-level JSON keys, and whether **`client`** vs **`response`** is present—covering both **`attempt_first_factor`** and the session fallback path; the same flag adds **`clerkDebugOtp`** / **`clerkDebugHint`** on relevant **`AccountController`** error JSON and in the OTP/login UI via **`formatApiErrorMessage`** in **`src/api.js`**. **Interpreting logs:** if **`attempt_first_factor Set-Cookie names`** never includes **`__session`** but **`created_session_id`** is **`yes`**, the **`touch`** path ran; if all **`GET /client`** attempts show **`Set-Cookie names: (none)`** and no embedded JWT, suspect network/proxy stripping cookies or upstream Clerk shape drift—run **`npm run check:clerk`** from the same machine to confirm TLS + **`__client`** visibility.
- **Email OTP, codes, magic link:** To **send** OTP, Clerk expects **`prepare_first_factor`** with **`strategy: email_code`** (and **`email_address_id`** from **`detectAuthMethod`**); **`attempt_first_factor`** with **`email_code`** but no **`code`** errors—do not use it alone as the send step. **Bulk code redemption** uses per-account dashboard session (`ensureSession` → tRPC), not the management API; **`POST /api/codes/preflight`** flags session gaps before **`POST /api/codes/bulk`**. **`redeemCode`** in **`dashboard-api.js`** tries cached tRPC → procedure candidates → **`redeemCodeViaPlaywright`**; Playwright classifies outcome via browser tRPC JSON, failure-first UI text, optional **credits `total`** poll (management key), legacy success regex, else **`REDEEM_OUTCOME_UNKNOWN`** + **`uiFeedback`**—see **`docs/API_REFERENCE.md`** (*Code Redemption Routes*) for the full ladder, **`errorCode`** meanings, discovery persistence, and HTTP envelope. OpenRouter may offer **email link**; Hydra’s FAPI path targets **`email_code`**—see **`docs/_archive/historical/IMPLEMENTATION_PLAN.md`** (archived; live work tracked in **`docs/IDEAS.md`**).
- **Provision management key** (`createManagementKey` / Playwright fallback): treat inner **`success: false`** as failure in API and UI—do not toast success from **`source`** (or similar) alone when the payload says the operation failed.
- **Management key docs vs runtime:** Opening OpenRouter’s management-keys page in an **IDE browser** records **selectors / tRPC** for **`docs/recon/`**; it does **not** store keys in Hydra. **`POST /api/accounts/:id/provision`** runs **`dashboard-api.js`** and captures the key from **upstream JSON or page text**, not from the site’s Copy button. **`PATCH /api/accounts/:id`** + Key Manager paste is the operator path when automation cannot run; see **`MANAGEMENT_KEY_PROVISION_AUTOMATION.md`**, **`API_REFERENCE.md`**, **`DASHBOARD_ACCOUNT_STATES.md`** (*Key Manager*).
