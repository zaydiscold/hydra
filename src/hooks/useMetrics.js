import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';

/**
 * Custom hook for Dashboard metrics and session logic.
 * Extracting state and API interactions from Dashboard.jsx.
 */
export function useMetrics({ addToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [provisioningIds, setProvisioningIds] = useState(new Set());
  const [liveStatuses, setLiveStatuses] = useState({}); // accountId → display status (cached/cheap)
  const [actionSessionTruth, setActionSessionTruth] = useState({}); // accountId → action status (live probe)
  const [cooldownMap, setCooldownMap] = useState({});   // { [hash]: expiresAtMs }
  const warnedExpiryRef = useRef(false);
  const didInitialLoadRef = useRef(false);

  const fetchDashboard = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    
    try {
      const [res, syncRes] = await Promise.all([
        api.getDashboard(),
        api.getPoolSyncStatus().catch(() => ({ data: {} })),
      ]);
      setData(res.data);
      setCooldownMap(syncRes.data?.cooldownMap ?? {});
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  // Initial load
  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    fetchDashboard();
  }, [fetchDashboard]);

  // Display status probing (cached/cheap)
  useEffect(() => {
    const accounts = data?.accounts;
    if (!accounts?.length) {
      setActionSessionTruth({});
      return;
    }
    
    // Server already did the work — use its display statuses, skip client-side probing
    const serverDisplay = data?.displaySessionStatuses || data?.liveStatuses;
    if (serverDisplay && Object.keys(serverDisplay).length > 0) {
      setLiveStatuses(serverDisplay);
      return;
    }

    let cancelled = false;

    async function probeAll() {
      const CONCURRENCY = 3;
      let active = 0;
      let idx = 0;
      const results = {};

      await new Promise((resolve) => {
        function next() {
          while (active < CONCURRENCY && idx < accounts.length) {
            const acct = accounts[idx++];
            active++;
            api.getSessionStatus(acct.id)
              .then((res) => {
                if (!cancelled) results[acct.id] = res?.data?.status || res?.data;
              })
              .catch(() => { /* keep existing */ })
              .finally(() => {
                active--;
                if (idx < accounts.length) next();
                else if (active === 0) resolve();
              });
          }
          if (idx >= accounts.length && active === 0) resolve();
        }
        next();
      });

      if (!cancelled) setLiveStatuses(results);
    }

    probeAll();
    return () => { cancelled = true; };
  }, [data?.accounts, data?.displaySessionStatuses, data?.liveStatuses]);

  useEffect(() => {
    const accounts = data?.accounts;
    if (!accounts?.length) return;

    const candidates = accounts.filter((acct) => acct.hasCredentials);

    if (candidates.length === 0) {
      setActionSessionTruth({});
      return;
    }

    let cancelled = false;

    async function probeProvisionTruth() {
      const CONCURRENCY = 3;
      let active = 0;
      let idx = 0;
      const results = {};

      await new Promise((resolve) => {
        function next() {
          while (active < CONCURRENCY && idx < candidates.length) {
            const acct = candidates[idx++];
            active++;
            api.checkSessionLive(acct.id)
              .then((res) => {
                if (!cancelled) results[acct.id] = res?.data?.status ?? 'unknown';
              })
              .catch(() => {
                if (!cancelled) results[acct.id] = 'error';
              })
              .finally(() => {
                active--;
                if (idx < candidates.length) next();
                else if (active === 0) resolve();
              });
          }
          if (idx >= candidates.length && active === 0) resolve();
        }
        next();
      });

      if (!cancelled) setActionSessionTruth(results);
    }

    probeProvisionTruth();
    return () => { cancelled = true; };
  }, [data?.accounts]);

  // Session expiry warning
  useEffect(() => {
    const accounts = data?.accounts;
    if (!accounts?.length || warnedExpiryRef.current || !Object.keys(liveStatuses).length) return;

    const expiring = accounts.filter((a) => liveStatuses[a.id] === 'expiring');
    if (expiring.length > 0) {
      const detail = expiring.map((a) => a.alias).join(', ');
      addToast(`⚠ ${expiring.length} session(s) expiring soon: ${detail}`, 'warning');
      warnedExpiryRef.current = true;
    }
  }, [data?.accounts, liveStatuses, addToast]);

  // Auto-refresh interval
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) fetchDashboard(true);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleProvision = useCallback(async (accountId) => {
    const account = data?.accounts?.find((item) => item.id === accountId);
    if (!account?.hasCredentials) {
      addToast('Live sign-in is required before provisioning on this account.', 'warning');
      return;
    }

    let truthStatus = actionSessionTruth[accountId];
    try {
      const live = await api.checkSessionLive(accountId);
      truthStatus = live?.data?.status ?? 'unknown';
      setActionSessionTruth((prev) => ({ ...prev, [accountId]: truthStatus }));
    } catch {
      truthStatus = truthStatus ?? 'error';
    }

    if (!(truthStatus === 'active' || truthStatus === 'expiring')) {
      addToast('Live session check required before provisioning. Sign in or refresh session first.', 'warning');
      return;
    }

    setProvisioningIds(prev => new Set(prev).add(accountId));
    try {
      const res = await api.provisionManagementKey(accountId);
      if (!res?.data?.key) {
        throw new Error(res?.data?.message || 'Provisioning did not return a management key');
      }
      addToast(`Management key provisioned via ${api.formatProvisionSourceForUi(res.data.source)}`, 'success');
      fetchDashboard(true);
    } catch (err) {
      console.error('[USE_METRICS] Provision failed:', err.message);
      addToast(`Provision failed: ${api.formatApiErrorMessage(err)}`, 'error');
    } finally {
      setProvisioningIds(prev => {
        const s = new Set(prev);
        s.delete(accountId);
        return s;
      });
    }
  }, [actionSessionTruth, addToast, data?.accounts, fetchDashboard]);

  const handleSilentRefresh = useCallback(async (account) => {
    try {
      await api.silentRefreshSession(account.id);
      addToast(`${account.alias}: session restored silently`, 'success');
      fetchDashboard(true);
      return true;
    } catch {
      return false;
    }
  }, [addToast, fetchDashboard]);

  return {
    data,
    loading,
    refreshing,
    provisioningIds,
    liveStatuses,
    actionSessionTruth,
    cooldownMap,
    fetchDashboard,
    handleProvision,
    handleSilentRefresh,
  };
}
