# Hydra — Session Kickoff Prompt

Paste this at the start of any new Claude session:

---

You're working on **Hydra** — a local OpenRouter proxy manager at `/Users/zaydk/Desktop/hydra`. The master plan is at `/Users/zaydk/.claude/plans/lively-bouncing-quilt.md` — read it first, it has the full history, architecture rules, open items, and exploits list.

**Mindset:** Be exploitative and curious. When touching auth/session/key management code, actively look for:
- tRPC/REST endpoints that return more data in session-auth context than management-key context (session = user's own browser, so OpenRouter may expose key plaintexts, transaction history, device tokens, etc. that the mgmt key API hides)
- Race condition windows in code redeem, session refresh, key creation
- Replay opportunities (can a Clerk `__client` cookie auth multiple accounts? Can a session JWT be reused after expiry in a grace window?)
- OpenRouter credit source differentiation (hackathon free credits vs purchased — separate fields?)
- Any response field or header that looks like internal state leaking out (build hashes, feature flags, A/B buckets, shadow endpoints)

**Critical ops:** No auto-reload — always `npm run dev` after backend changes. Server: localhost:3001, client: localhost:5173 (or 5174). Master bearer: `sk-hydra-c05b7d3626d0a62307863e0afd0a4c2e`.

**Stack:** Express 5 + Prisma/SQLite + React 19 + Vite. AES-256-GCM for all stored credentials. Clerk FAPI for session management.
