import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

function listRendererFiles(dir = resolve(ROOT, 'src'), rootCall = true) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRendererFiles(fullPath, false));
    } else if (entry.isFile() && /\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return rootCall ? files.map((file) => file.slice(ROOT.length + 1)) : files;
}

function normalizePathForContract(file) {
  return file.replaceAll('\\', '/');
}

function uniqueMatches(source, regex, group = 1) {
  return [...source.matchAll(regex)].map((m) => m[group]).filter(Boolean);
}

function ipcHandlerBlocks(source) {
  const starts = [...source.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g)]
    .map((match) => ({ channel: match[1], index: match.index }));
  return starts.map((start, i) => ({
    channel: start.channel,
    body: source.slice(start.index, starts[i + 1]?.index ?? source.length),
  }));
}

test('every native IPC channel is exposed through preload and renderer facade', () => {
  const ipcSrc = read('electron/app/ipc.js');
  const preloadSrc = read('electron/preload.js');
  const nativeSrc = read('src/lib/native.js');

  const ipcChannels = uniqueMatches(ipcSrc, /ipcMain\.handle\(['"]([^'"]+)['"]/g);
  const preloadChannels = uniqueMatches(preloadSrc, /ipcRenderer\.invoke\(['"]([^'"]+)['"]/g);

  assert.deepEqual(
    [...preloadChannels].sort(),
    [...ipcChannels].sort(),
    'preload must expose exactly the native IPC channels registered in main',
  );

  const preloadMethods = uniqueMatches(
    preloadSrc,
    /^\s{2}([A-Za-z0-9_]+):\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>\s*ipcRenderer\.invoke\(['"][^'"]+['"]/gm,
  );
  for (const method of preloadMethods) {
    assert.match(
      nativeSrc,
      new RegExp(`${method}:\\s*\\([^)]*\\)\\s*=>\\s*invokeNative\\(['"]${method}['"]`),
      `src/lib/native.js must unwrap preload method ${method}`,
    );
  }
});

test('every native IPC handler returns a Result envelope', () => {
  const ipcSrc = read('electron/app/ipc.js');
  const handlers = ipcHandlerBlocks(ipcSrc);

  assert.ok(handlers.length > 0, 'expected at least one ipcMain.handle registration');
  for (const { channel, body } of handlers) {
    assert.match(body, /(?:return\s+|=>\s*)(?:ok|err)\(/, `${channel} must return ok(...) or err(...)`);
  }
});

test('renderer native bridge calls go through Result-unwrapping helpers', () => {
  const sourceFiles = listRendererFiles().filter((file) => normalizePathForContract(file) !== 'src/lib/native.js');
  const preloadSrc = read('electron/preload.js');
  const nativeSrc = read('src/lib/native.js');

  assert.ok(sourceFiles.length > 0, 'expected renderer source files to scan');
  for (const file of sourceFiles) {
    const src = read(file);
    assert.doesNotMatch(src, /window\.hydraNative|globalThis\.window\??\.hydraNative/, `${file} must not call the preload bridge directly`);
  }

  const errorBoundary = read('src/components/ErrorBoundary.jsx');
  assert.match(errorBoundary, /tryNative\(native\.minimizeWindow\)/);
  assert.match(errorBoundary, /tryNative\(native\.closeWindow\)/);
  assert.match(preloadSrc, /MENU_EVENT_CHANNELS/);
  assert.match(preloadSrc, /onMenuEvent: \(callback\) =>/);
  assert.match(preloadSrc, /offMenuEvent: \(listeners\) =>/);
  assert.match(preloadSrc, /native:copied-proxy-url/);
  assert.match(preloadSrc, /native:copy-proxy-url-not-ready/);
  assert.match(preloadSrc, /native:clipboard-copy-failed/);
  assert.match(nativeSrc, /onMenuEvent: \(cb\) =>/);

  for (const file of ['src/pages/Diagnostics.jsx', 'src/pages/Settings.jsx']) {
    const src = read(file);
    assert.match(src, /native\.openAppLocation\(location/, `${file} must use the Result-unwrapping native helper for folder opens`);
    assert.match(src, /catch \(err\)/, `${file} must catch native folder-open failures`);
    assert.match(src, /Failed to open \$\{label\}/, `${file} must surface native folder-open failures`);
    assert.match(src, /openAppLocation\(['"]userData['"]/, `${file} must expose userData folder open`);
    assert.match(src, /openAppLocation\(['"]logs['"]/, `${file} must expose logs folder open`);
  }
});

test('enabled biometric auth-token gate fails closed when prompting is unavailable', () => {
  const ipcSrc = read('electron/app/ipc.js');
  const handler = ipcHandlerBlocks(ipcSrc).find(({ channel }) => channel === 'native:auth-token:get');

  assert.ok(handler, 'expected native:auth-token:get handler');
  assert.match(handler.body, /const biometricOn = await getPref\('biometricEnabled'\)/);
  assert.match(handler.body, /if \(biometricOn\) \{/);
  assert.match(handler.body, /await promptBiometric\('Unlock Hydra'\)/);
  assert.match(handler.body, /catch \(promptErr\) \{/);
  assert.match(handler.body, /biometric auth-token gate denied release/);
  assert.match(handler.body, /promptErr\?\.code \|\| 'BIOMETRIC_DENIED'/);
  assert.match(handler.body, /return ok\(null\)/);
  assert.doesNotMatch(
    handler.body,
    /biometricOn\s*&&\s*canPromptBiometric\(\)/,
    'enabled biometric gate must not bypass auth-token release when the biometric prompt is unavailable',
  );
});
