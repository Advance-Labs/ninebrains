// Minimal MCP client over stdio (newline-delimited JSON-RPC 2.0). Enough to
// initialize, list tools, follow tools/list_changed, and call tools.
import { spawn } from 'node:child_process';

export const PROTOCOL_VERSION = '2025-06-18';

export class McpStdioClient {
  constructor(name, config, { cwd } = {}) {
    this.name = name;
    this.config = config;
    this.cwd = cwd;
    this.tools = [];
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
  }

  async connect(timeoutMs = 10_000) {
    const { command, args = [], env = {} } = this.config;
    this.child = spawn(command, args, {
      cwd: this.config.cwd ?? this.cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.resume();
    this.exited = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.once('error', (err) => this.failAll(err));
    this.child.once('exit', (code) => this.failAll(new Error(`MCP server '${this.name}' exited (${code})`)));

    let buf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.onLine(line);
      }
    });

    const init = await this.request(
      'initialize',
      { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'fake-agent', version: '0.0.0' } },
      timeoutMs
    );
    this.serverInfo = init.serverInfo;
    this.notify('notifications/initialized');
    await this.refreshTools();
    return this;
  }

  onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id) && !msg.method) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${this.name}: ${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method === 'notifications/tools/list_changed') {
      this.listChanged = this.refreshTools().catch(() => {});
    } else if (msg.method && msg.id !== undefined) {
      // Server-to-client request (ping, sampling, ...). Answer ping, refuse the rest.
      const reply = msg.method === 'ping' ? { result: {} } : { error: { code: -32601, message: 'not supported' } };
      this.write({ jsonrpc: '2.0', id: msg.id, ...reply });
    }
  }

  write(msg) {
    if (!this.closed) this.child.stdin.write(JSON.stringify(msg) + '\n');
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  }

  request(method, params, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name}: ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  failAll(err) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
  }

  async refreshTools() {
    const res = await this.request('tools/list', {});
    this.tools = res.tools ?? [];
    return this.tools;
  }

  async hasTool(tool) {
    if (this.listChanged) await this.listChanged;
    if (this.tools.some((t) => t.name === tool)) return true;
    await this.refreshTools();
    return this.tools.some((t) => t.name === tool);
  }

  callTool(tool, args = {}) {
    return this.request('tools/call', { name: tool, arguments: args });
  }

  async close() {
    if (this.closed || !this.child) return;
    this.closed = true;
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 2000);
    this.child.kill('SIGTERM');
    await this.exited;
    clearTimeout(timer);
  }
}
