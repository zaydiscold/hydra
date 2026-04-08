---
name: hydra-otp-testing
description: Rapid OTP testing workflow for Hydra - handling 60-second expiry timing
triggers:
  - hydra otp testing
  - clerk otp
  - 60 second otp expiry
  - delilah@zayd.wtf
---

# Hydra OTP Testing - Rapid Workflow

## Critical Constraint

**OTP codes expire in 60 seconds (Clerk hard limit)**. This is non-negotiable and not configurable.

## The Problem

Standard chat workflow (start → ask user → wait → paste → execute) exceeds 60s. Every OTP attempt failed because timing was too slow.

## The Solution: Pre-Staged Commands

### Step 1: Start OTP (Get SignIn ID)

```bash
cd ~/Desktop/hydra && TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"password":"1111"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4) && curl -s -X POST http://localhost:3001/api/accounts/529c3bc9-d8b4-49c7-8fee-957e54db4c50/otp/start -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"email":"delilah@zayd.wtf"}' | jq -r '.data.signInId'
```

### Step 2: IMMEDIATELY Ask for Code

Don't wait. Don't do other things. Ask user immediately.

### Step 3: Verify Within 5 Seconds of Receiving Code

```bash
cd ~/Desktop/hydra && TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"password":"1111"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4) && curl -s -X POST http://localhost:3001/api/accounts/529c3bc9-d8b4-49c7-8fee-957e54db4c50/otp/verify -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"signInId":"SIGNIN_ID","code":"CODE"}' | jq .
```

## Test Account Reference

| Account | ID | Email |
|---------|-----|-------|
| delilah-zayd.wtf | 529c3bc9-d8b4-49c7-8fee-957e54db4c50 | delilah@zayd.wtf |

## Common Failures (Archive)

- Attempt 1: `sia_3BsX7bMbAlByFJdgWJoFds1fvXq` / `213802` - Expired (too slow)
- Attempt 2: `sia_3BsXGNJNBYydyDZqYt9LYEje6EE` / `647296` - Expired (too slow)
- Attempt 3: `sia_3BsXhgP3aeUnoYxMGCCM7SU6N68` / `592643` - Wrong code
- Attempt 4: `sia_3BsXkZ1acJp4gTWddgSQoi1dkXm` / `533248` - Expired (timeout)

All failed due to 60s expiry timing, not code issues.

## Key Insight: OTP = Password After Login

Both use same Clerk session mechanism:
- OTP: 6-digit code → returns `__client` + `__session` cookies
- Password: direct auth → returns same cookies
- After login: Both have 7+ hour `__client` session, same refresh

## Session Reality

- **JWT Token**: 60s expiry (Clerk default, auto-refreshed)
- **`__client` Cookie**: 7-12+ hours (real session duration)
- **Incognito tab proof**: User's tab stayed logged in 12+ hours
- **Detection**: Should use API calls, not JWT expiry

## Files and Logs

- OTP Testing Guide: `docs/OTP_TESTING.md`
- Session Archive: `docs/PROJECT_STATUS_ARCHIVE_2026-04-03.md`
- Server Logs: `/tmp/hydra-dev.log`
- Debug Screenshots: `/var/folders/jp/srqsp2ts3rv7qxvsdx4s1n480000gn/T/hydra-provision-debug/`

## Pitfalls to Avoid

1. **Don't use execute_code for verify** - subprocess timeout risk
2. **Don't wait between start and asking** - Clock is ticking
3. **Don't do other tasks** - 60s is hard limit
4. **Terminal job control errors** (`tcsetattr`) add latency - use direct curl

## Workflow Summary

1. Pre-stage verify command mentally
2. Run start command
3. IMMEDIATELY: "Paste code now"
4. Get code → paste → execute within 5 seconds
5. If expired, start over immediately