import { once } from 'node:events';
import { Readable, Transform } from 'node:stream';

/**
 * Observes OpenAI/OpenRouter SSE frames while forwarding bytes unchanged.
 */
export class SseUsageObserver extends Transform {
  constructor(options = {}) {
    super(options);
    this._buffer = '';
    this._usage = null;
    this._extractedModel = null;
    this._sawDone = false;
  }

  _transform(chunk, _encoding, callback) {
    this.push(chunk);
    this.observeChunk(chunk);
    callback();
  }

  _flush(callback) {
    if (this._buffer.trim()) this._parseFrames();
    callback();
  }

  observeChunk(chunk) {
    this._buffer += chunk.toString('utf8');
    this._parseFrames();
  }

  _parseFrames() {
    while (true) {
      const boundary = this._buffer.indexOf('\n\n');
      if (boundary < 0) break;

      const frame = this._buffer.slice(0, boundary);
      this._buffer = this._buffer.slice(boundary + 2);

      const dataLines = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      for (const dataLine of dataLines) {
        if (dataLine === '[DONE]') {
          this._sawDone = true;
          continue;
        }
        try {
          const parsed = JSON.parse(dataLine);
          if (parsed?.usage) this._usage = parsed.usage;
          if (parsed?.model) this._extractedModel = parsed.model;
        } catch {
          // Ignore non-JSON SSE events.
        }
      }
    }
  }

  get usage() { return this._usage; }
  get extractedModel() { return this._extractedModel; }
  get sawDone() { return this._sawDone; }
}

export function sseInterruptionFrame(reason) {
  return `data: ${JSON.stringify({ error: { message: reason, code: 'STREAM_INTERRUPTED' } })}\n\n`
    + 'data: [DONE]\n\n';
}

async function writeWithBackpressure(res, chunk) {
  if (res.destroyed || res.writableEnded) return false;
  if (res.write(chunk)) return true;
  await once(res, 'drain');
  return !res.destroyed && !res.writableEnded;
}

export async function forwardSseStream({ upstreamBody, res, observer, abortUpstream }) {
  const nodeStream = Readable.fromWeb(upstreamBody);
  let clientClosed = false;

  res.on('close', () => {
    clientClosed = !res.writableEnded;
    if (clientClosed) abortUpstream?.();
  });

  try {
    for await (const chunk of nodeStream) {
      observer.observeChunk(chunk);
      const wrote = await writeWithBackpressure(res, chunk);
      if (!wrote) return { interrupted: true, reason: 'client disconnected' };
    }
  } catch (err) {
    const reason = err?.message || 'upstream stream closed unexpectedly';
    if (!clientClosed && !res.destroyed && !res.writableEnded) {
      await writeWithBackpressure(res, sseInterruptionFrame(reason));
      res.end();
    }
    return { interrupted: true, reason };
  }

  if (!observer.sawDone && !clientClosed && !res.destroyed && !res.writableEnded) {
    const reason = 'upstream stream closed prematurely';
    await writeWithBackpressure(res, sseInterruptionFrame(reason));
    res.end();
    return { interrupted: true, reason };
  }

  if (!res.destroyed && !res.writableEnded) res.end();
  return { interrupted: false, reason: null };
}
