function abortError(reason = 'Operation aborted') {
  if (reason instanceof Error) return reason;
  const err = new Error(String(reason || 'Operation aborted'));
  err.name = 'AbortError';
  return err;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

export function combineAbortSignals(...signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

export function sleepWithSignal(ms, signal = null, { unref = false } = {}) {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      cleanup();
      reject(abortError(signal?.reason));
    };

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (unref) timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function bindRequestAbort(req, res, label = 'request') {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(abortError(`${label} disconnected`));
    }
  };
  const onResponseClose = () => {
    if (!res.writableEnded) abort();
  };

  req.once('aborted', abort);
  res.once('close', onResponseClose);
  if (req.aborted || (res.destroyed && !res.writableEnded)) abort();

  return {
    signal: controller.signal,
    dispose() {
      req.off('aborted', abort);
      res.off('close', onResponseClose);
    },
  };
}
