# Support Bundle

The support bundle feature collects diagnostic information for troubleshooting Hydra issues. It is designed to be safe to share — it never includes secrets, encrypted credentials, or database contents.

## What's Included

| Category | Details |
|----------|---------|
| **Version info** | Hydra app version (from `VITE_APP_VERSION` or Electron native) |
| **OS info** | Platform string (from Electron native or `navigator.platform`) |
| **Data directory** | `userData` path (Electron-only) |
| **Logs directory** | Electron logs path (path only, not log contents) |
| **Runtime mode** | Packaged (Electron), Dev (Electron), or Browser |
| **Proxy status** | Enabled or Disabled |
| **Server health** | Uptime, pool key counts (pooled, available) |
| **Timestamp** | ISO 8601 generation time |

## What's NOT Included

- ❌ Database contents (`hydra.db`)
- ❌ Encrypted credentials or secrets (`local-secrets.json`)
- ❌ API keys, management keys, session tokens
- ❌ Account data, balance information
- ❌ JWT secrets, encryption keys
- ❌ Application log file contents
- ❌ Environment variables
- ❌ Electron/Node.js version details

## How to Generate

1. Open Hydra
2. Navigate to **Diagnostics**
3. Click **"Support Bundle"**
4. The bundle is copied to your clipboard as structured text. Paste it into a support ticket, GitHub issue, or DM.

## Manual Access

If the app won't start and you can't reach the Diagnostics panel, you can find the same information manually:

### Logs

- **macOS:** `~/Library/Logs/Hydra/main.log`
- **Windows:** `%APPDATA%/Hydra/logs/main.log`
- **Linux:** `~/.config/hydra/logs/main.log`
- **Dev mode:** console output (Winston, console-only)

### Data Directory

The `HYDRA_DATA_DIR` env var (set by Electron to `app.getPath('userData')`):

- **macOS:** `~/Library/Application Support/Hydra/`
- **Windows:** `%APPDATA%/Hydra/`
- **Linux:** `~/.config/hydra/`

Contains `hydra.db`, `local-secrets.json`, and other runtime data. **Do not share the contents of this directory** — it contains encrypted credentials.

### Packaged Resources

`process.resourcesPath` (in packaged app) contains:

- `prisma/schema.prisma` — database schema
- `prisma/migrations/` — migration history
- `data/empty-hydra.db` — shipped empty database
- `chromium.zip` — bundled Playwright Chromium archive; runtime extracts it to the app data directory on first Playwright use

## Troubleshooting with the Bundle

Common checks when reviewing a support bundle:

1. **Version mismatch** — compare Hydra version against known-good releases
2. **Port conflicts** — verify no other process is bound to the port
3. **Missing resources** — confirm `prisma/schema.prisma`, `chromium.zip`, and `data/empty-hydra.db` exist in resources
4. **Permission errors** — check that the user can read/write the data directory
5. **Disk space** — ensure sufficient free space in the data directory volume
