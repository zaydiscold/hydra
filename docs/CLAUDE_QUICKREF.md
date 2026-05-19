# Hydra — Claude Agent Quick Reference

Project: `~/Desktop/hydra`
Local router: `localhost:3001`
Key format: `sk-hydra-*`

## Quick Commands

```bash
# Start dev
npm run dev

# Check sessions
node check-all-sessions.mjs

# OTP completion (when code arrives)
node complete-otp.js <alias> <code>

# Admin login password: 1111
```

## Accounts Reference

| Alias | ID | Email |
|-------|-----|-------|
| iam-zayd | cecff6a9-cbcc-4110-93ec-409299474b82 | iam@zayd.wtf |
| delilah-zayd | 529c3bc9-d8b4-49c7-8fee-957e54db4c50 | delilah@zayd.wtf |
| zayd-zayd | 09f8cc49-9308-4977-9f18-15d1a7e13216 | zayd@zayd.wtf |

## Key Technical Notes

### Cookie Handling for OpenRouter
- Required: `__cf_bm`, `_cfuvid` (Cloudflare)
- Session: `__session` (JWT, 60s expiry), `__client` (device, 7h expiry)
- Always get fresh JWT from `/client` before API calls

### Common Issues
1. **tRPC returns HTML** → Missing Cloudflare cookies or expired JWT
2. **Provisioning fails** → Try Playwright fallback (tRPC/REST often blocked)
3. **OTP expires** → 60 second window, must complete start+verify in one shot

### File Locations
- Session debug logs: `/tmp/hydra-dev.log`
- Provision screenshots: `/var/folders/.../hydra-provision-debug/`
- Complete OTP script: `complete-otp.js`
- Test automation: `complete-and-test.js`

## Full Documentation

- `AGENTS.md` — Project overview
- `ARCHITECTURE_DEEP_DIVE.md` — Mental model
- `SERVER_ARCHITECTURE.md` — Routes, controllers, middleware
- `API_REFERENCE.md` — Internal API contracts
- `hermes-skills-archive/` — Old Hermes skill dumps (legacy)

## When to Update Docs

Per `docs/AGENTS.md`: update relevant docs when changing:
- Server routes → `SERVER_ARCHITECTURE.md`
- API contracts → `API_REFERENCE.md`
- Architecture → `ARCHITECTURE_DEEP_DIVE.md`
- Proxy/rotation behavior → All three above
