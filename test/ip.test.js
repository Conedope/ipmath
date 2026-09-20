import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IpMathError,
  parseCIDR,
  addrFromStr,
  addrToStr,
  addrToHex,
  addrToBinary,
  networkOf,
  broadcastOf,
  firstHost,
  lastHost,
  hostCount,
  contains,
  split,
  rangeToCIDRs,
  cidrSum,
  netmaskStr,
} from '../lib/ip.js';

const toStr4 = (a) => addrToStr(a, 'v4');
const toStr6 = (a) => addrToStr(a, 'v6');

test('parseCIDR accepts valid IPv4 inputs', () => {
  const cases = [
    ['1.2.3.4/24', 'v4', [1, 2, 3, 4], 24],
    ['1.2.3.4', 'v4', [1, 2, 3, 4], 32],
    ['0.0.0.0/0', 'v4', [0, 0, 0, 0], 0],
    ['255.255.255.255/32', 'v4', [255, 255, 255, 255], 32],
    ['192.168.1.5/24', 'v4', [192, 168, 1, 5], 24],
    ['10.0.0.0/8', 'v4', [10, 0, 0, 0], 8],
  ];
  for (const [str, family, bytes, prefix] of cases) {
    const r = parseCIDR(str);
    assert.equal(r.family, family, str);
    assert.equal(r.prefix, prefix, str);
    assert.deepEqual(Array.from(r.addr), bytes, str);
  }
});

test('parseCIDR accepts valid IPv6 inputs', () => {
  const r1 = parseCIDR('2001:db8::/32');
  assert.equal(r1.family, 'v6');
  assert.equal(r1.prefix, 32);
  assert.deepEqual(Array.from(r1.addr), [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const r2 = parseCIDR('2001:db8::1');
  assert.equal(r2.prefix, 128);
  assert.deepEqual(Array.from(r2.addr).slice(14, 16), [0, 1]);

  const r3 = parseCIDR('2001:0db8:0000:0000:0000:0000:0000:0001/64');
  assert.equal(r3.family, 'v6');
  assert.equal(r3.prefix, 64);
  assert.deepEqual(Array.from(r3.addr).slice(14, 16), [0, 1]);

  const r4 = parseCIDR('::/0');
  assert.equal(r4.prefix, 0);
  assert.deepEqual(Array.from(r4.addr), new Array(16).fill(0));

  const r5 = parseCIDR('::1/128');
  assert.equal(r5.prefix, 128);
  assert.deepEqual(Array.from(r5.addr).slice(15), [1]);

  const r6 = parseCIDR('DEAD:BEEF::1');
  assert.equal(r6.family, 'v6');
  assert.equal(toStr6(r6.addr), 'dead:beef::1');
});

test('parseCIDR rejects invalid inputs', () => {
  const bad = [
    '',
    'garbage',
    '1.2.3.4/24/5',
    '/24',
    '1.2.3.4/',
    '256.1.1.1/24',
    '1.2.3/24',
    '1.2.3.4/abc',
    '1.2.3.4/-1',
    '1.2.3.4/33',
    '1.2.3.4.5',
    '1.2.3.4/24.5',
    ' 1.2.3.4',
    '1.2.3.4 ',
    '2001:db8::/129',
    '2001:db8::/abc',
    '2001:db8::/-1',
    '1:2:3:4:5:6:7:8:9',
    '2001:::db8',
    '2001:db8::1::',
    ':::',
    '2001:db8::ghij',
    '::ffff:192.168.1.1',
  ];
  for (const s of bad) {
    let threw = false;
    try {
      parseCIDR(s);
    } catch (e) {
      assert.ok(e instanceof IpMathError, `expected IpMathError for ${JSON.stringify(s)}, got ${e}`);
      assert.ok(e.message.length > 0);
      threw = true;
    }
    assert.ok(threw, `expected throw for ${JSON.stringify(s)}`);
  }
});

test('IPv4 round-trips', () => {
  for (const s of ['0.0.0.0', '1.2.3.4', '255.255.255.255', '10.0.0.0', '192.168.1.254']) {
    assert.equal(toStr4(addrFromStr(s, 'v4')), s);
  }
});

test('IPv6 rfc5952 compression', () => {
  assert.equal(toStr6(addrFromStr('2001:0db8:0000:0000:0000:0000:0000:0001', 'v6')), '2001:db8::1');
  assert.equal(toStr6(addrFromStr('::1', 'v6')), '::1');
  assert.equal(toStr6(addrFromStr('1::', 'v6')), '1::');
  assert.equal(toStr6(addrFromStr('::', 'v6')), '::');
  assert.equal(toStr6(addrFromStr('2001:db8::', 'v6')), '2001:db8::');
  assert.equal(toStr6(addrFromStr('1:2:3:4:5:6:7:8', 'v6')), '1:2:3:4:5:6:7:8');
  assert.equal(toStr6(addrFromStr('1:0:1:1:1:1:1:1', 'v6')), '1:0:1:1:1:1:1:1');
  assert.equal(toStr6(addrFromStr('2001:0:0:1:0:0:7:8', 'v6')), '2001::1:0:0:7:8');
  assert.equal(toStr6(addrFromStr('0:0:0:0:0:0:0:1', 'v6')), '::1');
  assert.equal(toStr6(addrFromStr('1:0:0:0:0:0:0:0', 'v6')), '1::');
});

test('IPv6 round-trips', () => {
  for (const s of ['::1', '2001:db8::1', 'fe80::1234:abcd', '2001:db8::', '1::']) {
    assert.equal(toStr6(addrFromStr(s, 'v6')), s);
  }
});

test('v4 network/broadcast/first/last/hostCount', () => {
  const a = addrFromStr('192.168.1.5', 'v4');
  assert.equal(toStr4(networkOf(a, 24)), '192.168.1.0');
  assert.equal(toStr4(broadcastOf(a, 24)), '192.168.1.255');
  assert.equal(toStr4(firstHost(a, 24, 'v4')), '192.168.1.1');
  assert.equal(toStr4(lastHost(a, 24, 'v4')), '192.168.1.254');
  assert.equal(hostCount(24, 'v4'), 254n);

  assert.equal(toStr4(networkOf(a, 31)), '192.168.1.4');
  assert.equal(toStr4(broadcastOf(a, 31)), '192.168.1.5');
  assert.equal(toStr4(firstHost(a, 31, 'v4')), '192.168.1.4');
  assert.equal(toStr4(lastHost(a, 31, 'v4')), '192.168.1.5');
  assert.equal(hostCount(31, 'v4'), 2n);

  assert.equal(toStr4(networkOf(a, 32)), '192.168.1.5');
  assert.equal(toStr4(broadcastOf(a, 32)), '192.168.1.5');
  assert.equal(toStr4(firstHost(a, 32, 'v4')), '192.168.1.5');
  assert.equal(toStr4(lastHost(a, 32, 'v4')), '192.168.1.5');
  assert.equal(hostCount(32, 'v4'), 1n);

  const a0 = addrFromStr('0.0.0.0', 'v4');
  assert.equal(toStr4(networkOf(a0, 0)), '0.0.0.0');
  assert.equal(toStr4(broadcastOf(a0, 0)), '255.255.255.255');
  assert.equal(toStr4(firstHost(a0, 0, 'v4')), '0.0.0.1');
  assert.equal(toStr4(lastHost(a0, 0, 'v4')), '255.255.255.254');
  assert.equal(hostCount(0, 'v4'), 4294967294n);

  const a10 = addrFromStr('10.0.0.0', 'v4');
  assert.equal(toStr4(networkOf(a10, 8)), '10.0.0.0');
  assert.equal(toStr4(broadcastOf(a10, 8)), '10.255.255.255');
  assert.equal(toStr4(firstHost(a10, 8, 'v4')), '10.0.0.1');
  assert.equal(toStr4(lastHost(a10, 8, 'v4')), '10.255.255.254');
  assert.equal(hostCount(8, 'v4'), 16777214n);

  assert.equal(toStr4(networkOf(addrFromStr('198.51.100.19', 'v4'), 24)), '198.51.100.0');
});

test('v6 network and hostCount', () => {
  const a = addrFromStr('2001:db8:abcd:1234::1', 'v6');
  assert.equal(toStr6(networkOf(a, 32)), '2001:db8::');
  assert.equal(toStr6(networkOf(a, 48)), '2001:db8:abcd::');
  assert.equal(hostCount(32, 'v6'), 79228162514264337593543950336n);
  assert.equal(hostCount(127, 'v6'), 2n);
  assert.equal(hostCount(128, 'v6'), 1n);
  assert.equal(hostCount(0, 'v6'), 1n << 128n);

  assert.equal(toStr6(networkOf(addrFromStr('::1', 'v6'), 128)), '::1');
});

test('v6 first/last host (no broadcast concept)', () => {
  const a = addrFromStr('2001:db8::1', 'v6');
  assert.equal(toStr6(firstHost(a, 32, 'v6')), '2001:db8::');
  assert.equal(toStr6(lastHost(a, 32, 'v6')), '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff');
  assert.equal(toStr6(firstHost(a, 128, 'v6')), '2001:db8::1');
  assert.equal(toStr6(lastHost(a, 128, 'v6')), '2001:db8::1');
});

test('netmask strings', () => {
  assert.equal(netmaskStr(0, 'v4'), '0.0.0.0');
  assert.equal(netmaskStr(16, 'v4'), '255.255.0.0');
  assert.equal(netmaskStr(24, 'v4'), '255.255.255.0');
  assert.equal(netmaskStr(32, 'v4'), '255.255.255.255');
  assert.equal(netmaskStr(32, 'v6'), 'ffff:ffff:0000:0000:0000:0000:0000:0000');
  assert.equal(netmaskStr(48, 'v6'), 'ffff:ffff:ffff:0000:0000:0000:0000:0000');
  assert.equal(netmaskStr(64, 'v6'), 'ffff:ffff:ffff:ffff:0000:0000:0000:0000');
});

test('contains boundary cells', () => {
  const net = addrFromStr('192.168.1.0', 'v4');
  assert.equal(contains(net, 24, addrFromStr('192.168.1.0', 'v4')), true);
  assert.equal(contains(net, 24, addrFromStr('192.168.1.255', 'v4')), true);
  assert.equal(contains(net, 24, addrFromStr('192.168.1.42', 'v4')), true);
  assert.equal(contains(net, 24, addrFromStr('192.168.0.255', 'v4')), false);
  assert.equal(contains(net, 24, addrFromStr('192.168.2.0', 'v4')), false);
  assert.equal(contains(net, 24, '192.168.1.1'), true);
  assert.equal(contains(net, 24, '192.168.9.1'), false);

  assert.equal(contains(addrFromStr('192.168.1.99', 'v4'), 24, '192.168.1.50'), true);

  const v6net = addrFromStr('2001:db8::', 'v6');
  assert.equal(contains(v6net, 32, addrFromStr('2001:db8:1::', 'v6')), true);
  assert.equal(contains(v6net, 32, addrFromStr('2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', 'v6')), false);
  assert.equal(contains(v6net, 32, '::1'), false);

  assert.equal(contains(net, 24, addrFromStr('::1', 'v6')), false);
  assert.equal(contains(v6net, 32, addrFromStr('192.168.1.1', 'v4')), false);

  const rec = parseCIDR('192.168.1.0/24');
  assert.equal(contains(rec, undefined, '192.168.1.7'), true);
  assert.equal(contains(rec, undefined, '192.168.9.7'), false);
});

test('split 10.0.0.0/8 by 256', () => {
  const rec = parseCIDR('10.0.0.0/8');
  const subs = split(rec.addr, 8, 256);
  assert.equal(subs.length, 256);
  assert.equal(subs[0].prefix, 16);
  const all = subs.map((s) => `${toStr4(s.network)}/${s.prefix}`);
  assert.deepEqual(
    [all[0], all[1], all[2], all[254], all[255]],
    ['10.0.0.0/16', '10.1.0.0/16', '10.2.0.0/16', '10.254.0.0/16', '10.255.0.0/16']
  );
});

test('split 10.0.0.0/16 by 4', () => {
  const rec = parseCIDR('10.0.0.0/16');
  const subs = split(rec.addr, 16, 4);
  assert.deepEqual(
    subs.map((s) => `${toStr4(s.network)}/${s.prefix}`),
    ['10.0.0.0/18', '10.0.64.0/18', '10.0.128.0/18', '10.0.192.0/18']
  );
});

test('split /32 by 1', () => {
  const rec = parseCIDR('192.168.1.7/32');
  const subs = split(rec.addr, 32, 1);
  assert.deepEqual(
    subs.map((s) => `${toStr4(s.network)}/${s.prefix}`),
    ['192.168.1.7/32']
  );
});

test('split rejects bad counts', () => {
  const rec = parseCIDR('10.0.0.0/8');
  for (const bad of [0, 3, 5, 12, -2, 1.5]) {
    assert.throws(() => split(rec.addr, 8, bad), IpMathError, `count ${bad}`);
  }
  assert.throws(() => split(rec.addr, 8, 2 ** 25), IpMathError);
  const r24 = parseCIDR('10.0.0.0/24');
  assert.throws(() => split(r24.addr, 24, 512), IpMathError);
});

test('split rejects IPv6', () => {
  const rec = parseCIDR('2001:db8::/32');
  assert.throws(() => split(rec.addr, 32, 2), IpMathError);
});

test('rangeToCIDRs basic', () => {
  const f = (first, last) => rangeToCIDRs(first, last).map((c) => `${toStr4(c.network)}/${c.prefix}`);

  assert.deepEqual(f('1.2.3.4', '1.2.3.7'), ['1.2.3.4/30']);
  assert.deepEqual(f('1.2.3.4', '1.2.3.4'), ['1.2.3.4/32']);
  assert.deepEqual(f('0.0.0.0', '0.0.0.255'), ['0.0.0.0/24']);
  assert.deepEqual(f('0.0.0.1', '0.0.0.5'), ['0.0.0.1/32', '0.0.0.2/31', '0.0.0.4/31']);
  assert.deepEqual(f('0.0.0.0', '255.255.255.255'), ['0.0.0.0/0']);
  assert.deepEqual(
    f('192.168.1.3', '192.168.1.44'),
    [
      '192.168.1.3/32',
      '192.168.1.4/30',
      '192.168.1.8/29',
      '192.168.1.16/28',
      '192.168.1.32/29',
      '192.168.1.40/30',
      '192.168.1.44/32',
    ]
  );
});

test('rangeToCIDRs rejects inverted range', () => {
  assert.throws(() => rangeToCIDRs('1.2.3.5', '1.2.3.4'), IpMathError);
});

test('cidrSum merges overlapping, adjacent and disjoint', () => {
  const f = (list) => cidrSum(list).map((c) => `${toStr4(c.network)}/${c.prefix}`);

  assert.deepEqual(f(['192.168.1.0/25', '192.168.1.64/26']), ['192.168.1.0/25']);
  assert.deepEqual(f(['192.168.0.0/24', '192.168.1.0/24']), ['192.168.0.0/23']);
  assert.deepEqual(f(['10.0.0.0/24', '10.0.2.0/24']), ['10.0.0.0/24', '10.0.2.0/24']);
  assert.deepEqual(f(['10.0.0.0/24', '10.0.0.0/24']), ['10.0.0.0/24']);
  assert.deepEqual(
    f(['10.0.1.0/24', '10.0.0.0/26', '10.0.2.0/24']),
    ['10.0.0.0/26', '10.0.1.0/24', '10.0.2.0/24']
  );
  assert.deepEqual(f([]), []);
});

test('cidrSum rejects IPv6', () => {
  assert.throws(() => cidrSum(['2001:db8::/32']), IpMathError);
});

test('addrToHex and addrToBinary', () => {
  assert.equal(addrToHex(addrFromStr('::1', 'v6'), 'v6'), '0000:0000:0000:0000:0000:0000:0000:0001');
  assert.equal(
    addrToHex(addrFromStr('2001:db8::', 'v6'), 'v6'),
    '2001:0db8:0000:0000:0000:0000:0000:0000'
  );
  assert.equal(addrToBinary(addrFromStr('192.168.1.0', 'v4')), '11000000.10101000.00000001.00000000');
});