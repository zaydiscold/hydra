# Packaged Electron Preload Bridge

## Finding

Public `v1.1.3` packaged dogfood exposed a desktop-only bridge failure:

```text
typeof window.hydraNative === "undefined"
```

The renderer still loaded the localhost UI, so browser-shaped checks looked
healthy. Native-only features were not healthy: Settings hid System Info and
Touch ID controls, renderer window actions could not reach main-process IPC,
and the splash could not report updater progress through `window.hydraSplash`.

## Root Cause

Both preload scripts used ESM imports:

```js
import { contextBridge, ipcRenderer } from 'electron';
```

Hydra creates both windows with `sandbox: true`. Electron's sandboxed preload
scripts run as plain JavaScript without an ESM context. The supported direct
Electron import is CommonJS:

```js
const { contextBridge, ipcRenderer } = require('electron');
```

Electron documentation:

- <https://github.com/electron/electron/blob/main/docs/tutorial/esm.md>
- <https://github.com/electron/electron/blob/main/docs/tutorial/context-isolation.md>

## Reproduction

1. Launch the packaged app through LaunchServices with temporary CDP enabled:

   ```bash
   open -n release/mac-arm64/Hydra.app --args --remote-debugging-port=9333
   ```

2. After the splash handoff, query `http://127.0.0.1:9333/json/list`.
3. Connect to the packaged renderer websocket and evaluate:

   ```js
   typeof window.hydraNative
   ```

4. Before the fix the result is `"undefined"`. After the fix it is `"object"`.

## Raw Evidence

Machine-local redacted probes:

- Broken public `v1.1.3`: `/private/tmp/hydra-v113-route-diagnostics.K2MLjV/05-settings-bridge-probe.json`
- Repaired splash bridge: `/private/tmp/hydra-v113-preload-fix-runtime.8IKRcr/01-splash-bridge.json`
- Repaired main bridge: `/private/tmp/hydra-v113-preload-fix-runtime.8IKRcr/03-main-bridge.json`
- Repaired Settings and route diagnostics: `/private/tmp/hydra-v113-preload-fix-runtime.8IKRcr/06-settings-and-route-diagnostics.json`

No API keys, cookies, auth tokens, account emails, or filesystem paths from
renderer preferences are included in the committed evidence.

## Permanent Verification

`server/tests/electron-ipc-contract.test.mjs` requires both sandboxed preloads
to use the CommonJS Electron import and rejects the unsupported ESM form.

The repaired local ARM package passed:

```bash
npm run lint
npm test
npm run gate
HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke
npm run openapi:hydra
node bin/hydra.mjs audit --json
git diff --check
```

Packaged runtime verification must continue to inspect the actual Electron
renderer. Static source checks alone cannot prove that a preload executed.

## Current Acceptance Rule

The temporary debugging reproduction above is historical evidence, not the
current dogfood path. Current packaged visual checks launch Hydra normally
through LaunchServices and use native desktop control only. Do not enable a
remote-debugging port, open a localhost browser tab, or use browser tooling as
release-acceptance evidence.
