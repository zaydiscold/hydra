# Security Policy

Hydra handles local vault credentials, OpenRouter API keys, session cookies,
management keys, proxy credentials, and account metadata. Treat logs, database
copies, screenshots, traces, exports, and diagnostic output as potentially
sensitive even when they appear partially redacted.

## Supported Versions

Security fixes are applied to the latest release and the current `master`
branch. Older releases may not receive backports.

## Reporting a Vulnerability

Do not disclose suspected vulnerabilities, credentials, session material, or
private account data in a public issue or pull request.

Use GitHub's private vulnerability reporting flow from the repository's
**Security** tab. If private reporting is unavailable, contact the repository
owner through GitHub without including exploit details or sensitive material in
public text, and request a private reporting channel.

A useful report includes:

- affected Hydra version or commit
- operating system and architecture
- affected surface, such as Electron, local API, CLI, updater, storage, or Docker
- reproduction steps using synthetic or redacted data
- expected and observed behavior
- security impact and any known prerequisites
- relevant logs with tokens, cookies, keys, emails, account IDs, and local paths removed

## Sensitive Diagnostic Data

Before attaching any artifact, remove at minimum:

- API keys and management keys
- session JWTs, Clerk cookies, and browser storage
- account emails, aliases, UUIDs, and proxy credentials
- vault files, SQLite databases, `.env` files, and `local-secrets.json`
- private filesystem paths and screenshots containing account data

Never commit live diagnostic dumps to the repository. One-off account repair or
credential inspection scripts should remain outside the public source tree.

## Scope

Security reports should concern Hydra itself or its documented packaging and
runtime paths. Upstream OpenRouter or Clerk behavior should be reported to the
relevant upstream provider unless Hydra exposes, stores, or handles that
behavior unsafely.
