# Hydra Session Management & Provisioning Test Plan

## Phase 1: Session Health Check Loop
- [ ] Check all 3 accounts (iam-zayd, delilah-zayd, zayd-zayd)
- [ ] Identify expired sessions
- [ ] Auto-refresh via Clerk `/v1/client` endpoint
- [ ] Verify sessions work with HTTP 200 test
- [ ] Save refreshed sessions encrypted

## Phase 2: Playwright Provisioning Test
- [ ] Test account 1: Provision key via Playwright
- [ ] Test account 2: Provision key via Playwright
- [ ] Test account 3: Provision key via Playwright
- [ ] Record success/failure for each

## Phase 3: Request-Based Alternative Research
- [ ] Analyze OpenRouter API endpoints
- [ ] Try tRPC with proper batch format
- [ ] Try GraphQL if exposed
- [ ] Reverse-engineer from Playwright network logs
- [ ] Document findings

## Current Status:
- Playwright: ✅ Working (proven with iam-zayd)
- Session refresh: ✅ Working (Clerk gives fresh JWT)
- Request-based: ❌ All return HTML (React SPA)
- Cost: $0 (local browser)
