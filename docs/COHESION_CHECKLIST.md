# Electron Codebase Cohesion Checklist

Cleanup pass on all new Electron files (Phase 1-3 of `feat/electron-migration`).

Date: 2026-05-05

---

## 1. Import Style Consistency

All Electron files use the same import conventions:

| Convention | Status |
|---|---|
| ESM `import`/`export` syntax (no `require`) | ✅ Consistent |
| `node:` prefix for all Node.js builtins | ✅ Consistent |
| Bare specifiers for npm packages (`electron`, etc.) | ✅ Consistent |
| JSDoc block comments at top of each file | ✅ Consistent |
| No mixed CJS/ESM anywhere | ✅ Consistent |

Files checked:
- `electron/main.js` — ESM, `node:path`, `node:url`, `electron` bare
- `electron/preload.js` — ESM, `electron` bare
- `electron/utils/migrateLegacyData.js` — ESM, `node:fs`, `node:path`
- `electron/builders/afterPack.js` — ESM, `node:fs`, `node:path`
- `electron/menus/appMenu.js` — ESM, `electron` bare
- `electron/tests/main-process.test.mjs` — ESM, `node:test`, `node:assert`, etc.

---

## 2. Dead Code Removal

### Removed
| File | Reason |
|---|---|
| `electron/utils/getFreePort.js` | Never imported. `main.js` hardcodes ports (3001 dev, 33100 prod). |
| `electron/utils/paths.js` | Never imported anywhere in the codebase. |

### Kept (actively used)
| File | Imported by |
|---|---|
| `electron/utils/migrateLegacyData.js` | `electron/main.js` (dynamic import) |
| `electron/builders/afterPack.js` | `electron-builder` config |
| `electron/menus/appMenu.js` | `electron/main.js` (dynamic import) |

---

## 3. macOS Artifacts

| File | Action |
|---|---|
| `electron/.DS_Store` | Deleted (gitignored, never tracked) |
| `/.DS_Store` | Deleted (gitignored, never tracked) |

`.gitignore` already includes `.DS_Store`.

---

## 4. Duplicate/Unused Files Audit

| Finding | Status |
|---|---|
| `AGENTS.md` / `CLAUDE.md` (root) vs `docs/AGENTS.md` | Intentional. Root files are thin entrypoints; `docs/AGENTS.md` has the full briefing. |
| No `.tmp`, `.bak`, `.old`, or `TODO` files found | ✅ Clean |
| No duplicate `.js`/`.mjs` source files | ✅ Clean |

---

## 5. No Unused Imports Within Files

Each file's imports verified — all imports are used within their respective files:

| File | Imports Check |
|---|---|
| `main.js` | `app`, `BrowserWindow`, `dialog` (all used), `path`, `fileURLToPath` (all used) |
| `preload.js` | `contextBridge`, `ipcRenderer` (both used) |
| `migrateLegacyData.js` | 5 `node:fs` imports, `path` (all used) |
| `afterPack.js` | `existsSync`, `path` (both used) |
| `appMenu.js` | `app`, `Menu` (both used); `shell` imported dynamically in Help click handler |
| `main-process.test.mjs` | All `node:test`, `node:assert`, `node:child_process`, `node:fs`, `node:path`, `node:url` imports used |

---

## 6. Lint Results

Lint: ✅ Passed — zero errors, zero warnings (ESLint 9).

---

## Summary

- **2 dead files removed**: `electron/utils/getFreePort.js`, `electron/utils/paths.js`
- **2 macOS artifacts cleaned**: `.DS_Store` files
- **Import style**: 100% consistent across all files
- **No unused imports** within any file
- **No duplicate source files** found
- All actively-used files have clear import chains back to `electron/main.js`
