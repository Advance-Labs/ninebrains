import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../bin/fake-claude.mjs', import.meta.url));
export const ECHO_SERVER = fileURLToPath(new URL('./fixtures/echo-mcp-server.mjs', import.meta.url));
export const HOOK_RECORDER = fileURLToPath(new URL('./fixtures/hook-recorder.mjs', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const EXEC_PATHS = fileURLToPath(new URL('../../../spikes/exec-paths/', import.meta.url));

export const tempDir = () => mkdtempSync(join(tmpdir(), 'fake-agent-test-'));

export function echoMcpConfig(env = {}) {
  return JSON.stringify({
    mcpServers: { echo: { type: 'stdio', command: process.execPath, args: [ECHO_SERVER], env } },
  });
}

export function hookSettings() {
  const hook = { type: 'command', command: `"${process.execPath}" "${HOOK_RECORDER}"` };
  const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'];
  return JSON.stringify({ hooks: Object.fromEntries(events.map((e) => [e, [{ hooks: [hook] }]])) });
}

export const readJsonLines = (path) =>
  existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

/** Runs fake-claude to completion. */
export function run(args, { env = {}, input = '', cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      const events = stdout
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .map((l) => JSON.parse(l));
      resolve({ code, stdout, stderr, events });
    });
    child.stdin.end(input);
  });
}

/** Starts fake-claude in interactive mode over pipes and lets a test drive it. */
export function interact(args, { env = {}, cwd } = {}) {
  const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...env } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const closed = new Promise((resolve) => child.on('close', resolve));
  return {
    get output() {
      return out;
    },
    write: (s) => child.stdin.write(s),
    async waitFor(pattern, timeoutMs = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (typeof pattern === 'string' ? out.includes(pattern) : pattern.test(out)) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`timed out waiting for ${pattern}\n--- output ---\n${out}`);
    },
    closed,
    kill: () => child.kill(),
  };
}
