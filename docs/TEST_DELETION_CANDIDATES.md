# Test Deletion Candidates

These are not deletions in this PR. They are candidates to revisit after the cross-platform hardening has stayed green.

| Test | Why it is expensive | Keep until |
| --- | --- | --- |
| `server/tests/ui-static-contract.test.mjs` | Regexes renderer source directly, so normal JSX/CSS refactors can break it even when behavior is unchanged. | Equivalent behavior is covered by component-level or browser-level tests. |
| Broad README/workflow static checks in contract tests | They are useful release guardrails, but can drift when docs are reorganized. | The invariant is either moved into a smaller contract or documented as an intentional release gate. |
