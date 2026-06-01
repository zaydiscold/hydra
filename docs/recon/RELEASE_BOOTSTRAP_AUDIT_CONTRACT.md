# Release Bootstrap Audit Contract

## What Was Found

Auto-version run `26738144380` created immutable tag `v1.4.1`, then Release
Desktop Apps run `26738151871` failed in shared `test:ci` before package jobs
started. The failing CLI regression required the current package version's
macOS Intel and Windows artifacts to already be recorded as public.

That requirement cannot hold during release bootstrap: the tagged workflow
must pass its shared source gate before it can build and upload those artifacts.

## How It Was Found

Run:

```bash
gh run view 26738151871 --log-failed
gh run view 26738151871 --log | \
  rg -n -C 8 'not ok|FAIL|ERR_ASSERTION|mac-intel-artifact'
node bin/hydra.mjs audit --json | \
  jq '.items[] | select(.id=="mac-intel-artifact" or .id=="mac-intel-current" or .id=="windows-installer-artifact")'
```

The release log identified `server/tests/cli.test.mjs:380`. Local audit output
then confirmed that `mac-intel-current` was honestly `missing` for package
metadata `1.4.1`, because no `v1.4.1` desktop release had published.

## Why It Matters

A read-only audit must remain strict after publication, but its regression test
cannot make publication impossible. The old test created a circular dependency:

```text
release gate -> current public artifact evidence -> package upload -> release gate
```

## Fix

The CLI regression now distinguishes two states:

- Before current public-release evidence is recorded, hosted package-smoke
  evidence may satisfy historical artifact availability checks while
  `mac-intel-current` remains `missing`.
- After current public-release evidence is recorded, the regression still
  requires current-version public Intel and Windows evidence.

The audit command itself was not weakened.

## Release Boundary

Keep failed tag `v1.4.1` immutable. It uploaded no desktop artifacts. The
repaired artifact-parity tranche advances through the normal patch lane as
`v1.4.2`.

The repair checkpoint
`5857ff4ce330fec3016862fc1390e4ce9eabd1f1` used `[skip-bump]`;
Auto-version run `26738319746` skipped, CI run `26738319743` passed, and Docker
workflow run `26738319737` passed runtime smoke and registry image push.

## Resolution

Commit `2ed168b802043b4f23f78f3b052e2ba394b3fddf` triggered the repaired patch
release. Auto-version run `26738561372` created immutable tag `v1.4.2`, normal
CI run `26738561386` passed, and Docker workflow run `26738561364` passed
runtime smoke and registry image push.

Release Desktop Apps run `26738568988` passed the shared `lint, test, gate`
job that previously blocked `v1.4.1`, then published Linux x64 AppImage, macOS
arm64 zip, macOS Intel zip, Windows x64 NSIS, and the merged dual-architecture
`latest-mac.yml`. Live release inspection verified all ten expected public
assets. The circular release-bootstrap dependency is closed without weakening
post-publication audit truth.
