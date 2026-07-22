## 2026-06-08 - [Avoid Re-Querying Static DB Data if Cache Exists]
**Learning:** In applications using frequent polling (like a live traffic dashboard), direct database queries for static or slow-changing data (like model catalogs/prices) can cause unnecessary DB load. The application already maintained an in-memory cache for models `getCachedPoolModels()`, but `getTraffic` was directly querying the DB using `prisma.cachedModel.findMany` instead of utilizing the cache.
**Action:** Always check if a caching layer or service already exists for lookup/reference data before writing direct database queries, especially on high-frequency endpoints.
## 2026-07-20 - [Prisma Distinct requires matching OrderBy on PostgreSQL]
**Learning:** When using `distinct` combined with `orderBy` in Prisma, PostgreSQL translates this into a `DISTINCT ON` SQL clause. This strictly requires that the distinct field(s) be the first argument(s) in the `orderBy` array.
**Action:** Always prepend the `distinct` column(s) to the `orderBy` array when using Prisma deduplication to avoid fatal runtime errors in PostgreSQL environments.
## 2026-07-22 - [Avoid N+1 queries when mapping related lists]
**Learning:** Resolving DB N+1 queries manually mapped in code (like `localMap = new Map()`) per loop item is highly inefficient and creates significant latency as account sizes grow.
**Action:** When a controller requires related data (like `keys`) for a list of items (`accounts`), push this to a batched lookup method in the service layer using `where: { <foreign_key>: { in: <ids> } }`, returning a Map or grouping to prevent redundant query overhead.
