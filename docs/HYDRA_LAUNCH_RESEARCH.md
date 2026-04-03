# Hydra launch UX — parallel research synthesis

This document records a **three-lens swarm** comparison for (A) starting the backend from the UI and (B) one-command / CLI packaging. Each lens answers the same schema:

`Recommendation | Effort (S/M/L) | Risks | Fits Hydra stack | Kill criteria`

---

## Slice A — Can the UI start the server?

### Agent A — Minimal / YAGNI

| Field | Content |
|--------|---------|
| **Recommendation** | Do not add runtimes. Improve copy when `/api` fetch fails in Vite dev: tell users to run `npm run dev` (or `npm run server`). Optional clipboard button. |
| **Effort** | S |
| **Risks** | None material; avoids false promise of a “Start server” button in pure browser. |
| **Fits stack** | Yes — [`src/api.js`](../src/api.js), [`BulkAuthWizard`](../src/pages/BulkAuthWizard.jsx), [`App.jsx`](../src/App.jsx). |
| **Kill criteria** | If product insists on one-click start with zero terminal use → this lens cannot satisfy alone. |

### Agent B — Ops / packaging

| Field | Content |
|--------|---------|
| **Recommendation** | Document that browsers cannot spawn local Node; recommend **production** path [`npm start`](../launch.js) / `hydra` (single port) for “double-click” operators. Optional **tray/daemon** only if enterprise deployment needs it. |
| **Effort** | S for docs; L for tray installer across macOS/Windows. |
| **Risks** | Tray/daemon = install/update story, code signing, AV false positives. |
| **Fits stack** | `launch.js` already unifies API + static `dist/`. |
| **Kill criteria** | Tray not justified until non-technical users cannot use `Start Hydra` scripts + README. |

### Agent C — Product / UX

| Field | Content |
|--------|---------|
| **Recommendation** | Users conflate “app open in browser” with “backend up.” **Electron/Tauri** is the only pattern that delivers a true in-app **Start** if the shell owns the process. **Custom URL scheme** (`hydra://…`) is a middle ground: link opens a registered handler. |
| **Effort** | M for URL scheme + docs; **L** for Electron (build, updates, binary size). |
| **Risks** | Electron doubles maintenance; URL scheme needs per-OS registration. |
| **Fits stack** | Wraps existing Node + static UI; no change to Express contract. |
| **Kill criteria** | If roadmap has no desktop app → defer Electron. |

### Slice A — Agreement

- **All three agree:** a normal **same-origin web page** cannot execute `node server/index.js` (browser sandbox).
- **Split:** A/B prefer messaging + existing `launch.js`; C reserves Electron/URL scheme for hard UX requirements.

---

## Slice B — One-command / `hydra` UX

### Agent A — Minimal / YAGNI

| Field | Content |
|--------|---------|
| **Recommendation** | Add **`package.json` `bin`** → [`bin/hydra.mjs`](../bin/hydra.mjs): default → `launch.js`, `hydra dev` → `npm run dev`. Document `npm link` for a global `hydra` command. |
| **Effort** | S |
| **Risks** | Global link points at clone path; users must `npm link` after clone moves. |
| **Fits stack** | Yes. |
| **Kill criteria** | None for local dev power users. |

### Agent B — Ops / packaging

| Field | Content |
|--------|---------|
| **Recommendation** | **`npm bin`** for developers; **Docker Compose** for reproducible envs (CI, onboarding); optional **Makefile** targets as thin wrappers. Avoid **pm2** for default desktop flow — adds daemon semantics. |
| **Effort** | S (bin); M (Dockerfile + compose + docs). |
| **Risks** | Docker on Apple Silicon + Playwright/native deps may need extra image work. |
| **Fits stack** | Compose runs same `node` + `npm` commands. |
| **Kill criteria** | Docker optional until team asks for container-only deploy. |

### Agent C — Product / UX

| Field | Content |
|--------|---------|
| **Recommendation** | **Shell alias** is zero-repo-change for experts (`alias hydra='cd … && npm run dev'`). Ship **`hydra`** via `bin` for discoverability; README table: dev vs prod vs Docker. |
| **Effort** | S |
| **Risks** | Alias per-machine; not shareable in repo. |
| **Fits stack** | Yes. |
| **Kill criteria** | N/A |

### Slice B — Agreement

- **Consensus:** **`hydra` CLI via `bin`** is the best repo-native one-word entry after `npm link` (or `npx` from published package).
- **Split:** Docker/Make are **optional** layers for ops-heavy users, not required for MVP.

---

## Synthesis — decision matrix

| Option | A Minimal | B Ops | C Product | Phase |
|--------|-----------|-------|-----------|-------|
| Pure web “Start server” button | No | No | No | **Blocked** (browser security) |
| Better offline/dev copy + copy command | Yes | Yes | Yes | **P0 — shipped in repo** |
| `hydra` / `hydra dev` CLI | Yes | Yes | Yes | **P0 — shipped in repo** |
| Docs: README + DEVELOPMENT | Yes | Yes | Yes | **P0** |
| Docker Compose | Defer | Optional | Optional | **P2** |
| Tray daemon | Defer | If needed | — | **P3** |
| Electron / Tauri | Defer | — | If mandatory | **P3** |

### Phased rollout

1. **Phase 0 (now):** Dev error UX + `bin/hydra.mjs` + documentation.
2. **Phase 1:** Optional `docker-compose.yml` if container onboarding is requested.
3. **Phase 2:** Desktop shell or URL scheme only after explicit product decision.

---

## Related files

- [`launch.js`](../launch.js) — production orchestration
- [`package.json`](../package.json) — `dev`, `start`, `server` scripts
- [`docs/DEVELOPMENT.md`](DEVELOPMENT.md) — workflow + constraints
