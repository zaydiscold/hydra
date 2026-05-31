// @platform all
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { timeAgo } from '../../src/utils/time.js';

const REAL_DATE_NOW = Date.now;
const NOW = Date.parse('2026-05-31T00:00:00.000Z');

function ago(ms) {
  return new Date(NOW - ms).toISOString();
}

test.before(() => {
  Date.now = () => NOW;
});

test.after(() => {
  Date.now = REAL_DATE_NOW;
});

test('session age labels stay compact instead of leaking large hour counts', () => {
  assert.equal(timeAgo(ago(60 * 60 * 1000)), '1h ago');
  assert.equal(timeAgo(ago(23 * 60 * 60 * 1000)), '23h ago');
  assert.equal(timeAgo(ago(24 * 60 * 60 * 1000)), '1d ago');
  assert.equal(timeAgo(ago(900 * 60 * 60 * 1000)), '5w ago');
  assert.equal(timeAgo(ago(1000 * 60 * 60 * 1000)), '5w ago');
  assert.equal(timeAgo(ago(90 * 24 * 60 * 60 * 1000)), '3mo ago');
  assert.equal(timeAgo(ago(800 * 24 * 60 * 60 * 1000)), '2y ago');
});

test('session age labels fail quietly for missing, invalid, or future timestamps', () => {
  assert.equal(timeAgo(null), '');
  assert.equal(timeAgo('not-a-date'), '');
  assert.equal(timeAgo(new Date(NOW + 1000).toISOString()), 'just now');
});
