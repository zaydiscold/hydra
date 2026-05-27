import { useCallback, useEffect, useRef } from 'react';
import { clearTrackedTimeout, setTrackedTimeout } from '../lib/runtimeDiagnostics.js';

export function useOwnedTimeouts(owner = 'useOwnedTimeouts') {
  const timersRef = useRef(new Set());
  const ownerRef = useRef(owner);

  const clearOwnedTimeout = useCallback((timer) => {
    if (!timer) return;
    clearTrackedTimeout(timer);
    timersRef.current.delete(timer);
  }, []);

  const setOwnedTimeout = useCallback((fn, ms) => {
    const timer = setTrackedTimeout(ownerRef.current, () => {
      timersRef.current.delete(timer);
      fn();
    }, ms);
    timersRef.current.add(timer);
    return timer;
  }, []);

  useEffect(() => () => {
    for (const timer of timersRef.current) clearTrackedTimeout(timer);
    timersRef.current.clear();
  }, []);

  return { clearOwnedTimeout, setOwnedTimeout };
}
