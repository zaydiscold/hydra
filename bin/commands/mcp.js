/**
 * `hydra mcp` — private local stdio MCP adapter for Hydra fleet tools.
 *
 * This intentionally wraps existing guarded/read-only CLI commands instead of
 * exposing arbitrary local HTTP route execution. Claude Code/Cursor can inspect
 * fleet state while Hydra is closed, and mutating operations stay behind the
 * CLI's existing explicit confirmation guards.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HYDRA_BIN = join(ROOT, 'bin/hydra.mjs');
const MAX_MESSAGE_BYTES = 1024 * 1024;

const tools = [
  {
    name: 'hydra_status',
    description: 'Read a redacted Hydra fleet and local proxy overview.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    command: () => ['status', '--json'],
  },
  {
    name: 'hydra_proxy_status',
    description: 'Read local /v1 proxy listener, gate, and masked proxy-key status.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    command: () => ['proxy', 'status', '--json'],
  },
  {
    name: 'hydra_api_map',
    description: 'List Hydra local API routes from the private OpenAPI map.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tag: {
          type: 'string',
          description: 'Optional route tag filter such as accounts, codes, pool, system, or proxy.',
        },
      },
    },
    command: (input = {}) => input.tag ? ['api-map', '--json', '--tag', String(input.tag)] : ['api-map', '--json'],
  },
  {
    name: 'hydra_audit',
    description: 'Run the read-only Hydra release evidence audit.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    command: () => ['audit', '--json'],
  },
  {
    name: 'hydra_doctor',
    description: 'Read local Hydra runtime diagnostics including data-dir, Chromium resource, and port checks.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    command: () => ['doctor', '--json'],
  },
];

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

function usage() {
  process.stdout.write(`Hydra MCP

  hydra mcp             Start the private local stdio MCP server
  hydra mcp --list-tools

Tools are read-only wrappers over existing Hydra CLI commands:
  ${tools.map((tool) => tool.name).join('\n  ')}

Configure Claude Code/Cursor with a stdio server command:
  hydra mcp
`);
}

function runHydra(args) {
  const result = spawnSync(process.execPath, [HYDRA_BIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(detail || `hydra ${args.join(' ')} exited ${result.status}`);
  }
  return result.stdout.trim();
}

function parseJsonOutput(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function jsonText(value) {
  return {
    content: [
      {
        type: 'text',
        text: `${JSON.stringify(value, null, 2)}\n`,
      },
    ],
  };
}

function errorPayload(message) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `${message}\n`,
      },
    ],
  };
}

function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function handleRequest(message) {
  if (!message || typeof message !== 'object') return null;
  const { id, method, params = {} } = message;

  if (id == null) {
    return null;
  }

  if (method === 'initialize') {
    return response(id, {
      protocolVersion: params.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: {
        name: 'hydra-local',
        version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
      },
    });
  }

  if (method === 'tools/list') {
    return response(id, {
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }

  if (method === 'tools/call') {
    const name = params.name;
    const tool = toolByName.get(name);
    if (!tool) return response(id, errorPayload(`Unknown Hydra MCP tool: ${name}`));
    try {
      const stdout = runHydra(tool.command(params.arguments || {}));
      return response(id, jsonText(parseJsonOutput(stdout)));
    } catch (err) {
      return response(id, errorPayload(err?.message || String(err)));
    }
  }

  return errorResponse(id, -32601, `Unsupported method: ${method}`);
}

function startStdioServer() {
  let buffer = Buffer.alloc(0);

  return new Promise((resolve) => {
    process.stdin.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length > 0) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;

        const header = buffer.slice(0, headerEnd).toString('utf8');
        const match = header.match(/content-length:\s*(\d+)/i);
        if (!match) {
          process.stderr.write('[hydra mcp] dropping malformed MCP frame without Content-Length\n');
          buffer = Buffer.alloc(0);
          return;
        }

        const length = Number(match[1]);
        if (!Number.isInteger(length) || length < 0 || length > MAX_MESSAGE_BYTES) {
          process.stderr.write(`[hydra mcp] invalid MCP frame length: ${match[1]}\n`);
          buffer = Buffer.alloc(0);
          return;
        }

        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + length;
        if (buffer.length < bodyEnd) return;

        const raw = buffer.slice(bodyStart, bodyEnd).toString('utf8');
        buffer = buffer.slice(bodyEnd);

        let message;
        try {
          message = JSON.parse(raw);
        } catch (err) {
          writeMessage(errorResponse(null, -32700, `Parse error: ${err?.message || err}`));
          continue;
        }

        const reply = handleRequest(message);
        if (reply) writeMessage(reply);
      }
    });
    process.stdin.on('end', resolve);
    process.stdin.resume();
  });
}

export async function run(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }
  if (argv.includes('--list-tools')) {
    process.stdout.write(`${JSON.stringify({ tools: tools.map(({ command, ...tool }) => tool) }, null, 2)}\n`);
    return;
  }
  await startStdioServer();
}
