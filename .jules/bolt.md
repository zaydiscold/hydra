## 2026-06-08 - [Avoid Re-Querying Static DB Data if Cache Exists]
**Learning:** In applications using frequent polling (like a live traffic dashboard), direct database queries for static or slow-changing data (like model catalogs/prices) can cause unnecessary DB load. The application already maintained an in-memory cache for models `getCachedPoolModels()`, but `getTraffic` was directly querying the DB using `prisma.cachedModel.findMany` instead of utilizing the cache.
**Action:** Always check if a caching layer or service already exists for lookup/reference data before writing direct database queries, especially on high-frequency endpoints.
## 2026-07-15 - [Delegate Deduplication to Database Engine]
**Learning:** When retrieving records grouped by an identifier (e.g., getting the best key per account), pulling all rows into Node.js and deduplicating in a loop using a `Map` wastes CPU cycles and memory.
**Action:** Leverage Prisma's `distinct` parameter alongside `orderBy` to push the deduplication logic to the database layer, ensuring only the single best record per group is returned across the network boundary.
