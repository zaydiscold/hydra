# Doctor Process Ownership Boundary

Date: 2026-06-01

## Finding

`hydra doctor --json` could count a diagnostic wrapper shell as a Hydra-owned
runtime process when that shell contained a filename such as:

```text
doctor-before-launch.json
```

The app itself still had the expected four native processes. The fifth entry
was the soak script's `/bin/zsh -c ...` wrapper.

## How It Was Found

The final `v1.4.3` packaged-app soak under:

```text
/private/tmp/hydra-v143-final-launch-soak-20260601T.h8HdlU
```

reported five Hydra-owned processes. A targeted `ps` snapshot and the
`doctor-profile-0.json` process list showed that the extra entry was the
wrapper script, not an Electron helper.

Testing each ownership predicate against that command isolated the accidental
match:

```text
root: true
server: true
matched substring: launch.js
context: doctor-before-launch.json
```

## Root Cause

The long-running repo-process fallback accepted any matching substring:

```text
server/standalone.js|launch.js|electron/main.js
```

That made the `.json` suffix in `before-launch.json` look like the runtime
entrypoint `launch.js`.

## Fix

The fallback now requires a whitespace-delimited executable token rooted in
the repo:

```text
(?:^|\s)\S*(?:server/standalone.js|scripts/launch.js|electron/main.js)(?:\s|$)
```

This preserves the intended standalone-server, source-launcher, and Electron
main-process matches while rejecting wrapper filenames and diagnostic prose.

`server/tests/cli.test.mjs` now locks the bounded matcher shape down and rejects
the former broad substring expression.

## Raw Evidence

Against the same still-running wrapper and app:

```text
before fix sample 4: processCount=5 cpu=0.2%
after fix sample 5:  processCount=4 cpu=0.0%
after fix sample 6:  processCount=4 cpu=0.0%
after fix sample 7:  processCount=4 cpu=0.0%
```

Focused regression:

```text
npm run test:cli
46/46 passed
```

## Reproduce

1. Launch Hydra through LaunchServices.
2. Keep a wrapper shell alive whose command contains both the repo root and a
   filename ending in `before-launch.json`.
3. Run `node bin/hydra.mjs doctor --json`.
4. Verify `performance.hydraProcesses.processes` contains only the native Hydra
   tree and does not include the wrapper shell.

## Release Boundary

This CLI diagnostic fix ships with the `v1.4.3` source release. A rebuilt ARM
package, strict codesign check, package smoke, and corrected five-minute
LaunchServices soak are required before publication. The desktop bundle ships
the embedded app server/runtime source; the repo-linked CLI remains verified
through its focused and full test chains.
