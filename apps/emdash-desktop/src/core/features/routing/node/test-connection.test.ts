import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProfileLaunch } from '../api/node/launch-env';
import { createConnectionTester, type ResolvedAddress } from './test-connection';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

function startServer(handler: Handler): Promise<{
  close(): Promise<void>;
  port: number;
  requests: IncomingMessage[];
}> {
  const requests: IncomingMessage[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req);
    handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}

const localProfile = (
  port: number,
  protocol: ProfileLaunch['protocol'] = 'anthropic'
): ProfileLaunch => ({
  id: 'p1',
  kind: 'local',
  protocol,
  baseUrl: `http://127.0.0.1:${port}`,
});

const NEVER_BLOCKED = () => false;

let servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

describe('SEC-21 test connection is pinned and never follows a redirect', () => {
  it('reports ok with the model count on 200', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [1, 2] }));
    });
    servers.push(server);
    const tester = createConnectionTester({ isBlockedAddress: NEVER_BLOCKED });
    const result = await tester(localProfile(server.port), 'a-local-key-12345');
    expect(result.status).toBe('ok');
    expect(result.modelCount).toBe(2);
  });

  it('reports auth-failed on 401', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(401);
      res.end('{}');
    });
    servers.push(server);
    const tester = createConnectionTester({ isBlockedAddress: NEVER_BLOCKED });
    const result = await tester(localProfile(server.port), 'a-local-key-12345');
    expect(result.status).toBe('auth-failed');
  });

  it('reports not-found on 404', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(404);
      res.end('{}');
    });
    servers.push(server);
    const tester = createConnectionTester({ isBlockedAddress: NEVER_BLOCKED });
    const result = await tester(localProfile(server.port), 'a-local-key-12345');
    expect(result.status).toBe('not-found');
  });

  it('does not follow a 302 redirect: the target never sees a request', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    });
    servers.push(target);
    const redirector = await startServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${target.port}/v1/models` });
      res.end();
    });
    servers.push(redirector);
    const tester = createConnectionTester({ isBlockedAddress: NEVER_BLOCKED });
    const result = await tester(localProfile(redirector.port), 'a-local-key-12345');
    expect(result.status).toBe('error');
    expect(target.requests.length).toBe(0);
  });

  it('sends x-api-key and authorization for the anthropic protocol', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    });
    servers.push(server);
    const tester = createConnectionTester({ isBlockedAddress: NEVER_BLOCKED });
    await tester(localProfile(server.port, 'anthropic'), 'a-local-key-12345');
    const headers = server.requests[0]!.headers;
    expect(headers['x-api-key']).toBe('a-local-key-12345');
    expect(headers.authorization).toBe('Bearer a-local-key-12345');
  });

  it('sends only authorization for openai-responses', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    });
    servers.push(server);
    const tester = createConnectionTester({ isBlockedAddress: NEVER_BLOCKED });
    await tester(localProfile(server.port, 'openai-responses'), 'a-local-key-12345');
    const headers = server.requests[0]!.headers;
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers.authorization).toBe('Bearer a-local-key-12345');
  });

  it('refuses a local profile whose host resolves off this machine, without connecting', async () => {
    const target = await startServer((_req, res) => res.end('{}'));
    servers.push(target);
    let connected = false;
    const tester = createConnectionTester({
      isBlockedAddress: NEVER_BLOCKED,
      resolve: async (): Promise<ResolvedAddress[]> => {
        connected = true;
        return [{ address: '10.0.0.5', family: 4 }];
      },
    });
    const profile: ProfileLaunch = {
      id: 'p1',
      kind: 'local',
      protocol: 'anthropic',
      baseUrl: 'http://my-local-host:11434',
    };
    const result = await tester(profile, 'a-local-key-12345');
    expect(result.status).toBe('unreachable');
    expect(target.requests.length).toBe(0);
    expect(connected).toBe(true);
  });

  it('refuses an api-key profile whose host resolves to a blocked address', async () => {
    const tester = createConnectionTester({
      isBlockedAddress: (address) => address.startsWith('127.'),
      resolve: async (): Promise<ResolvedAddress[]> => [{ address: '127.0.0.1', family: 4 }],
    });
    const profile: ProfileLaunch = {
      id: 'p1',
      kind: 'anthropic-api',
      protocol: 'anthropic',
      baseUrl: 'https://my-remote-host',
    };
    const result = await tester(profile, 'sk-ant-remote-key-1234567');
    expect(result.status).toBe('unreachable');
  });

  it('never includes the key in any returned message', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(401);
      res.end('{}');
    });
    servers.push(server);
    const key = 'a-local-key-should-not-leak-99887766';
    const tester = createConnectionTester({ isBlockedAddress: NEVER_BLOCKED });
    const result = await tester(localProfile(server.port), key);
    expect(result.message).not.toContain(key);
  });
});
