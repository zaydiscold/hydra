# Hydra

<p align="center">
  <img src="public/hydra_dragon.png" alt="Hydra" width="112" />
</p>

<p align="center">
  <strong>Local-first OpenRouter fleet manager, desktop control plane, and OpenAI-compatible API router.</strong>
</p>

<p align="center">
  <a href="https://github.com/zaydiscold/hydra/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/zaydiscold/hydra/ci.yml?branch=master&label=CI&style=flat-square"></a>
  <a href="https://github.com/zaydiscold/hydra/actions/workflows/release.yml"><img alt="Release" src="https://img.shields.io/github/actions/workflow/status/zaydiscold/hydra/release.yml?branch=master&label=release&style=flat-square"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22.12-339933?style=flat-square&logo=node.js&logoColor=white">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-42-47848F?style=flat-square&logo=electron&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111">
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-SQLite-2D3748?style=flat-square&logo=prisma&logoColor=white">
  <a href="openapi/hydra-api.openapi.json"><img alt="OpenAPI" src="https://img.shields.io/badge/OpenAPI-3.1-6BA539?style=flat-square&logo=openapiinitiative&logoColor=white"></a>
</p>

Hydra is a packaged Electron app for running an OpenRouter account fleet from one local machine. It combines encrypted local storage, account/session management, key provisioning, promo-code workflows, live traffic visibility, a scriptable CLI, and an OpenAI-compatible `/v1` proxy that can stay running as an API router.

It is designed for operators who want a native control plane without shipping account secrets to a hosted service.

## Navigation

- [Highlights](#highlights)
- [Install](#install)
- [Quick Start From Source](#quick-start-from-source)
- [Desktop App](#desktop-app)
- [CLI](#cli)
- [Local API Router](#local-api-router)
- [Operator Hardening](#operator-hardening)
- [Development And Release Gates](#development-and-release-gates)
- [Screenshots And Remotion](#screenshots-and-remotion)

## Highlights

- **Native desktop control plane**: Electron shell with an embedded Express API, tray/menu lifecycle, platform-native user data paths, and packaged runtime resources.
- **OpenAI-compatible local router**: `/v1/models` and `/v1/chat/completions` proxy traffic through the managed OpenRouter key pool.
- **Long-running API behavior**: bounded proxy concurrency, buffered request-log writes, log rotation, request-log retention, upstream health checks, and graceful shutdown paths.
- **Fleet account operations**: add accounts, track session health, provision management keys, sync balances, and inspect account readiness.
- **Key pool management**: rotate across pooled keys, cool down rate-limited keys, disable unhealthy keys, and expose a single local Hydra proxy key.
- **Account proxy pool**: optional encrypted account-task proxy list for browser-backed signup, key, and code flows.
- **Promo-code workflows**: preflight readiness, redeem against selected accounts, and keep redemption history.
- **Local-first security**: local vault password, encrypted secrets, owner-only data directories, redacted CLI output, and loopback-first network binding.
- **Scriptable operator CLI**: JSON-friendly commands for automation, diagnostics, imports/exports, fleet scans, and router lifecycle control.
- **Release-oriented quality gates**: linting, Electron packaging checks, API integration tests, UI static contracts, OpenAPI coverage, Docker smoke checks, and Windows path compatibility checks.

## Install

Use the packaged release artifact for your platform:

| Platform | Artifact | Notes |
| --- | --- | --- |
| macOS | `Hydra.app` / zip | Boots the embedded server and native desktop window. |
| Windows | `Hydra Setup.exe` | Uses `%APPDATA%\\Hydra\\` for app data. |
| Linux | `Hydra.AppImage` | Uses `~/.config/Hydra/` for app data. |

On first launch, Hydra creates an encrypted local vault and an empty SQLite database in the platform user-data directory. Closing the app window does not have to kill the router; quit from the tray/menu when you want the server fully stopped.

## Quick Start From Source

```bash
git clone https://github.com/zaydiscold/hydra.git
cd hydra
cp .env.example .env
npm install
npm run dev:electron
```

Build a desktop artifact:

```bash
npm run electron:build
```

Run the quality gate:

```bash
npm run lint
npm test
npm run gate
```

## Desktop App

The desktop app is the primary operator surface. It starts the embedded API server, stores secrets in the local vault, exposes tray/menu lifecycle controls, and keeps app data in the platform user-data directory instead of the source checkout.

Settings includes local security controls, router settings, biometric status when available, and the encrypted account proxy pool. The proxy pool accepts one proxy per line in `ip:port:user:pass` format. Empty pools are valid; account tasks continue without proxies when no saved proxy is available.

## CLI

Hydra ships a local `hydra` binary for operator scripts. Link it during development:

```bash
npm link
hydra help
```

Common commands are grouped by operator workflow:

| Workflow | Commands |
| --- | --- |
| Status and diagnostics | `hydra status`, `hydra doctor --json`, `hydra logs --lines 100` |
| Fleet and accounts | `hydra accounts --json`, `hydra account <id-prefix>`, `hydra balance`, `hydra scan --json` |
| Keys and codes | `hydra keys --account <id-prefix>`, `hydra codes preflight <code> --all` |
| Router lifecycle | `hydra proxy status`, `hydra serve --port 3001`, `HYDRA_TOKEN=<token> hydra stop --port 3001` |
| OpenRouter helpers | `hydra openrouter models --json`, `hydra ai chat "hello" --route proxy` |
| Agent tools | `hydra mcp`, `hydra mcp --list-tools`, `hydra api-map --json` |
| Vault automation | `hydra unlock --stdin --token-only` |

The CLI defaults to redacted human output and supports `--json` on the commands meant for automation. Secret-bearing flows require explicit flags such as `--yes`, `--stdin`, or an environment token so shell scripts do not accidentally burn codes, rotate proxy keys, or expose credentials.

`hydra mcp` starts a private local stdio MCP server for Claude Code, Cursor, and other agent clients. It exposes curated fleet tools over the existing CLI contracts: status, proxy status, API map, release audit, and doctor diagnostics. It does not publish Hydra, register public endpoint tools, or bypass confirmation-gated live writes.

## Local API Router

Hydra exposes OpenAI-compatible endpoints on the local server:

```bash
curl http://127.0.0.1:3001/v1/models \
  -H "Authorization: Bearer sk-hydra-..."

curl http://127.0.0.1:3001/v1/chat/completions \
  -H "Authorization: Bearer sk-hydra-..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{ "role": "user", "content": "ping" }]
  }'
```

The tracked API contract lives at [`openapi/hydra-api.openapi.json`](openapi/hydra-api.openapi.json).

## Operator Hardening

Hydra is meant to sit open and take repeated local requests. The server includes guardrails for unattended use:

- Bounded `/v1` in-flight request cap via `HYDRA_PROXY_MAX_IN_FLIGHT`.
- Buffered request-log writes via `HYDRA_REQUEST_LOG_QUEUE_MAX`, `HYDRA_REQUEST_LOG_FLUSH_MS`, and `HYDRA_REQUEST_LOG_FLUSH_BATCH`.
- Bounded shutdown drain via `HYDRA_REQUEST_LOG_SHUTDOWN_DRAIN_MS`.
- Request-log retention via `HYDRA_REQUEST_LOG_KEEP_DAYS` and `HYDRA_REQUEST_LOG_KEEP_COUNT`.
- Rotating file logs via `HYDRA_LOG_MAX_SIZE` and `HYDRA_LOG_MAX_FILES`.
- Background health, retention, refresher, and task timers that do not pin idle Node processes.
- Loopback-first server binding and authenticated shutdown.

Local security controls are intentionally boring and explicit: vault-backed secrets, owner-only data directories, redacted CLI output, optional biometric unlock status in Settings, and encrypted account proxy storage. The README avoids embedding real account data, full API keys, or live secrets.

## Development And Release Gates

Use these scripts when changing the app locally:

```bash
npm run dev:electron        # Electron development loop
npm run server              # Standalone Express server
npm run build               # Vite renderer build
```

Use these gates before treating a change as release-ready:

```bash
npm run electron:prepare    # Prepare packaged server/runtime resources
npm run electron:smoke      # Smoke-test packaged Electron artifact
npm run docker:smoke        # Docker runtime contract check
npm run openapi:hydra       # Regenerate tracked OpenAPI map
```

## Star History

<a href="https://www.star-history.com/#zaydiscold/hydra&Date">
  <img alt="Hydra star history" src="https://api.star-history.com/svg?repos=zaydiscold/hydra&type=Date" />
</a>

## Screenshots And Remotion

Release media should be refreshed from the packaged Electron app. Browser-target screenshots are not release-quality evidence for the desktop UI.

## Screenshot Plan

The old tracked dashboard screenshots are intentionally not embedded here because they predate the newer streamlined dashboard/pie-chart UI. The release-quality capture pass should refresh media from the packaged Electron app, not from a browser target, then embed the new assets near the top of this README:

1. **Vault setup**: first-run password/vault screen with no real secrets visible.
2. **Dashboard**: account fleet overview with balances, health, and status cards redacted or seeded.
3. **Pool**: proxy key pool and router status view showing local base URL and pooled-key health.
4. **Traffic**: request-log/traffic panel showing bounded router activity and latency/status rows.
5. **CLI**: terminal capture for `hydra status`, `hydra doctor --json`, and `hydra proxy status`.

## Remotion Plan

The repo already has a Remotion showreel path under `videos/`. Keep it short and product-facing:

1. Use the refreshed Electron screenshots as Remotion image assets.
2. Create a 20-30 second composition: vault setup, dashboard, proxy pool, traffic, CLI automation, local API router.
3. Render one still frame first with `npx remotion still <composition-id> --scale=0.25 --frame=30`.
4. Render the final MP4/GIF preview and reference it from this README once the artifact size is GitHub-friendly.
