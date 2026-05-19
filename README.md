# Hydra | OpenRouter Fleet Manager

Hydra is a local Electron desktop app for managing OpenRouter account fleets. It ships an embedded Express server, encrypted local storage, a React dashboard, and an OpenAI-compatible local proxy in one packaged app.

## What It Does

Hydra is built for operators who manage multiple OpenRouter identities and keys. It consolidates account status, balances, key management, code redemption, and proxy routing into one native desktop window.

## Features

- **Multi-Account Dashboard** — Real-time aggregate balances and account status visualization.
- **Fleet Key Management** — Generate, store, and rotate API keys for accounts in your pool.
- **Bulk Code Redemption** — Distribute promo codes to your entire fleet in a single pass.
- **Local-First Storage** — Sensitive account/session/key material is encrypted at rest.
- **Embedded Proxy** — Hydra exposes an OpenAI-compatible local `/v1` proxy on a loopback port surfaced in the app.
- **Desktop Packaging** — Buildable Electron packages for macOS, Windows, and Linux.

## Quick Start

Hydra is a native desktop app — no terminal required for end users.

### Run the packaged app

| Launcher | What it does |
| --- | --- |
| `Hydra.app` (macOS) / `Hydra Setup.exe` (Windows) / `Hydra.AppImage` (Linux) | The packaged Electron app. Boots the embedded server, opens the native window, and stays running in the system tray / menu bar. Closing the window keeps the proxy alive; "Quit Hydra" from the tray fully shuts down. |

The first launch creates an empty SQLite database in your platform-native `userData` directory:

- macOS: `~/Library/Application Support/Hydra/`
- Windows: `%APPDATA%\Hydra\`
- Linux: `~/.config/Hydra/`

There is no "browser opening to localhost" step in the desktop flow — the window is the app.

## Development

Install dependencies and run Hydra in Electron development mode:

```bash
cp .env.example .env
npm install
npm run dev:electron
```

Common checks:

```bash
npm run lint
npm test
npm run build
npm run gate
```

Build a desktop artifact:

```bash
npm run electron:build
```

## CLI

Hydra includes a local CLI for operator scripts:

```bash
node bin/hydra.mjs help
node bin/hydra.mjs doctor --json
node bin/hydra.mjs openrouter models --json
node bin/hydra.mjs codes preflight <code> --json
```

## Documentation

- [Packaging](docs/PACKAGING.md) covers desktop artifact builds and smoke checks.
- [Docker Runtime](docs/DOCKER.md) covers the optional server-style deployment.
- [API Reference](docs/API_REFERENCE.md) covers the local server and app contracts.
- [Hydra API Map](docs/HYDRA_API_MAP.md) explains the private source-derived API map and CLI boundary.
