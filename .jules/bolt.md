## 2026-06-08 - [Avoid Re-Querying Static DB Data if Cache Exists]
**Learning:** In applications using frequent polling (like a live traffic dashboard), direct database queries for static or slow-changing data (like model catalogs/prices) can cause unnecessary DB load. The application already maintained an in-memory cache for models `getCachedPoolModels()`, but `getTraffic` was directly querying the DB using `prisma.cachedModel.findMany` instead of utilizing the cache.
**Action:** Always check if a caching layer or service already exists for lookup/reference data before writing direct database queries, especially on high-frequency endpoints.

## 2026-06-10 - [Avoid N+1 queries in mapping collections]
**Learning:** In applications mapping over records (`allAccounts.map`) and awaiting queries inside (`await store.getLocalKeys(req.user.id, account.id)`), an N+1 query vulnerability exists which leads to excessive database load when the collection size is large.
**Action:** Always batch related data queries prior to mapping over collections by retrieving data with an `IN` clause and aggregating them into a Map object that can be queried continuously in memory.
