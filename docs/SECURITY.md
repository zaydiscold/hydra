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
- **Session Tokens** — Upon login, the server issues a signed **JWT (JSON Web Token)**.
- **CSRF Protection** — All state-changing requests require a valid JWT in the `Authorization` header.

## 🏮 Privacy Principles

1. **No External Sync** — Hydra does not have a "cloud sync" feature. Your data stays in the local `prisma/dev.db`.
2. **Encrypted Buffer** — When keys are rotated or redeemed, the raw tokens only exist in application memory for the duration of the request.
3. **Auditability** — All proxy requests are logged locally in `RequestLog`, allowing you to audit your fleet's traffic from the "Traffic" page.

---

> [!CAUTION]
> **Backup your `.env` and `prisma/` folder.**
> Because Hydra is local-first, the developer or user is responsible for data redundancy. If your machine's filesystem is corrupted and you don't have backups, your OpenRouter fleet management data is gone.
