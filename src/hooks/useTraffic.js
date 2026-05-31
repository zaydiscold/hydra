import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';
import { useVisibleRecurringTask } from './useVisibleRecurringTask.js';

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
  }, [fetchTraffic]);

  const refreshVisibleTraffic = useCallback(() => fetchTraffic(true), [fetchTraffic]);
  useVisibleRecurringTask('useTraffic.autoRefresh', refreshVisibleTraffic, 30000);

  return {
    data,
    loading,
    refreshing,
    fetchTraffic
  };
}
