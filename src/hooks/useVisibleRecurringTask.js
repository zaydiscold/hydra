import { useEffect } from 'react';
import { clearTrackedTimeout, setTrackedTimeout } from '../lib/runtimeDiagnostics.js';

export function useVisibleRecurringTask(owner, task, delayMs, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;

    let cancelled = false;
    let running = false;
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

    const schedule = () => {
      clear();
      if (cancelled || document.hidden) return;
      timer = setTrackedTimeout(owner, async () => {
        timer = null;
        if (cancelled || document.hidden || running) {
          schedule();
          return;
        }

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
      }, delayMs);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        clear();
        abort();
      }
      else schedule();
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
