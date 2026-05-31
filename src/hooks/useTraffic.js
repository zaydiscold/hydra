import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';
import { useVisibleRecurringTask } from './useVisibleRecurringTask.js';

export function useTraffic({ addToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const didInitialLoadRef = useRef(false);
  const inFlightRef = useRef(false);
  const requestAbortRef = useRef(null);
  const unmountedRef = useRef(false);

  const fetchTraffic = useCallback(async (silent = false, externalSignal) => {
    if (inFlightRef.current || unmountedRef.current) return;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    requestAbortRef.current = controller;
    inFlightRef.current = true;
    if (silent) setRefreshing(true);
    try {
      const res = await api.getTraffic(controller.signal);
      if (unmountedRef.current || controller.signal.aborted) return;
      setData(res.data);
    } catch (err) {
      if (unmountedRef.current || controller.signal.aborted) return;
      if (addToast) addToast(err.message, 'error');
    } finally {
      externalSignal?.removeEventListener('abort', forwardAbort);
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
        inFlightRef.current = false;
        if (!unmountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
  }, [addToast]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      didInitialLoadRef.current = false;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      inFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    fetchTraffic();
  }, [fetchTraffic]);

  const refreshVisibleTraffic = useCallback((signal) => fetchTraffic(true, signal), [fetchTraffic]);
  useVisibleRecurringTask('useTraffic.autoRefresh', refreshVisibleTraffic, 30000);

  return {
    data,
    loading,
    refreshing,
    fetchTraffic
  };
}
