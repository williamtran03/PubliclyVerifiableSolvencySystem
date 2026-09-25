# Snarkless (KZG)

The arm with no circuit. Balances are interpolated into a polynomial and committed with
KZG; the total is an opening at 0, non-negativity is a range argument over the bits of
each balance, and a customer's inclusion is an opening at their point. Everything is
verified on-chain with the pairing precompile, so there is no proving toolchain and no
verification key to regenerate.

## Layout

| Path | What it is |
| --- | --- |
| `contracts/KzgSolvencyRegistry.sol` | Degree bound, opening at 0, range argument, inclusion, epoch record |
| `contracts/KzgVerifier.sol` | Pairing and curve arithmetic over BN254 |
| `prover/grandSum.ts` | Interpolates balances and identities, commits, opens at 0 and at a customer's point |
| `prover/range.ts` | The 64-bit range argument: bit commitments, quotient, batched opening |
| `prover/commit.ts`, `poly.ts`, `field.ts`, `transcript.ts` | Commitments, polynomial and field arithmetic, Fiat-Shamir |
| `prover/srs.ts`, `prover/ceremony.ts` | Load, validate and extract the SRS from a Powers of Tau transcript |
| `script/setup.ts` | `make kzg-setup`: downloads the pinned ceremony file and writes `fixtures/srs.json` |
| `prover/buildEpoch.ts` | `make kzg-epoch`: the per-epoch prover |
| `fixtures/attack.json` | The vanishing-polynomial attack, kept so the test suite can refuse it |

Roles, reserve control, sampling and the publication window come from
`shared/contracts/ReserveRegistry.sol`.

## The scheme

    identity = Poseidon2(username, salt)
    balances interpolated over the 8th roots of unity as p(X)
    total    = N * p(0), opened at 0 with one pairing
    range    = 64 bit commitments plus a quotient, batched into one opening
    context  = keccak256(abi.encode(chainId, registry, epochId)) mod r

Both Fiat-Shamir transcripts absorb the context, so a proof is bound to one registry,
chain and epoch id.

**The degree bound is what makes the total honest.** Committing to `p(X) + c·Z_H(X)`
leaves every slot unchanged but moves `p(0)`, which would let the published total drop
while inclusion and range proofs still verify. The registry checks a shifted commitment
against `[τ^(D−7)]₂` with one extra pairing, which the shifted polynomial can only
satisfy if `p` really has degree below the domain size.

## Trusted setup

`make kzg-setup` downloads `ppot_0080_08.ptau` (80 contributions plus a RANDAO beacon),
checks the pinned SHA-256, checks with pairings that the G1 and G2 points are successive
powers of one `τ`, and writes `fixtures/srs.json`. `loadSrs` repeats the point and
powers checks on every load, and the registry publishes the three G2 points it verifies
against through `getSrs()`, so anyone can compare a deployment with the ceremony instead
of trusting whoever deployed it. Whoever knows `τ` can forge openings and escape the
degree bound; the setup is sound if one contributor destroyed their secret.

## Build and run

    make kzg-setup                                    # once; leaves srs.json alone afterwards
    make kzg-epoch SNAPSHOT=<snapshot.json> OUT=<dir> # epoch, range, inclusion and attack artifacts

Omitting both variables overwrites the committed fixtures that the Foundry tests read.

## Demo

    anvil --silent --port 8547 &
    forge build
    make kzg-demo

Deploys the registry, binds the transcript to the deployed address, proves, submits, and
checks every customer opening through `verifyInclusion`, which is a view and therefore
free over `eth_call`.

## Limits

Single-asset: a multi-asset version needs one range argument per asset. The total is
public by construction. The range argument opens the balance polynomial at a public
challenge, which leaks one linear combination of all balances; blinding it would shift
`p(0)` and collide with the degree bound, so it stays a stated limitation. Domain size
is 8, and balances are capped at 2^64 − 1.
