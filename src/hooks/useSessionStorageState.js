import { useEffect, useState } from 'react';

function readSessionValue(key, fallback) {
  try {
    const stored = window.sessionStorage?.getItem(key);
    return stored === null ? fallback : JSON.parse(stored);
  } catch {
    return fallback;
  }
}

export function useSessionStorageState(key, fallback) {
  const [value, setValue] = useState(() => readSessionValue(key, fallback));

  useEffect(() => {
    try {
      window.sessionStorage?.setItem(key, JSON.stringify(value));
    } catch {
      // Persistence is a convenience. Keep the live view usable if storage
      // is unavailable or full.
    }
  }, [key, value]);

  return [value, setValue];
}

