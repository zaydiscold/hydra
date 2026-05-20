# CI Status Reference

Last refreshed: 2026-05-20.

Source command:

```bash
gh run list --limit 30 --json conclusion,name,headBranch,createdAt \
  --jq '.[] | select(.conclusion=="failure") | [.name, .headBranch, .createdAt] | @tsv'
```

| Workflow | Branch | Recent runs | Cause | Current prevention |
| --- | --- | ---: | --- | --- |
| Electron package smoke | `claude/fix-cli-export-mode-windows` | 3 | Windows runner reached `npm run gate`; `scripts/integration-gate.mjs` dynamically imported raw `resolve(ROOT, ...)` paths, so Node ESM parsed `D:\...` as unsupported protocol `d:`. | `scripts/integration-gate.mjs` now wraps those imports in `pathToFileURL(...).href`; `server/tests/cross-platform-contract.test.mjs` forbids `import(resolve(` in scripts. |
| Electron package smoke | `claude/cleanup-pass-1` | 3 | Windows ACLs exposed POSIX mode-bit assumptions in tests around generated owner-only files. | POSIX mode assertions are guarded with `process.platform !== 'win32'`; `server/tests/cross-platform-contract.test.mjs` blocks unguarded `mode & 0o` assertions. |

Known green baseline after fixes:

| Scope | Evidence |
| --- | --- |
| PR #3 | CI and Electron package smoke passed on `c6f0bfb`, including `windows-latest --win nsis --x64`. |
| master | `ba70a0d` fixed the raw dynamic import path issue; `e3b638d` stayed green remotely before this pass. |

## Failure Pattern Notes

- Windows does not enforce POSIX `chmod(0o600)` semantics the way macOS/Linux do. Tests can still verify the behavior on POSIX, but Windows needs a behavior-level assertion or an explicit skip around mode bits.
- Node ESM dynamic import accepts POSIX absolute paths by accident of syntax, but Windows drive-letter paths must be converted with `pathToFileURL(...).href`.
- Static contract tests are useful for packaging invariants, but regex assertions against JSX/layout details should be treated as deletion candidates when they churn during normal UI refactors.
