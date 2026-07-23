## 2026-06-08 - [Avoid Re-Querying Static DB Data if Cache Exists]
**Learning:** In applications using frequent polling (like a live traffic dashboard), direct database queries for static or slow-changing data (like model catalogs/prices) can cause unnecessary DB load. The application already maintained an in-memory cache for models `getCachedPoolModels()`, but `getTraffic` was directly querying the DB using `prisma.cachedModel.findMany` instead of utilizing the cache.
**Action:** Always check if a caching layer or service already exists for lookup/reference data before writing direct database queries, especially on high-frequency endpoints.
## 2026-07-20 - [Prisma Distinct requires matching OrderBy on PostgreSQL]
**Learning:** When using `distinct` combined with `orderBy` in Prisma, PostgreSQL translates this into a `DISTINCT ON` SQL clause. This strictly requires that the distinct field(s) be the first argument(s) in the `orderBy` array.
**Action:** Always prepend the `distinct` column(s) to the `orderBy` array when using Prisma deduplication to avoid fatal runtime errors in PostgreSQL environments.
## 2026-07-23 - [Batch Query Inside Parallel Loop to Avoid N+1]
**Learning:** `Promise.allSettled(array.map(...))` or `Promise.all(array.map(...))` is commonly used to resolve promises in parallel. However, placing database queries like `store.getLocalKeys` inside this parallel mapping causes an N+1 query problem, placing unneeded load and connections on the database, which gets worse as the list of elements grows.
**Action:** Extract database lookups that occur inside parallel map blocks into a single batch query executed *before* the loop, then index the results with a `Map` or hash table for O(1) lookups inside the map loop.
