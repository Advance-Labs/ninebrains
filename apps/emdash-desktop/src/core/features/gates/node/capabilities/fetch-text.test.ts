import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFetchText, FetchBlockedError, type ResolvedAddress, type Resolver } from './fetch-text';

const PUBLIC: ResolvedAddress = { address: '93.184.215.14', family: 4 };
const LOOPBACK: ResolvedAddress = { address: '127.0.0.1', family: 4 };

/** Resolver that must never be reached (IP literals and scheme checks fail first). */
const unreachable: Resolver = async () => {
  throw new Error('resolver should not be called');
};

describe('SEC-21 rebinding and redirects blocked (default policy)', () => {
  const fetchText = createFetchText({ resolve: unreachable, timeoutMs: 2000 });

  it.each([
    'http://127.0.0.1/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]:8080/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://100.64.0.1/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://224.0.0.1/',
    'http://0.0.0.0/',
  ])('blocks %s before connecting', async (url) => {
    await expect(fetchText(url, {})).rejects.toBeInstanceOf(FetchBlockedError);
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/', 'gopher://x/', 'http://user:pw@example.com/', 'nonsense'])(
    'refuses %s',
    async (url) => {
      await expect(fetchText(url, {})).rejects.toBeInstanceOf(FetchBlockedError);
    }
  );

  it('blocks a name whose answer mixes public and private addresses', async () => {
    const f = createFetchText({ resolve: async () => [PUBLIC, LOOPBACK] });
    await expect(f('http://rebind.test/', {})).rejects.toThrow(/blocked address \(127\.0\.0\.1\)/);
  });

  it('blocks a name that resolves to an IPv4-mapped IPv6 loopback', async () => {
    const f = createFetchText({ resolve: async () => [{ address: '::ffff:127.0.0.1', family: 6 }] });
    await expect(f('http://mapped.test/', {})).rejects.toBeInstanceOf(FetchBlockedError);
  });

  it('blocks a name that does not resolve', async () => {
    await expect(createFetchText({ resolve: async () => [] })('http://x.test/', {})).rejects.toThrow(/did not resolve/);
  });
});

describe('SEC-21 pinning, redirects and caps against a local server', () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/host') return res.end(req.headers.host);
      if (url === '/ok') return res.end('ok');
      if (url === '/to-mapped') {
        res.writeHead(302, { location: `http://[::ffff:127.0.0.1]:${port}/ok` });
        return res.end();
      }
      if (url === '/to-private') {
        res.writeHead(302, { location: 'http://10.0.0.1/ok' });
        return res.end();
      }
      if (url === '/to-relative') {
        res.writeHead(301, { location: '/ok' });
        return res.end();
      }
      const loop = url.match(/^\/loop\/(\d+)$/);
      if (loop) {
        res.writeHead(302, { location: `/loop/${Number(loop[1]) + 1}` });
        return res.end();
      }
      if (url === '/big') return res.end(Buffer.alloc(3 * 1024 * 1024, 97));
      if (url === '/big-chunked') {
        res.write(Buffer.alloc(1024 * 1024, 97));
        res.write(Buffer.alloc(1024 * 1024, 97));
        return res.end(Buffer.alloc(1024 * 1024, 97));
      }
      if (url === '/404') {
        res.writeHead(404);
        return res.end('nope');
      }
      if (url === '/hang') return; // never answers
      res.end('?');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // Tests need a loopback server, so they swap in a policy that allows exactly 127.0.0.1.
  // Every other private form, including ::ffff:127.0.0.1, stays blocked.
  const onlyLoopback = (a: string) => a === '127.0.0.1';

  it('connects to the checked address even when the resolver would now answer differently', async () => {
    let calls = 0;
    const resolve: Resolver = async () => (calls++ === 0 ? [LOOPBACK] : [{ address: '10.9.9.9', family: 4 }]);
    const f = createFetchText({ resolve, addressPolicy: onlyLoopback });
    await expect(f(`http://pinned.test:${port}/ok`, {})).resolves.toBe('ok');
    expect(calls).toBe(1);
  });

  it('keeps the original Host header', async () => {
    const f = createFetchText({ resolve: async () => [LOOPBACK], addressPolicy: onlyLoopback });
    await expect(f(`http://named.test:${port}/host`, {})).resolves.toBe(`named.test:${port}`);
  });

  it('re-checks every redirect hop', async () => {
    const f = createFetchText({ resolve: async () => [LOOPBACK], addressPolicy: onlyLoopback });
    await expect(f(`http://127.0.0.1:${port}/to-relative`, {})).resolves.toBe('ok');
    await expect(f(`http://127.0.0.1:${port}/to-mapped`, {})).rejects.toBeInstanceOf(FetchBlockedError);
    await expect(f(`http://127.0.0.1:${port}/to-private`, {})).rejects.toBeInstanceOf(FetchBlockedError);
  });

  it('stops after 5 redirects', async () => {
    const f = createFetchText({ addressPolicy: onlyLoopback });
    await expect(f(`http://127.0.0.1:${port}/loop/0`, {})).rejects.toThrow(/More than 5 redirects/);
  });

  it('caps the body at 2 MB, by header and while streaming', async () => {
    const f = createFetchText({ addressPolicy: onlyLoopback });
    await expect(f(`http://127.0.0.1:${port}/big`, {})).rejects.toThrow(/cap/);
    await expect(f(`http://127.0.0.1:${port}/big-chunked`, {})).rejects.toThrow(/cap/);
  });

  it('times out a server that never answers', async () => {
    const f = createFetchText({ addressPolicy: onlyLoopback, timeoutMs: 300 });
    await expect(f(`http://127.0.0.1:${port}/hang`, {})).rejects.toThrow();
  });

  it('rejects non-2xx responses', async () => {
    const f = createFetchText({ addressPolicy: onlyLoopback });
    await expect(f(`http://127.0.0.1:${port}/404`, {})).rejects.toThrow(/HTTP 404/);
  });
});
