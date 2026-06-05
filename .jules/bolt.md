## 2024-05-18 - Prisma SQLite NULL ordering
**Learning:** In the project's SQLite/Prisma backend, `NULL` values sort last in descending (`DESC`) order.
**Action:** When querying for the latest `lastUsedAt`, you don't need a separate query for active vs unused. You can use a single Prisma query with multiple `orderBy` criteria: `orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }]`. Prisma natively handles the fallback logic without needing a secondary database query since NULLs sort last in descending order in Prisma SQLite.
