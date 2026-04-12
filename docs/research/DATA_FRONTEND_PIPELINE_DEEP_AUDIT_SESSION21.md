# DATA LAYER + FRONTEND PIPELINE — Deep Audit (Session 21)

> End-to-end analysis: Prisma schema → service layer → API controllers → React state → DOM rendering.
> Date: 2026-04-09 | Hydra v0.0.0 | React 19.2.4 | Prisma 6.19.2 | SQLite | Vite 5.4.21

---

## 1. Prisma Optimization

### 1.1 Missing Indexes — CRITICAL

**Account.userId has no @@index.** Every single query in `store.js` filters by `{ userId }` or `{ id, userId }`. Prisma creates an implicit index for `@relation` fields on some databases, but SQLite is not guaranteed. This is the #1 most-queried column.

- `server/services/store.js:166` — `assertAccountUniqueForUser`: `findMany({ where: { userId } })`
- `server/services/store.js:229` — `getAccounts`: `findMany({ where: { userId } })`
- `server/services/store.js:270` — `getAllAccountsWithKeys`: `findMany({ where: { userId } })`
- All `findFirst({ where: { id, userId } })` calls (18 occurrences)

**Action:** Add `@@index([userId])` to the Account model in `schema.prisma`.

**Key.accountId has no @@index.** Every key lookup joins through account. The `getPooledKeys`, `getLocalKeys`, and `syncKeysFromOpenRouter` functions query by `accountId`.

- `server/services/store.js:609` — `getPooledKeys`: `findMany({ where: { isPooled: true, disabled: false, account: { userId } } })`
- `server/services/store.js:627` — `getLocalKeys`: `findMany({ where: { accountId, account: { userId } } })`

**Action:** Add `@@index([accountId])` and `@@index([accountId, isPooled, disabled])` to the Key model.

**Key.isPooled + Key.disabled — no composite index.** The pool query (`getPooledKeys`) filters on all three: `isPooled=true, disabled=false, account.userId`. A covering index would make this a single index scan.

**Action:** Add `@@index([isPooled, disabled])` to Key model.

### 1.2 N+1 Encryption in Uniqueness Check — CRITICAL

`server/services/store.js:161-190` — `assertAccountUniqueForUser` fetches ALL accounts for a user, then **decrypts each account's config** in a loop to check email uniqueness:

```js
const existing = await prisma.account.findMany({ where: { userId } });
for (const account of existing) {
  let config;
  try { config = readConfig(account); } // AES-256-GCM decrypt + JSON.parse
  catch { continue; }
  // check alias (plaintext column) and email (encrypted in config)
}
```

With 30 accounts, this triggers 30 AES-256-GCM decryptions just to check if an email already exists. The alias check uses the plaintext `account.alias` column (good), but the email check requires full config decryption.

**Action — Denormalize email to Account row:** Add `email String?` to the Account model. Set it at account creation/update time. This makes uniqueness checks a single indexed DB query with zero decryption. The encrypted config retains the canonical copy; the column is a denormalized cache.

### 1.3 Sequential Upsert Loop

`server/services/store.js:684-711` — `syncKeysFromOpenRouter` iterates with `for (const keyRecord of liveKeys)` and does individual `prisma.key.upsert()` per key. With 10 keys per account, that's 10 sequential DB round-trips.

**Action:** Use `prisma.$transaction([...upserts])` to batch all upserts in a single transaction, or use `createMany` with `onConflict: 'update'` (Prisma 6+ supports `skipDuplicates`).

### 1.4 No SQLite PRAGMA Tuning

`server/services/db.js:1-4` — Bare PrismaClient instantiation with zero PRAGMA configuration:

```js
export const prisma = new PrismaClient();
```

SQLite defaults:
- `journal_mode = delete` (not WAL — causes exclusive locks on writes)
- `synchronous = FULL` (safest but slowest — fsync on every commit)
- `cache_size = -2000` (2MB page cache — tiny for read-heavy dashboards)
- `temp_store = DEFAULT` (may use disk for temp tables)

**Action:** Add a `prisma.$executeRawUnsafe` block after instantiation:

```js
await prisma.$executeRawUnsafe(`PRAGMA journal_mode=WAL`);      // Concurrent reads during writes
await prisma.$executeRawUnsafe(`PRAGMA synchronous=NORMAL`);     // Safe with WAL, much faster
await prisma.$executeRawUnsafe(`PRAGMA cache_size=-64000`);      // 64MB cache (local app, not shared)
await prisma.$executeRawUnsafe(`PRAGMA temp_store=MEMORY`);      // In-memory temp tables
await prisma.$executeRawUnsafe(`PRAGMA busy_timeout=5000`);      // Wait up to 5s for locked DB
```

This is a local single-user app — WAL mode is safe and the #1 performance win for SQLite.

### 1.5 Missing @@unique on Key.hash per Account

`schema.prisma:39-56` — Key uses `hash` as `@id`, which guarantees global uniqueness. But the relation `accountId` has no `@@unique([hash, accountId])` — technically a hash could be moved between accounts without constraint. Low risk but worth noting.

---

## 2. React 19 Specific Tricks

### 2.1 `useOptimistic` for Pool Toggle — HIGH VALUE

`src/pages/PoolManager.jsx:321-325` — `handleBulkToggle` sets `bulkLoading=true`, awaits the API call, then sets `bulkLoading=false`. The checkbox toggles but the UI waits for the server response.

With `useOptimistic`, the checkbox would flip instantly and revert only on error:

```jsx
const [optimisticPooled, addOptimisticPooled] = useOptimistic(
  currentPooled,
  (state, { hash, isPooled }) => ({ ...state, [hash]: isPooled })
);
```

**Applicable to:** Pool toggle checkbox (`PoolManager.jsx:148`), key enable/disable toggle (`PoolManager.jsx:285`), account bulk toggle.

### 2.2 `useTransition` for Dashboard Refresh — MEDIUM VALUE

`src/pages/Dashboard.jsx:462-477` — `fetchDashboard` with `silent=true` sets `refreshing=true`, blocks UI, then clears. A `useTransition` would keep the UI responsive during the async data merge:

```jsx
const [isPending, startTransition] = useTransition();
const handleRefresh = () => startTransition(() => fetchDashboard(true));
```

This prevents the stats grid and account cards from freezing during the 1-5s API round-trip.

### 2.3 `use()` Hook for Initial Data — LOW VALUE (no SSR)

React 19's `use()` hook reads from promises/context. Without SSR or Suspense streaming, the benefit is marginal. The current pattern (`useEffect` + `useState` + loading flag) works fine for a SPA. Would only add value if Hydra added server-side rendering or React Server Components.

### 2.4 React 19 Actions for Form Submission

`src/pages/Settings.jsx:26-38` — Password change form uses manual `handleSubmit` with loading state. React 19 Actions (`<form action={...}>`) could simplify this, but the benefit is cosmetic — the current pattern is already clean.

`src/pages/Dashboard.jsx:131-161` — AuthScreen form submission is already well-structured with error handling. Converting to an Action would not improve the UX significantly.

### 2.5 Suspense Boundaries — MEDIUM VALUE

Currently no `<Suspense>` boundaries exist anywhere in the app. Adding them around page-level lazy-loaded components would:
- Show skeleton loaders during code splitting loads
- Isolate slow data fetches (e.g., PoolManager with 10+ API calls)

```jsx
<Suspense fallback={<PageSkeleton />}>
  <Route path="/pool" element={<PoolManager />} />
</Suspense>
```

But this requires `React.lazy()` imports first (see section 8).

---

## 3. Data Flow Analysis — Dashboard Refresh

### 3.1 Full Trace: DB → DOM

```
1. React: fetchDashboard() called (Dashboard.jsx:462)
2. API: GET /api/dashboard (api.js:169)
3. Controller: DashboardController.getDashboard (DashboardController.js:49)
4. Service: store.getAllAccountsWithKeys(userId) — DB query + decrypt ALL configs + sessionTokens
5. Service: store.getAccounts(userId) — DB query + decrypt ALL configs + sessionTokens AGAIN
6. Controller: For each account, check sessionStatus → if expiring/expired/unknown, attempt clerkAuth.refreshSession()
7. Controller: If sessions refreshed, call store.getAccounts() AGAIN (3rd full decrypt cycle)
8. Controller: For each account, check snapshotCache (30s TTL) → if miss, call openrouter.getAccountSnapshot()
9. Service: openrouter.getAccountSnapshot — 2 API calls per account (getCredits + listKeys)
10. Controller: For each account, call store.getStoredSessionStatusPayload — DB query + decrypt + live Clerk probe
11. Controller: JSON.serialize({ accounts, totals, liveStatuses }) → HTTP response
12. React: setData(res.data) — triggers full re-render of stats grid + all AccountCards
13. React: If server didn't include liveStatuses, client-side probeAll() fires (Dashboard.jsx:498-529)
14. DOM: Re-render of all AccountCard components with new data
```

### 3.2 Serialization Bottlenecks

**Double-decryption is the #1 bottleneck.** Steps 4-5 decrypt every account config twice. With 30 accounts:
- Step 4: 30 × `decryptConfig()` + 30 × `decrypt(sessionToken)` = 60 AES-256-GCM operations
- Step 5: 30 × `decryptConfig()` + 30 × `decrypt(sessionToken)` = 60 AES-256-GCM operations
- Step 7 (if refresh): 30 × `decryptConfig()` + 30 × `decrypt(sessionToken)` = 60 more operations
- Step 10: 30 × `decryptConfig()` + 30 × `decrypt(sessionToken)` = 60 more operations

**Worst case: 240 AES-256-GCM operations per dashboard load.** Even the happy path is 120.

**Action:** Merge steps 4-5 into a single call. `getAllAccountsWithKeys` already returns everything `getAccounts` returns and more. The `metaById` map in `DashboardController.js:60-62` is redundant with the data already available from step 4.

### 3.3 Could We Use Binary/Compact Formats?

JSON is fine for this use case. The response payloads are small (a few KB per account). Binary formats (MessagePack, CBOR) would save ~20% bandwidth but add a parsing dependency and the savings are negligible on localhost. Not worth the complexity.

**The real bottleneck is not serialization — it's decryption volume and API call count.**

---

## 4. Modern State Management

### 4.1 Current Pattern: useState + useCallback Chains

Every page uses the same pattern:
- `useState(null)` for data
- `useState(true)` for loading
- `useState(false)` for refreshing
- `useCallback` for fetch functions
- `useEffect` for initial load
- `useRef` for `didInitialLoadRef` guards

This repeats verbatim across:
- `Dashboard.jsx:449-483` (data, loading, refreshing, didInitialLoadRef)
- `AccountDetail.jsx:153-253` (snapshot, accountMeta, loading, loadError, initialFetchDone)
- `Vault.jsx:59-132` (accounts, liveStatuses, loading, probing)
- `PoolManager.jsx` (poolData, loading, etc.)
- `Settings.jsx:5-24` (lanUrls, loading, etc.)

### 4.2 Stale Closure Risks

`Dashboard.jsx:462-477` — `fetchDashboard` depends on `addToast`. If `addToast` identity changes (it won't — it's stable via useCallback with `[]` deps), the effect re-fires. But the pattern is fragile: any new dependency added to `fetchDashboard` would trigger the `useEffect` again.

`Vault.jsx:161-172` — `commitEdit` captures `editModal` in closure. If `editModal` changes between render and execution, stale data could be committed. Currently safe because the modal is dismissed before the async call, but it's a latent bug.

### 4.3 TanStack Query Would Eliminate These Patterns

Every fetch/loading/error state could be replaced with:

```jsx
const { data, isLoading, refetch } = useQuery({
  queryKey: ['dashboard'],
  queryFn: () => api.getDashboard().then(r => r.data),
  staleTime: 30_000,     // match server snapshotCache TTL
  refetchInterval: 300_000, // 5min auto-refresh
});
```

Benefits:
- Automatic cache deduplication (Dashboard and Vault both call `getDashboard` — TQ shares the result)
- Built-in stale-while-revalidate (instant UI from cache, background refresh)
- No `didInitialLoadRef` guards
- No manual `loading`/`refreshing` state
- Automatic error handling with retry

**Without adding deps:** React Context + `useReducer` could centralize the toast system and auth state (already partially done). But for data fetching, there's no stdlib equivalent — the current pattern is the best zero-dep option.

### 4.4 Props Drilling

`addToast` is passed through 4 levels: `App → Dashboard → AccountCard` (via closure). A ToastContext would eliminate this. Currently not painful (only 2-3 levels deep), but would scale poorly if component tree grows.

---

## 5. Caching Strategy

### 5.1 Cache Inventory

| Cache | Location | TTL | Invalidated By |
|-------|----------|-----|----------------|
| `snapshotCache` | DashboardController.js:12 | 30s | Per-account on key/balance update |
| `_sessionStatusCache` | store.js:11 | 5min | Per-account on session status probe |
| `rotationManager.pool` | rotation-manager.js:19 | Until `reload()` | Pool toggle, key registration, key drop |
| `CachedModel` (DB) | model-cache.js | Until refresh | Manual "Refresh Models" button |
| React component state | Dashboard.jsx, Vault.jsx | Until unmount | N/A — re-fetched on mount |
| `responseBodyCache` | dashboard-api.js:78 | Request-scoped | GC via WeakMap |

### 5.2 Redundant Caches

**Dashboard + Vault both call `getDashboard()` independently.** If the user navigates from Dashboard to Vault, Vault re-fetches the exact same data. With TanStack Query (or a shared React Context), this would be a single cache hit.

**`_sessionStatusCache` in store.js duplicates the work of `liveStatuses` in React state.** The server populates `_sessionStatusCache` during dashboard load, returns `liveStatuses` in the response, and the client stores it in React state. The server cache serves subsequent `getSessionStatus` calls (e.g., from AccountDetail), which is useful. Not truly redundant — just duplicated in two layers.

### 5.3 Cache Invalidation Bugs

**`snapshotCache` is only invalidated per-account (`invalidateSnapshotCache(accountId)`), but there's no global invalidation on account addition/deletion.** Adding a new account should clear all cached snapshots since the totals need recalculation. Currently, `handleAccountAdded` calls `fetchDashboard(true)` which bypasses cache (since the cache is per-account and the new account has no cache entry). This works accidentally — the new account gets a fresh snapshot, and existing cached snapshots are still valid. But if an account is **deleted**, its cached snapshot still exists in memory (harmless but wasteful).

**`snapshotCache` entries for errored accounts are never cached** (DashboardController.js:178: "Don't cache errors"). This means errored accounts trigger a full API call every 30s. If OpenRouter is down, every dashboard refresh hammers the dead API. Consider caching errors with a shorter TTL (5s) to provide backoff.

---

## 6. Encryption Performance

### 6.1 The Core Problem

AES-256-GCM decryption is invoked per-account for every operation. The hot paths:

| Function | Decryptions per call | Called by |
|----------|---------------------|-----------|
| `getAccounts()` | N × (decryptConfig + decrypt sessionToken) | Dashboard (step 5) |
| `getAllAccountsWithKeys()` | N × (decryptConfig + decrypt sessionToken) | Dashboard (step 4), Pool |
| `assertAccountUniqueForUser()` | N × decryptConfig | Account creation/update |
| `getStoredSessionStatusPayload()` | 1 × (decryptConfig + decrypt sessionToken) | Dashboard (step 10), per-account |

For 30 accounts on a dashboard load: **120-240 AES-256-GCM operations** (see section 3.2).

### 6.2 In-Memory Decrypted Config Cache

**Proposal:** Cache decrypted configs in a process-level Map with TTL:

```js
const _configCache = new Map(); // accountId → { config, expiresAt }
const CONFIG_CACHE_TTL_MS = 60_000; // 1 minute

function readConfigCached(account) {
  const cached = _configCache.get(account.id);
  if (cached && Date.now() < cached.expiresAt && cached.configVersion === account.updatedAt) {
    return cached.config;
  }
  const config = readConfig(account); // decrypt
  _configCache.set(account.id, { config, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS, configVersion: account.updatedAt });
  return config;
}
```

**Security tradeoff:** Decrypted configs (containing management keys, passwords, session cookies) live in process memory for 60s. This is already the case during request processing — the cache just extends the lifetime. Risk: memory dump during TTL window reveals secrets. Mitigation: short TTL, process isolation (local app only).

**Performance gain:** Eliminates ~80% of decryption operations on repeated dashboard loads within 60s. With 30 accounts, drops from 120-240 to 0-60 decryptions.

### 6.3 Denormalization to Avoid Decryption

The most frequently accessed fields from encrypted config are:
- `email` (uniqueness check, UI display)
- `authMethod` (UI badge)
- `managementKey` (snapshot/provision calls)
- `sessionExpiry` (session status heuristic)

Move `email` and `authMethod` to plaintext Account columns (like `lastKnownBalance` was moved in P15/P23). This eliminates the need for `getAccounts()` to decrypt configs at all — it can read straight from indexed columns.

`managementKey` must stay encrypted (it's the crown jewel). But it's only needed when making API calls, not for listing.

---

## 7. Classic DB Tricks

### 7.1 Denormalization for Read-Heavy Paths

**Pool status on Account row.** Currently, pool status requires joining Account → Key and filtering by `isPooled`. Add a denormalized `poolKeyCount Int @default(0)` to Account. Update it when keys are toggled. This makes "accounts with pooled keys" a simple column read.

**Balance on Account row (already done — P15/P23).** `lastKnownBalance`, `totalCredits`, `lastKnownBalanceAt` exist. Good.

**Email and auth method on Account row (proposed above).** Same pattern as balance denormalization.

### 7.2 Covering Indexes

For the pool query in `getPooledKeys`:
```sql
SELECT * FROM Key WHERE isPooled = 1 AND disabled = 0 AND accountId IN (...)
```

A covering index: `@@index([isPooled, disabled, accountId])` would satisfy this query entirely from the index without touching the data pages.

### 7.3 Partial Indexes for Common WHERE Clauses

SQLite supports partial indexes via `WHERE` clause. Common queries:

```sql
CREATE INDEX idx_key_pooled_active ON Key(accountId, hash) WHERE isPooled = 1 AND disabled = 0;
CREATE INDEX idx_account_needs_refresh ON Account(userId) WHERE lastKnownBalanceAt IS NULL;
```

Prisma doesn't natively support partial indexes, but they can be added via `prisma.$executeRawUnsafe` in a migration.

### 7.4 SQLite PRAGMA Tuning

See section 1.4 for the full PRAGMA block. Summary of expected gains:

| PRAGMA | Default | Proposed | Expected Gain |
|--------|---------|----------|---------------|
| `journal_mode` | delete | WAL | Concurrent reads during writes; ~2x write throughput |
| `synchronous` | FULL | NORMAL | Safe with WAL; ~3-5x write throughput |
| `cache_size` | -2000 (2MB) | -64000 (64MB) | Hot pages stay in RAM; ~10x fewer disk reads |
| `temp_store` | DEFAULT | MEMORY | In-memory sorting for ORDER BY / GROUP BY |
| `busy_timeout` | 0 | 5000 | No "database is locked" errors under load |

---

## 8. Build Optimization

### 8.1 No Lazy Loading — ALL Pages Eagerly Loaded

`src/App.jsx:6-14` — Every page component is statically imported:

```jsx
import Dashboard from './pages/Dashboard.jsx';
import AccountDetail from './pages/AccountDetail.jsx';
import Vault from './pages/Vault.jsx';
import CodeRedemption from './pages/CodeRedemption.jsx';
import Generator from './pages/Generator.jsx';
import Settings from './pages/Settings.jsx';
import PoolManager from './pages/PoolManager.jsx';
import Traffic from './pages/Traffic.jsx';
import BulkAuthWizard from './pages/BulkAuthWizard.jsx';
```

**Action:** Convert to `React.lazy()` + `Suspense`:

```jsx
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Vault = lazy(() => import('./pages/Vault.jsx'));
// ... etc
```

This would split the 390KB bundle into per-route chunks. Dashboard (~80KB) loads immediately; Generator, Traffic, etc. load on demand.

### 8.2 Bundle Size Analysis

Current production build (`dist/assets/`):
- `index-CN0BWZwE.js` — **390,563 bytes** (~381KB, ~120KB gzipped estimate)
- `index-ADMfOMOj.css` — **43,914 bytes** (~44KB)

**Largest contributors (estimated):**
- React + React DOM: ~130KB
- react-router-dom: ~30KB
- playwright (server-only, should not be in client bundle — verify)
- react-window + react-virtualized-auto-sizer: ~15KB (imported but **NOT USED** in Dashboard — see note)

**react-window is in dependencies but unused.** `Dashboard.jsx` renders all account cards in a simple `.accounts-grid` div with no virtualization. With 30+ accounts, this renders 30+ `AccountCard` components (each with IntersectionObserver). react-window would help at 100+ accounts but adds bundle weight for nothing currently.

**Action:** If not using virtualization, remove `react-window` and `react-virtualized-auto-sizer` from dependencies.

### 8.3 Source Maps in Production

`vite.config.js` — No `build.sourcemap` option. Default is `false`. This is fine for production (no source maps = smaller build + no source exposure). Consider `sourcemap: 'hidden'` for error tracking without exposing source.

### 8.4 Tree-Shaking Effectiveness

Vite uses Rollup for production builds. Tree-shaking is effective for:
- Named imports from `api.js` (only used functions are included)
- Icon components (only imported icons are bundled)

Potential issue: `dashboard-api.js` is 3200+ lines and includes Playwright imports. If any client-side code accidentally imports from it, the entire Playwright library would be bundled. **Verify that `dashboard-api.js` is server-only and never imported by client code.**

### 8.5 Vite Config — Missing Optimizations

```js
// Current vite.config.js — bare minimum
export default defineConfig({
  plugins: [react()],
  base: './',
  define: { ... },
  server: { ... },
})
```

**Missing:**
- `build.rollupOptions.output.manualChunks` — Split react, react-dom, react-router into a vendor chunk
- `build.cssCodeSplit: true` — Already default, but verify
- `build.target: 'es2020'` — Modern browsers only (smaller output)
- `build.minify: 'terser'` with `terserOptions.compress.drop_console: true` — Strip console.logs in prod

---

## 9. WebSocket / SSE for Real-Time Updates

### 9.1 Current Polling Behavior

| Page | Poll Interval | What's Polled |
|------|---------------|---------------|
| Dashboard | 5 min (Dashboard.jsx:548-552) | `getDashboard()` + `getPoolSyncStatus()` |
| Vault | 10 min (Vault.jsx:135-140) | `getDashboard()` |
| PoolManager | No auto-refresh | Manual only |

### 9.2 SSE vs WebSocket

For Hydra's use case (single local user, server push only), **Server-Sent Events (SSE)** is the better choice:
- Simpler protocol (HTTP-based, no upgrade handshake)
- Auto-reconnect built in
- Unidirectional (server → client) — Hydra doesn't need client→server streaming
- Works through proxies and CORS without special configuration

### 9.3 Events That Benefit from Real-Time Delivery

1. **429/402 cooldown events** — Currently, the cooldown map is only refreshed on the next poll. With SSE, the client would instantly see a key enter cooldown and display the [LOCKED Xm] badge.

2. **Pool rotation events** — When `rotationManager.reload()` is called (key added/removed), push an event so all connected tabs update instantly.

3. **Session expiry alerts** — When a session transitions from 'active' to 'expiring', push immediately instead of waiting for the next 5-min poll.

4. **Provisioning completion** — The Playwright provisioning flow takes 10-60s. Currently the frontend polls. SSE would push a "provision complete" event.

### 9.4 Implementation Sketch

```js
// Server: server/routes/events.js
router.get('/api/events', auth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  eventBus.on('pool:cooldown', (d) => send('cooldown', d));
  eventBus.on('session:status', (d) => send('session', d));
  req.on('close', () => eventBus.off(...));
});

// Client: src/hooks/useSSE.js
export function useHydraEvents() {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => setEvents(prev => [...prev, JSON.parse(e.data)]);
    return () => es.close();
  }, []);
  return events;
}
```

**Effort:** ~2-3 hours for a basic SSE channel. Would eliminate most polling and give instant UI updates for cooldown/expiry events.

---

## 10. Error Boundary Patterns

### 10.1 Current State — Single Global Boundary

`src/App.jsx:466` — One `ErrorBoundary` wraps the entire authenticated app:

```jsx
<ErrorBoundary>
  {/* sidebar + main content + routes */}
</ErrorBoundary>
```

`src/components/ErrorBoundary.jsx` — Class component that catches any render error and shows a full-screen "SYSTEM COLLAPSE" screen. There is **no recovery** — the user must reload.

### 10.2 Problems with Single Boundary

1. **A crash in any page kills the entire app.** If PoolManager throws during render, the sidebar, navigation, and all other pages become inaccessible until reload.

2. **No per-account isolation.** If a single AccountCard throws (e.g., malformed data), the entire accounts grid disappears. Currently, `AccountCard` catches errors per-card in Dashboard (the card shows an error state), but this is handled by the `try/catch` in DashboardController, not by a React Error Boundary.

3. **No reset mechanism.** Once `hasError = true`, the boundary never recovers. There's no `resetErrorBoundary` callback or retry mechanism.

### 10.3 Recommended: Per-Page + Per-Card Boundaries

```jsx
// Per-page boundary — catches page-level errors, shows page-specific fallback
<ErrorBoundary fallback={<PageError onRetry={() => resetKey++}} resetKey={resetKey}>
  <Routes>
    <Route path="/pool" element={<PoolManager />} />
    <Route path="/settings" element={<Settings />} />
  </Routes>
</ErrorBoundary>

// Per-card boundary — isolates account card failures
<ErrorBoundary fallback={<CardError alias={account.alias} />}>
  <AccountCard account={account} />
</ErrorBoundary>
```

### 10.4 Server-Side Error Isolation — Already Good

`DashboardController.js:162-179` — Individual account snapshot failures are caught per-account and return an `errorResult` object instead of throwing. This means one account's API failure doesn't prevent other accounts from rendering.

`store.js:272-286` — `getAllAccountsWithKeys` uses `flatMap` with try/catch per account. Corrupt accounts are auto-purged and skipped. Good defensive pattern.

**The server is more resilient than the client.** The client's single ErrorBoundary is the weakest link.

---

## Appendix A: Priority Action Matrix

| # | Finding | Impact | Effort | Priority |
|---|---------|--------|--------|----------|
| 1 | Add `@@index([userId])` to Account | High | 5 min | P0 |
| 2 | Add `@@index([accountId, isPooled, disabled])` to Key | High | 5 min | P0 |
| 3 | SQLite PRAGMA tuning (WAL, cache_size, etc.) | High | 30 min | P0 |
| 4 | Eliminate double-decryption in DashboardController | High | 1 hr | P0 |
| 5 | Denormalize email/authMethod to Account columns | High | 2 hr | P1 |
| 6 | In-memory decrypted config cache (60s TTL) | Medium | 1 hr | P1 |
| 7 | Lazy-load page components (React.lazy) | Medium | 30 min | P1 |
| 8 | SSE for real-time cooldown/expiry events | Medium | 3 hr | P2 |
| 9 | Per-page Error Boundaries | Medium | 1 hr | P2 |
| 10 | `useOptimistic` for pool toggles | Low | 1 hr | P2 |
| 11 | TanStack Query for data fetching | Medium | 4 hr | P3 |
| 12 | Batch `syncKeysFromOpenRouter` upserts | Low | 30 min | P3 |
| 13 | Remove unused react-window dependency | Low | 5 min | P3 |

---

## Appendix B: File Reference Map

| File | Lines | Role |
|------|-------|------|
| `prisma/schema.prisma` | 104 | Database schema |
| `server/services/db.js` | 4 | Prisma client init |
| `server/services/store.js` | 733 | Data access + encryption layer |
| `server/services/storage-codec.js` | 57 | AES-256-GCM encrypt/decrypt |
| `server/services/dashboard-api.js` | 3236 | Playwright + tRPC provisioning |
| `server/services/rotation-manager.js` | 290 | In-memory key pool + circuit breaker |
| `server/services/model-cache.js` | 78 | OpenRouter model list cache |
| `server/services/redemption-log.js` | 54 | File-based redemption history |
| `server/services/logger.js` | 31 | Winston logger |
| `server/config.js` | 111 | Zod-validated env config |
| `server/controllers/DashboardController.js` | 231 | Dashboard API endpoint |
| `server/controllers/PoolController.js` | 446 | Pool management endpoint |
| `src/App.jsx` | 590 | Root React component + routing |
| `src/api.js` | 289 | API client with auth |
| `src/pages/Dashboard.jsx` | 779 | Main dashboard page |
| `src/pages/AccountDetail.jsx` | 828 | Account detail page |
| `src/pages/Vault.jsx` | 533 | Account vault table |
| `src/pages/PoolManager.jsx` | 1099 | Key pool management |
| `src/pages/Settings.jsx` | 130 | Settings page |
| `src/components/ErrorBoundary.jsx` | 72 | Global error boundary |
| `vite.config.js` | 22 | Build configuration |
