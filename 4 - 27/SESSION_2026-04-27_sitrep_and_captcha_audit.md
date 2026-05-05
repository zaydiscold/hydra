# Session 2026-04-27 — Sitrep + Captcha Fallback Audit

**Date:** 2026-04-27 (Monday, 13:06 PDT)
**Branch:** `master`
**Working tree:** clean except untracked `docs/SITREP_2026-04-24.md`
**User intent:** Read-only audit. Verify Playwright fallback is still wired in case the HTTP-primary signup path gets blocked. Don't change anything. Document this session for the consolidated `4 - 27/` folder.

---

## TL;DR

- The HTTP-primary signup migration **shipped** on 2026-04-23 (commit `d275102`), merged to master 2026-04-24 (`9d7697d`).
- A follow-up commit `159d182` was added 2026-04-24 to handle a CAPTCHA-gated signup edge case.
- **Playwright fallback IS still fully wired and now actively handles new-account signup**, not just network-failure backup.
- Nothing in this session changed code. Only documentation written.

---

## Where the prior session left off (2026-04-21)

The previous Claude Code session (Opus, session 23) finished:

| Action | File | Persisted? |
|---|---|---|
| Removed `--with-deps` from playwright install | `Dockerfile` | ✅ committed in `d275102` |
| Verified Docker build success (`hydra:http-test` tagged) | (build artifact) | ✅ |
| Deleted stale `Dockerfile.bak` | (deletion) | ✅ |
| Added "session 23" entry under P2 → Kill Playwright | `~/.claude/plans/hydra_plan.md` | ✅ |
| Flipped status 🟡 → 🟢 in migration plan | `~/.claude/plans/hydra_http_migration.md` | ✅ (later updated to merged) |

The session ended with deferred items: dev smoke test + commit. User said "we don't care about a PR, finish this another time."

---

## What happened between 2026-04-21 and today

Git log timeline:

```
9d7697d  merge: feat/http-signup-migration               2026-04-24
159d182  fix(generator): Handle captcha-gated signup fallback   2026-04-24
d275102  feat: complete HTTP signup migration — slim Dockerfile, otp-generator dead-code fixes, docs   2026-04-23
```

1. **2026-04-23:** A follow-up agent committed all three modified files as `d275102`. My Dockerfile fix from session 23 landed unchanged.
2. **2026-04-24 (early):** Merged to master via `9d7697d`.
3. **2026-04-24 (01:59 PDT):** A prod-smoke-test caught a CAPTCHA edge case. Fix shipped same day as `159d182`. **This is the change I had not seen before this session.**

---

## The CAPTCHA fix (commit `159d182`) — what it actually does

**Problem found:** OpenRouter's Clerk instance enabled CAPTCHA on `POST /client/sign_ups` (the "create new account" endpoint) sometime after the migration shipped. The HTTP path can call `detectAuthMethod` and `startEmailOTP` fine for *existing accounts*, but `sign_ups/.../prepare_email_address_verification` now fails the CAPTCHA challenge when called from a server.

**The fix:** Surgical. Existing-account flows still go pure HTTP. Brand-new accounts route to Playwright after `detectAuthMethod` returns `isSignUp:true`.

**Code shape now (`server/services/account-generator.js` lines 364–409):**

```javascript
async function launchSignupFlow(task) {
  const promise = (async () => {
    try {
      taskSupervisor.updateTask(task.taskId, { status: 'detecting_account' });

      let authInfo;
      try {
        authInfo = await detectAuthMethod(task.metadata.email);
      } catch (fapiErr) {
        // (1) Network failure: fall back to browser
        logger.warn(`[Account Generator] FAPI detectAuthMethod failed for ${task.metadata.email}: ${fapiErr.message} — falling back to browser`);
        taskSupervisor.updateTask(task.taskId, { status: 'falling_back_to_browser' });
        return launchSignupFlowPlaywright(task);
      }

      // (2) NEW BRAND-NEW ACCOUNT BRANCH: Clerk requires CAPTCHA for /sign_ups
      if (authInfo?.isSignUp) {
        logger.warn(`[Account Generator] Clerk reported sign-up for ${task.metadata.email}, but sign_up preparation is CAPTCHA-gated — falling back to browser`);
        taskSupervisor.updateTask(task.taskId, { status: 'falling_back_to_browser' });
        return launchSignupFlowPlaywright(task);
      }

      // Existing account — proceed with pure HTTP
      taskSupervisor.updateTask(task.taskId, { status: 'sending_otp' });
      let otpInfo;
      try {
        otpInfo = await startEmailOTP(task.metadata.email);
      } catch (fapiErr) {
        // (3) Network failure on OTP send: fall back to browser
        logger.warn(`[Account Generator] FAPI startEmailOTP failed for ${task.metadata.email}: ${fapiErr.message} — falling back to browser`);
        taskSupervisor.updateTask(task.taskId, { status: 'falling_back_to_browser' });
        return launchSignupFlowPlaywright(task);
      }

      taskSupervisor.attachResources(task.taskId, {
        signInId: otpInfo.signInId,
        clientCookie: otpInfo.clientCookie,
        isSignUp: otpInfo.isSignUp,
        httpMode: true,
      });

      taskSupervisor.updateTask(task.taskId, { status: 'awaiting_otp' });
      logger.info(`[Account Generator] OTP sent to ${task.metadata.email} via Clerk FAPI`);
    } catch (err) {
      logger.error(`[Account Generator] Launch failed: ${err.message}`);
      await taskSupervisor.fail(task.taskId, err);
    }
  })();
  return trackPromise(task, promise);
}
```

There are now **THREE Playwright fallback triggers** in `launchSignupFlow`:

| # | Trigger | Line | Why it matters |
|---|---|---|---|
| 1 | `detectAuthMethod` throws (network/FAPI down) | 372–376 | Original resilience case |
| 2 | **`authInfo.isSignUp === true`** (brand-new email) | 378–382 | NEW — covers the CAPTCHA wall |
| 3 | `startEmailOTP` throws | 388–392 | OTP-send-step network failure |

**Detection in `finalizeOtpSubmission`** (line 411–418) was made simpler and more permissive:

```javascript
async function finalizeOtpSubmission(task, otpCode) {
  const promise = (async () => {
    try {
      // HTTP tasks carry signInId/clientCookie in resources. Browser fallback
      // tasks carry page/context/browser and complete through Playwright.
      if (!task.resources?.httpMode) {
        return finalizeOtpSubmissionPlaywright(task, otpCode);
      }
      // ... HTTP path continues
```

Old check was `task.resources?.browser && !task.resources?.httpMode`. New check is just `!task.resources?.httpMode` — any task without explicit `httpMode:true` falls through to Playwright. This is correct because the new sign-up branch routes *immediately* to Playwright in `launchSignupFlow` and never reaches the line that sets `httpMode:true`.

---

## Verification: Playwright fallback IS intact ✅

`grep` of `account-generator.js` confirms all the moving pieces are still present:

```
Line 27:   import { chromium } from 'playwright';
Line 116:  async function launchSignupFlowPlaywright(task) { ...
Line 128:  const browser = await chromium.launch(...);
Line 236:  async function finalizeOtpSubmissionPlaywright(task, otpCode) { ...
Line 375:  return launchSignupFlowPlaywright(task);   // network failure
Line 381:  return launchSignupFlowPlaywright(task);   // CAPTCHA-gated isSignUp
Line 391:  return launchSignupFlowPlaywright(task);   // OTP-send failure
Line 417:  return finalizeOtpSubmissionPlaywright(task, otpCode);
```

**Conclusion:** Playwright fallback is not just preserved as dead code — it's the **active path for new account creation** because of the CAPTCHA wall. The HTTP path now serves a smaller (but still important) role: existing-account OTP login, session refresh, password auth.

---

## What changed in this session

I made **zero code changes**. Only file system actions:

1. Created folder `/Users/zaydk/Desktop/hydra/4 - 27/`
2. Wrote this file (`SESSION_2026-04-27_sitrep_and_captcha_audit.md`)

Everything else was read-only investigation:
- `git log --oneline -15` to see recent commits
- `git status --short` to confirm clean working tree
- `git show 159d182 --stat` and full diff to read the captcha fix
- `Read` of `account-generator.js` lines 355–445 to confirm fallback wiring
- `Grep` for `chromium`, `Playwright`, `httpMode`, `isSignUp`, `falling_back_to_browser` to verify all references

---

## Living plan documents (where context survives)

| Doc | Purpose | Last touched |
|---|---|---|
| `~/.claude/plans/hydra_http_migration.md` | Detailed migration plan + API signatures + state machine | 2026-04-24 (marked DONE/merged) |
| `~/.claude/plans/hydra_http_migration_session_log.md` | Chronological agent-handoff log | session 23 |
| `~/.claude/plans/hydra_plan.md` | Master Hydra plan with P0–P4 priorities; HTTP migration noted under P2 → Kill Playwright | session 23 |
| `docs/HTTP_SIGNUP_MIGRATION.md` | In-repo project doc, comprehensive | rewritten in `159d182` to reflect CAPTCHA reality |
| `docs/PROJECT_STATUS_APRIL_2026.md` | High-level project status, edited in `159d182` | 2026-04-24 |
| `docs/SITREP_2026-04-24.md` | Untracked sitrep someone wrote 04-24 — never committed | uncommitted |

---

## Open questions / loose threads (not addressed this session)

1. **Image size still ~3.66GB** (multi-arch manifest). Single-arch ~1.8GB. The original ~1.1GB target is unreachable while Playwright is bundled. Real wins require killing Playwright entirely, which the CAPTCHA fix has now made *harder* — Playwright is now load-bearing for new signups, not just a fallback.

2. **CAPTCHA stability:** If OpenRouter ever disables CAPTCHA on `/sign_ups` again, the HTTP path could be re-enabled by removing the `if (authInfo?.isSignUp) → fall back` branch. Worth monitoring.

3. **Untracked `docs/SITREP_2026-04-24.md`:** Someone wrote a sitrep three days ago and never committed it. Worth checking if it has notes that should land in a commit.

4. **`launchSignupFlowPlaywright` line 125 TODO references PAIN_POINTS.md #9** — Electron migration concern about Chromium binary, unrelated to CAPTCHA work.

---

## What the next agent should know

- **Don't try to remove the Playwright fallback yet.** It's the only path for new account signup until the CAPTCHA situation changes upstream.
- **HTTP path is still alive** for existing-account flows — sign-in, session refresh, password auth all use `clerk-auth.js` directly. Don't delete those.
- **`isSignUp` flag is still load-bearing** in `finalizeOtpSubmission` (line 466 — picks `'password'` vs `'otp'` for `authMethod` field). Even though new-account signup never reaches this line anymore (it routes to Playwright), the flag still flows through for the HTTP path.
- **The state machine has a new starting branch:** `detecting_account → falling_back_to_browser → launching_browser → ...` for any new email. The `sending_otp → awaiting_otp` HTTP states only fire for existing accounts.
