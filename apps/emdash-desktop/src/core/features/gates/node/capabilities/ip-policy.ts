/**
 * SEC-21 address policy: only public unicast addresses may be fetched.
 *
 * Blocked: loopback, RFC 1918, link-local (incl. 169.254.169.254), CGNAT, `0.0.0.0/8`, benchmark,
 * documentation and reserved ranges, multicast, broadcast; IPv6 unspecified, loopback, ULA,
 * link-local, site-local, multicast, documentation, and every form that embeds an IPv4 address
 * (mapped, compatible, NAT64, 6to4, Teredo), since those can smuggle a private v4 target.
 * Anything that does not parse is blocked.
 */
import { isIP } from 'node:net';

type V4Range = readonly [base: number, prefix: number];

const v4 = (a: number, b: number, c: number, d: number) => ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

const BLOCKED_V4: readonly V4Range[] = [
  [v4(0, 0, 0, 0), 8],
  [v4(10, 0, 0, 0), 8],
  [v4(100, 64, 0, 0), 10],
  [v4(127, 0, 0, 0), 8],
  [v4(169, 254, 0, 0), 16],
  [v4(172, 16, 0, 0), 12],
  [v4(192, 0, 0, 0), 24],
  [v4(192, 0, 2, 0), 24],
  [v4(192, 88, 99, 0), 24],
  [v4(192, 168, 0, 0), 16],
  [v4(198, 18, 0, 0), 15],
  [v4(198, 51, 100, 0), 24],
  [v4(203, 0, 113, 0), 24],
  [v4(224, 0, 0, 0), 4],
  [v4(240, 0, 0, 0), 4],
];

function parseV4(address: string): number | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !(n >= 0 && n <= 255))) return undefined;
  return v4(nums[0], nums[1], nums[2], nums[3]);
}

function inV4Range(ip: number, [base, prefix]: V4Range): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) >>> 0 === (base & mask) >>> 0;
}

/** Expands an IPv6 address (dotted v4 tail allowed) to 8 16-bit groups. */
function parseV6(address: string): number[] | undefined {
  let text = address;
  const tail = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const n = parseV4(tail[1]);
    if (n === undefined) return undefined;
    text = `${text.slice(0, -tail[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? undefined : nums;
}

function isBlockedV6(g: number[]): boolean {
  const zeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroPrefix(6)) return true; // ::, ::1, IPv4-compatible ::a.b.c.d
  if (zeroPrefix(5) && g[5] === 0xffff) return true; // IPv4-mapped ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard 100::/64
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) return true; // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True when `address` must not be connected to. Brackets and zone ids are tolerated. */
export function isBlockedAddress(raw: string): boolean {
  let address = raw.trim();
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  if (address.includes('%')) return true; // scoped (zone id) addresses are link-local by nature
  const family = isIP(address);
  if (family === 4) {
    const n = parseV4(address);
    return n === undefined || BLOCKED_V4.some((r) => inV4Range(n, r));
  }
  if (family === 6) {
    const groups = parseV6(address.toLowerCase());
    return groups === undefined || isBlockedV6(groups);
  }
  return true;
}
