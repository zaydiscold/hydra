import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';
import { clearTrackedTimeout, setTrackedTimeout } from '../lib/runtimeDiagnostics.js';

export function useTraffic({ addToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const didInitialLoadRef = useRef(false);
  const inFlightRef = useRef(false);

  const fetchTraffic = useCallback(async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (silent) setRefreshing(true);
    try {
      const res = await api.getTraffic();
      setData(res.data);
    } catch (err) {
      if (addToast) addToast(err.message, 'error');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    fetchTraffic();
    let cancelled = false;
    let timer = null;

    const schedule = () => {
      if (cancelled) return;
      timer = setTrackedTimeout('useTraffic.autoRefresh', async () => {
        timer = null;
        if (!document.hidden) await fetchTraffic(true);
        schedule();
      }, 30000); // 30s auto-refresh; the /api/pool/traffic query is heavy
                 // (findMany take:100 + groupBy on RequestLog). 6×/min drove
                 // measurable CPU heat — 2×/min is plenty for an ops dashboard.
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTrackedTimeout(timer);
    };
  }, [fetchTraffic]);

  return {
    data,
    loading,
    refreshing,
    fetchTraffic
  };
}
