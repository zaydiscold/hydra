import { useEffect } from 'react';
import { clearTrackedTimeout, setTrackedTimeout } from '../lib/runtimeDiagnostics.js';

export function useVisibleRecurringTask(owner, task, delayMs, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;

    let cancelled = false;
    let running = false;
    let pendingImmediate = false;
    let timer = null;
    let controller = null;

    const clear = () => {
      if (!timer) return;
      clearTrackedTimeout(timer);
      timer = null;
    };

    const abort = () => {
      controller?.abort();
      controller = null;
    };

    const schedule = (immediate = false) => {
      if (immediate) pendingImmediate = true;
      clear();
      if (cancelled || document.hidden) return;
      // Also pause when the window is visible but unfocused (another app/window
      // is active); visibilitychange only covers minimize/occlusion, not focus.
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) return;
      // A run is in flight; its finally reschedules and honors pendingImmediate.
      // Returning here (not arming a 0ms timer) avoids a hide/show busy-spin.
      if (running) return;
      const delay = pendingImmediate ? 0 : delayMs;
      timer = setTrackedTimeout(owner, async () => {
        timer = null;
        if (cancelled || document.hidden || running) {
          schedule();
          return;
        }

        pendingImmediate = false;
        running = true;
        const taskController = new AbortController();
        controller = taskController;
        try {
          await task(taskController.signal);
        } catch (err) {
          if (err?.name !== 'AbortError') {
            console.warn(`[${owner}] visible recurring task failed:`, err?.message || err);
          }
        } finally {
          if (controller === taskController) controller = null;
          running = false;
          schedule();
        }
      }, delay);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        clear();
        abort();
      }
      else schedule(true);
    };
    const handleBlur = () => {
      clear();
      abort();
    };
    const handleFocus = () => schedule(true);

    document.addEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', handleBlur);
      window.addEventListener('focus', handleFocus);
    }
    schedule();

    return () => {
      cancelled = true;
      clear();
      abort();
      document.removeEventListener('visibilitychange', handleVisibility);
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', handleBlur);
        window.removeEventListener('focus', handleFocus);
      }
    };
  }, [delayMs, enabled, owner, task]);
}
