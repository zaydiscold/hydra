// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { SseUsageObserver, forwardSseStream } from '../lib/sse-stream.js';

const encoder = new TextEncoder();

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.chunks = [];
    this.destroyed = false;
    this.writableEnded = false;
  }

  write(chunk) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  }

  end() {
    this.writableEnded = true;
    this.emit('close');
  }

  text() {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function streamFromChunks(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function streamThatErrorsAfter(chunks, error = new Error('socket hang up')) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      setTimeout(() => controller.error(error), 0);
    },
  });
}

test('forwardSseStream appends STREAM_INTERRUPTED before ending a truncated SSE stream', async () => {
  const res = new FakeResponse();
  const observer = new SseUsageObserver();
  const result = await forwardSseStream({
    upstreamBody: streamFromChunks([
      'data: {"model":"openrouter/test","choices":[{"delta":{"content":"hi"}}]}\n\n',
    ]),
    res,
    observer,
  });

  const text = res.text();
  assert.equal(result.interrupted, true);
  assert.equal(result.reason, 'upstream stream closed prematurely');
  assert.equal(observer.sawDone, false);
  assert.equal(observer.extractedModel, 'openrouter/test');
  assert.match(text, /STREAM_INTERRUPTED/);
  assert.match(text, /data: \[DONE\]\n\n$/);
  assert.equal(res.writableEnded, true);
});

test('forwardSseStream appends STREAM_INTERRUPTED when upstream throws mid-stream', async () => {
  const res = new FakeResponse();
  const observer = new SseUsageObserver();
  const result = await forwardSseStream({
    upstreamBody: streamThatErrorsAfter([
      'data: {"model":"openrouter/test","choices":[{"delta":{"content":"partial"}}]}\n\n',
    ], new Error('upstream socket closed')),
    res,
    observer,
  });

  const text = res.text();
  assert.equal(result.interrupted, true);
  assert.equal(result.reason, 'upstream socket closed');
  assert.equal(observer.sawDone, false);
  assert.equal(observer.extractedModel, 'openrouter/test');
  assert.match(text, /partial/);
  assert.match(text, /STREAM_INTERRUPTED/);
  assert.match(text, /upstream socket closed/);
  assert.match(text, /data: \[DONE\]\n\n$/);
  assert.equal(res.writableEnded, true);
});

test('forwardSseStream leaves complete SSE streams untouched', async () => {
  const res = new FakeResponse();
  const observer = new SseUsageObserver();
  const result = await forwardSseStream({
    upstreamBody: streamFromChunks([
      'data: {"model":"openrouter/test","usage":{"total_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ]),
    res,
    observer,
  });

  const text = res.text();
  assert.equal(result.interrupted, false);
  assert.equal(observer.sawDone, true);
  assert.deepEqual(observer.usage, { total_tokens: 7 });
  assert.doesNotMatch(text, /STREAM_INTERRUPTED/);
  assert.match(text, /data: \[DONE\]\n\n$/);
  assert.equal(res.writableEnded, true);
});
