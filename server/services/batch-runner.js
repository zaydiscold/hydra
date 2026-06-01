import pLimit from 'p-limit';

function abortError(reason = 'Batch operation aborted') {
  if (reason instanceof Error) return reason;
  const err = new Error(String(reason || 'Batch operation aborted'));
  err.name = 'AbortError';
  return err;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function sleep(ms, signal = null) {
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
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function combineAbortSignals(...signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

export function bindRequestAbort(req, res, label = 'batch request') {
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

export async function runInBatches(items, worker, { concurrency = 3, delayMs = 1000, signal = null } = {}) {
  const results = [];
  throwIfAborted(signal);

  for (let index = 0; index < items.length; index += concurrency) {
    throwIfAborted(signal);
    const chunk = items.slice(index, index + concurrency);
    const limit = pLimit(concurrency);
    const chunkResults = await Promise.all(
      chunk.map((item, chunkIndex) => limit(() => {
        throwIfAborted(signal);
        return worker(item, index + chunkIndex, signal);
      }))
    );
    results.push(...chunkResults);

    if (delayMs > 0 && index + concurrency < items.length) {
      await sleep(delayMs, signal);
    }
  }

  return results;
}
