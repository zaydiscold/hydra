# Auth and cookie research backlog

This note preserves the useful research ideas from the April 8, 2026 draft
docs that were consolidated into the canonical documentation.

Canonical sources:

- `docs/ARCHITECTURE_DEEP_DIVE.md` for session, cookie, provisioning, and
  request-flow behavior.
- `docs/DASHBOARD_ACCOUNT_STATES.md` for dashboard session labels.
- `docs/MANAGEMENT_KEY_PROVISION_AUTOMATION.md` for provisioning operations.
- `docs/SERVER_ACTION_CAPTURE_REPLAY.md` for Next.js Server Action capture.
- `docs/SECURITY.md` for local auth and encryption.

## Verified notes

- **Management key capture:** Current code extracts full management-key material
  with the `sk-or-v1-*` pattern and verifies usefulness through OpenRouter. Do
  not rely on a distinct management-key prefix.
- **Provisioning order:** `createManagementKey` attempts Server Action replay
  first, then tRPC cached/candidate routes, then REST, then Playwright.
- **Session expiry:** `sessionExpiry` is a realistic Clerk session TTL. The
  short Clerk JWT expiry is not the session lifecycle source of truth.
- **Refresh warning window:** `SESSION_EXPIRING_SOON_MS` is 24 hours. Dashboard
  refresh and the background refresher use that window to extend sessions before
  they die.
- **Cookie roles:** `__session` is the short-lived proof token. `__client` and
  related Clerk device cookies are the refresh path. Cloudflare cookies can be
  parsed when observed, but the current Server Action path does not require
  persisted Cloudflare cookies.

## Backlog ideas

- **Server Action self-healing:** If the management-key or redeem action hash
  goes stale, fetch the page HTML, scan loaded JavaScript chunks for candidate
  hashes near the relevant route context, cache the match, and retry once.
- **JWT caching for bulk redeem:** Cache fresh Clerk JWTs briefly during a bulk
  redemption batch to avoid one Clerk `/v1/client` request per code.
- **Per-IP 429 handling:** Detect upstream 429s that look IP-wide rather than
  key-specific, then cool all pooled keys instead of only the key that hit the
  response.
- **Cookie stacking:** Investigate whether Clerk device cookies remain usable
  independently after re-authentication. If confirmed, design a bounded storage
  format for multiple device-cookie jars per account.
- **Vampire mode:** Test whether a low-risk dashboard mutation extends Clerk
  session lifetime. Do not automate this without proof and an audit trail.
- **tRPC replay:** Capture live browser tRPC requests and replay them with
  exact headers to understand when OpenRouter returns JSON vs the Next.js app
  shell.
- **Playwright CDP attach:** Keep `HYDRA_PLAYWRIGHT_CDP_ENDPOINT` as the
  operator path for using an existing Chrome session when bundled Chromium hits
  bot or auth friction.

## Archive note

The removed draft docs were useful as scratch notes but not kept as canonical
references because they duplicated existing docs and contradicted implementation
on session expiry, provisioning order, and key prefix behavior.
