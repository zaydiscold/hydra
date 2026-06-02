# Hydra Packaged Evidence Manifest

This directory contains the public-safe packaged Electron screenshot checkpoint
for Hydra. The full representative suite came from exact-public `v1.1.4`; the
exact-public `v1.3.0`, `v1.4.0`, `v1.4.7`, current `v1.5.1`, and local
`v1.5.6` canonical apps add Dashboard privacy proofs. The `v1.5.7` dev smoke
adds a non-secret Generator page proof for the OTP-submit rescue. The `v1.4.7`
package also adds a native splash capture.

## Capture Rules

- App screenshots came from the exact public arm64 `Hydra.app` through native
  CoreGraphics window enumeration and `/usr/sbin/screencapture -l
  <CGWindowID>`.
- The current `v1.5.1` refresh used the same CoreGraphics window enumeration,
  then fell back to direct CoreGraphics window-image capture because
  `/usr/sbin/screencapture -l` returned `could not create image from window` for
  both Hydra window IDs on this macOS SDK/runtime.
- The `v1.5.6` refresh used Hydra's packaged self-capture launch flag through
  LaunchServices:
  `node scripts/open-packaged-app.mjs release/mac-arm64/Hydra.app --self-capture=/private/tmp/.../hydra-v156-dashboard-raw.png`.
  This uses Electron `webContents.capturePage()` from the app's own main
  process, so it does not depend on macOS Screen Recording, Accessibility,
  Chrome, Vite preview, or browser harnesses.
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

macOS Vision OCR scanned the `v1.1.4` gallery and later `v1.4.7` splash proof
for email markers, `sk-` key prefixes, credential assignments, and uninterrupted
token-shaped strings. It found zero hits. The `v1.3.0`, `v1.4.0`, `v1.4.7`,
`v1.5.1`, and `v1.5.6` Dashboard proofs were additionally scanned with
Tesseract OCR for credential-shaped and endpoint-shaped patterns after
pixelation. The `v1.5.7` Generator proof was captured before any account email
or OTP value was entered. ImageMagick reported nonblank color variance for
every PNG.

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
| `hydra-v130-packaged-dashboard-privacy-redacted.png` | Native exact-public Dashboard window, content pixelated below titlebar before check-in | `d09cb79b6c2a819eb3eb7957f6fd33464193d492cfa74bf8aae6badd96e27c6c` |
| `hydra-v140-packaged-dashboard-privacy-redacted.png` | Native exact-public Dashboard window without shadow, content pixelated below titlebar before check-in | `74789ea47e6a33fff972ac15a40667fe0e99af786aae9e13b3cc65cd3f92fc0f` |
| `hydra-v147-packaged-splash.png` | Native exact-public splash window without browser or accessibility attachment | `3a608664fffde2b2976be1e1aacd9ca445056997854411396472c25f13b350fd` |
| `hydra-v147-packaged-dashboard-privacy-redacted.png` | Native exact-public Dashboard window, content pixelated below titlebar before check-in | `c655726b575915159731242ebed34df96407f38b4cd6fb1a6c8e50750ed229e2` |
| `hydra-v151-packaged-dashboard-privacy-redacted.png` | Native current `v1.5.1` Dashboard window, content pixelated below titlebar before check-in | `bff154ff91ad5fba41f90b5c138987098fac6671043d160ec72bc3613e9f25af` |
| `hydra-v156-packaged-dashboard-self-capture-redacted.png` | Packaged `v1.5.6` Dashboard renderer self-capture via LaunchServices flag, content pixelated before check-in | `c0c4d7e415417bf00b1ff06ae66b9d35523b9f35e66754171ba3507d20c9bdd9` |
| `hydra-v157-generator-dev-initial.png` | Source dev `/generator` page before account data entry, captured during the OTP-submit rescue smoke | `a41c33c6c1eb766df52333ecddf09ad93bdbe3fb3e54b2595c465bf671bd95de` |
