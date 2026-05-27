import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';
import { clearTrackedTimeout, setTrackedTimeout } from '../lib/runtimeDiagnostics.js';

function normalizeAccountKeys(keys) {
  if (Array.isArray(keys)) return keys;
  if (keys && Array.isArray(keys.list)) return keys.list;
  return [];
}

export function usePools({ addToast }) {
  const [accounts, setAccounts] = useState([]);
  const [poolStats, setPoolStats] = useState(null);
  const [masterKey, setMasterKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [proxyStatus, setProxyStatus] = useState('loading');
  const [proxyStatusStats, setProxyStatusStats] = useState(null);
  const [reloadingPool, setReloadingPool] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [modelCache, setModelCache] = useState(null);
  const [models, setModels] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [proxyOn, setProxyOn] = useState(true);

  const didInitialLoadRef = useRef(false);

  const loadPoolData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const optionalPoolCall = (label, promise) => promise.catch((err) => {
        console.warn(`[POOLS] ${label} unavailable:`, err.message);
        return null;
      });
      const [poolRes, keyRes, modelsRes, syncRes, proxyRes] = await Promise.all([
        api.getPoolData(),
        api.getMasterKey(),
        optionalPoolCall('model catalog', api.getPoolModels()),
        optionalPoolCall('sync status', api.getPoolSyncStatus()),
        optionalPoolCall('proxy toggle status', api.getProxyStatus()),
      ]);
      const rawAccounts = poolRes.data?.accounts ?? [];
      setAccounts(rawAccounts.map((a) => {
        const keys = normalizeAccountKeys(a.keys);
        const hasPooledKey = keys.some(k => k.isPooled);
        return {
          ...a,
          keys,
          poolStatus: hasPooledKey ? 'pooled' : 'not_pooled',
          modelGroup: a.modelGroup ?? null,
        };
      }));
      setPoolStats(poolRes.data?.poolStats ?? null);
      setModelCache(poolRes.data?.modelCache ?? null);
      setMasterKey(keyRes.data?.masterKey ?? '');
      setEndpoint(keyRes.data?.endpoint ?? '');
      if (modelsRes?.data?.models) setModels(modelsRes.data.models);
      if (syncRes?.data) setSyncStatus(syncRes.data);
      if (proxyRes?.data != null) setProxyOn(proxyRes.data.enabled ?? true);
    } catch (err) {
      if (addToast) addToast(err.message, 'error');
    }
    setLoading(false);
    setRefreshing(false);
  }, [addToast]);

  const loadProxyStatus = useCallback(async () => {
    let timeoutTimer = null;
    try {
      const timeout = new Promise((_, reject) => {
        timeoutTimer = setTrackedTimeout('usePools.proxyStatusTimeout', () => reject(new Error('timeout')), 5000);
      });
      const res = await Promise.race([api.getPoolStatus(), timeout]);
      clearTrackedTimeout(timeoutTimer);
      const data = res.data ?? {};
      setProxyStatus(data.proxy === 'online' ? 'online' : 'offline');
      setProxyStatusStats({
        pooled: data.pooled ?? 0,
        available: data.available ?? 0,
        cooldowns: data.cooldowns ?? 0,
        uptime: data.uptime ?? 0,
      });
    } catch (err) {
      clearTrackedTimeout(timeoutTimer);
      console.warn('[POOLS] Proxy status probe failed:', err.message);
      setProxyStatus('offline');
      setProxyStatusStats(null);
    }
  }, []);

  const load = useCallback(async (quiet = false) => {
    await Promise.all([loadPoolData(quiet), loadProxyStatus()]);
  }, [loadPoolData, loadProxyStatus]);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    load();
  }, [load]);

  async function handleToggleProxy() {
    const next = !proxyOn;
    try {
      await api.toggleProxy(next);
      setProxyOn(next);
      if (addToast) addToast(`Proxy ${next ? 'enabled' : 'disabled'}`, next ? 'success' : 'warning');
    } catch (err) {
      if (addToast) addToast(`Proxy toggle failed: ${err.message}`, 'error');
    }
  }

  async function handleToggleKey(hash, isPooled) {
    try {
      await api.toggleKeyPooled(hash, isPooled);
      if (addToast) addToast(`Key ${isPooled ? 'added to' : 'removed from'} pool`, 'success');
      await load(true);
    } catch (err) {
      if (addToast) addToast(err.message, 'error');
    }
  }

  async function handleToggleAccount(accountId, isPooled) {
    try {
      const res = await api.toggleAccountPooled(accountId, isPooled);
      if (addToast) addToast(`${res.data?.updated ?? 0} key(s) ${isPooled ? 'added to' : 'removed from'} pool`, 'success');
      await load(true);
    } catch (err) {
      if (addToast) addToast(err.message, 'error');
    }
  }

  async function handleRegister(hash, keyString) {
    try {
      await api.registerKeyString(hash, keyString);
      if (addToast) addToast('Key string saved and encrypted locally', 'success');
      await load(true);
    } catch (err) {
      if (addToast) addToast(err.message, 'error');
    }
  }

  async function handleRefreshModels() {
    setRefreshingModels(true);
    try {
      await api.refreshModels();
      if (addToast) addToast('Model list refreshed', 'success');
      await loadPoolData(true);
    } catch (err) {
      if (addToast) addToast(`Model refresh failed: ${err.message}`, 'error');
    } finally {
      setRefreshingModels(false);
    }
  }

  async function handleAutoProvision(accountId) {
    try {
      const res = await api.autoProvisionPoolKey(accountId);
      if (addToast) addToast(`Key "${res.data?.name}" created and added to pool`, 'success');
      await load(true);
    } catch (err) {
      if (addToast) addToast(`Auto-provision failed: ${err.message}`, 'error');
    }
  }

  async function handleSyncKeys(accountId) {
    try {
      const res = await api.syncPoolKeys(accountId);
      const n = res.data?.synced ?? 0;
      if (addToast) {
        addToast(n > 0 ? `Synced ${n} key string(s) from OpenRouter` : 'No key strings found via sync — try pasting manually', n > 0 ? 'success' : 'warning');
      }
      await load(true);
    } catch (err) {
      if (addToast) addToast(`Sync failed: ${err.message}`, 'error');
    }
  }

  async function handleDisableKey(hash, currentlyEnabled) {
    try {
      await api.disablePoolKey(hash, currentlyEnabled);
      if (addToast) addToast(`Key ${currentlyEnabled ? 'disabled' : 're-enabled'}`, 'success');
      await load(true);
    } catch (err) {
      if (addToast) addToast(`Toggle failed: ${err.message}`, 'error');
    }
  }

  async function handleDeleteKey(hash) {
    try {
      await api.deletePoolKey(hash);
      if (addToast) addToast('Key deleted from OpenRouter and local DB', 'success');
      await load(true);
    } catch (err) {
      if (addToast) addToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  async function handleReloadPool() {
    setReloadingPool(true);
    try {
      await api.reloadPool();
      if (addToast) addToast('Pool reloaded', 'success');
      await load(true);
    } catch (err) {
      if (addToast) addToast(err.message, 'error');
      await loadProxyStatus();
    } finally {
      setReloadingPool(false);
    }
  }

  const [rotatingKey, setRotatingKey] = useState(false);

  async function handleRotateMasterKey() {
    setRotatingKey(true);
    try {
      const res = await api.rotateMasterKey();
      setMasterKey(res.data?.masterKey ?? '');
      if (addToast) addToast('Master key rotated — update your clients', 'warning');
    } catch (err) {
      if (addToast) addToast(`Rotate failed: ${err.message}`, 'error');
    } finally {
      setRotatingKey(false);
    }
  }

  return {
    accounts,
    poolStats,
    masterKey,
    endpoint,
    loading,
    refreshing,
    proxyStatus,
    proxyStatusStats,
    reloadingPool,
    refreshingModels,
    modelCache,
    models,
    syncStatus,
    proxyOn,
    load,
    loadProxyStatus,
    loadPoolData,
    handleToggleProxy,
    handleToggleKey,
    handleToggleAccount,
    handleRegister,
    handleRefreshModels,
    handleAutoProvision,
    handleSyncKeys,
    handleDisableKey,
    handleDeleteKey,
    handleReloadPool,
    handleRotateMasterKey,
    rotatingKey,
  };
}
