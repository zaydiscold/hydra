## 2024-05-18 - SQLite Null Handling in DESC Sorts
**Learning:** In Hydra, which uses SQLite exclusively, `NULL` values sort last in descending order (`DESC`).
**Action:** When creating fallback sorting logic (e.g. `orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }]`), you do not need to execute two separate queries to handle rows where `lastUsedAt` is null. A single query with multiple `orderBy` criteria will naturally fallback to the secondary sort when the primary sort is `null` and placed at the bottom. This simplifies the codebase and improves performance.
