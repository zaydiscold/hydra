# Hydra v1.1.4 Packaged Evidence Manifest

This directory contains the public-safe packaged Electron screenshot checkpoint
for Hydra `v1.1.4`.

## Capture Rules

- App screenshots came from the exact public arm64 `Hydra.app` through native
  CoreGraphics window enumeration and `/usr/sbin/screencapture -l
  <CGWindowID>`.
- Dashboard, Vault, and Pool sensitive fields were blurred or replaced in the
  packaged renderer before native capture. No unredacted live screenshot was
  written into the repository.
- Settings machine-specific local and LAN endpoint values were replaced with
  explicit redaction labels during the repository visual-review pass.
- First-run setup used an isolated temporary Electron `--user-data-dir`.
- Traffic used a second isolated temporary profile seeded with six synthetic
  `RequestLog` rows. The rows intentionally cover `200`, `429`, and `502`
  statuses plus visible latency values without touching live account state.
- CLI artifacts were rendered from fresh privacy-safe command output because
  Terminal AppleEvents, Computer Use Terminal access, and post-exit native
  Terminal capture were permission-constrained.
- Both isolated Electron profiles were moved reversibly to `~/.Trash`.

## Privacy Verification

macOS Vision OCR scanned every PNG for email markers, `sk-` key prefixes,
credential assignments, and uninterrupted token-shaped strings. It found zero
hits. ImageMagick also reported nonblank color variance for every PNG.

Computer Use still timed out against Hydra after `120s`, so final human visual
review remains a manual release boundary.

## Artifacts

| File | Method | SHA-256 |
| --- | --- | --- |
| `hydra-v114-packaged-vault-setup.png` | Native packaged isolated first-run window | `d259940c78f20f7d615a6b2b5f8a7768c50ca2dc895173a3af61244679221a2b` |
| `hydra-v114-packaged-dashboard-redacted.png` | Native packaged live window, in-renderer account redaction | `d0555b6ce790b8ac5aace8e4ad92ffeccd17fa3d078f8617d325565efe0b26f9` |
| `hydra-v114-packaged-vault-redacted.png` | Native packaged live window, in-renderer table redaction | `aebb222ca20946a3f602a66962fa62de82ed9b193d1677b576b93a4b84b47475` |
| `hydra-v114-packaged-pool-redacted.png` | Native packaged live window, in-renderer account and token redaction | `1a34085153443876659082e5815a1e4d3558c17c695dbf959357e5597face299` |
| `hydra-v114-packaged-settings-touch-id.png` | Native packaged live Settings window, machine-specific endpoint redaction | `ede54b6d508f1956f036421e6ce4aeb17c20a0c3ff544707ec141329b621a782` |
| `hydra-v114-packaged-traffic-demo.png` | Native packaged isolated Traffic window with synthetic rows | `fe2d20c0b5a3f1617f0de00880086e91652dc0863f826d5730f75b8159519e95` |
| `hydra-v114-cli-status-redacted.png` | Rendered from fresh redacted `hydra status` output | `1026ace5527fac8475c4d023e4b5cad04c1f1bb7e71ba648a46b9880a546fb5b` |
| `hydra-v114-cli-proxy-status-redacted.png` | Rendered from fresh redacted `hydra proxy status` output | `7b71001415d98785ba2763d67eeff3ebecb6dad0f8fa3de1a4bcb316779464e6` |
| `hydra-v114-cli-doctor-redacted.png` | Rendered from fresh compact `hydra doctor --json` excerpt | `de99d0c9c587e6cc4e31ec44d628e4f85a3443628c7dd5bb399a615071b1df0d` |
