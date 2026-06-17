## 2026-06-08 - [Avoid Re-Querying Static DB Data if Cache Exists]
**Learning:** In applications using frequent polling (like a live traffic dashboard), direct database queries for static or slow-changing data (like model catalogs/prices) can cause unnecessary DB load. The application already maintained an in-memory cache for models `getCachedPoolModels()`, but `getTraffic` was directly querying the DB using `prisma.cachedModel.findMany` instead of utilizing the cache.
**Action:** Always check if a caching layer or service already exists for lookup/reference data before writing direct database queries, especially on high-frequency endpoints.

## 2026-06-18 - [React Array Rendering on Polling Endpoints]
**Learning:** Polling endpoints in React components (like `Traffic.jsx` polling 100 log rows) will re-render every item in the array if they are inlined, even if 99% of the rows have not changed. This burns CPU on expensive string building and formatting functions (like `describeRoute`).
**Action:** Always extract row-level rendering into a separate component wrapped with `React.memo` when rendering arrays of data that are frequently refreshed via polling.
