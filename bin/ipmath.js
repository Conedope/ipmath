#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  IpMathError,
  parseCIDR,
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
  guessFamily,
} from '../lib/ip.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const PROG = 'ipmath';

const USAGE = `Usage: ${PROG} <command> [options]

Commands:
  info CIDR                Show network info for a CIDR
  contains CIDR IP...      Test membership; prints yes/no per IP
  split CIDR N             Split an IPv4 subnet into N equal subnets (N power of two)
  range FIRST LAST         Cover an inclusive IPv4 range with minimal CIDRs
  sum CIDR...              Merge overlapping/adjacent IPv4 CIDRs

Options:
  --json       Machine-readable JSON output
  --expand     Show uncompressed (long-form) IPv6 addresses
  --version    Print version and exit
  --help       Show this help and exit

Examples:
  ${PROG} info 192.168.1.0/24
  ${PROG} contains 10.0.0.0/8 10.1.2.3 8.8.8.8
  ${PROG} split 10.0.0.0/8 256
  ${PROG} range 192.168.1.0 192.168.1.255
  ${PROG} sum 10.0.0.0/25 10.0.0.128/26
`;

function fail(message) {
  process.stderr.write(`${PROG}: ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stderr.write(USAGE);
  process.exit(2);
}

const args = process.argv.slice(2);
let json = false;
let expand = false;
const rest = [];
for (const arg of args) {
  if (arg === '--json') json = true;
  else if (arg === '--expand') expand = true;
  else if (arg === '--help' || arg === '-h') {
    process.stdout.write(USAGE);
    process.exit(0);
  } else if (arg === '--version' || arg === '-V') {
    process.stdout.write(`${PROG} ${pkg.version}\n`);
    process.exit(0);
  } else rest.push(arg);
}
if (rest.length === 0) usage();
const [cmd, ...cmdArgs] = rest;

function requireMin(n) {
  if (cmdArgs.length < n) usage();
}
function requireExact(n) {
  if (cmdArgs.length !== n) usage();
}

function fmtAddr(addr, family) {
  if (family === 'v6' && expand) return addrToHex(addr, 'v6');
  return addrToStr(addr, family);
}

function renderCidrList(list) {
  return list.map(({ network, prefix, family }) => `${fmtAddr(network, family)}/${prefix}`);
}

function cmdInfo() {
  requireExact(1);
  const rec = parseCIDR(cmdArgs[0]);
  const fam = rec.family;
  const net = networkOf(rec.addr, rec.prefix);
  const bcast = broadcastOf(rec.addr, rec.prefix);
  const fh = firstHost(rec.addr, rec.prefix, fam);
  const lh = lastHost(rec.addr, rec.prefix, fam);
  const address = `${fmtAddr(rec.addr, fam)}/${rec.prefix}`;
  if (json) {
    const out = {
      address,
      family: fam,
      prefix: rec.prefix,
      netmask: netmaskStr(rec.prefix, fam),
      network: fmtAddr(net, fam),
      firstHost: fmtAddr(fh, fam),
      lastHost: fmtAddr(lh, fam),
      hostCount: String(hostCount(rec.prefix, fam)),
    };
    if (fam === 'v4') {
      out.broadcast = fmtAddr(bcast, fam);
      out.binary = addrToBinary(net);
    } else {
      out.hex = addrToHex(rec.addr, 'v6');
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  const rows = [
    ['IP address', address],
    ['prefix', `/${rec.prefix}`],
    ['netmask', netmaskStr(rec.prefix, fam)],
    ['network', fmtAddr(net, fam)],
  ];
  if (fam === 'v4') rows.push(['broadcast', fmtAddr(bcast, fam)]);
  rows.push(
    ['first host', fmtAddr(fh, fam)],
    ['last host', fmtAddr(lh, fam)],
    ['host count', String(hostCount(rec.prefix, fam))]
  );
  if (fam === 'v4') rows.push(['binary', addrToBinary(net)]);
  else rows.push(['hex', addrToHex(rec.addr, 'v6')]);
  const w = Math.max(...rows.map((r) => r[0].length));
  for (const [k, v] of rows) process.stdout.write(`${k.padEnd(w)}  ${v}\n`);
}

function cmdContains() {
  requireMin(2);
  const rec = parseCIDR(cmdArgs[0]);
  const ips = cmdArgs.slice(1);
  if (json) {
    const results = ips.map((ip) => ({ ip, contains: contains(rec, rec.prefix, ip) }));
    process.stdout.write(
      JSON.stringify({ cidr: `${fmtAddr(rec.addr, rec.family)}/${rec.prefix}`, results }, null, 2) +
        '\n'
    );
    return;
  }
  for (const ip of ips) {
    const ok = contains(rec, rec.prefix, ip);
    process.stdout.write(`${ip}  ${ok ? 'yes' : 'no'}\n`);
  }
}

function cmdSplit() {
  requireExact(2);
  const rec = parseCIDR(cmdArgs[0]);
  const count = Number(cmdArgs[1]);
  const subs = split(rec.addr, rec.prefix, count).map((s) => ({ ...s, family: 'v4' }));
  if (json) {
    process.stdout.write(
      JSON.stringify(
        { cidr: `${fmtAddr(rec.addr, rec.family)}/${rec.prefix}`, count, subnets: renderCidrList(subs) },
        null,
        2
      ) + '\n'
    );
    return;
  }
  for (const s of renderCidrList(subs)) process.stdout.write(s + '\n');
}

function cmdRange() {
  requireExact(2);
  const [first, last] = cmdArgs;
  for (const s of [first, last]) {
    if (guessFamily(s) !== 'v4') fail('range requires IPv4 endpoints');
  }
  const cidrs = rangeToCIDRs(first, last).map((c) => ({ ...c, family: 'v4' }));
  if (json) {
    process.stdout.write(
      JSON.stringify({ first, last, cidrs: renderCidrList(cidrs) }, null, 2) + '\n'
    );
    return;
  }
  for (const c of renderCidrList(cidrs)) process.stdout.write(c + '\n');
}

function cmdSum() {
  requireMin(1);
  const merged = cidrSum(cmdArgs).map((c) => ({ ...c, family: 'v4' }));
  if (json) {
    process.stdout.write(JSON.stringify({ cidrs: renderCidrList(merged) }, null, 2) + '\n');
    return;
  }
  for (const c of renderCidrList(merged)) process.stdout.write(c + '\n');
}

try {
  switch (cmd) {
    case 'info':
      cmdInfo();
      break;
    case 'contains':
      cmdContains();
      break;
    case 'split':
      cmdSplit();
      break;
    case 'range':
      cmdRange();
      break;
    case 'sum':
      cmdSum();
      break;
    default:
      usage();
  }
} catch (e) {
  if (e instanceof IpMathError) fail(e.message);
  else throw e;
}