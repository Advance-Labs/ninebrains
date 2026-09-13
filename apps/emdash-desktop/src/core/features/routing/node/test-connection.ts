/**
 * "Test connection" for a model profile, from main (never the renderer). One GET of the
 * profile's model list with the key in a header, under the same rules as the gates' SEC-21
 * `fetchText`: the host is resolved once, every answer is checked, and the socket connects to
 * the checked address through its own `lookup` hook, so DNS rebinding can't swap the target.
 *
 * - API-key profiles: https only, and no address the SEC-21 policy blocks (loopback, private,
 *   link-local, metadata...). Local profiles: loopback only, nothing else.
 * - No redirects: a redirect would carry the key to a host the user never named.
 * - 10 s, a 64 KiB body cap, and the body never leaves this file: the result is a status, a
 *   message and a model count.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { createRedactor } from '@core/features/exec-runs/api/node/redact';
import type { ProfileLaunch } from '@core/features/routing/api/node/launch-env';
import type { ConnectionTest } from '../api/contract';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface ConnectionTesterDeps {
  /** The SEC-21 policy (`gates/node/capabilities/ip-policy`), injected by the composition root. */
  isBlockedAddress(address: string): boolean;
  resolve?: Resolver;
  timeoutMs?: number;
}

export type ConnectionTester = (
  profile: ProfileLaunch,
  key: string | undefined
) => Promise<ConnectionTest>;

const MAX_BODY = 64 * 1024;

const systemResolver: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));

export function isLoopbackAddress(address: string): boolean {
  const lower = address.toLowerCase();
  return /^127\./.test(lower) || lower === '::1' || /^::ffff:127\./.test(lower);
}

/** The model-list URL: Anthropic's `/v1/models`, or `/models` under an OpenAI-style `/v1` base. */
export function modelListUrl(profile: Pick<ProfileLaunch, 'protocol' | 'baseUrl'>): URL {
  const base = profile.baseUrl.replace(/\/+$/, '');
  return new URL(profile.protocol === 'anthropic' ? `${base}/v1/models` : `${base}/models`);
}

function authHeaders(profile: ProfileLaunch, key: string | undefined): Record<string, string> {
  if (!key) return {};
  return profile.protocol === 'anthropic'
    ? { 'x-api-key': key, authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${key}` };
}

const result = (
  status: ConnectionTest['status'],
  message: string,
  httpStatus: number | null = null,
  modelCount: number | null = null
): ConnectionTest => ({ status, message, httpStatus, modelCount });

class Refused extends Error {}

export function createConnectionTester(deps: ConnectionTesterDeps): ConnectionTester {
  const resolve = deps.resolve ?? systemResolver;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  async function pin(url: URL, kind: ProfileLaunch['kind']): Promise<ResolvedAddress> {
    const auth = kind === 'local' ? 'local' : 'api-key';
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const family = isIP(host);
    const answers: ResolvedAddress[] = family
      ? [{ address: host, family: family === 6 ? 6 : 4 }]
      : await resolve(host);
    if (answers.length === 0) throw new Refused(`${host} did not resolve.`);
    for (const answer of answers) {
      const allowed =
        auth === 'local'
          ? isLoopbackAddress(answer.address)
          : !deps.isBlockedAddress(answer.address);
      if (!allowed) {
        throw new Refused(
          auth === 'local'
            ? `${host} is not on this machine (${answer.address}); a local profile stays on loopback.`
            : `${host} resolves to an address an API-key profile may not reach (${answer.address}).`
        );
      }
    }
    return answers[0]!;
  }

  function get(url: URL, target: ResolvedAddress, headers: Record<string, string>) {
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    };
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const client = url.protocol === 'https:' ? https : http;
    return new Promise<{ status: number; body: string }>((resolvePromise, reject) => {
      const req = client.request(
        {
          protocol: url.protocol,
          hostname: host,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { accept: 'application/json', 'user-agent': 'Ninebrains/0.1', ...headers },
          lookup,
          agent: false,
          timeout: timeoutMs,
          ...(isIP(host) ? {} : { servername: host }),
        },
        (res: IncomingMessage) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
            if (body.length > MAX_BODY) res.destroy();
          });
          res.on('close', () => resolvePromise({ status: res.statusCode ?? 0, body }));
          res.on('error', () => resolvePromise({ status: res.statusCode ?? 0, body }));
        }
      );
      req.on('timeout', () =>
        req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
      );
      req.on('error', reject);
      req.end();
    });
  }

  return async (profile, key) => {
    const redact = createRedactor(key ? [key] : []);
    let url: URL;
    try {
      url = modelListUrl(profile);
    } catch {
      return result('error', 'The base URL is not valid.');
    }
    if (profile.kind !== 'local' && url.protocol !== 'https:') {
      return result('error', 'An API-key profile must use https.');
    }
    let target: ResolvedAddress;
    try {
      target = await pin(url, profile.kind);
    } catch (error) {
      return result(
        'unreachable',
        redact(error instanceof Refused ? error.message : `Could not resolve ${url.hostname}.`)
      );
    }
    let answer: { status: number; body: string };
    try {
      answer = await get(url, target, authHeaders(profile, key));
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      return result(
        'unreachable',
        `Could not reach ${url.host}${typeof code === 'string' ? ` (${code})` : ''}.`
      );
    }
    const { status } = answer;
    if (status >= 200 && status < 300) {
      let count: number | null = null;
      try {
        const json = JSON.parse(answer.body) as { data?: unknown; models?: unknown };
        const list = Array.isArray(json.data) ? json.data : json.models;
        count = Array.isArray(list) ? list.length : null;
      } catch {
        count = null;
      }
      return result(
        'ok',
        count === null ? 'Connected.' : `Connected. The server lists ${count} models.`,
        status,
        count
      );
    }
    if (status === 401 || status === 403) {
      return result('auth-failed', 'The server refused the key.', status);
    }
    if (status === 404) {
      return result(
        'not-found',
        'The server answered, but has no model list at this path. Check the base URL; the first real run confirms it.',
        status
      );
    }
    if (status === 429)
      return result('rate-limited', 'The server is rate limiting this key.', status);
    if (status >= 300 && status < 400) {
      return result(
        'error',
        'The server redirected. Ninebrains never follows a redirect with a key; use the final URL as the base URL.',
        status
      );
    }
    return result('error', `The server answered HTTP ${status}.`, status);
  };
}
