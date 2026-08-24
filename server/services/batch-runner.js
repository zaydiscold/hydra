import pLimit from 'p-limit';
import { sleepWithSignal, throwIfAborted } from '../lib/abort.js';

export { bindRequestAbort, combineAbortSignals, throwIfAborted } from '../lib/abort.js';

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

    if (index + concurrency < items.length) {
      const resolvedDelayMs = typeof delayMs === 'function' ? delayMs() : delayMs;
      if (resolvedDelayMs > 0) await sleepWithSignal(resolvedDelayMs, signal, { unref: true });
    }
  }

  return results;
}
