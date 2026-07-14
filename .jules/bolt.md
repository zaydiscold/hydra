## 2026-06-08 - [Avoid Re-Querying Static DB Data if Cache Exists]
**Learning:** In applications using frequent polling (like a live traffic dashboard), direct database queries for static or slow-changing data (like model catalogs/prices) can cause unnecessary DB load. The application already maintained an in-memory cache for models `getCachedPoolModels()`, but `getTraffic` was directly querying the DB using `prisma.cachedModel.findMany` instead of utilizing the cache.
**Action:** Always check if a caching layer or service already exists for lookup/reference data before writing direct database queries, especially on high-frequency endpoints.

## 2026-07-14 - [Leverage Prisma `distinct` for Database Deduplication]
**Learning:** When fetching records that need to be deduplicated based on a specific field (like finding the "best" key per account), doing the deduplication in-memory after a `findMany` query means transferring and deserializing unnecessary duplicate rows across the Prisma engine boundary.
**Action:** Use Prisma's `distinct` property combined with the existing `orderBy` clause to push the deduplication logic down to the database engine. This reduces memory footprint, CPU overhead, and data transfer.
