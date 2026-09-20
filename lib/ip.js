// ipmath — pure IPv4/IPv6 / CIDR arithmetic.
// No dependencies; bytes live in Uint8Array, IPv6 math uses BigInt.

export class IpMathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IpMathError';
  }
}

const V4_BYTES = 4;
const V6_BYTES = 16;

export function familyOfBytes(len) {
  if (len === V4_BYTES) return 'v4';
  if (len === V6_BYTES) return 'v6';
  return null;
}

export function guessFamily(str) {
  return str.includes(':') ? 'v6' : 'v4';
}

// --- address parsing -------------------------------------------------------

export function addrFromStr(str, family) {
  if (typeof str !== 'string' || str.length === 0) {
    throw new IpMathError('empty address');
  }
  const fam = family || guessFamily(str);
  if (fam === 'v4') return addrFromStr4(str);
  if (fam === 'v6') return addrFromStr6(str);
  throw new IpMathError(`unknown address family: ${fam}`);
}

function addrFromStr4(str) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(str);
  if (!m) throw new IpMathError(`invalid IPv4 address: "${str}"`);
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(m[i + 1]);
    if (n > 255) throw new IpMathError(`invalid IPv4 address: "${str}"`);
    out[i] = n;
  }
  return out;
}

function addrFromStr6(str) {
  if (str.includes('.')) {
    throw new IpMathError(`embedded IPv4 tails are not supported: "${str}"`);
  }
  const parts = str.split('::');
  if (parts.length > 2) throw new IpMathError(`invalid IPv6 address: "${str}"`);
  let left;
  let right;
  if (parts.length === 2) {
    left = parts[0] === '' ? [] : parts[0].split(':');
    right = parts[1] === '' ? [] : parts[1].split(':');
    if (left.length + right.length >= 8) {
      throw new IpMathError(`invalid IPv6 address: "${str}"`);
    }
  } else {
    left = parts[0].split(':');
    if (left.length !== 8) throw new IpMathError(`invalid IPv6 address: "${str}"`);
    right = [];
  }
  const groups = left.concat(new Array(8 - left.length - right.length).fill('0'), right);
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i];
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) {
      throw new IpMathError(`invalid IPv6 address: "${str}"`);
    }
    const v = parseInt(g, 16);
    out[i * 2] = (v >> 8) & 0xff;
    out[i * 2 + 1] = v & 0xff;
  }
  return out;
}

// --- address printing ------------------------------------------------------

function ipv6Groups(addr) {
  const g = [];
  for (let i = 0; i < 8; i++) {
    g.push(((addr[i * 2] << 8) | addr[i * 2 + 1]).toString(16));
  }
  return g;
}

// RFC 5952: lowercase, collapse the longest run of >=2 zero groups; ties go
// to the first run encountered.
export function addrToStr(addr, family) {
  const fam = family || familyOfBytes(addr.length);
  if (fam === 'v4') return Array.from(addr).join('.');
  if (fam === 'v6') return compressV6(addr);
  throw new IpMathError(`bad address length: ${addr.length}`);
}

function compressV6(addr) {
  const g = ipv6Groups(addr);
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  let len = 0;
  for (let i = 0; i < g.length; i++) {
    if (g[i] === '0') {
      if (start === -1) {
        start = i;
        len = 1;
      } else {
        len++;
      }
      if (len > bestLen) {
        bestLen = len;
        bestStart = start;
      }
    } else {
      start = -1;
      len = 0;
    }
  }
  if (bestLen >= 2) {
    const head = g.slice(0, bestStart);
    const tail = g.slice(bestStart + bestLen);
    const h = head.join(':');
    const t = tail.join(':');
    if (head.length === 0) return '::' + t;
    if (tail.length === 0) return h + '::';
    return h + '::' + t;
  }
  return g.join(':');
}

// Uncompressed full form, e.g. 2001:0db8:0000:...:0001.
export function addrToHex(addr, family) {
  const fam = family || familyOfBytes(addr.length);
  if (fam === 'v6') {
    return ipv6Groups(addr).map((x) => x.padStart(4, '0')).join(':');
  }
  return Array.from(addr).map((x) => x.toString(16).padStart(2, '0')).join('.');
}

export function addrToBinary(addr) {
  return Array.from(addr).map((b) => b.toString(2).padStart(8, '0')).join('.');
}

// --- bit helpers -----------------------------------------------------------

function buildMaskBytes(prefix, len) {
  const a = new Uint8Array(len);
  let bits = prefix;
  for (let i = 0; i < len; i++) {
    if (bits >= 8) {
      a[i] = 0xff;
      bits -= 8;
    } else if (bits > 0) {
      a[i] = (0xff << (8 - bits)) & 0xff;
      bits = 0;
    }
  }
  return a;
}

function applyMask(addr, prefix, fill) {
  const a = new Uint8Array(addr);
  const mask = buildMaskBytes(prefix, a.length);
  for (let i = 0; i < a.length; i++) {
    const m = mask[i];
    if (fill) a[i] = (a[i] & m) | ~m;
    else a[i] = (a[i] & m) & 0xff;
  }
  return a;
}

export function networkOf(addr, prefix) {
  return applyMask(addr, prefix, false);
}

export function broadcastOf(addr, prefix) {
  return applyMask(addr, prefix, true);
}

export function netmaskStr(prefix, family) {
  if (family === 'v4') {
    return addrToStr(buildMaskBytes(prefix, 4), 'v4');
  }
  return addrToHex(buildMaskBytes(prefix, 16), 'v6');
}

// --- bigint bridges --------------------------------------------------------

export function bytesToBig(addr) {
  let v = 0n;
  for (const b of addr) v = (v << 8n) | BigInt(b);
  return v;
}

export function bigToBytes(v, len) {
  const a = new Uint8Array(len);
  let x = v;
  for (let i = len - 1; i >= 0; i--) {
    a[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return a;
}

function incBytes(a) {
  const r = new Uint8Array(a);
  for (let i = r.length - 1; i >= 0; i--) {
    r[i] = (r[i] + 1) & 0xff;
    if (r[i] !== 0) break;
  }
  return r;
}

function decBytes(a) {
  const r = new Uint8Array(a);
  for (let i = r.length - 1; i >= 0; i--) {
    if (r[i] !== 0) {
      r[i] -= 1;
      break;
    }
    r[i] = 0xff;
  }
  return r;
}

// --- CIDR arithmetic -------------------------------------------------------

export function parseCIDR(str) {
  if (typeof str !== 'string') throw new IpMathError('CIDR must be a string');
  if (str.length === 0) throw new IpMathError('empty CIDR');
  const slash = str.indexOf('/');
  const addrPart = slash === -1 ? str : str.slice(0, slash);
  const prefixPart = slash === -1 ? undefined : str.slice(slash + 1);
  if (prefixPart === '') throw new IpMathError(`invalid CIDR: "${str}"`);
  const family = guessFamily(addrPart);
  const maxPrefix = family === 'v4' ? 32 : 128;
  let prefix;
  if (prefixPart === undefined) {
    prefix = maxPrefix;
  } else {
    if (!/^\d+$/.test(prefixPart)) {
      throw new IpMathError(`invalid prefix in CIDR: "${str}"`);
    }
    prefix = Number(prefixPart);
    if (prefix > maxPrefix) {
      throw new IpMathError(`prefix ${prefix} out of range for ${family}`);
    }
  }
  const addr = addrFromStr(addrPart, family);
  return { family, addr, prefix };
}

export function firstHost(addr, prefix, family) {
  const fam = family || familyOfBytes(addr.length);
  const net = networkOf(addr, prefix);
  if (fam === 'v4') {
    // rfc3021: /31 and /32 have no network/broadcast to skip.
    if (prefix >= 31) return net;
    return incBytes(net);
  }
  // IPv6 has no broadcast; the all-zeros address is a usable host address.
  return net;
}

export function lastHost(addr, prefix, family) {
  const fam = family || familyOfBytes(addr.length);
  const bc = broadcastOf(addr, prefix);
  if (fam === 'v4') {
    if (prefix >= 31) return bc;
    return decBytes(bc);
  }
  return bc;
}

export function hostCount(prefix, family) {
  if (family === 'v4') {
    if (prefix <= 30) return (1n << BigInt(32 - prefix)) - 2n;
    return 1n << BigInt(32 - prefix);
  }
  return 1n << BigInt(128 - prefix);
}

export function contains(network, prefix, ip, family) {
  let net = network;
  let pref = prefix;
  let fam = family;
  if (network && typeof network === 'object' && !(network instanceof Uint8Array)) {
    if (!(network.addr instanceof Uint8Array)) {
      throw new IpMathError('contains: bad network');
    }
    net = network.addr;
    pref = network.prefix;
    fam = network.family || familyOfBytes(net.length);
  }
  fam = fam || familyOfBytes(net.length);
  const len = fam === 'v4' ? 4 : 16;
  let ipBytes;
  if (typeof ip === 'string') ipBytes = addrFromStr(ip, fam);
  else if (ip instanceof Uint8Array) ipBytes = ip;
  else throw new IpMathError('contains: bad ip');
  if (ipBytes.length !== len) return false;
  const netM = bytesToBig(applyMask(net, pref, false));
  const ipM = bytesToBig(applyMask(ipBytes, pref, false));
  return netM === ipM;
}

// Split an IPv4 subnet into `count` equal subnets (count must be a power of
// two). The sub-prefix is prefix + log2(count).
export function split(network, prefix, count) {
  if (familyOfBytes(network.length) !== 'v4') {
    throw new IpMathError('split requires an IPv4 subnet');
  }
  if (prefix > 32) throw new IpMathError(`split: prefix ${prefix} out of range`);
  if (!Number.isInteger(count) || count < 1 || (count & (count - 1)) !== 0) {
    throw new IpMathError(`split count must be a power of two, got ${count}`);
  }
  const capacity = 1n << BigInt(32 - prefix);
  if (BigInt(count) > capacity) {
    throw new IpMathError(`split count ${count} exceeds subnet capacity ${capacity}`);
  }
  const newPrefix = prefix + Math.log2(count);
  const step = 1n << BigInt(32 - newPrefix);
  const base = bytesToBig(networkOf(network, prefix));
  const out = [];
  for (let i = 0n; i < BigInt(count); i++) {
    out.push({ network: bigToBytes(base + i * step, 4), prefix: newPrefix });
  }
  return out;
}

function toBig32(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string') return bytesToBig(addrFromStr(v, 'v4'));
  if (v instanceof Uint8Array) {
    if (familyOfBytes(v.length) !== 'v4') {
      throw new IpMathError('range requires IPv4 endpoints');
    }
    return bytesToBig(v);
  }
  if (typeof v === 'number') return BigInt(v >>> 0);
  throw new IpMathError('invalid range endpoint');
}

// Cover the inclusive IPv4 range [first, last] with the minimal list of CIDRs.
export function rangeToCIDRs(first, last) {
  const f = toBig32(first);
  const l = toBig32(last);
  if (f > l) {
    throw new IpMathError(
      `inverted range: ${addrToStr(bigToBytes(f, 4), 'v4')} > ${addrToStr(bigToBytes(l, 4), 'v4')}`
    );
  }
  const out = [];
  let cur = f;
  while (cur <= l) {
    let step = 1n;
    for (;;) {
      const next = step << 1n;
      const aligned = (cur & (next - 1n)) === 0n;
      const fits = cur + next - 1n <= l;
      if (aligned && fits) step = next;
      else break;
    }
    out.push({
      network: bigToBytes(cur, 4),
      prefix: 32 - Math.log2(Number(step)),
    });
    cur += step;
  }
  return out;
}

function cidrToInterval(entry) {
  let rec;
  if (typeof entry === 'string') {
    rec = parseCIDR(entry);
  } else if (
    entry &&
    typeof entry === 'object' &&
    entry.network instanceof Uint8Array &&
    Number.isInteger(entry.prefix)
  ) {
    rec = { addr: entry.network, prefix: entry.prefix, family: familyOfBytes(entry.network.length) };
  } else {
    throw new IpMathError('cidrSum: invalid entry');
  }
  if (rec.family !== 'v4') throw new IpMathError('cidrSum requires IPv4 CIDRs');
  return {
    first: bytesToBig(networkOf(rec.addr, rec.prefix)),
    last: bytesToBig(broadcastOf(rec.addr, rec.prefix)),
  };
}

// Merge a list of IPv4 CIDRs into the minimal covering list. Overlapping and
// adjacent intervals are collapsed greedily, then rangeToCIDRs produces the
// smallest set of CIDRs for each contiguous run.
export function cidrSum(list) {
  if (!Array.isArray(list)) throw new IpMathError('cidrSum expects an array');
  if (list.length === 0) return [];
  const iv = list.map(cidrToInterval).sort((a, b) =>
    a.first < b.first ? -1 : a.first > b.first ? 1 : a.last < b.last ? -1 : a.last > b.last ? 1 : 0
  );
  const runs = [{ first: iv[0].first, last: iv[0].last }];
  for (let i = 1; i < iv.length; i++) {
    const cur = runs[runs.length - 1];
    const it = iv[i];
    if (it.first <= cur.last + 1n) {
      if (it.last > cur.last) cur.last = it.last;
    } else {
      runs.push({ first: it.first, last: it.last });
    }
  }
  const out = [];
  for (const r of runs) out.push(...rangeToCIDRs(r.first, r.last));
  return out;
}