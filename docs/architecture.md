# Architecture

Three pieces of software, three audiences, one shared root.

```
prover/            (custodian, private)      cli/            (customer, public)
customers.csv                                proof-<user>.json
   |  buildTree.ts                              |  verify-inclusion.ts
   v                                            v
Merkle-sum root {hash, sum} --- one tx --->  SolvencyRegistry (public, on-chain)
                                                ^
                                    reserve wallets attest by signature
```

| | runs where | sees | costs |
|---|---|---|---|
| `prover/` | custodian's own machine | every customer balance | nothing |
| `contracts/` | Ethereum | one root, one total, a wallet list | ~90k gas per epoch |
| `cli/` | customer's laptop | that customer's own leaf, and the public root | nothing, no wallet |

## Why a contract rather than a JSON file on a website

A file served from the custodian's own domain can be swapped at 3am and nobody
can prove it ever said something else. The point of putting the root on-chain is
not decentralisation for its own sake — it is that *every past claim stays
visible*, so "we were solvent in March" is a checkable statement rather than a
press release.

## The Merkle-sum tree

Ordinary proof of reserves only proves the assets side; the liabilities number
is self-reported by the one party with every incentive to shrink it. The
Merkle-sum tree fixes the liabilities side:

- leaf: `hash = H(id, balance)`, `sum = balance`
- node: `hash = H(leftHash, leftSum, rightHash, rightSum)`, `sum = leftSum + rightSum`

Because each parent hash commits to both children's *hashes and sums*, changing
any balance anywhere below breaks the hash chain all the way to the root. The
root's `sum` is therefore the total liabilities computed by construction, not
typed in by hand — and shrinking it requires tampering with some specific
customer's path, which that customer can detect on their own.

## Leaf identity and ordering

`id = keccak256(username) mod r`, and leaves are sorted strictly ascending by
`id` before the tree is built. Both details are load-bearing:

- **Hashing** rather than reinterpreting the username's bytes as an integer:
  a raw reinterpretation wraps silently past 32 bytes, so two customers could be
  handed the same leaf identity. (The same class of bug the Electisec audit found
  in Summa's username encoding.)
- **Strict ordering** gives pairwise distinctness for free, which is what a
  verifier can actually check cheaply: adjacent-and-increasing implies globally
  distinct. Padding leaves continue the sequence (`lastId + 1 + k`) so the
  property holds across them too, with no special case.

## Hash choice

`HashFn = (values: bigint[]) => bigint` is a parameter everywhere, never an
import. Two implementations ship:

| | in a circuit | on-chain | dependency |
|---|---|---|---|
| `poseidonHash` (default) | ~250 constraints | ~40k gas (needs a library) | `poseidon-lite`, 0 vulns |
| `keccakHash` | ~150,000 constraints | 30 gas (native) | none |

Poseidon is the default because the expensive verification happens inside a
proof system, not inside the EVM. The parameters are circomlib's, which is
exactly what `poseidon::poseidon::bn254::{hash_2, hash_4}` implements in Noir —
so the TypeScript prover and a circuit agree on a root without either side
re-implementing the other. That equality is asserted, not assumed.

## The assets side

`SolvencyRegistry` sums the live ETH balance of an attested wallet set. A wallet
joins only by signing an EIP-191 message bound to the contract address and chain
id, so a custodian cannot list a wallet it does not control. `submitEpoch`
*reverts* when reserves do not cover the published liabilities, which makes
insolvency unpublishable rather than merely detectable: the only failure mode
left is silence, and silence is loud.

What that still does not prove is in [manipulations.md](manipulations.md).
