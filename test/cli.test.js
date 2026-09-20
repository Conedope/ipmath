import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const bin = new URL('../bin/ipmath.js', import.meta.url).pathname;

function run(args, opts = {}) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...opts });
}

test('info produces expected table', () => {
  const r = run(['info', '192.168.1.0/24']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const out = r.stdout;
  assert.ok(out.includes('IP address  192.168.1.0'));
  assert.ok(out.includes('prefix      /24'));
  assert.ok(out.includes('netmask     255.255.255.0'));
  assert.ok(out.includes('network     192.168.1.0'));
  assert.ok(out.includes('broadcast   192.168.1.255'));
  assert.ok(out.includes('first host  192.168.1.1'));
  assert.ok(out.includes('last host   192.168.1.254'));
  assert.ok(out.includes('host count  254'));
  assert.ok(out.includes('11000000.10101000.00000001.00000000'));
});

test('info --json numeric correctness', () => {
  const r = run(['info', '--json', '192.168.1.5/24']);
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.equal(o.address, '192.168.1.5/24');
  assert.equal(o.family, 'v4');
  assert.equal(o.prefix, 24);
  assert.equal(o.netmask, '255.255.255.0');
  assert.equal(o.network, '192.168.1.0');
  assert.equal(o.broadcast, '192.168.1.255');
  assert.equal(o.firstHost, '192.168.1.1');
  assert.equal(o.lastHost, '192.168.1.254');
  assert.equal(o.hostCount, '254');
  assert.equal(o.binary, '11000000.10101000.00000001.00000000');
});

test('info v6 --json', () => {
  const r = run(['info', '--json', '2001:db8::/32']);
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.equal(o.family, 'v6');
  assert.equal(o.prefix, 32);
  assert.equal(o.network, '2001:db8::');
  assert.equal(o.netmask, 'ffff:ffff:0000:0000:0000:0000:0000:0000');
  assert.equal(o.hostCount, '79228162514264337593543950336');
  assert.equal(o.hex, '2001:0db8:0000:0000:0000:0000:0000:0000');
});

test('info /31 (rfc3021)', () => {
  const r = run(['info', '192.168.1.4/31']);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('first host  192.168.1.4'));
  assert.ok(r.stdout.includes('last host   192.168.1.5'));
  assert.ok(r.stdout.includes('host count  2'));
});

test('info --expand shows long-form IPv6', () => {
  const r = run(['info', '--expand', '2001:db8::1/48']);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('IP address  2001:0db8:0000:0000:0000:0000:0000:0001'));
  assert.ok(r.stdout.includes('network     2001:0db8:0000:0000:0000:0000:0000:0000'));
});

test('contains prints yes/no and exits 0', () => {
  const r = run(['contains', '192.168.1.0/24', '192.168.1.1', '192.168.2.1', '192.168.1.255']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.deepEqual(r.stdout.trim().split('\n'), [
    '192.168.1.1  yes',
    '192.168.2.1  no',
    '192.168.1.255  yes',
  ]);
});

test('contains --json', () => {
  const r = run(['contains', '--json', '192.168.1.0/24', '192.168.1.1', '8.8.8.8']);
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.equal(o.cidr, '192.168.1.0/24');
  assert.deepEqual(o.results, [
    { ip: '192.168.1.1', contains: true },
    { ip: '8.8.8.8', contains: false },
  ]);
});

test('split 10.0.0.0/8 by 256', () => {
  const r = run(['split', '10.0.0.0/8', '256']);
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 256);
  assert.equal(lines[0], '10.0.0.0/16');
  assert.equal(lines[1], '10.1.0.0/16');
  assert.equal(lines[255], '10.255.0.0/16');
});

test('split --json', () => {
  const r = run(['split', '--json', '10.0.0.0/16', '4']);
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.equal(o.count, 4);
  assert.deepEqual(o.subnets, [
    '10.0.0.0/18',
    '10.0.64.0/18',
    '10.0.128.0/18',
    '10.0.192.0/18',
  ]);
});

test('split non power-of-two exits 1 with stderr', () => {
  const r = run(['split', '10.0.0.0/8', '3']);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith('ipmath: '));
  assert.equal(r.stdout, '');
});

test('range expands to minimal CIDRs', () => {
  const r = run(['range', '1.2.3.4', '1.2.3.7']);
  assert.equal(r.status, 0);
  assert.deepEqual(r.stdout.trim().split('\n'), ['1.2.3.4/30']);

  const r2 = run(['range', '0.0.0.1', '0.0.0.5']);
  assert.equal(r2.status, 0);
  assert.deepEqual(r2.stdout.trim().split('\n'), ['0.0.0.1/32', '0.0.0.2/31', '0.0.0.4/31']);
});

test('range inverted exits 1', () => {
  const r = run(['range', '1.2.3.9', '1.2.3.4']);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith('ipmath: '));
});

test('range rejects IPv6 endpoints', () => {
  const r = run(['range', '::1', '::2']);
  assert.equal(r.status, 1);
});

test('sum merges adjacent CIDRs', () => {
  const r = run(['sum', '192.168.0.0/24', '192.168.1.0/24']);
  assert.equal(r.status, 0);
  assert.deepEqual(r.stdout.trim().split('\n'), ['192.168.0.0/23']);
});

test('sum --json', () => {
  const r = run(['sum', '--json', '10.0.0.0/25', '10.0.0.64/26']);
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(o.cidrs, ['10.0.0.0/25']);
});

test('bad CIDR exits 1 with message on stderr', () => {
  const r = run(['info', '999.1.2.3/24']);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith('ipmath: '));
  assert.equal(r.stdout, '');
});

test('usage errors exit 2', () => {
  assert.equal(run([]).status, 2);
  assert.equal(run(['frobnicate']).status, 2);
  assert.equal(run(['info']).status, 2);
  assert.equal(run(['contains', '1.2.3.4/24']).status, 2);
  assert.equal(run(['split', '10.0.0.0/8']).status, 2);
  const r = run([]);
  assert.ok(r.stderr.includes('Usage:'));
});

test('--version and --help', () => {
  const v = run(['--version']);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /^ipmath \d+\.\d+\.\d+\n$/);

  const h = run(['--help']);
  assert.equal(h.status, 0);
  assert.ok(h.stdout.includes('Usage:'));
});