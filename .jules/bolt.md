## 2026-05-30 - [Optimize Dashboard Stats Rendering]
**Learning:** React component derived state containing multiple array mapping, filtering and iterations on large lists triggered unnecessarily when unconnected modal state toggled. Fallback variable destructuring inside useMemo returned `undefined` without `data` bounds checks breaking initial loader states.
**Action:** Extract expensive list computations into a `useMemo` block with correct defaults fallback checking to prevent unnecessary list iterations during component renders. Ensure that destructured objects return defined defaults in case of empty initial data.

## 2026-05-30 - [Optimize Dashboard Stats Rendering Part 2]
**Learning:** React component derived state useMemo blocks should not return variables in destructuring patterns that are not explicitly captured on the lhs. Destructuring missing keys will result in ESLint no-unused-vars errors and eventually CI failure.
**Action:** Remove `syncedCount` and `attentionCount` returned objects from the `useMemo` destructured dictionary map return as they are entirely internally consumed for derived computation (`statusLabel`, etc) inside the scope.
