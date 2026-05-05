# 🐉 Hydra | OpenRouter Fleet Manager

Hydra is a professional, high-intensity local management dashboard for OpenRouter account fleets. It provides a single, locally-secured interface to manage balances, rotate API keys, and perform bulk operations across dozens of accounts simultaneously.

## 🏮 The Vision

Hydra is built for power users who manage multiple OpenRouter identities. Instead of juggling dozens of browser tabs and management keys, Hydra consolidates your "fleet" into a high-performance terminal dashboard.

### Why Hydra?

- **Efficiency** — One-click key rotation and bulk redemption across all accounts.
- **Safety** — API keys and session data are **encrypted at rest** on your local machine.
- **Speed** — Neo-Brutalist UI designed for rapid interaction and high-intensity monitoring.
- **Portability** — A portable development environment that runs anywhere with Node.js.

## ⚡ Key Features

- **Multi-Account Dashboard** — Real-time aggregate balances and account status visualization.
- **Fleet Key Rotation** — Centrally generate and rotate API keys for any account in your pool.
- **Bulk Code Redemption** — Distribute promo codes to your entire fleet in a single pass.
- **Neo-Cyberpunk UI** — A premium, space-age design system optimized for modern cockpits.
- **Local-First Encryption** — AES-256-GCM protection for all sensitive information.

## 🚀 Quick Start (Production)

Hydra is designed for zero-friction deployment — no terminal mastery required.

### 1. Install Node.js

Hydra requires **Node.js 18+**. Download it from: [nodejs.org](https://nodejs.org).

### 2. Launching Hydra

Use the launcher that matches the build you want:

| Launcher | What it does |
| --- | --- |
| `Hydra.app` | Packaged Electron app. Starts the embedded local server and opens the native desktop UI. |
| `Launch Hydra.command` | macOS launcher for this repo clone. Good for local production-style startup without opening a terminal first. |
| `npm start` | Production-style terminal startup via `scripts/launch.js`. Builds if needed, syncs the local DB schema, starts Express, then opens the browser UI. |
| `npm run preview` / `npm run preview:electron` | Builds the Vite frontend and launches Electron against the built app. |
| `npm run preview:web` | Old Vite preview behavior for frontend-only preview. |
| `npm run preview:static` | Builds the frontend and runs the standalone Express server. |
| `npm run start:electron` | Production equivalent of the Electron preview flow. |

Legacy launchers such as `Start Hydra.command` / `Start Hydra.bat` may exist in older checkouts, but the current macOS repo launcher is `Launch Hydra.command`.

### 3. Access Dashboard

The browser will automatically open to `http://localhost:3001` once the environment is initialized.

### 4. Dev Server Notes

If you are working on the UI, `npm run dev` starts the Vite client on `http://localhost:5173` and the Express backend on `http://localhost:3001` at the same time.

- Frontend-only CSS and React changes usually hot-reload in the browser.
- Backend changes in `server/` usually require restarting the backend process.
- If the browser is pointed at `http://localhost:5173`, that is the Vite dev server; if the app says the server is offline, restart the backend, not the browser tab.

**Important:** The web UI **cannot** start the Node server for you (browser security). You must run `npm run dev`, `npm start`, or the `hydra` CLI (below) from a terminal or launcher script.

### 5. `hydra` CLI (optional global command)

From the repository root:

```bash
npm link
```

Then from any directory:

| Command | What it runs |
|---------|----------------|
| `hydra` | Production-style boot via `launch.js` (same as `npm start`) |
| `hydra dev` | Vite + Express (same as `npm run dev`) |
| `hydra help` | Usage |

`npm link` ties the global `hydra` command to **this clone**; if you move the folder, run `npm link` again from the new path.

For a full research-style comparison of packaging options, see [**docs/HYDRA_LAUNCH_RESEARCH.md**](docs/HYDRA_LAUNCH_RESEARCH.md).

---

## 🛠️ Developer Implementation

For developers wanting to build or extend the Hydra core:

1. **Setup Environment**

   ```bash
   cp .env.example .env
   npm install
   ```

2. **Launch Dev Mode**

   ```bash
   npm run dev
   ```

   Or, after `npm link`: `hydra dev`

*Dev instances run concurrently at `http://localhost:5173` (Client) and `http://localhost:3001` (Server).*

*If you need to restart the local backend during development, stop the running `npm run dev` process and run it again. The client server and API server are launched together by the same command.*

## 📖 Project Documentation

Explore the technical architecture and design system:

- [**Hydra Architecture Deep Dive**](docs/ARCHITECTURE_DEEP_DIVE.md) — Full route/service/proxy mental model for humans and agents.
- [**Architecture Guide**](docs/PROJECT_STRUCTURE.md) — Codebase map and design patterns.
- [**Security Architecture**](docs/SECURITY.md) — AES-256 encryption & local-first philosophy.
- [**Branding & Design**](docs/BRANDING.md) — The Neo-Brutalist / Space-Age design system.
- [**Development Workflow**](docs/DEVELOPMENT.md) — Prisma, environment, and build scripts.
- [**API Reference**](docs/API_REFERENCE.md) — Internal server routes and data models.
- [**CLIProxyAPI & gateways**](docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md) — Optional sidecars (CLIProxyAPI, LiteLLM), ports, and how they relate to Hydra’s **`/v1`** proxy (routing is still Express **`/v1/*`** on port 3001 unless you change the server).
- [**AI Briefing**](docs/AGENTS.md) — Technical context for AI coding assistants.
