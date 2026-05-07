# 🛡️ Security Architecture

Hydra is designed with a **"local-first, local-only"** security philosophy. This means your sensitive credentials (OpenRouter session tokens, API keys, and account configs) never leave your machine except when sent directly to the official OpenRouter API.

## 🔐 Encryption Strategy

Hydra uses **AES-256-GCM** (Galois/Counter Mode), a state-of-the-art symmetric encryption algorithm that provides both confidentiality and authenticity.

### The Algorithm

- **AES-256** — A military-grade industry standard for encryption.
- **GCM** — Provides authenticated encryption, ensuring that if any bit of the encrypted data is tampered with, decryption will fail.
- **IV (Initialization Vector)** — A unique 16-byte random IV is generated for *every single* encrypted block, ensuring that the same piece of data encrypted twice results in different ciphertexts.

### Data at Rest

Sensitive fields in the Prisma SQLite database (`sessionToken`, `config`, and `key`) are stored as Base64-encoded strings containing:
`[16-byte IV] + [16-byte Auth Tag] + [Encrypted Data]`

## 🗝️ Secret Management

### Storage Encryption Key

The master key used for AES-256-GCM is managed by `server/services/local-secrets.js`.

- During development, this key is derived from the `JWT_SECRET` in `.env`.
- In production, it is typically a long-lived machine-specific secret generated on the first run.

- **IMPORTANT**: If the `JWT_SECRET` or the machine secret is lost, all encrypted account data becomes unrecoverable.

### User Authentication

- **Password Hashing** — User passwords are hashed using **bcrypt** (with a high-cost factor of 12 by default).
- **Session Tokens** — Upon login, the server issues a signed **JWT (JSON Web Token)** with a default 24-hour lifetime. In Electron, the renderer also stores the token through the native bridge in `userData/renderer-auth-token.json` with an explicit `expiresAt`, so random packaged localhost ports do not force a fresh password login on every launch.
- **CSRF Protection** — Normal state-changing requests require a valid JWT in the `Authorization` header. The destructive recovery reset is the exception: `POST /api/auth/nuke` is public so a locked-out operator can recover, but it requires the current local password and `confirm: "NUKE_HYDRA"`.

Hydra is designed as a single-user local tool. Password policy is intentionally
minimal compared with a shared SaaS system, because the stronger boundary is
local machine access plus encrypted local storage. Do not expose the Express
server to an untrusted network without adding a stricter deployment security
review.

Administrative reset uses `nukeSystem()` in `server/services/auth.js` to wipe
local vault data and mark the app as restart-required. Treat it as a destructive
local recovery tool, not a normal runtime flow.

## 🏮 Privacy Principles

1. **No External Sync** — Hydra does not have a "cloud sync" feature. Your data stays in the local SQLite database under your platform's `userData` directory (`~/Library/Application Support/Hydra/` on macOS, `%APPDATA%\Hydra\` on Windows, `~/.config/Hydra/` on Linux).
2. **Encrypted Buffer** — When keys are rotated or redeemed, the raw tokens only exist in application memory for the duration of the request.
3. **Auditability** — All proxy requests are logged locally in `RequestLog`, allowing you to audit your fleet's traffic from the "Traffic" page.
4. **Loopback-only listener** — In packaged builds the embedded Express server binds to `127.0.0.1` only. The randomized port is never exposed beyond the local machine.

## 🔓 Touch ID / Biometric Unlock

**Default behavior (macOS):** biometric unlock is off until the user enables it in **Settings → Touch ID Unlock**. Earlier builds auto-enabled Touch ID on first launch, but that made a dismissed system prompt look like a broken persisted session. Hydra now keeps the 24-hour password unlock token persistence independent from biometric opt-in.

**How it works:** when biometric unlock is enabled, the renderer asks main process for the persisted auth token (so you don't retype your password). Main process gates that read on a Touch ID prompt (`systemPreferences.promptTouchID('Unlock Hydra')`). Approve → token released → renderer auto-unlocks. Cancel / wrong finger / sensor unavailable → typed error (`BIOMETRIC_CANCELLED` / `BIOMETRIC_UNAVAILABLE` / `BIOMETRIC_FAILED`) → renderer falls back to the password screen. **Touch ID never replaces the password** — it gates a token that already exists, the same way 1Password and Apple Keychain do.

**No external native dependency.** Hydra uses Electron's built-in `systemPreferences` API directly, so there's no `node-mac-auth` / `keytar` rebuild step. Stored auth tokens live in `userData/renderer-auth-token.json` at mode `0600`.

**Threat model:** anyone with both physical access to your unlocked Mac AND a fingerprint enrolled on it can unlock Hydra without your password — same boundary as every keychain-backed app on the platform. An attacker with disk-only access (no fingerprint) gains nothing — the gate is on the Touch ID prompt, not on file decryption.

**Platform support today:**
| Platform | Status |
|----------|--------|
| macOS (Touch ID) | ✅ Supported, opt-in from Settings |
| Windows (Hello) | 📅 Stubbed — see `docs/IDEAS.md` |
| Linux | ❌ Not supported (no first-party biometric API) |

Disable any time at **Settings → Touch ID Unlock → uncheck "Require Touch ID when unlocking the vault"**.

## 📡 Optional Crash Telemetry (Sentry)

Settings → "Send anonymized crash reports to Hydra" is **off by default**. When enabled (and `HYDRA_SENTRY_DSN` is configured), Sentry's main-process integration reports unhandled exceptions and renderer crashes. Before any event leaves the device:

- The full event JSON is regex-scrubbed for `sk-or-…`, `sk-hydra-…`, `__session=`, `__client(_uat)?=`, and `Bearer …` tokens — replaced with `[REDACTED]`.
- The user's home-directory prefix is rewritten to `<HOME>/…`.
- `tracesSampleRate` is `0` (no performance traces) and `sendDefaultPii: false` (no user/IP attachment).
- `Net` and `ChildProcess` integrations are stripped to prevent request body / spawn argument capture.

Disabling the toggle takes effect on next launch (the SDK is initialized once at boot). The native crash reporter (`crashReporter.start`) is also gated on the same toggle.

---

> [!CAUTION]
> **Backup your `.env` and `prisma/` folder.**
> Because Hydra is local-first, the developer or user is responsible for data redundancy. If your machine's filesystem is corrupted and you don't have backups, your OpenRouter fleet management data is gone.
