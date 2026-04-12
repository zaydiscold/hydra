import pLimit from 'p-limit';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runInBatches(items, worker, { concurrency = 3, delayMs = 1000 } = {}) {
  const results = [];

  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency);
    const limit = pLimit(concurrency);
    const chunkResults = await Promise.all(
      chunk.map((item, chunkIndex) => limit(() => worker(item, index + chunkIndex)))
    );
    results.push(...chunkResults);

    if (delayMs > 0 && index + concurrency < items.length) {
      await sleep(delayMs);
    }
  }

  return results;
}
