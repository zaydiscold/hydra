# Final Dogfood Evidence

The final Hydra dogfood pass needs packaged Electron and live-account evidence that Codex cannot safely infer from source tests. Use the checked-in preflight to create a redacted evidence artifact after you run the real app.

Run from the repo root after building the packaged app:

```bash
npm run dogfood:final -- \
  --write-evidence=docs/DOGFOOD_EVIDENCE.json \
  --version=1.0.10 \
  --artifact-dir=/path/to/downloaded/release-assets \
  --app=/path/to/Hydra.app \
  --launch-diagnostics \
  --manual=packaged-gui-launch \
  --manual=window-controls \
  --manual=splash-unlock-dashboard \
  --manual=navigation-dead-buttons
```

Add the other manual flags only after you actually perform those checks:

- `--manual=touch-id`
- `--manual=live-account-flows`
- `--manual=screenshots-redacted`
- `--manual=windows-launch`

The default output is `docs/DOGFOOD_EVIDENCE.json` when `--write-evidence` is passed without a path. The example above uses an explicit path so the evidence location is unambiguous.

The evidence records checklist status, artifact presence, `hydra audit` summary, Docker reachability, optional app-open status, and optional `--launch-diagnostics` results for the Electron runtime, LaunchServices, Finder AppleEvents, and Hydra's packaged app handoff. Use `--version=<semver>` when local package metadata lags the release under test, `--artifact-dir=<dir>` for downloaded GitHub release assets, and `--app=<path/to/Hydra.app>` for an extracted release app; by default the script uses local `package.json`, local `release/` artifacts, and `release/mac-arm64/Hydra.app`. It does not read the local database, cookies, screenshots, API keys, Clerk session IDs, local secrets, or account email contents.

Do not paste API keys, cookies, tokens, real account data, or private screenshots into this file. It is a status artifact, not a log dump.

This evidence file is not release-complete by itself. The release remains not complete while `hydra audit` has deferred items or any required manual check is absent.