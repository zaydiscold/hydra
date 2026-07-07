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

    document.addEventListener('visibilitychange', handleVisibility);
    schedule();

    return () => {
      cancelled = true;
      clear();
      abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [delayMs, enabled, owner, task]);
}
