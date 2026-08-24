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
const MODERN_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSIONS = Object.freeze([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  MODERN_PROTOCOL_VERSION,
  ...LEGACY_PROTOCOL_VERSIONS,
]);
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const TOOL_LIST_TTL_MS = 60_000;
const SERVER_INFO = Object.freeze({
  name: 'hydra-local',
  version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
});

const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
});

const tools = [
  {
    name: 'hydra_status',
    description: 'Read a redacted Hydra fleet and local proxy overview.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    annotations: READ_ONLY_ANNOTATIONS,
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
    annotations: READ_ONLY_ANNOTATIONS,
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
    annotations: READ_ONLY_ANNOTATIONS,
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
    annotations: READ_ONLY_ANNOTATIONS,
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
    annotations: READ_ONLY_ANNOTATIONS,
    command: () => ['doctor', '--json'],
  },
];

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

function publicTool(tool) {
  const { name, description, inputSchema, annotations } = tool;
  return { name, description, inputSchema, annotations };
}

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
    structuredContent: value,
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

function errorResponse(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function protocolVersionFor(message) {
  return message?.params?._meta?.[PROTOCOL_VERSION_META_KEY] || null;
}

function isModernRequest(message) {
  return message?.method === 'server/discover' || protocolVersionFor(message) === MODERN_PROTOCOL_VERSION;
}

function withModernResultMetadata(result, message) {
  if (!isModernRequest(message) || !result || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }
  return {
    resultType: 'complete',
    ...result,
    _meta: {
      ...(result._meta && typeof result._meta === 'object' ? result._meta : {}),
      [SERVER_INFO_META_KEY]: SERVER_INFO,
    },
  };
}

function negotiateLegacyProtocolVersion(requested) {
  return LEGACY_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LEGACY_PROTOCOL_VERSIONS[0];
}

function validateRequest(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return 'JSON-RPC request must be an object';
  }
  if (message.jsonrpc !== '2.0') return 'jsonrpc must be "2.0"';
  if (typeof message.method !== 'string' || message.method.length === 0) {
    return 'method must be a non-empty string';
  }
  if (message.params !== undefined && (
    message.params === null
    || typeof message.params !== 'object'
    || Array.isArray(message.params)
  )) {
    return 'params must be an object when provided';
  }
  return null;
}

function validateModernVersion(message) {
  if (!isModernRequest(message) || message.method === 'server/discover') return null;
  const version = protocolVersionFor(message);
  if (!version) return `Modern MCP requests must include params._meta.${PROTOCOL_VERSION_META_KEY}`;
  if (version !== MODERN_PROTOCOL_VERSION) {
    return `Unsupported MCP protocol version: ${version}`;
  }
  return null;
}

function handleRequest(message) {
  const invalid = validateRequest(message);
  if (invalid) return errorResponse(message?.id, -32600, 'Invalid Request', invalid);

  const { id, method, params = {} } = message;

  // JSON-RPC notifications intentionally receive no response.
  if (id == null) return null;

  const versionError = validateModernVersion(message);
  if (versionError) {
    return errorResponse(id, -32602, 'Invalid params', {
      message: versionError,
      supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    });
  }

  if (method === 'server/discover') {
    return response(id, withModernResultMetadata({
      supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: 'Hydra exposes read-only local fleet, proxy, API-map, audit, and doctor tools.',
      ttlMs: TOOL_LIST_TTL_MS,
      cacheScope: 'private',
    }, message));
  }

  if (method === 'initialize') {
    return response(id, {
      protocolVersion: negotiateLegacyProtocolVersion(params.protocolVersion),
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: 'Hydra exposes read-only local fleet, proxy, API-map, audit, and doctor tools.',
    });
  }

  if (method === 'ping') {
    return response(id, withModernResultMetadata({}, message));
  }

  if (method === 'tools/list') {
    const result = {
      tools: tools.map(publicTool),
      ...(isModernRequest(message) ? {
        ttlMs: TOOL_LIST_TTL_MS,
        cacheScope: 'private',
      } : {}),
    };
    return response(id, withModernResultMetadata(result, message));
  }

  if (method === 'tools/call') {
    const name = params.name;
    if (typeof name !== 'string' || name.length === 0) {
      return errorResponse(id, -32602, 'Invalid params', 'tools/call requires a non-empty params.name');
    }
    if (params.arguments !== undefined && (
      params.arguments === null
      || typeof params.arguments !== 'object'
      || Array.isArray(params.arguments)
    )) {
      return errorResponse(id, -32602, 'Invalid params', 'params.arguments must be an object');
    }

    const tool = toolByName.get(name);
    if (!tool) return response(id, withModernResultMetadata(errorPayload(`Unknown Hydra MCP tool: ${name}`), message));
    try {
      const stdout = runHydra(tool.command(params.arguments || {}));
      return response(id, withModernResultMetadata(jsonText(parseJsonOutput(stdout)), message));
    } catch (err) {
      return response(id, withModernResultMetadata(errorPayload(err?.message || String(err)), message));
    }
  }

  return errorResponse(id, -32601, `Unsupported method: ${method}`);
}

function writeMessage(message, framing = 'newline') {
  const json = JSON.stringify(message);
  if (framing === 'content-length') {
    const body = Buffer.from(json, 'utf8');
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
    return;
  }
  process.stdout.write(`${json}\n`);
}

function parseContentLengthFrame(buffer) {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd < 0) return null;

  const header = buffer.subarray(0, headerEnd).toString('utf8');
  const match = header.match(/(?:^|\r\n)content-length:\s*(\d+)\s*(?:\r\n|$)/i);
  if (!match) return { error: 'Malformed MCP compatibility frame without Content-Length' };

  const length = Number(match[1]);
  if (!Number.isInteger(length) || length < 0 || length > MAX_MESSAGE_BYTES) {
    return { error: `Invalid MCP compatibility frame length: ${match[1]}` };
  }

  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + length;
  if (buffer.length < bodyEnd) return null;
  return {
    raw: buffer.subarray(bodyStart, bodyEnd).toString('utf8'),
    rest: buffer.subarray(bodyEnd),
    framing: 'content-length',
  };
}

function parseNewlineFrame(buffer) {
  const newline = buffer.indexOf(0x0a);
  if (newline < 0) {
    if (buffer.length > MAX_MESSAGE_BYTES) {
      return { error: `MCP stdio message exceeded ${MAX_MESSAGE_BYTES} bytes without a newline` };
    }
    return null;
  }

  let body = buffer.subarray(0, newline);
  if (body.length > 0 && body[body.length - 1] === 0x0d) body = body.subarray(0, body.length - 1);
  return {
    raw: body.toString('utf8'),
    rest: buffer.subarray(newline + 1),
    framing: 'newline',
  };
}

function nextFrame(buffer) {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 32)).toString('ascii');
  return /^content-length:/i.test(prefix)
    ? parseContentLengthFrame(buffer)
    : parseNewlineFrame(buffer);
}

function startStdioServer() {
  let buffer = Buffer.alloc(0);

  return new Promise((resolve, reject) => {
    process.stdin.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length > 0) {
        const frame = nextFrame(buffer);
        if (!frame) return;
        if (frame.error) {
          process.stderr.write(`[hydra mcp] ${frame.error}\n`);
          writeMessage(errorResponse(null, -32700, 'Parse error', frame.error));
          buffer = Buffer.alloc(0);
          return;
        }

        buffer = frame.rest;
        if (frame.raw.trim() === '') continue;

        let message;
        try {
          message = JSON.parse(frame.raw);
        } catch (err) {
          writeMessage(errorResponse(null, -32700, 'Parse error', err?.message || String(err)), frame.framing);
          continue;
        }

        const reply = handleRequest(message);
        if (reply) writeMessage(reply, frame.framing);
      }
    });
    process.stdin.on('end', resolve);
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

export async function run(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }
  if (argv.includes('--list-tools')) {
    process.stdout.write(`${JSON.stringify({ tools: tools.map(publicTool) }, null, 2)}\n`);
    return;
  }
  await startStdioServer();
}
