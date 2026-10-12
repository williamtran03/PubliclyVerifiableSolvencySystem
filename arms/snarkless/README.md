# Snarkless (KZG)

The arm with no circuit. Balances are interpolated into a blinded polynomial and committed
with KZG; the total is a running sum over the committed balances, non-negativity is a range
argument over the bits of each balance, and a customer's inclusion is an opening at their
point. Everything is
verified on-chain with the pairing precompile, so there is no proving toolchain and no
verification key to regenerate.

## Layout

| Path | What it is |
| --- | --- |
| `contracts/KzgSolvencyRegistry.sol` | Reserve check, liability proof, inclusion, epoch record |
| `contracts/KzgLiabilityArgument.sol` | The running sum and range argument, checked at one point with one batched pairing |
| `contracts/KzgVerifier.sol` | Pairing and curve arithmetic over BN254 |
| `prover/grandSum.ts` | Interpolates and blinds balances, commits balances and identities, opens at a customer's point |
| `prover/liabilities.ts` | The liability proof: bit and running-sum commitments, quotient, two openings |
| `prover/commit.ts`, `poly.ts`, `field.ts`, `transcript.ts` | Commitments, polynomial and field arithmetic, Fiat-Shamir |
| `prover/srs.ts`, `prover/ceremony.ts` | Load, validate and extract the SRS from a Powers of Tau transcript |
| `script/setup.ts` | `make kzg-setup`: downloads the pinned ceremony file and writes `fixtures/srs.json` |
| `prover/buildEpoch.ts` | `make kzg-epoch`: the per-epoch prover |
| `fixtures/attack.json` | A balance commitment padded with `5000·Z_H`, which proves only the true total |

Roles, reserve control, sampling and the publication window come from
`shared/contracts/ReserveRegistry.sol`.

## The scheme

    identity = Poseidon2(username, Poseidon2(customerSecret))
    balances interpolated over the 8th roots of unity as B(X), plus Z_H(X)·(random)
    running  A(ω⁰) = 0,  A(ωⁱ⁺¹) = A(ωⁱ) + B(ωⁱ),  A(ω⁷) + B(ω⁷) = total
    range    bit_k(ωⁱ) ∈ {0, 1} and Σ 2^k·bit_k(ωⁱ) = B(ωⁱ), for 64 bits
    proof    one quotient for all constraints; openings at ζ and ωζ, one pairing
    context  = keccak256(abi.encode(chainId, registry, epochId)) mod r

The company receives only the commitment to a customer-chosen high-entropy secret; the
customer keeps the secret and supplies it during local verification. Both Fiat-Shamir transcripts absorb the context, so a proof is bound to one registry,
chain and epoch id.

**Why a running sum and not an opening at 0.** For a polynomial of degree below 8,
`Σ B(ωⁱ) = 8·B(0)`, so the total could be one opening at 0. But committing to
`B + c·Z_H` keeps every slot and moves `B(0)`, and the degree bound meant to stop that
assumes nobody knows a power of `τ` above 32. The ceremony file publishes up to `τ⁵¹⁰`,
so the bound could be forged and an understated total accepted. Every constraint here
holds on the eight domain points, where `Z_H` is zero, so the degree of the committed
polynomial does not matter.

**Why everything is blinded.** The proof opens `B` at a public `ζ`. Unblinded, that is
`Σ bᵢ·Lᵢ(ζ)` with known coefficients, and for small balances lattice reduction recovers
all of them. Adding a random multiple of `Z_H` changes no slot and no constraint but makes
every opened value uniformly random.

## Trusted setup

`make kzg-setup` downloads `ppot_0080_08.ptau` (80 contributions plus a RANDAO beacon),
checks the pinned SHA-256, checks with pairings that the G1 and G2 points are successive
powers of one `τ`, and writes `fixtures/srs.json`. `loadSrs` repeats the point and
powers checks on every load. The two G2 points the registry verifies against are
constants in `KzgLiabilityArgument.sol`, so a deployer cannot substitute its own `τ`, and
`getSrs()` returns them for comparison with the ceremony. Whoever knows `τ` can forge openings; the setup is sound if one contributor destroyed
their secret. `srs.json` still carries the `boundedDegree` and `boundG2` fields of the
earlier design; the loader ignores them.

## Build and run

    make kzg-setup                                    # once; leaves srs.json alone afterwards
    make kzg-epoch SNAPSHOT=<snapshot.json> OUT=<dir> # epoch, liability proof, inclusion and attack artifacts

Omitting both variables overwrites the committed fixtures that the Foundry tests read.

## Demo

    anvil --silent --port 8547 &
    forge build
    make kzg-demo

Deploys the registry, binds the transcript to the deployed address, proves, submits, and
checks every customer opening through `verifyInclusion`, which is a view and therefore
free over `eth_call`.

## Limits

Single-asset: a multi-asset version needs one liability proof per asset. The total is
public by construction. Domain size is 8, and balances are capped at 2^64 − 1. The
registry's runtime code is 303 bytes under the EIP-170 limit with the optimizer off.
The KZG registry deployed on Sepolia on 2026-09-25 predates this design and accepts a
forged degree bound; it has to be redeployed.
