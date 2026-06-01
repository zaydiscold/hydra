# Node Mock Module Options Migration

## What Changed

The test harness no longer uses Node's deprecated `mock.module()` option
spellings:

```text
namedExports
defaultExport
```

All mocks now use the current `exports` object, including `exports.default`
for default exports.

## How It Was Found

The full source-validation chain emitted deprecation warnings from Node's
experimental module-mocking API. A repository search located every stale
option:

```bash
rg -n 'namedExports|defaultExport' server/tests electron/tests scripts \
  -g '*.mjs' -g '*.js'
```

The migration used a mechanical `namedExports -> exports` rewrite followed by
explicit merges for modules that expose both named and default exports.

## Why It Matters

The deprecated options still execute under the current Node runtime, but they
add noise to every validation run and increase the risk that a future Node
upgrade turns a warning into a harness failure. Keeping the tests on the
current API makes release output quieter and the forward-compatibility
boundary clearer.

## Raw Evidence

The before-and-after search counts are:

```text
deprecated mock.module option occurrences: 68 -> 0
changed test files: 13
```

The only remaining module-mock message is Node's expected experimental-feature
warning.

The shared test-chain completeness suite now recursively scans `server/tests`,
`electron/tests`, and `scripts` for either deprecated spelling. A stale option
cannot silently return without failing the first step of `npm test`.

The focused completeness suite passed `2/2` after the guard was added. The
complete source chain then passed full `npm test`, lint, build, integration
gate (`12/12`), OpenAPI generation (`83 operations`), dogfood preflight, audit,
and diff check.

## Reproduce

Run:

```bash
git grep -n -E 'namedExports|defaultExport' HEAD -- server/tests electron/tests scripts
rg -n 'namedExports|defaultExport' server/tests electron/tests scripts \
  -g '*.mjs' -g '*.js'
npm test
npm run lint
node bin/hydra.mjs audit --json
git diff --check
```

The first command shows the pre-migration checkpoint. The second should return
no current-source matches. The full test command begins with the static
regression guard.

## Release Boundary

This is a test-harness-only migration. It does not alter the packaged Electron
payload, replace public `v1.4.0` release assets, or close manual GUI, Touch ID
fingerprint, Intel, or Windows launch dogfood boundaries.
