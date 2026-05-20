// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HYDRA = join(ROOT, 'bin/hydra.mjs');

function runHydra(args) {
  const result = spawnSync(process.execPath, [HYDRA, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function frame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function parseFrames(text) {
  const messages = [];
  let offset = 0;
  while (offset < text.length) {
    const headerEnd = text.indexOf('\r\n\r\n', offset);
    if (headerEnd < 0) break;
    const header = text.slice(offset, headerEnd);
    const match = header.match(/content-length:\s*(\d+)/i);
    assert.ok(match, `missing Content-Length in ${header}`);
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    messages.push(JSON.parse(text.slice(bodyStart, bodyEnd)));
    offset = bodyEnd;
  }
  return messages;
}

test('hydra mcp lists private local fleet tools', () => {
  const report = JSON.parse(runHydra(['mcp', '--list-tools']));
  const names = report.tools.map((tool) => tool.name);

  assert.deepEqual(
    names,
    ['hydra_status', 'hydra_proxy_status', 'hydra_api_map', 'hydra_audit', 'hydra_doctor'],
  );
  for (const tool of report.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(Object.hasOwn(tool, 'command'), false, 'MCP tool list must not leak command internals');
  }
});

test('hydra mcp speaks framed stdio JSON-RPC and returns tool results', async () => {
  const child = spawn(process.execPath, [HYDRA, 'mcp'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  child.stdin.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }));
  child.stdin.write(frame({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
  child.stdin.write(frame({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hydra_api_map', arguments: { tag: 'system' } } }));
  child.stdin.end();

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });

  assert.equal(exitCode, 0, stderr);
  const messages = parseFrames(stdout);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].id, 1);
  assert.equal(messages[0].result.serverInfo.name, 'hydra-local');
  assert.equal(messages[1].id, 2);
  assert.ok(messages[1].result.tools.some((tool) => tool.name === 'hydra_audit'));
  assert.equal(messages[2].id, 3);

  const toolText = messages[2].result.content[0].text;
  const payload = JSON.parse(toolText);
  assert.equal(payload.routes.every((route) => route.tag === 'system'), true);
  assert.ok(payload.routes.some((route) => route.path === '/api/system/health'));
});

