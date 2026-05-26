import { useCallback, useEffect, useRef } from 'react';

export function useOwnedTimeouts() {
  const timersRef = useRef(new Set());

  const clearOwnedTimeout = useCallback((timer) => {
    if (!timer) return;
    clearTimeout(timer);
    timersRef.current.delete(timer);
  }, []);

  const setOwnedTimeout = useCallback((fn, ms) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      fn();
    }, ms);
    timersRef.current.add(timer);
    return timer;
  }, []);

  useEffect(() => () => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  return { clearOwnedTimeout, setOwnedTimeout };
}
