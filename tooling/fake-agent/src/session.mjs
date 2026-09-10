// Session setup shared by print and interactive modes: MCP connections, tool
// list, hooks, session id.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { McpStdioClient } from './mcp-client.mjs';
import { HookRunner, loadSettings } from './hooks.mjs';
import { resolveModel } from './events.mjs';

const BUILTIN_TOOLS = ['Task', 'Bash', 'Edit', 'Read', 'Write', 'WebFetch', 'WebSearch', 'ToolSearch'];

function loadMcpConfigs(values) {
  const servers = {};
  for (const value of values) {
    const text = value.trim().startsWith('{') ? value : existsSync(value) ? readFileSync(value, 'utf8') : null;
    if (text === null) throw new Error(`MCP config file not found: ${value}`);
    Object.assign(servers, JSON.parse(text).mcpServers ?? {});
  }
  return servers;
}

export async function openSession(opts, { cwd, env }) {
  const sessionId = typeof opts.resume === 'string' ? opts.resume : opts.sessionId ?? randomUUID();
  const mcp = new Map();
  const mcpServers = [];
  for (const [name, cfg] of Object.entries(loadMcpConfigs(opts.mcpConfigs))) {
    if ((cfg.type ?? 'stdio') !== 'stdio') {
      mcpServers.push({ name, status: 'failed' }); // fake only speaks stdio
      continue;
    }
    const client = new McpStdioClient(name, cfg, { cwd });
    try {
      await client.connect();
      mcp.set(name, client);
      mcpServers.push({ name, status: 'connected' });
    } catch {
      await client.close().catch(() => {});
      mcpServers.push({ name, status: 'failed' });
    }
  }

  const disallowed = new Set(opts.disallowedTools);
  let builtins = BUILTIN_TOOLS.filter((t) => !(t === 'ToolSearch' && env.ENABLE_TOOL_SEARCH === 'false'));
  if (opts.tools) builtins = opts.tools.includes('default') ? builtins : builtins.filter((t) => opts.tools.includes(t));
  const mcpTools = [...mcp].flatMap(([server, c]) => c.tools.map((t) => `mcp__${server}__${t.name}`));
  const tools = [...builtins, ...mcpTools].filter((t) => !disallowed.has(t));

  const settings = loadSettings(opts.settings);
  const hooks = new HookRunner({ settings, sessionId, cwd, permissionMode: opts.permissionMode, env });

  return {
    opts,
    cwd,
    sessionId,
    model: resolveModel(opts.model),
    mcp,
    mcpServers,
    tools,
    hooks,
    startedAt: Date.now(),
    state: { turns: 0, denials: [], lastText: '', lastToolResult: '', prompt: '' },
    async close() {
      await Promise.all([...mcp.values()].map((c) => c.close()));
    },
  };
}
