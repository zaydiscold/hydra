# Final Dogfood Evidence

The final Hydra dogfood pass needs packaged Electron and live-account evidence that Codex cannot safely infer from source tests. Use the checked-in preflight to create a redacted evidence artifact after you run the real app.

Run from the repo root after building the packaged app:

```bash
npm run dogfood:final -- --write-evidence \
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

The default output is `docs/DOGFOOD_EVIDENCE.json`. It records checklist status, artifact presence, `hydra audit` summary, Docker reachability, and optional app-open status. It does not read the local database, cookies, screenshots, API keys, Clerk session IDs, local secrets, or account email contents.

Do not paste API keys, cookies, tokens, real account data, or private screenshots into this file. It is a status artifact, not a log dump.

This evidence file is not release-complete by itself. The release remains not complete while `hydra audit` has deferred items or any required manual check is absent.
