# Refactor Forward Plan (Post OTP/Wiring Sweep)

## Goals
- Eliminate remaining session/refresh contract drift across controllers, dashboard API, and UI surfaces.
- Reduce repeated cookie-stack pruning logic and make refresh behavior single-path.
- Make API response-shape handling explicit and testable (`{ data: ... }`, nested results where intended).

## Priority 1: Session Refresh Contract Unification
- Create a shared helper in server auth/session domain that:
  - accepts `session` + cookie stack,
  - calls Clerk refresh,
  - prunes dead cookies,
  - persists session + stack atomically,
  - returns a normalized result payload.
- Replace duplicated inline refresh+persist logic in:
  - `server/controllers/AccountController.js`
  - `server/controllers/DashboardController.js`
  - `server/services/dashboard-api.js`
  - `server/services/session-refresher.js`

## Priority 2: Cache & Concurrency Reliability
- Keep session-status cache invalidation centralized around all session writes (already improved; formalize with tests).
- Keep bounded concurrency for both dashboard snapshot collection and live-status probe pass.
- Keep refresher non-overlapping and lifecycle-safe (startup timer + interval ownership).

## Priority 3: Client Response Envelope Consistency
- Introduce tiny client-side normalizers for common envelope families (list, details, paged/results) in one place.
- Ban silent empty-success paths where payload shape is malformed.
- Add focused tests for bulk OTP queue build from `data.results` and malformed payload behavior.

## Priority 4: UI State/Gating Consistency
- Consolidate session/provision gating predicates into one shared frontend helper module used by:
  - Dashboard cards
  - Vault rows
  - Account Detail fallback states
  - Bulk OTP queue actions
- Ensure `unknown` always means “checking” (non-destructive UI state), not “force sign in”.

## Priority 5: Security/Storage Follow-up (Bigger Change)
- Evaluate migration away from `localStorage` token persistence to HttpOnly cookie/session-backed auth if architecture allows.
- If deferred, document XSS threat model and harden CSP + script trust boundaries.

## Test Additions (Next Pass)
- Integration tests for refresh endpoints asserting:
  - cookie-stack pruning persistence,
  - response envelope shape,
  - cache invalidation side effects.
- Dashboard integration test ensuring live-status pass is bounded and non-regressive for larger account sets.
- OTP flow integration test asserting verified/provisioned state transitions are explicit and not silently ambiguous.

## Priority 0 (Next Up): Measure Actual Clerk Session Lifetime
**Problem:** We're hardcoding `sessionExpiry = now + 7 days` at login, but empirical evidence shows sessions
drop in ~4 days. It's not confirmed to be *less* than 7 days either — the 4-day failures we've seen were
likely caused by cookie storage bugs (cookies not being written back after the first refresh) rather than
Clerk actually killing the session. Bottom line: **we are guessing the session TTL, not measuring it.**

**What we know:**
- An incognito tab stayed live for 6+ days (documented).
- Session drops after ~4 days on stored accounts correlate with cookie-write failures, not Clerk expiry.
- The `__client` device cookie backs the Clerk session; the JWT (`__session`) is just a short-lived proof (~2.5 min).

**Goal:** Build an isolated integration test that:
1. Logs in via one real OTP account (or fixture).
2. Stores the raw `__client` cookie value.
3. Polls `GET /v1/client` with that cookie every 6 hours in the background.
4. Records the exact timestamp when Clerk returns a non-active session.
5. Writes results to `docs/recon/SESSION_LIFETIME_RESULTS.md`.

**Implementation sketch:**
- `server/scripts/session-lifetime-probe.js` — standalone Node script (not wired into the server).
- Takes `--cookie <value>` and `--account-id <id>` as CLI args (or reads from a `.env` override).
- Uses `clerk-auth.refreshSession()` directly; does NOT touch Prisma or the running server.
- Logs output to `docs/recon/session_lifetime_probe.log`.
- Can be run in a background terminal: `node server/scripts/session-lifetime-probe.js --cookie "..." --interval 360`.

**Expected outcome:** Exact datapoint (e.g. "cookie expired at T+5d 14h") so we can stop guessing
and set a correct `sessionExpiry` TTL (or store `null` and rely entirely on the live probe result).
