import { useState, useCallback, useEffect, useRef } from 'react';
import * as api from '../api';
import { accountNeedsSession } from '../utils/accountSession';

const POLL_INTERVAL = 5000;

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

  // Email Link (Magic Link) Tab State
  const [emailLinkRows, setEmailLinkRows] = useState([]);
  const [emailLinkLog, setEmailLinkLog] = useState([]);
  const pollRefs = useRef({});
  const unmountedRef = useRef(false);

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

  const updateEmailLinkRow = useCallback((email, patch) => {
    setEmailLinkRows((prev) => prev.map((r) => (r.email === email ? { ...r, ...patch } : r)));
  }, []);

  const startMagicLinkPolling = useCallback((email, accountId, signInId) => {
    if (unmountedRef.current) return;
    if (pollRefs.current[email]) clearInterval(pollRefs.current[email]);

    let consecutiveFailures = 0;

    pollRefs.current[email] = setInterval(async () => {
      if (unmountedRef.current) { clearInterval(pollRefs.current[email]); return; }
      try {
        const res = await api.getMagicLinkStatus(accountId, signInId);
        consecutiveFailures = 0;
        const st = res?.data?.status ?? res?.status;
        if (st === 'completed_or_expired') {
          clearInterval(pollRefs.current[email]);
          delete pollRefs.current[email];
          const accs = await api.getAccounts();
          const list = Array.isArray(accs?.data) ? accs.data : [];
          const acc = list.find((a) => a.id === accountId);
          if (acc && acc.sessionStatus === 'active') {
            updateEmailLinkRow(email, { status: 'done', message: '✓ Signed in' });
            appendEmailLinkLog(`✓ magic link claimed → ${email}`);
            addToast?.(`${email} signed in via magic link`, 'success');
          } else {
            updateEmailLinkRow(email, { status: 'sent', message: 'Waiting for click…' });
          }
        }
      } catch (err) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          clearInterval(pollRefs.current[email]);
          delete pollRefs.current[email];
          updateEmailLinkRow(email, { status: 'error', message: 'Poll failed — check connection' });
          appendEmailLinkLog(`✗ magic link poll failed after 3 errors → ${email}: ${err?.message || 'unknown'}`);
        }
      }
    }, POLL_INTERVAL);
  }, [addToast, appendEmailLinkLog, updateEmailLinkRow]);

  useEffect(() => {
    const activePolls = pollRefs.current;
    const onMessage = (evt) => {
      if (!evt.data || evt.data.type !== 'hydra:magic-link-done') return;
      const { email, signInId: doneSignInId } = evt.data;
      if (!email) return;
      if (doneSignInId && activePolls[email]) {
        clearInterval(activePolls[email]);
        delete activePolls[email];
      }
      updateEmailLinkRow(email, { status: 'done', message: '✓ Signed in (instant)' });
      appendEmailLinkLog(`✓ postMessage received — magic link claimed → ${email}`);
      addToast?.(`${email} signed in via magic link`, 'success');
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      unmountedRef.current = true;
      for (const t of Object.values(activePolls)) clearInterval(t);
    };
  }, [addToast, appendEmailLinkLog, updateEmailLinkRow]);

  const handleSendMagicLinks = useCallback(async (emails) => {
    if (!emails.length) { setLocalError('Paste at least one email.'); return; }
    resetErrors();
    setCreating(true);

    try {
      const res = await api.bulkOtpStubs(emails);
      const stubResults = normalizeBulkOtpStubResults(res);
      const newRows = stubResults
        .filter(r => r.account)
        .map(r => ({ email: r.account.email, id: r.account.id, signInId: null, status: 'idle', message: '' }));

      if (!newRows.length) {
        setLocalError('No queue rows were returned. Check server logs for bulk-otp-stubs processing.');
        setCreating(false);
        return;
      }

      setEmailLinkRows(newRows);
      appendEmailLinkLog(`Created ${newRows.length} account stub(s) — sending magic links in parallel…`);

      await Promise.all(
        newRows.map((row, idx) =>
          new Promise((resolve) => setTimeout(resolve, idx * 400)).then(async () => {
            updateEmailLinkRow(row.email, { status: 'sending', message: 'Sending…' });
            try {
              const res = await api.sendMagicLink(row.id, row.email);
              const signInId = res?.data?.signInId ?? res?.signInId;
              updateEmailLinkRow(row.email, { status: 'sent', signInId, message: '📧 Check inbox — click the link' });
              appendEmailLinkLog(`magic link sent → ${row.email}`);
              if (signInId) startMagicLinkPolling(row.email, row.id, signInId);
            } catch (err) {
              const errMsg = api.formatApiErrorMessage(err);
              updateEmailLinkRow(row.email, { status: 'error', message: errMsg });
              appendEmailLinkLog(`✗ magic link failed → ${row.email}: ${errMsg}`);
            }
          })
        )
      );
      addToast?.(`Sent magic links to ${newRows.length} account(s)`, 'info');
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }, [addToast, appendEmailLinkLog, resetErrors, startMagicLinkPolling, updateEmailLinkRow]);

  const handleResendMagicLink = useCallback(async (row) => {
    updateEmailLinkRow(row.email, { status: 'sending', message: 'Re-sending…' });
    try {
      const res = await api.sendMagicLink(row.id, row.email);
      const signInId = res?.data?.signInId ?? res?.signInId;
      updateEmailLinkRow(row.email, { status: 'sent', signInId, message: '📧 Check inbox — click the link' });
      appendEmailLinkLog(`magic link re-sent → ${row.email}`);
      startMagicLinkPolling(row.email, row.id, signInId);
    } catch (err) {
      updateEmailLinkRow(row.email, { status: 'error', message: api.formatApiErrorMessage(err) });
    }
  }, [appendEmailLinkLog, startMagicLinkPolling, updateEmailLinkRow]);

  // --- OTP Logic ---

  const handleCreateOtpStubs = useCallback(async (emails) => {
    if (!emails.length) { setLocalError('Add at least one email.'); return; }
    resetErrors();
    setCreating(true);
    setOtpStubSummary(null);
    setOtpSignInId('');
    setOtpCode('');
    try {
      const res = await api.bulkOtpStubs(emails);
      const results = normalizeBulkOtpStubResults(res);
      let created = 0, reused = 0, dup = 0, failed = 0;
      const nextQueue = [];
      for (const row of results) {
        if (row.account) {
          if (row.reused) reused++;
          else created++;
          nextQueue.push({
            id: row.account.id,
            alias: row.account.alias,
            email: row.account.email,
            verified: false,
            skipped: false,
            managementKey: null,
            reused: !!row.reused,
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
      setOtpStubSummary({ created, reused, duplicateEmail: dup, failed, inputLines: emails.length, resultRows: results.length });
      appendOtpLog(`Queue built in pasted order: ${created} new, ${reused} reused, ${dup} dup-skip, ${failed} errors`);
      if (nextQueue.length) addToast?.(`Created ${nextQueue.length} OTP row(s)`, 'success');
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
    } finally {
      setCreating(false);
    }
  }, [addToast, appendOtpLog, resetErrors]);

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
        (a) => a.email && (a.authMethod === 'otp' || a.authMethod === 'email') && accountNeedsSession(a.sessionStatus)
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
    localError, resetErrors,
    errorCopyCommand,

    // Email Link
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
