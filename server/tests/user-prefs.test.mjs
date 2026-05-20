// @platform all
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hydra-user-prefs-'));

mock.module('electron', {
  namedExports: {
    app: {
      getPath(name) {
        if (name === 'userData') return userDataDir;
        return userDataDir;
      },
    },
  },
});

const {
  PREF_DEFAULTS,
  _resetPrefsCache,
  getAllPrefs,
  getPref,
  isPrefExplicitlySet,
  setPref,
} = await import('../../electron/app/userPrefs.js');

test('user preferences persist across cache reset and keep owner-only permissions', async () => {
  _resetPrefsCache();

  assert.equal(await getPref('telemetryEnabled'), false);
  assert.equal(await isPrefExplicitlySet('telemetryEnabled'), false);

  await setPref('telemetryEnabled', true);
  assert.equal(await getPref('telemetryEnabled'), true);
  assert.equal(await isPrefExplicitlySet('telemetryEnabled'), true);

  _resetPrefsCache();
  const reloaded = await getAllPrefs();
  assert.equal(reloaded.telemetryEnabled, true);
  assert.equal(reloaded.biometricEnabled, PREF_DEFAULTS.biometricEnabled);

  if (process.platform !== 'win32') {
    assert.equal(statSync(userDataDir).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(userDataDir, 'preferences.json')).mode & 0o777, 0o600);
  }
});

test('default-equal preferences are removed from disk but still read from defaults', async () => {
  _resetPrefsCache();

  await setPref('biometricEnabled', true);
  await setPref('biometricEnabled', false);
  _resetPrefsCache();

  assert.equal(await getPref('biometricEnabled'), false);
  assert.equal(await isPrefExplicitlySet('biometricEnabled'), false);
});

test('unknown preferences are rejected instead of silently persisting typos', async () => {
  await assert.rejects(
    setPref('doesNotExist', true),
    /Unknown preference key: doesNotExist/,
  );
});
