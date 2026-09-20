# ipmath

IP/CIDR math CLI in pure JavaScript — no dependencies. IPv4/IPv6 byte arithmetic
on `Uint8Array`, BigInt for IPv6. Fully offline, deterministic.

```
ipmath info 192.168.1.0/24
IP address  192.168.1.0
prefix      /24
netmask     255.255.255.0
network     192.168.1.0
broadcast   192.168.1.255
first host  192.168.1.1
last host   192.168.1.254
host count  254
binary      11000000.10101000.00000001.00000000
```

## Install

No runtime dependencies exist. For a global install:

```
npm install -g .
```

Or run directly:

```
node bin/ipmath.js --help
```

Requires Node.js >= 18.

## Usage

```
ipmath info CIDR                Show network info for a CIDR
ipmath contains CIDR IP...      Test membership; prints yes/no per IP
ipmath split CIDR N             Split an IPv4 subnet into N equal subnets (N power of two)
ipmath range FIRST LAST         Cover an inclusive IPv4 range with minimal CIDRs
ipmath sum CIDR...              Merge overlapping/adjacent IPv4 CIDRs
```

Global options: `--json` (machine-readable output), `--expand` (uncompressed
long-form IPv6), `--version`, `--help`.

Errors (bad CIDR, non power-of-two split count, inverted range) print to stderr
and exit 1; usage errors exit 2.

## Examples (real output)

### info — /31 (RFC 3021 point-to-point)

```
$ ipmath info 192.168.1.4/31
IP address  192.168.1.4
prefix      /31
netmask     255.255.255.254
network     192.168.1.4
broadcast   192.168.1.5
first host  192.168.1.4
last host   192.168.1.5
host count  2
binary      11000000.10101000.00000001.00000100
```

### info — IPv6 with --json and --expand

```
$ ipmath info --json 2001:db8::/32
{
  "address": "2001:db8::/32",
  "family": "v6",
  "prefix": 32,
  "netmask": "ffff:ffff:0000:0000:0000:0000:0000:0000",
  "network": "2001:db8::",
  "firstHost": "2001:db8::",
  "lastHost": "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
  "hostCount": "79228162514264337593543950336",
  "hex": "2001:0db8:0000:0000:0000:0000:0000:0000"
}
```

```
$ ipmath info --expand 2001:db8::1/48
IP address  2001:0db8:0000:0000:0000:0000:0000:0001
prefix      /48
netmask     ffff:ffff:ffff:0000:0000:0000:0000:0000
network     2001:0db8:0000:0000:0000:0000:0000:0000
first host  2001:0db8:0000:0000:0000:0000:0000:0000
last host   2001:0db8:0000:ffff:ffff:ffff:ffff:ffff
host count  1208925819614629174706176
hex         2001:0db8:0000:0000:0000:0000:0000:0001
```

### contains

```
$ ipmath contains 10.0.0.0/8 10.1.2.3 8.8.8.8 10.0.0.0
10.1.2.3  yes
8.8.8.8   no
10.0.0.0  yes
```

An IP equal to the network or broadcast addresses counts as contained.

### split

```
$ ipmath split 10.0.0.0/16 4
10.0.0.0/18
10.0.64.0/18
10.0.128.0/18
10.0.192.0/18
```

```
$ ipmath split 10.0.0.0/8 256
10.0.0.0/16
10.1.0.0/16
...
10.255.0.0/16
```

`N` must be a power of two no larger than the subnet size; the sub-prefix
becomes `prefix + log2(N)`.

### range

```
$ ipmath range 192.168.1.3 192.168.1.44
192.168.1.3/32
192.168.1.4/30
192.168.1.8/29
192.168.1.16/28
192.168.1.32/29
192.168.1.40/30
192.168.1.44/32
```

### sum

```
$ ipmath sum 192.168.0.0/24 192.168.1.0/24
192.168.0.0/23
```

## Design notes

- **RFC 5952** — IPv6 text form is lowercase hex with the longest run of two or
  more zero groups collapsed to `::`; ties favor the first run (e.g.
  `2001:0:0:1:0:0:7:8` → `2001::1:0:0:7:8`). A single zero group is never
  compressed. `--expand`/`addrToHex` prints the uncompressed full form.
- **RFC 3021** — for IPv4 prefixes `/31`, both addresses are usable hosts:
  `hostCount = 2^(32-prefix)` with no network/broadcast subtraction (and `/32`
  has exactly 1). Prefixes `/30` and below subtract 2 (network + broadcast).
- **IPv6 has no broadcast address**, so first host is the network address
  itself, last host is the all-ones address, and `hostCount = 2^(128-prefix)`
  for every prefix (a `/128` holds exactly one address).
- IPv4 range conversion and `sum` operate on 32-bit addresses; every merged
  interval is re-emitted as the minimal CIDR covering set (adjacent or
  overlapping inputs collapse, e.g. two `/24`s become one `/23`).

## Development

```
npm test
```

Runs the Node built-in test runner (`node --test test/*.test.js`) with zero
dependencies. CI runs the same suite on Node 20 and 22.

## License

MIT © 2026 Conedope