/**
 * SEC-21 `fetchText`: SSRF-safe, DNS-pinned.
 *
 * Each hop resolves the host exactly once, rejects the hop if ANY returned address is blocked,
 * and then connects to that checked address through the socket's own `lookup` hook. The name is
 * never resolved a second time, so a DNS-rebinding answer can't swap the target between check
 * and connect. `Host` and TLS SNI still carry the original name.
 *
 * Built on `node:http`/`node:https`, whose `lookup` option is the socket's connect-time resolver.
 * That gives the same guarantee as an undici `Agent` with a custom `connect.lookup` without adding
 * a dependency to the app. `@advance-labs/net-guard` is not used: it resolves with `dns.lookup`
 * and then lets `fetch` resolve again (threat model §6 item 9).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { isBlockedAddress } from './ip-policy';
import type { FetchText } from './types';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface FetchTextOptions {
  resolve?: Resolver;
  /**
   * Replaces the SEC-21 address policy. For tests that need a loopback server; the app must wire
   * the default. Return true when the address may be connected to.
   */
  addressPolicy?: (address: string) => boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBlockedError';
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const systemResolver: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));

function parseTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlockedError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchBlockedError(`Only http and https are allowed, got ${url.protocol}`);
  }
  if (url.username || url.password) throw new FetchBlockedError('URLs with credentials are refused');
  return url;
}

/** WHATWG URL already normalises `0x7f000001` and friends to dotted IPv4. */
const bareHost = (url: URL) => url.hostname.replace(/^\[(.*)\]$/, '$1');

export function createFetchText(options: FetchTextOptions = {}): FetchText {
  const resolve = options.resolve ?? systemResolver;
  const allowed = options.addressPolicy ?? ((a: string) => !isBlockedAddress(a));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  const userAgent = options.userAgent ?? 'Ninebrains-FactCheck/0.1';

  async function pin(url: URL): Promise<ResolvedAddress> {
    const host = bareHost(url);
    const family = isIP(host);
    const answers: ResolvedAddress[] = family
      ? [{ address: host, family: family === 6 ? 6 : 4 }]
      : await resolve(host);
    if (answers.length === 0) throw new FetchBlockedError(`${host} did not resolve`);
    const blocked = answers.find((a) => !allowed(a.address));
    if (blocked) throw new FetchBlockedError(`${host} resolves to a blocked address (${blocked.address})`);
    return answers[0];
  }

  function get(url: URL, target: ResolvedAddress, signal: AbortSignal): Promise<IncomingMessage> {
    const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      // Connect-time pin: the checked address, whatever the name resolves to by now.
      if (lookupOptions.all) callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    };
    const host = bareHost(url);
    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolvePromise, reject) => {
      const req = client.request(
        {
          protocol: url.protocol,
          hostname: host,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { 'user-agent': userAgent, accept: 'text/*, application/json, */*;q=0.5', 'accept-encoding': 'identity' },
          lookup,
          agent: false,
          signal,
          ...(isIP(host) ? {} : { servername: host }),
        },
        resolvePromise
      );
      req.on('error', reject);
      req.end();
    });
  }

  async function readBody(res: IncomingMessage): Promise<string> {
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      throw new FetchBlockedError(`Response of ${declared} bytes exceeds the ${maxBytes}-byte cap`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        res.destroy();
        throw new FetchBlockedError(`Response exceeds the ${maxBytes}-byte cap`);
      }
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  return async (rawUrl, init = {}) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    let url = parseTarget(rawUrl);
    for (let hop = 0; ; hop++) {
      signal.throwIfAborted();
      const target = await pin(url);
      const res = await get(url, target, signal);
      const status = res.statusCode ?? 0;
      if (REDIRECTS.has(status) && res.headers.location) {
        res.resume();
        if (hop >= maxRedirects) throw new FetchBlockedError(`More than ${maxRedirects} redirects`);
        // Every hop is re-parsed, re-resolved and re-checked.
        url = parseTarget(new URL(res.headers.location, url).href);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new Error(`HTTP ${status} from ${url.origin}${url.pathname}`);
      }
      return readBody(res);
    }
  };
}
