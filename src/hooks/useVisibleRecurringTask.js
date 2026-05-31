import { useEffect } from 'react';
import { clearTrackedTimeout, setTrackedTimeout } from '../lib/runtimeDiagnostics.js';

export function useVisibleRecurringTask(owner, task, delayMs, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;

    let cancelled = false;
    let running = false;
    let timer = null;

    const clear = () => {
      if (!timer) return;
      clearTrackedTimeout(timer);
      timer = null;
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
        try {
          await task();
        } catch (err) {
          console.warn(`[${owner}] visible recurring task failed:`, err?.message || err);
        } finally {
          running = false;
          schedule();
        }
      }, delayMs);
    };

    const handleVisibility = () => {
      if (document.hidden) clear();
      else schedule();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    schedule();

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [delayMs, enabled, owner, task]);
}
