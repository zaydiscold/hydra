/**
 * Pure path-allowlist helper.
 *
 * Lives in its own module so it can be unit-tested without an Electron
 * runtime — `electron/app/ipc.js` does `import { app } from 'electron'` at
 * the top level, which throws when imported under plain `node --test`.
 *
 * Used by `native:open-path` IPC to decide whether the renderer is allowed
 * to ask the OS to open a given path. Defends against:
 *   - non-string inputs from a compromised renderer
 *   - paths outside the allowlist roots
 *   - symlink escapes (a symlink inside an allowed root that resolves
 *     outside it — realpathSync resolves it before the comparison).
 */
import path from 'node:path';
import fs from 'node:fs';

/**
 * @param {string} target - the path to validate
 * @param {string[]} allowedRoots - absolute paths that target must be inside
 * @returns {boolean}
 */
export function isPathInAllowlist(target, allowedRoots) {
  if (typeof target !== 'string' || target.length === 0) return false;
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return false;
  let normalized;
  try {
    normalized = fs.realpathSync(target);
  } catch {
    return false;  // path doesn't exist OR can't be resolved → reject
  }
  const resolvedRoots = allowedRoots.map(root => {
    try { return fs.realpathSync(root); } catch { return root; }
  });
  return resolvedRoots.some(root => normalized === root || normalized.startsWith(root + path.sep));
}
