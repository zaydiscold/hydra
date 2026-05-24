## 2024-05-24 - Unnecessary O(N^2) lookups on self-referential lists
**Learning:** Found a performance anti-pattern in the codebase where array iterations (like `filter`) perform a nested `.find` on the same array using the current item's ID, rather than using the object directly. This unintentionally turns O(N) render operations into O(N²) bottlenecks, especially noticeable on pages with many items like the Vault page.
**Action:** Always prefer passing the object directly or building an O(1) map upfront instead of performing `.find` lookups inside array iteration methods.
