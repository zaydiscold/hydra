import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';

export function useTraffic({ addToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const didInitialLoadRef = useRef(false);

  const fetchTraffic = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const res = await api.getTraffic();
      setData(res.data);
    } catch (err) {
      if (addToast) addToast(err.message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    fetchTraffic();
    const interval = setInterval(() => {
      if (!document.hidden) fetchTraffic(true);
    }, 10000); // 10s auto-refresh for traffic
    return () => clearInterval(interval);
  }, [fetchTraffic]);

  return {
    data,
    loading,
    refreshing,
    fetchTraffic
  };
}
