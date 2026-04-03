# CLIProxyAPI, gateways, and Hydra — synthesis

This document records the architecture decision, parallel exploration findings (Hydra baseline, CLIProxyAPI ideas, alternatives), and optional **sidecar** runbook. It does **not** change Hydra’s runtime behavior.

## Architecture decision (2026-04-02)

| Option | Verdict |
|--------|---------|
| **Hydra-only (default)** | **Keep.** The built-in `/v1` proxy ([`server/routes/proxy.js`](../server/routes/proxy.js)), rotation ([`server/services/rotation-manager.js`](../server/services/rotation-manager.js)), and vault remain the source of truth for **OpenRouter API key pooling** and fleet UI. |
| **CLIProxyAPI sidecar** | **Optional complement.** Use when you need **OAuth-backed CLI flows** (Codex, Claude Code, Gemini CLI, etc.) that Hydra does not implement. Run as a **second process** on a **different port**; do not treat it as a drop-in replacement for Hydra’s vault or management APIs. |
| **LiteLLM (or similar Python gateway)** | **Defer unless required.** Adopt only if you explicitly want **Python ops**, richer **cross-provider** catalog/spend features, and accept a separate stack. Could theoretically sit **in front of** Hydra’s `/v1` as an upstream client—not planned by default. |

**Rationale:** Hydra and [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) solve overlapping but distinct problems: Hydra is an **OpenRouter fleet manager** (keys, balances, redemption, encrypted local store); CLIProxyAPI is a **Go multi-protocol CLI proxy** with strong **OAuth** and **YAML-driven** `openai-compatibility` providers. There is **no shared dependency** in this repo today.

---

## Hydra baseline (proxy + rotation)

**Contract**

- `Authorization: Bearer sk-hydra-...` (derived master key); not JWT.
- Forwards to `{OR_BASE}/api/v1` + path/query; preserves method; JSON bodies.
- Streaming: pipes upstream body; cancels on client disconnect.
- `GET /v1/models`: `CachedModel` → live OpenRouter → static list; `X-Hydra-Models-Source`.
- Up to **3** upstream attempts; **429** → 60s cooldown, **402** → 10m cooldown, **401** → evict key from pool; optional **5xx** model swap for certain id patterns.
- **30s** upstream timeout; logs to `RequestLog`.

**Rotation**

- Pool from DB via `getPooledKeys`; **weighted random** by `limitRemaining` with round-robin fallback (file header still says “round-robin”—implementation is weighted).

**Gaps vs “ideal” gateway (backlog ideas, not commitments)**

- Single shared master key; no per-client API keys.
- Fixed retry count / no backoff; hard 30s timeout.
- Streaming logs lack full usage aggregation at stream end.
- Process-local rotation state (not multi-instance safe without redesign).
- Docs could spell out cooldown durations and 402→503 mapping explicitly.

---

## CLIProxyAPI — ideas Hydra could borrow

| Idea | Hydra angle | Effort | Risk |
|------|-------------|--------|------|
| Versioned **management API** namespace (`/v0/management`-style) | Separate operator automation from dashboard JWT routes | Medium | Low–medium |
| **Hot reload** / watcher pattern for pool rules or flags | Event queue to refresh rotation vs full reload | Medium–high | Medium |
| **Usage aggregates** + export/import | Complement `RequestLog` with operator-facing totals | Medium | Low (document semantics) |
| **Log tail API** (`after=timestamp` polling) | Dashboard / local tools without SSH | Low–medium | Low |
| **Model aliases / mapping** | Reduce client churn when OpenRouter renames models | Medium | Medium |
| **PATCH-by-index/match** for key entries | Script-friendly pool updates | Low–medium | Low |
| **Management hardening** (lockout, hashed secrets) | If non-JWT management is added | Low | Low |
| **Runtime debug toggle** | Ops without restart | Low | Low |

**Poor fit:** Go embed SDK, OAuth-first product surface, YAML as SSOT (Hydra uses Prisma + encrypted vault), full multi-backend translation (Amp, Gemini native, etc.).

**OpenRouter in CLIProxyAPI:** Configured under `openai-compatibility`: `base-url` `https://openrouter.ai/api/v1`, `api-key-entries` with keys (and optional `models` aliases). See [Management API](https://help.router-for.me/management/api.html) and upstream README.

---

## Alternatives scan (LiteLLM, etc.)

| | LiteLLM | Hydra built-in `/v1` | CLIProxyAPI sidecar |
|---|---------|----------------------|---------------------|
| Runtime | Python | Node | Go |
| Wins when | Unified catalog, spend tracking, heavy routing | Tight OR pool + dashboard + one binary | Minimal binary, OAuth CLIs |
| Integration | Extra service; could call Hydra `/v1` upstream | Default | Second port; parallel to Hydra |

**Rule of thumb:** LiteLLM for **observability + multi-provider** out of the box; CLIProxyAPI for **CLI OAuth**; stay on Hydra’s proxy when **minimal moving parts** and **OR-specific** behavior matter most.

---

## Optional sidecar: ports and URLs

| Service | Default base | Notes |
|---------|--------------|--------|
| **Hydra** (this app) | `http://localhost:3001` | OpenAI-compatible proxy: `http://localhost:3001/v1` with `sk-hydra-...` |
| **CLIProxyAPI** (Homebrew / binary) | Often **`http://127.0.0.1:8317`** | Confirm with your `config.yaml` `port` field; Docker examples use `8317:8317` |

Point **OpenAI-compatible clients** at **one** endpoint per request path:

- **Pooled OpenRouter keys + Hydra rotation** → Hydra `3001/v1`.
- **CLIProxyAPI features (OAuth providers, Amp routes, etc.)** → CLIProxyAPI’s port (e.g. `8317`).

Avoid double-proxying the same traffic unless you have a clear chain (e.g. experimental LiteLLM → Hydra `/v1`).

### Example: OpenRouter block in CLIProxyAPI `config.yaml`

Use upstream docs as source of truth; illustrative shape:

```yaml
# Excerpt only — see https://help.router-for.me/ and CLIProxyAPI releases for full schema
port: 8317
openai-compatibility:
  - name: openrouter
    base-url: https://openrouter.ai/api/v1
    api-key-entries:
      - api-key: "sk-or-v1-..."   # or multiple entries for rotation-style setups
    # optional:
    # models:
    #   - name: anthropic/claude-3.5-sonnet
    #     alias: claude-sonnet-latest
```

Hydra users typically **do not** duplicate the full key pool here; use this when you want **CLIProxyAPI-managed** OpenRouter keys **separate** from Hydra’s pool.

### macOS install (Homebrew)

```bash
brew install cliproxyapi
brew services start cliproxyapi   # optional daemon
```

Default config path with `brew services` is under `$(brew --prefix)/etc/cliproxyapi.conf`. To use `~/.cli-proxy-api/config.yaml`, see [Quick Start](https://help.router-for.me/introduction/quick-start.html).

---

## Multi-agent exploration (method)

Findings above were produced by **parallel subagent passes**: (1) Hydra codebase audit, (2) CLIProxyAPI / Management API research, (3) LiteLLM vs sidecar vs custom proxy comparison. This file is the **merged synthesis** and **ordered backlog** input for future work—no automatic code changes.

---

## Related docs

- [`SERVER_ARCHITECTURE.md`](SERVER_ARCHITECTURE.md) — middleware and `/v1` proxy placement
- [`API_REFERENCE.md`](API_REFERENCE.md) — proxy routes and headers
- [`ARCHITECTURE_DEEP_DIVE.md`](ARCHITECTURE_DEEP_DIVE.md) — proxy flow sequence
