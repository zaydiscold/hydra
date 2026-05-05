# Support Bundle

The support bundle feature collects diagnostic information for troubleshooting Hydra issues. It is designed to be safe to share — it never includes secrets, encrypted credentials, or database contents.

## What's Included

| Category | Details |
|----------|---------|
| **Version info** | Hydra app version, Electron version, Node.js version, platform/arch |
| **OS info** | OS type, release, hostname (sanitized) |
| **Logs** | Application logs from `~/Library/Logs/Hydra/main.log` (macOS) or equivalent |
| **Config** | Non-sensitive environment variables (`NODE_ENV`, `HYDRA_PORT`, feature flags) |
| **Resource paths** | `process.resourcesPath`, `userData` directory location |

## What's NOT Included

- ❌ Database contents (`hydra.db`)
- ❌ Encrypted credentials or secrets (`local-secrets.json`)
- ❌ API keys, management keys, session tokens
- ❌ Account data, balance information
- ❌ JWT secrets, encryption keys

## How to Generate

1. Open Hydra
2. Navigate to **Settings** → **Diagnostics**
3. Click **"Copy Support Bundle"**
4. The bundle is copied to your clipboard as structured text. Paste it into a support ticket, GitHub issue, or DM.

## Manual Access

If the app won't start and you can't reach the Diagnostics panel, you can find the same information manually:

### Logs

- **macOS:** `~/Library/Logs/Hydra/main.log`
- **Windows:** `%APPDATA%/hydra/logs/main.log`
- **Linux:** `~/.config/hydra/logs/main.log`
- **Dev mode:** console output (Winston, console-only)

### Data Directory

The `HYDRA_DATA_DIR` env var (set by Electron to `app.getPath('userData')`):

- **macOS:** `~/Library/Application Support/hydra/`
- **Windows:** `%APPDATA%/hydra/`
- **Linux:** `~/.config/hydra/`

Contains `hydra.db`, `local-secrets.json`, and other runtime data. **Do not share the contents of this directory** — it contains encrypted credentials.

### Packaged Resources

`process.resourcesPath` (in packaged app) contains:

- `prisma/schema.prisma` — database schema
- `prisma/migrations/` — migration history
- `data/empty-hydra.db` — shipped empty database
- `chromium/` — bundled Playwright Chromium

## Troubleshooting with the Bundle

Common checks when reviewing a support bundle:

1. **Version mismatch** — compare Hydra/Electron/Node versions against known-good releases
2. **Port conflicts** — verify no other process is bound to the port
3. **Missing resources** — confirm `prisma/schema.prisma`, `chromium/`, and `data/empty-hydra.db` exist in resources
4. **Permission errors** — check that the user can read/write the data directory
5. **Disk space** — ensure sufficient free space in the data directory volume
