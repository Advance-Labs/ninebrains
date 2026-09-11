import { describe, expect, it } from 'vitest';
import { isBlockedAddress } from './ip-policy';

describe('SEC-21 address policy', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '198.18.0.1',
    '224.0.0.1',
    '239.255.255.250',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:8.8.8.8',
    '::127.0.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2001:0:4136:e378::',
    '2001:db8::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%en0',
    'fec0::1',
    'ff02::1',
    'not-an-ip',
    '',
  ])('blocks %j', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '93.184.215.14',
    '1.1.1.1',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    '2a00:1450:4001::200e',
  ])('allows public %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});
