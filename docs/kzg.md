# The snarkless proof

## The idea

Stop thinking of the customer list as a tree and think of it as a function.
Interpolate a polynomial `p` over the `n`-th roots of unity so that `p(ω^i)` is
customer *i*'s balance. Then one identity does all the work:

```
sum over the domain of p(ω^i)  =  n · p(0)
```

because every non-constant term of `p` sums to zero as it goes round the circle.
So the custodian's total liabilities are `n` times the polynomial's *constant
coefficient* — and proving a constant coefficient is a KZG opening at a single
point, zero. The verifier does one pairing check.

That is the whole grand-sum construction, taken from Summa V2. No circuit, no
constraint system, no proving system: the statement is simple enough to check
directly, so we check it directly.

| what | how | where |
|---|---|---|
| the published total is really the sum of the balances | KZG opening at 0 | on-chain, 392k gas |
| your balance is one of the ones counted | KZG opening at ω^i | on-chain view, 154k gas, free |
| nobody's balance is secretly negative | polynomial range argument | off-chain, pinned on-chain by hash |

## The range argument

A grand sum alone is not a proof of solvency, and this is the part that is easy
to wave past. Balances live in a prime field, where "minus ten" is an enormous
positive number. A custodian can park one in an unused slot, cancel a real
customer, and publish a smaller total — and *every pairing check still passes*,
because the arithmetic really is consistent. It is just consistent with a lie.

`prover/kzg/range.ts` closes that without a SNARK either:

1. commit to one polynomial `b_k` per bit position, where `b_k(ω^i)` is bit *k*
   of customer *i*'s balance;
2. each `b_k` is boolean, i.e. `b_k(X)² − b_k(X)` vanishes on the domain;
3. the bits rebuild the balances, i.e. `Σ 2^k b_k(X) − p(X)` vanishes on it too;
4. fold (2) and (3) with a Fiat-Shamir challenge `γ` and show the fold is
   divisible by `Z_H(X) = X^n − 1` — which happens exactly when every one of
   those identities holds at every leaf;
5. prove that divisibility by opening both sides at a challenge point `ζ`, with
   all 130 openings batched into one proof.

This is more than Summa V2 itself does without a proving system: Summa's own
range check is a halo2 circuit. Here there is no circuit compiler anywhere in
the repository.

The cost is proof size. 128 bit polynomials means 130 commitments and 130
evaluations — about 17 KB. That verifies in milliseconds off-chain, and folding
130 commitments on-chain would cost more than the SNARK this branch exists to
avoid, so the contract stores `keccak256` of the artifact instead and
`cli/verify-range.ts` checks both that the file is the pinned one and that it
verifies. The chain pins exactly one artifact; anyone at all can check it.

An accumulator formulation would replace the 128 bit polynomials with about four
(bits on an `n·128` domain, plus a running-sum polynomial that reassembles each
balance at block boundaries). That is the obvious next step and it is not
implemented — it is a real protocol design task, not a refactor.

## Trusted setup

KZG needs a structured reference string, `[τ^i]₁` and `[τ]₂`. Whoever knows `τ`
can open any commitment to any value, so an SRS the custodian generated is worth
nothing against the custodian.

`script/setup.ts` generates one locally and says so loudly, twice. It is a
development convenience. A deployment loads ceremony output — perpetual powers
of tau, or Aztec Ignition — and `loadSrs` reads the same JSON shape, so that is
a file swap rather than a code change.

Note what this is *not*: a per-circuit ceremony. The SRS is universal and depends
only on the maximum degree, so changing the customer count needs no new setup.
That is a real advantage over Groth16 and, in practice, over the fixed-size
circuit on `feat/zk-solvency`.

## Cost

Measured, `n = 8`:

| | |
|---|---|
| `submitEpoch` (2 pairings + storage) | 391,992 gas on a live chain |
| `verifyInclusion` (view, free to call) | 153,631 gas |
| registry deployment | 2,302,683 gas, 11,833 bytes |
| grand sum proof | 64 bytes |
| inclusion proof | 64 bytes |
| range argument | ~17 KB, verified off-chain |
| prover | milliseconds |

The on-chain numbers barely move with customer count: `submitEpoch` is two
pairings whatever `n` is. The prover is `O(n log n)`.

## Privacy

Different shape from the Merkle tree, not strictly better.

- **Better:** an inclusion proof is one curve point. There are no sibling sums,
  so a customer learns nothing about anyone else — the Merkle scheme's structural
  leak, where every customer sees one neighbour's exact balance, is simply gone.
- **Worse:** the commitment is unblinded. `p` is determined by the balances, so
  anyone who *guesses* a customer's index and balance can test the guess against
  the pairing equation and get a yes or no. Blinding `p` with a random multiple
  of `Z_H(X)` fixes this at the cost of one extra SRS degree; it is not
  implemented here, and `docs/privacy.md` counts it among the honest gaps.
- **Unchanged:** the total, the reserve margin, and the publication cadence are
  public every epoch, and the domain size leaks customer count to a power of two.

## Running it

```shell
make setup    # once: the development SRS
make commit   # commitments, grand sum opening, range argument, customer proofs
make test     # forge tests against the real fixtures, plus the prover's own
make demo     # the whole thing on a local chain
```
