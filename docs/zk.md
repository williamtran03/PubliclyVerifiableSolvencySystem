# The validity proof

## The gap this closes

An inclusion proof convinces one customer about one leaf. It says nothing about
the other leaves, and two things hiding there break the whole scheme:

- **A negative balance.** Balances live in a prime field, where "−10 ETH" is
  just an enormous positive number that happens to wrap. A leaf carrying one
  cancels a real customer's balance, so the published total comes out smaller
  than what is owed — and every individual inclusion check still passes.
- **A duplicated customer.** Two leaves with the same id means only one of them
  is really the customer's, while both verify.

Neither is visible from any hash path. On `main` the only defence is that the
prover checks its own inputs, which is no defence at all, because the prover is
the party with the motive.

## What the circuit proves

`circuits/solvency/src/main.nr`, over the whole tree at once:

| | |
|---|---|
| public | `root_hash`, `total_liabilities` |
| private | every leaf id, every leaf balance |

1. every balance is a valid `u128` — Noir range-constrains integer inputs, and
   an enormous field element is not a `u128`, so this *is* the non-negativity
   check;
2. leaf ids are strictly increasing, so no id repeats (checking adjacent pairs
   costs `n−1` comparisons; checking distinctness directly would cost `n²/2`);
3. the sums fold up with checked `u128` addition, so a total that would wrap is
   an unsatisfiable constraint rather than a silently wrong root;
4. the root and the total that come out are exactly the two public inputs.

Because the total is a *public input*, the same proof cannot be reused to
publish a smaller number — `test_RejectsAnUnderstatedTotal` and step 6 of the
demo are that claim, executed.

## Toolchain, and why this one

| | |
|---|---|
| language | Noir 1.0.0-beta.26 |
| backend | Barretenberg 6.0.0-nightly.20260902, UltraHonk (`--verifier_target evm`) |
| hash | Poseidon, circomlib parameters (`poseidon` v0.3.0 / `poseidon-lite`) |

Noir over Circom, for three reasons that matter on a deadline:

- **No per-circuit ceremony.** Circom + Groth16 needs a `ptau` download and a
  per-circuit setup whose output must be trusted; Honk uses a universal
  structured reference string, so changing the circuit is a recompile rather
  than a ritual.
- **The verifier is generated, not written.** `bb write_solidity_verifier`
  emits `contracts/HonkVerifier.sol`. It is committed as a build artifact and
  never hand-edited.
- **The dependency situation is honest.** `circomlibjs` pulls ~400 packages and
  53 advisories. `poseidon-lite` is one package with none, and its permutation
  is byte-identical to Noir's `poseidon::poseidon::bn254`.

That last equality is the load-bearing one, and it is *asserted*, not assumed:
`script/prove.ts` compares the circuit's public inputs against the root the
TypeScript prover computed and refuses to write a fixture if they differ.

## Cost

Measured, on the 8-leaf circuit:

| | |
|---|---|
| circuit size | 32,768 gates (`N` in the verifier) |
| proving time | ~1 s on a laptop |
| proof | 8,384 bytes |
| `verify()` | 2,384,969 gas |
| full `submitEpoch` on a live chain | ~3.86 M gas, calldata included |
| verifier deployment | 3,973,521 gas, 18,463 bytes (EIP-170 limit is 24,576) |

That is expensive — roughly a third of a block for one epoch. It buys a
guarantee nothing else here can give, and it is paid once per epoch rather than
once per customer, which is the right side of the trade for a daily snapshot and
the wrong side for an hourly one. The `feat/snarkless-solvency` branch reaches a
weaker but much cheaper version of the same guarantee; see
[comparison.md](comparison.md).

ZK Honk (rather than plain Honk) is deliberate: the proof itself must not leak
the witness, and the witness here is every customer's balance.

## Fixed size is a design constraint

A verification key commits to the circuit, and the circuit commits to the leaf
count. Eight leaves are baked into `LEAVES` in both `main.nr` and
`prover/circuit.ts`, and the two are checked against each other at prove time.

Growing the customer list therefore means recompiling, redeploying the verifier,
and telling everyone the new address — which is real operational weight, not a
detail. The production answer is to compile for a large fixed capacity and pad,
paying constant cost for the largest tree you will ever have. That is a
deliberate trade, and it is the sharpest practical difference from the KZG
approach on the other branch, where capacity is a parameter of the SRS rather
than of the circuit.

## Running it

```shell
noirup -v 1.0.0-beta.26
bbup -v 6.0.0-nightly.20260902

make prove         # tree -> witness -> proof -> fixtures/zk-proof.json + HonkVerifier.sol
make test-circuit  # the circuit's own tests, including the two failure cases
make demo          # the whole thing on a local chain
```

`fixtures/zk-proof.json` and `contracts/HonkVerifier.sol` are committed, so
`forge test` and CI verify a real proof without needing the circuit toolchain
installed. A separate CI job reinstalls it, re-proves, and runs the Foundry
tests against the fresh proof — which is what catches the circuit and the
TypeScript prover drifting apart.

Note that the proof is *not* reproducible byte for byte. ZK Honk masks the
witness with fresh randomness on every run, so two proofs of the same statement
differ; only the verification key and the public inputs are deterministic, and
those are what CI diffs.
