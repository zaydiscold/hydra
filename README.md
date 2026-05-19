# 🐉 Hydra | OpenRouter Fleet Manager

Hydra is a professional, high-intensity **local desktop application** for managing OpenRouter account fleets. The packaged Electron app ships an embedded Express server and a React UI in a single window — there is no separate frontend to host or backend to deploy. Everything runs on your machine, encrypted at rest.

## 🏮 The Vision

Hydra is built for power users who manage multiple OpenRouter identities. Instead of juggling dozens of browser tabs and management keys, Hydra consolidates your "fleet" into one native desktop window.

### Why Hydra?

- **Efficiency** — One-click key rotation and bulk redemption across all accounts.
- **Safety** — API keys and session data are **encrypted at rest** in the OS-native `userData` directory.
- **Speed** — Neo-Brutalist UI designed for rapid interaction and high-intensity monitoring.
- **Portability** — Native Electron bundles for Apple Silicon Mac, Intel Mac, Windows, and Linux, plus a Docker runtime for server-style deployments.

## ⚡ Key Features

- **Multi-Account Dashboard** — Real-time aggregate balances and account status visualization.
- **Fleet Key Rotation** — Centrally generate and rotate API keys for any account in your pool.
- **Bulk Code Redemption** — Distribute promo codes to your entire fleet in a single pass.
- **Neo-Cyberpunk UI** — A premium, space-age design system optimized for modern cockpits.
- **Local-First Encryption** — AES-256-GCM protection for all sensitive information.
- **Embedded Proxy** — Hydra is also an OpenAI-compatible local proxy at `http://127.0.0.1:<port>/v1` (port chosen at boot, surfaced in the tray menu and Settings page) so any tool that speaks the OpenAI API can hit your fleet through it.

## 🚀 Quick Start (Desktop App)

Hydra is a native desktop app — no terminal required for end users.

### Run the packaged app

| Launcher | What it does |
| --- | --- |
| `Hydra.app` (macOS) / `Hydra Setup.exe` (Windows) / `Hydra.AppImage` (Linux) | The packaged Electron app. Boots the embedded server, opens the native window, and stays running in the system tray / menu bar. Closing the window keeps the proxy alive; "Quit Hydra" from the tray fully shuts down. |
| `Launch Hydra.command` | macOS shortcut for running this repo clone in production-style mode without first opening a terminal. |
| `npm run preview:electron` | From a clone: builds the Vite frontend and launches Electron against the built app — the standard local-test-the-real-app flow. |
| `npm run electron:build` | Produces a distributable artifact in `release/` (macOS zip / Windows NSIS / Linux packages). |
| `npm run electron:build:mac-x64` | Produces an Intel Mac zip for 2019 Intel Macs and other x64 macOS hosts. |

The first launch creates an empty SQLite database in your platform-native `userData` directory:

- macOS: `~/Library/Application Support/Hydra/`
- Windows: `%APPDATA%\Hydra\`
- Linux: `~/.config/Hydra/`

There is no "browser opening to localhost" step in the desktop flow — the window is the app.

### Developer mode

If you are working on Hydra itself:

```bash
cp .env.example .env
npm install
npm run dev:electron   # Vite HMR + Electron window concurrently
```

`npm run dev:electron` runs Vite in dev mode and Electron loads `VITE_DEV_SERVER_URL` when set, otherwise `http://localhost:${HYDRA_VITE_PORT:-5173}` inside the BrowserWindow with hot module reload. Backend changes in `server/` still require restarting the dev process.

`npm run electron:build` uses the macOS zip target by default because sandboxed agent environments cannot start the `hdiutil` helper needed for DMG creation. On a normal unsandboxed Mac release machine, use `npm run electron:build:dmg` to produce the DMG.

For Intel Macs, run `npm run electron:build:mac-x64` on the Intel machine
itself, or use the release workflow's `macos-15-intel` job. On Zayd's setup,
the Intel home server is reachable with `ssh home`.

`npm run dev` (without `:electron`) is the legacy browser-mode dev loop — Vite on 5173 + Express on 3001 in your default browser. It still works for UI-only iteration but is **not** the production runtime.

### Docker runtime

For a persistent web/API deployment:

```bash
docker compose up -d --build
```

This serves Hydra at `http://127.0.0.1:3001` and stores state in `./data`.
The published image is multi-arch (`linux/amd64` and `linux/arm64`). See
[docs/DOCKER.md](docs/DOCKER.md).

### 5. `hydra` CLI (optional global command)

From the repository root:

```bash
npm link
```

Then from any directory:

| Command | What it runs |
|---------|----------------|
| `hydra` | Show usage |
| `hydra start` | Production-style boot via `launch.js` (same as `npm start`) |
| `hydra dev` | Vite + Express (same as `npm run dev`) |
| `hydra doctor --json` | Machine-readable system and runtime checks |
| `hydra logs --json` | Machine-readable tail of the app log |
| `hydra help` | Usage |

`npm link` ties the global `hydra` command to **this clone**; if you move the folder, run `npm link` again from the new path.

For current packaging/build details, see [**docs/PACKAGING.md**](docs/PACKAGING.md).

---

## 🛠️ Developer Implementation

For developers wanting to build or extend the Hydra core:

1. **Setup Environment**

   ```bash
   cp .env.example .env
   npm install
   ```

2. **Launch Dev Mode (recommended — Electron window)**

   ```bash
   npm run dev:electron
   ```

   Vite HMR is loaded inside the BrowserWindow — the same shell you ship.

3. **Browser-mode dev (legacy)**

   ```bash
   npm run dev
   ```

   Spins up Vite (`http://localhost:5173`) + Express (`http://localhost:3001`) for browser-only iteration. Useful for fast CSS work, but the production runtime is Electron — always retest in `npm run dev:electron` before shipping a UI change.

*If you need to restart the local backend during development, stop the running dev process and run it again. The client and API are launched together by the same command.*

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
