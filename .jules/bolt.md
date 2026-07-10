## 2026-06-08 - [Avoid Re-Querying Static DB Data if Cache Exists]
**Learning:** In applications using frequent polling (like a live traffic dashboard), direct database queries for static or slow-changing data (like model catalogs/prices) can cause unnecessary DB load. The application already maintained an in-memory cache for models `getCachedPoolModels()`, but `getTraffic` was directly querying the DB using `prisma.cachedModel.findMany` instead of utilizing the cache.
**Action:** Always check if a caching layer or service already exists for lookup/reference data before writing direct database queries, especially on high-frequency endpoints.

## 2026-07-10 - [Batch DB Queries in Loops]
**Learning:** Found an N+1 query pattern in `PoolController.js` inside `getPoolData`. The application was making an explicit database query per account in a loop to fetch `localKeys`.
**Action:** When working with dashboard endpoints that loop through multiple related records (like accounts), always extract the related DB lookups (like keys) into a single batched query using Prisma (`where: { account: { userId } }`), then index the results into an in-memory `Map` by the parent ID to avoid database bottlenecks during high scale.
