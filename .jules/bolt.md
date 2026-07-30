## 2026-06-08 - [Avoid Re-Querying Static DB Data if Cache Exists]
**Learning:** In applications using frequent polling (like a live traffic dashboard), direct database queries for static or slow-changing data (like model catalogs/prices) can cause unnecessary DB load. The application already maintained an in-memory cache for models `getCachedPoolModels()`, but `getTraffic` was directly querying the DB using `prisma.cachedModel.findMany` instead of utilizing the cache.
**Action:** Always check if a caching layer or service already exists for lookup/reference data before writing direct database queries, especially on high-frequency endpoints.
## 2026-07-20 - [Prisma Distinct requires matching OrderBy on PostgreSQL]
**Learning:** When using `distinct` combined with `orderBy` in Prisma, PostgreSQL translates this into a `DISTINCT ON` SQL clause. This strictly requires that the distinct field(s) be the first argument(s) in the `orderBy` array.
**Action:** Always prepend the `distinct` column(s) to the `orderBy` array when using Prisma deduplication to avoid fatal runtime errors in PostgreSQL environments.
## 2026-08-01 - [Avoid N+1 queries when calling db functions within an async map loop]
**Learning:** Calling database find functions (`getLocalKeys` via `prisma.findMany`) inside `Promise.allSettled(array.map(async ...))` loops leads to unnecessary DB connections and latency bottlenecks (N+1 query problem).
**Action:** Always fetch the target relations in a single database batch query outside the loop using grouped identifiers (e.g., `userId`), then structure the result into a Map mapped by standard identifier (e.g. `accountId`) to enable O(1) lookups during the main iterations.
