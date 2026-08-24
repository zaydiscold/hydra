# Recon Utilities

This directory is limited to reusable, non-credentialed diagnostics that are
safe to keep in the public repository.

## Rules

- Do not hard-code account IDs, user IDs, email addresses, domains, tokens,
  cookies, API keys, management keys, passwords, or proxy credentials.
- Do not decrypt and print stored credentials or session material.
- Do not write credential, cookie, account, or session dumps into the repository
  root.
- Use synthetic fixtures for examples and tests.
- Write temporary diagnostic output beneath the operating system temp directory,
  and redact it before sharing.
- Keep one-off account repair, live-session capture, and emergency recovery
  scripts outside the public repository.
- Promote durable behavior into tested application or CLI code instead of
  accumulating personal scratch scripts here.

## Retained Tools

- `analyze-api.mjs`: generic API-surface analysis
- `analyze-ui.mjs`: generic UI-surface analysis
- `check-clerk-connectivity.mjs`: bounded upstream connectivity diagnostic
- `get_selectors.cjs`: selector inspection helper

Any new utility in this directory should be safe to execute against a clean
checkout without access to private operator data.
