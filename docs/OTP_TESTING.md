# OTP Testing Guide

## ⚠️ CRITICAL: OTP Codes Expire in 60 Seconds

**One-minute expiry means you MUST verify immediately.**

## Quick Reference

### Test Account
- **Alias**: delilah-zayd.wtf  
- **ID**: `529c3bc9-d8b4-49c7-8fee-957e54db4c50`
- **Email**: delilah@zayd.wtf
- **Method**: OTP

### Start OTP (Get SignIn ID)

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"password":"1111"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4) && curl -s -X POST http://localhost:3001/api/accounts/529c3bc9-d8b4-49c7-8fee-957e54db4c50/otp/start -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"email":"delilah@zayd.wtf"}' | jq -r '.data.signInId'
```

### Verify (USE IMMEDIATELY - CODE EXPIRES FAST)

Replace `SIGNIN_ID` and `CODE`:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"password":"1111"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4) && curl -s -X POST http://localhost:3001/api/accounts/529c3bc9-d8b4-49c7-8fee-957e54db4c50/otp/verify -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"signInId":"SIGNIN_ID","code":"CODE"}' | jq .
```

## What Went Wrong (Archive)

**2025-04-03 Session**: Multiple OTP failures due to:

1. **Slow workflows**: Multiple separate commands caused 60s expiry to pass
2. **Terminal issues**: `tcsetattr` job control errors added latency  
3. **No rapid script**: No single-command start+verify existed
4. **AFK delays**: User away from keyboard during critical 60s window

**Solution**: Pre-stage verify command, get code, paste immediately.

## Session vs JWT Expiry (What We Learned)

| Component | Duration | Notes |
|-----------|----------|-------|
| OTP Code | 60 seconds | Must verify immediately |
| JWT Token | 60 seconds | Auto-refreshed by Clerk |
| __client Cookie | 7+ hours | Real session duration |
| Incognito Tab | 12+ hours | User's actual experience |
| Hydra Login | Permanent | Password: 1111 |

**Key Fix Applied**: Session detection now uses actual API calls, not just JWT expiry.

## All Test Accounts

| Alias | ID | Email | Auth |
|-------|-----|-------|------|
| iam-zayd.wtf | cecff6a9-cbcc-4110-93ec-409299474b82 | - | password |
| delilah-zayd.wtf | 529c3bc9-d8b4-49c7-8fee-957e54db4c50 | delilah@zayd.wtf | otp |
| zayd-zayd.wtf | 09f8cc49-9308-4977-9f18-15d1a7e13216 | - | password |
| admin-zayd.world | 6f1d28e8-bc8d-4557-b589-66b6db341f8c | admin@zayd.world | password |
