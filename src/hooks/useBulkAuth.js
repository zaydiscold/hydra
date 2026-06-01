import { useState, useCallback, useEffect, useRef } from 'react';
import * as api from '../api';
import { accountNeedsSession } from '../utils/accountSession';
import { isOtpAuthMethod } from '../utils/authMethod';
import { remainingEmailTextAfterUse } from '../utils/auth';
import {
  clearTrackedInterval,
  clearTrackedTimeout,
  setTrackedInterval,
  setTrackedTimeout,
} from '../lib/runtimeDiagnostics.js';

const POLL_INTERVAL = 5000;
const BULK_MAGIC_LINK_SEND_DELAY_MS = 6500;

function normalizeMagicLinkCapability(response) {
  const payload = response?.data ?? response;
  if (!payload || typeof payload !== 'object') {
    return {
      status: 'error',
      available: null,
      message: 'Email Link capability response was malformed. Use OTP until Hydra can re-check the callback.',
    };
  }
  return {
    status: 'ready',
    available: !!payload.available,
    message: payload.message || '',
    hint: payload.hint || '',
    fallback: payload.fallback || '',
    code: payload.code || '',
    callbackOrigin: payload.callbackOrigin || '',
    callbackPath: payload.callbackPath || '',
  };
}

function normalizeBulkOtpStubResults(response) {
  const payload = response?.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  const err = new Error('Bulk stub response was malformed. Expected data.results array.');
  err.code = 'BULK_STUB_BAD_RESPONSE';
  throw err;
}

/**
 * Custom hook for Bulk Authentication logic.
 * Manages both Email Link (Magic Link) and OTP flows.
 */
export function useBulkAuth(addToast) {
  // Common state
  const [pasteText, setPasteText] = useState('');
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState('');
  const [errorCopyCommand, setErrorCopyCommand] = useState('');
  const [bulkForceReplace, setBulkForceReplace] = useState(false);
  const [magicLinkCapability, setMagicLinkCapability] = useState({
    status: 'checking',
    available: null,
    message: 'Checking Email Link callback...',
  });

  // Email Link (Magic Link) Tab State
  const [emailLinkRows, setEmailLinkRows] = useState([]);
  const [emailLinkLog, setEmailLinkLog] = useState([]);
  const pollRefs = useRef({});
  const pollTimerRef = useRef(null);
  const unmountedRef = useRef(false);
  const lifecycleAbortRef = useRef(null);
  const magicLinkSendDelayCancelsRef = useRef(new Set());

  // OTP Tab State
  const [otpQueue, setOtpQueue] = useState([]);
  const [otpCurrentIdx, setOtpCurrentIdx] = useState(0);
  const [otpLog, setOtpLog] = useState([]);
  const [otpSignInId, setOtpSignInId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMergeBusy, setOtpMergeBusy] = useState(false);
  const [otpFetchingKeys, setOtpFetchingKeys] = useState(false);
  const [otpProvisionEnabled, setOtpProvisionEnabled] = useState(true);
  const [otpKeyName, setOtpKeyName] = useState('hydra-bulk');
  const [otpStubSummary, setOtpStubSummary] = useState(null);

  const appendEmailLinkLog = useCallback((msg) => {
    setEmailLinkLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 100));
  }, []);

  const appendOtpLog = useCallback((msg) => {
    setOtpLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 100));
  }, []);

  const resetErrors = useCallback(() => {
    setLocalError('');
    setErrorCopyCommand('');
  }, []);

  // --- Email Link Logic ---

  const refreshMagicLinkCapability = useCallback(async (signalOverride) => {
    const signal = signalOverride ?? lifecycleAbortRef.current?.signal;
    if (!signal || signal.aborted || unmountedRef.current) return null;
    setMagicLinkCapability((prev) => ({
      ...prev,
      status: prev.status === 'ready' ? 'refreshing' : 'checking',
    }));
    try {
      const res = await api.getMagicLinkCapability(signal);
      if (signal.aborted || unmountedRef.current) return null;
      const capability = normalizeMagicLinkCapability(res);
      setMagicLinkCapability(capability);
      return capability;
    } catch (err) {
      if (signal.aborted || unmountedRef.current) return null;
      const capability = {
        status: 'error',
        available: null,
        message: api.formatApiErrorMessage(err),
      };
      setMagicLinkCapability(capability);
      return capability;
    }
  }, []);

  const waitForMagicLinkSendDelay = useCallback((delayMs) => {
    const signal = lifecycleAbortRef.current?.signal;
    if (!signal || signal.aborted || unmountedRef.current) return Promise.resolve(false);

    return new Promise((resolve) => {
      let timer = null;
      let settled = false;
      const finish = (shouldContinue) => {
        if (settled) return;
        settled = true;
        clearTrackedTimeout(timer);
        signal.removeEventListener('abort', cancel);
        magicLinkSendDelayCancelsRef.current.delete(cancel);
        resolve(shouldContinue);
      };
      const cancel = () => finish(false);
      timer = setTrackedTimeout('useBulkAuth.magicLinkSendDelay', () => finish(true), delayMs);
      magicLinkSendDelayCancelsRef.current.add(cancel);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }, []);

  const updateEmailLinkRow = useCallback((email, patch) => {
    setEmailLinkRows((prev) => prev.map((r) => (r.email === email ? { ...r, ...patch } : r)));
  }, []);

  const stopMagicLinkPolling = useCallback((email) => {
    delete pollRefs.current[email];
    if (Object.keys(pollRefs.current).length === 0 && pollTimerRef.current) {
      clearTrackedInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const ensureMagicLinkPoller = useCallback(() => {
    if (pollTimerRef.current) return;

    pollTimerRef.current = setTrackedInterval('useBulkAuth.magicLinkPoller', () => {
      if (unmountedRef.current) {
        clearTrackedInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        return;
      }

      const pollEntries = Object.entries(pollRefs.current).filter(([, poll]) => !poll.inFlight);
      if (pollEntries.length === 0) return;
      const signal = lifecycleAbortRef.current?.signal;
      if (!signal || signal.aborted) return;

      void (async () => {
        const completed = [];
        try {
          await Promise.all(pollEntries.map(async ([email, poll]) => {
            poll.inFlight = true;
            try {
              const res = await api.getMagicLinkStatusQuiet(poll.accountId, poll.signInId, signal);
              if (signal.aborted || unmountedRef.current) return;
              poll.consecutiveFailures = 0;
              const st = res?.data?.status ?? res?.status;
              if (st === 'completed_or_expired') {
                completed.push([email, poll]);
              }
            } catch (err) {
              if (signal.aborted || unmountedRef.current) return;
              poll.consecutiveFailures += 1;
              if (poll.consecutiveFailures >= 3) {
                stopMagicLinkPolling(email);
                updateEmailLinkRow(email, { status: 'error', message: 'Poll failed — check connection' });
                appendEmailLinkLog(`✗ magic link poll failed after 3 errors → ${email}: ${err?.message || 'unknown'}`);
              }
            }
          }));

          if (signal.aborted || unmountedRef.current || completed.length === 0) return;

          await Promise.all(completed.map(async ([email, poll]) => {
            try {
              const res = await api.checkSessionLiveQuiet(poll.accountId, signal);
              if (signal.aborted || unmountedRef.current) return;
              const status = res?.data?.status ?? res?.status;
              if (status === 'active') {
                stopMagicLinkPolling(email);
                updateEmailLinkRow(email, { status: 'done', message: '✓ Signed in — live session confirmed' });
                appendEmailLinkLog(`✓ magic link claimed and live session confirmed → ${email}`);
                addToast?.(`${email} signed in via magic link`, 'success');
              } else {
                stopMagicLinkPolling(email);
                updateEmailLinkRow(email, { status: 'error', message: 'Link expired or session was not confirmed — resend' });
                appendEmailLinkLog(`✗ magic link ended without an active Clerk session → ${email} (${status || 'unknown'})`);
              }
            } catch (err) {
              if (signal.aborted || unmountedRef.current) return;
              poll.consecutiveFailures += 1;
              if (poll.consecutiveFailures >= 3) {
                stopMagicLinkPolling(email);
                updateEmailLinkRow(email, { status: 'error', message: 'Session confirmation failed — check connection' });
                appendEmailLinkLog(`✗ magic link live confirmation failed after 3 errors → ${email}: ${err?.message || 'unknown'}`);
              }
            }
          }));
        } finally {
          for (const [, poll] of pollEntries) poll.inFlight = false;
        }
      })();
    }, POLL_INTERVAL);
  }, [addToast, appendEmailLinkLog, stopMagicLinkPolling, updateEmailLinkRow]);

  const startMagicLinkPolling = useCallback((email, accountId, signInId) => {
    if (unmountedRef.current) return;
    pollRefs.current[email] = {
      accountId,
      signInId,
      consecutiveFailures: 0,
      inFlight: false,
    };
    ensureMagicLinkPoller();
  }, [ensureMagicLinkPoller]);

  useEffect(() => {
    unmountedRef.current = false;
    const controller = new AbortController();
    lifecycleAbortRef.current = controller;
    const signal = controller.signal;
    const activePolls = pollRefs.current;
    const delayCancels = magicLinkSendDelayCancelsRef.current;
    const onMessage = (evt) => {
      if (!evt.data || evt.data.type !== 'hydra:magic-link-done') return;
      const { email, signInId: doneSignInId } = evt.data;
      if (!email) return;
      const poll = activePolls[email];
      if (!poll || (doneSignInId && doneSignInId !== poll.signInId)) return;

      updateEmailLinkRow(email, { status: 'sent', message: 'Link clicked — confirming session…' });
      void api.checkSessionLiveQuiet(poll.accountId, signal)
        .then((res) => {
          if (signal.aborted || unmountedRef.current) return;
          const status = res?.data?.status ?? res?.status;
          if (status !== 'active') {
            appendEmailLinkLog(`magic link clicked; Clerk session not active yet → ${email} (${status || 'unknown'})`);
            return;
          }
          stopMagicLinkPolling(email);
          updateEmailLinkRow(email, { status: 'done', message: '✓ Signed in — live session confirmed' });
          appendEmailLinkLog(`✓ magic link claimed and live session confirmed → ${email}`);
          addToast?.(`${email} signed in via magic link`, 'success');
        })
        .catch((err) => {
          if (signal.aborted || unmountedRef.current) return;
          appendEmailLinkLog(`magic link clicked; live session confirmation failed → ${email}: ${err?.message || 'unknown'}`);
        });
    };
    window.addEventListener('message', onMessage);
    void refreshMagicLinkCapability(signal);
    return () => {
      window.removeEventListener('message', onMessage);
      unmountedRef.current = true;
      controller.abort();
      if (lifecycleAbortRef.current === controller) lifecycleAbortRef.current = null;
      for (const cancel of delayCancels) cancel();
      delayCancels.clear();
      for (const email of Object.keys(activePolls)) delete activePolls[email];
      if (pollTimerRef.current) {
        clearTrackedInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [addToast, appendEmailLinkLog, refreshMagicLinkCapability, stopMagicLinkPolling, updateEmailLinkRow]);

  const handleSendMagicLinks = useCallback(async ({ emails, duplicates = [] }) => {
    if (!emails.length) { setLocalError('Paste at least one email.'); return; }
    const signal = lifecycleAbortRef.current?.signal;
    if (!signal || signal.aborted || unmountedRef.current) return;
    resetErrors();
    setCreating(true);
    if (duplicates.length) {
      appendEmailLinkLog(`Skipped repeated pasted email(s): ${[...new Set(duplicates)].join(', ')}`);
    }

    try {
      const capability = await refreshMagicLinkCapability(signal);
      if (signal.aborted || unmountedRef.current) return;
      if (!capability?.available) {
        const message = capability?.message || 'Email Link is unavailable until Hydra has a public Clerk callback configured.';
        setLocalError(message);
        setEmailLinkRows(emails.map((email) => ({
          email,
          id: `unavailable-${email}`,
          signInId: null,
          status: 'error',
          message: 'Use OTP or configure a public callback',
          canRetry: false,
        })));
        appendEmailLinkLog(`Email Link unavailable before queue creation: ${message}`);
        return;
      }

      const res = await api.bulkOtpStubs(emails, signal, { forceReplace: bulkForceReplace });
      if (signal.aborted || unmountedRef.current) return;
      const stubResults = normalizeBulkOtpStubResults(res);
      const skippedEmails = stubResults
        .filter(r => !r.account)
        .map(r => r.email)
        .filter(Boolean);
      const newRows = stubResults
        .filter(r => r.account)
        .map(r => ({
          email: r.account.email,
          id: r.account.id,
          signInId: null,
          status: 'idle',
          message: r.replaced ? 'Replacing existing account sign-in…' : '',
          replaced: !!r.replaced,
        }));

      if (!newRows.length) {
        const duplicateSkips = stubResults.filter(r => r.skipped === 'duplicate_email').map(r => r.email).filter(Boolean);
        setLocalError(duplicateSkips.length
          ? `All pasted rows already exist. Enable Force replace to rebuild those sign-in stubs: ${duplicateSkips.join(', ')}`
          : 'No queue rows were returned. Check server logs for bulk-otp-stubs processing.');
        setCreating(false);
        return;
      }

      setEmailLinkRows(newRows);
      const replacedCount = newRows.filter((r) => r.replaced).length;
      if (skippedEmails.length) appendEmailLinkLog(`Skipped existing email(s): ${skippedEmails.join(', ')}`);
      appendEmailLinkLog(`Prepared ${newRows.length} account row(s)${replacedCount ? ` (${replacedCount} replaced)` : ''} — sending one at a time with rate-limit pacing…`);

      const usedEmails = [];
      for (let idx = 0; idx < newRows.length; idx += 1) {
        const row = newRows[idx];
        const shouldSend = await waitForMagicLinkSendDelay(idx === 0 ? 0 : BULK_MAGIC_LINK_SEND_DELAY_MS);
        if (!shouldSend || signal.aborted || unmountedRef.current) return;
        updateEmailLinkRow(row.email, { status: 'sending', message: 'Sending…' });
        try {
          const res = await api.sendMagicLink(row.id, row.email, signal);
          if (signal.aborted || unmountedRef.current) return;
          const signInId = res?.data?.signInId ?? res?.signInId;
          updateEmailLinkRow(row.email, { status: 'sent', signInId, message: 'Check inbox — click the link' });
          appendEmailLinkLog(`magic link sent → ${row.email}`);
          usedEmails.push(row.email);
          if (signInId) startMagicLinkPolling(row.email, row.id, signInId);
        } catch (err) {
          if (signal.aborted || unmountedRef.current) return;
          const errMsg = api.formatApiErrorMessage(err);
          updateEmailLinkRow(row.email, { status: 'error', message: errMsg });
          appendEmailLinkLog(`✗ magic link failed → ${row.email}: ${errMsg}`);
          if (err.code === 'MAGIC_LINK_CALLBACK_UNAVAILABLE') {
            setLocalError(errMsg);
            for (const pendingRow of newRows.slice(idx + 1)) {
              updateEmailLinkRow(pendingRow.email, {
                status: 'error',
                message: 'Email Link unavailable until HYDRA_MAGIC_LINK_CALLBACK_ORIGIN is configured',
              });
            }
            break;
          }
        }
      }
      if (signal.aborted || unmountedRef.current) return;
      if (usedEmails.length) setPasteText((prev) => remainingEmailTextAfterUse(prev, usedEmails));
      addToast?.(`Magic-link send finished: ${usedEmails.length}/${newRows.length} sent`, usedEmails.length ? 'info' : 'warning');
    } catch (err) {
      if (signal.aborted || unmountedRef.current) return;
      setLocalError(api.formatApiErrorMessage(err));
    } finally {
      if (!unmountedRef.current) setCreating(false);
    }
  }, [addToast, appendEmailLinkLog, bulkForceReplace, refreshMagicLinkCapability, resetErrors, setPasteText, startMagicLinkPolling, updateEmailLinkRow, waitForMagicLinkSendDelay]);

  const handleResendMagicLink = useCallback(async (row) => {
    const signal = lifecycleAbortRef.current?.signal;
    if (!signal || signal.aborted || unmountedRef.current) return;
    updateEmailLinkRow(row.email, { status: 'sending', message: 'Re-sending…' });
    try {
      const capability = await refreshMagicLinkCapability(signal);
      if (signal.aborted || unmountedRef.current) return;
      if (!capability?.available) {
        const message = capability?.message || 'Email Link is unavailable until Hydra has a public Clerk callback configured.';
        setLocalError(message);
        updateEmailLinkRow(row.email, {
          status: 'error',
          message: 'Use OTP or configure a public callback',
          canRetry: false,
        });
        appendEmailLinkLog(`Email Link unavailable before retry: ${message}`);
        return;
      }
      const res = await api.sendMagicLink(row.id, row.email, signal);
      if (signal.aborted || unmountedRef.current) return;
      const signInId = res?.data?.signInId ?? res?.signInId;
      updateEmailLinkRow(row.email, { status: 'sent', signInId, message: '📧 Check inbox — click the link' });
      appendEmailLinkLog(`magic link re-sent → ${row.email}`);
      startMagicLinkPolling(row.email, row.id, signInId);
    } catch (err) {
      if (signal.aborted || unmountedRef.current) return;
      updateEmailLinkRow(row.email, { status: 'error', message: api.formatApiErrorMessage(err) });
    }
  }, [appendEmailLinkLog, refreshMagicLinkCapability, startMagicLinkPolling, updateEmailLinkRow]);

  // --- OTP Logic ---

  const handleCreateOtpStubs = useCallback(async ({ emails, duplicates = [] }) => {
    if (!emails.length) { setLocalError('Add at least one email.'); return; }
    const signal = lifecycleAbortRef.current?.signal;
    if (!signal || signal.aborted || unmountedRef.current) return;
    resetErrors();
    setCreating(true);
    setOtpStubSummary(null);
    setOtpSignInId('');
    setOtpCode('');
    if (duplicates.length) {
      appendOtpLog(`Skipped repeated pasted email(s): ${[...new Set(duplicates)].join(', ')}`);
    }
    try {
      const res = await api.bulkOtpStubs(emails, signal, { forceReplace: bulkForceReplace });
      if (signal.aborted || unmountedRef.current) return;
      const results = normalizeBulkOtpStubResults(res);
      let created = 0, reused = 0, replaced = 0, dup = 0, failed = 0;
      const nextQueue = [];
      const usedEmails = [];
      for (const row of results) {
        if (row.account) {
          if (row.replaced) replaced++;
          else if (row.reused) reused++;
          else created++;
          usedEmails.push(row.account.email);
          nextQueue.push({
            id: row.account.id,
            alias: row.account.alias,
            email: row.account.email,
            verified: false,
            skipped: false,
            managementKey: null,
            reused: !!row.reused,
            replaced: !!row.replaced,
            fromExisting: !!row.reused,
          });
        } else {
          if (row.skipped === 'duplicate_email') dup++;
          else failed++;
          appendOtpLog(`stub skip/fail ${row.email}: ${row.error || row.skipped || 'unknown'}`);
        }
      }
      setOtpQueue(nextQueue);
      setOtpCurrentIdx(0);
      setOtpStubSummary({ created, reused, replaced, duplicateEmail: dup, failed, inputLines: emails.length, resultRows: results.length });
      appendOtpLog(`Queue built in pasted order: ${created} new, ${reused} reused, ${replaced} replaced, ${dup} dup-skip, ${failed} errors`);
      if (usedEmails.length) setPasteText((prev) => remainingEmailTextAfterUse(prev, usedEmails));
      if (nextQueue.length) addToast?.(`Created ${nextQueue.length} OTP row(s)`, 'success');
    } catch (err) {
      if (signal.aborted || unmountedRef.current) return;
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
    } finally {
      if (!unmountedRef.current) setCreating(false);
    }
  }, [addToast, appendOtpLog, bulkForceReplace, resetErrors, setPasteText]);

  const handleSendOtpCode = useCallback(async (current) => {
    if (!current) return;
    resetErrors();
    setOtpBusy(true);
    try {
      const res = await api.startOTP(current.id, current.email);
      setOtpSignInId(res?.data?.signInId ?? res?.signInId ?? '');
      appendOtpLog(`OTP sent → ${current.email}`);
      addToast?.('Check email for the 6-digit code', 'info');
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
    } finally {
      setOtpBusy(false);
    }
  }, [addToast, appendOtpLog, resetErrors]);

  const handleVerifyOtp = useCallback(async (current, code) => {
    if (!current || code.length !== 6) return;
    resetErrors();
    setOtpBusy(true);
    try {
      await api.verifyOTP(current.id, otpSignInId, code);
      appendOtpLog(`verified → ${current.email}`);
      setOtpQueue((q) => q.map((item, i) => (i === otpCurrentIdx ? { ...item, verified: true } : item)));
      addToast?.(`${current.email} verified`, 'success');
      setOtpSignInId('');
      setOtpCode('');
      
      // Auto-provision if enabled
      if (otpProvisionEnabled) {
        // Parallel provisioning — don't await, let it run in background
        setOtpQueue((q) => q.map((item, i) => (i === otpCurrentIdx ? { ...item, provisioning: true } : item)));
        api.provisionManagementKey(current.id, otpKeyName)
          .then((pres) => {
            const key = pres?.data?.key ?? pres?.key;
            if (key) {
              setOtpQueue((q) => q.map((item) => (item.id === current.id ? { ...item, managementKey: key, provisioning: false } : item)));
              appendOtpLog(`provisioned → ${current.email}`);
              addToast?.(`Management key provisioned for ${current.email}`, 'success');
            } else {
              setOtpQueue((q) => q.map((item) => (item.id === current.id ? { ...item, provisioning: false } : item)));
              appendOtpLog(`provision finished (no key) → ${current.email}`);
              addToast?.('Verified but key provision failed — check account detail', 'warn');
            }
          })
          .catch((perr) => {
            setOtpQueue((q) => q.map((item) => (item.id === current.id ? { ...item, provisioning: false } : item)));
            appendOtpLog(`provision fail → ${current.email}: ${perr.message}`);
            addToast?.('Verified but key provision failed — check account detail', 'warn');
          });
      }

      setOtpCurrentIdx((i) => Math.min(i + 1, otpQueue.length - 1));
      return true;
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
      return false;
    } finally {
      setOtpBusy(false);
    }
  }, [addToast, appendOtpLog, otpQueue.length, otpSignInId, otpCurrentIdx, otpProvisionEnabled, otpKeyName, resetErrors]);

  const handleProvisionOtpKey = useCallback(async (current, silent = false) => {
    if (!current) return;
    if (!silent) { resetErrors(); setOtpBusy(true); }
    try {
      const res = await api.provisionManagementKey(current.id, otpKeyName);
      const key = res?.data?.key ?? res?.key;
      if (key) {
        setOtpQueue((q) => q.map((item) => (item.id === current.id ? { ...item, managementKey: key } : item)));
        appendOtpLog(`provisioned key → ${current.email}`);
      }
    } catch (err) {
      appendOtpLog(`provision failed → ${current.email}: ${err.message}`);
      if (!silent) addToast?.(`Provision failed for ${current.email}: ${err.message}`, 'warning');
    } finally {
      if (!silent) setOtpBusy(false);
    }
  }, [addToast, appendOtpLog, otpKeyName, resetErrors]);

  const handleFetchOtpKeys = useCallback(async () => {
    setOtpFetchingKeys(true);
    let fetched = 0, missing = 0, failed = 0;
    const verifiedItems = otpQueue.filter(i => i.verified && !i.managementKey);
    
    for (const item of verifiedItems) {
      try {
        const res = await api.getAccountManagementKey(item.id);
        const key = res?.data?.managementKey ?? res?.managementKey ?? res?.data?.key ?? res?.key;
        if (key) {
          fetched++;
          setOtpQueue((q) => q.map((qi) => (qi.id === item.id ? { ...qi, managementKey: key } : qi)));
          appendOtpLog(`key fetched → ${item.email}`);
        } else {
          missing++;
          appendOtpLog(`no key yet → ${item.email}`);
        }
      } catch (err) {
        if (err?.status === 404) {
          missing++;
          appendOtpLog(`no key yet → ${item.email}`);
        } else {
          failed++;
          appendOtpLog(`key fetch failed → ${item.email}: ${err?.message || 'unknown error'}`);
        }
      }
    }
    if (fetched > 0) addToast?.(`Fetched ${fetched} key(s)`, 'success');
    if (missing > 0) addToast?.(`${missing} account(s) not yet provisioned`, 'warning');
    if (failed > 0) addToast?.(`${failed} account key fetch request(s) failed`, 'error');
    setOtpFetchingKeys(false);
  }, [addToast, appendOtpLog, otpQueue]);

  const handleMergeExistingOtp = useCallback(async () => {
    resetErrors();
    setOtpMergeBusy(true);
    setOtpSignInId('');
    setOtpCode('');
    try {
      const res = await api.getAccounts();
      const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : null;
      if (!list) {
        const err = new Error('Saved-account merge failed: malformed accounts response.');
        err.code = 'MERGE_ACCOUNTS_BAD_RESPONSE';
        throw err;
      }
      const candidates = list.filter(
        (a) => a.email && isOtpAuthMethod(a.authMethod) && accountNeedsSession(a.sessionStatus)
      );
      
      let mergedLen = 0;
      setOtpQueue((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        const merged = candidates
          .filter((a) => !ids.has(a.id))
          .map((a) => ({
            id: a.id, 
            alias: a.alias, 
            email: a.email, 
            verified: false, 
            skipped: false, 
            fromExisting: true, 
            managementKey: null 
          }));
        mergedLen = merged.length;
        return merged.length ? [...prev, ...merged] : prev;
      });
      
      if (mergedLen) {
        appendOtpLog(`queue +${mergedLen} existing OTP account(s)`);
        addToast?.(`Added ${mergedLen} existing account(s) to queue`, 'info');
      } else {
        addToast?.('No saved accounts currently need re-authentication', 'info');
      }
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
    } finally {
      setOtpMergeBusy(false);
    }
  }, [addToast, appendOtpLog, resetErrors]);

  const handleSkipOtp = useCallback((current) => {
    if (!current) return;
    appendOtpLog(`skipped → ${current.email}`);
    setOtpQueue((q) => q.map((item) => (item.id === current.id ? { ...item, skipped: true } : item)));
    setOtpSignInId('');
    setOtpCode('');
    resetErrors();
    setOtpCurrentIdx((i) => Math.min(i + 1, otpQueue.length - 1));
  }, [appendOtpLog, otpQueue.length, resetErrors]);

  return {
    pasteText, setPasteText,
    creating,
    bulkForceReplace,
    setBulkForceReplace,
    localError, resetErrors,
    errorCopyCommand,

    // Email Link
    magicLinkCapability,
    refreshMagicLinkCapability,
    emailLinkRows,
    emailLinkLog,
    handleSendMagicLinks,
    handleResendMagicLink,

    // OTP
    otpQueue,
    otpCurrentIdx, setOtpCurrentIdx,
    otpLog,
    otpSignInId,
    otpCode, setOtpCode,
    otpBusy,
    otpMergeBusy,
    otpFetchingKeys,
    otpProvisionEnabled, setOtpProvisionEnabled,
    otpKeyName, setOtpKeyName,
    otpStubSummary,
    handleCreateOtpStubs,
    handleSendOtpCode,
    handleVerifyOtp,
    handleProvisionOtpKey,
    handleFetchOtpKeys,
    handleMergeExistingOtp,
    handleSkipOtp
  };
}
