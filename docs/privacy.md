# What the proof actually reveals

"Nothing leaks" is never the honest answer. This document says what each party
learns, from one snapshot and from a sequence of them.

## What the public learns from the chain

Per epoch: the root hash, the total liabilities in wei, the summed reserves, and
the timestamp. Nothing per-customer. But the *sequence* of epochs is public
forever, so an observer gets:

- the custodian's total liability curve over time, to the wei;
- the reserve margin, which is a solvency-stress signal — a margin trending to
  zero is visible to competitors and to anyone shorting;
- the exact publication cadence, so a *missed* epoch is conspicuous. That is the
  intended alarm, but it is also a run trigger.

The leaf count is not published on-chain, but it is in `fixtures/epoch.json` and
is anyway inferable from proof lengths (`depth = siblingHashes.length`), so
customer-count growth is effectively public at power-of-two granularity.

## What a customer learns from their own proof

This is the real leak, and it is structural to Merkle-sum trees.

An inclusion proof contains one sibling `{hash, sum}` per level. The sums are
not incidental — the verifier needs them to recompute the parent — and each one
is the *total balance of a subtree the customer is not in*. For a tree of depth
`d`, the customer learns `d` partial sums of other customers' money:

```
depth 3, customer at leaf 0:
  level 0 sibling -> the exact balance of exactly one other customer
  level 1 sibling -> the combined balance of two other customers
  level 2 sibling -> the combined balance of four other customers
```

The level-0 sibling is the sharp edge: **every customer learns one other
customer's exact balance.** They do not learn whose — the sibling's id is not in
the proof, only the hash — but they learn the amount, and in a small tree an
amount plus a bit of context is often identifying.

## What repeated snapshots reveal

Sorting leaves by `keccak256(username)` makes the tree order stable across
epochs. That is good for reproducibility and bad for privacy: a customer's
neighbours stay the same, so across `T` epochs each customer observes a
*time series* of their level-0 sibling's balance. Deposits, withdrawals, and
their sizes and timing are all visible for that one anonymous account. Over
enough epochs, behaviour is a fingerprint.

Joins and leaves are visible too. If the customer count crosses a power of two,
every proof gets one level longer, which every customer sees.

## Mitigations, and what they cost

| mitigation | effect | cost |
|---|---|---|
| Split each customer across `k` random leaves summing to their balance | a sibling sum is no longer any single person's balance | proof size and tree size grow `k`× |
| Randomise leaf order per epoch (salt the sort key with the epoch id) | breaks the cross-epoch neighbour link, so no time series | proofs are no longer comparable between epochs; loses the cheap distinctness argument unless the salt is committed to |
| Add a blinding leaf of random balance to each pair | sibling sums stop being exact | inflates published liabilities, so the custodian must over-reserve |
| Publish only bucketed totals | coarsens everything | weakens the guarantee the scheme exists to give |

None of these are implemented here. The first two are the ones worth doing and
both are compatible with the current design; they are called out as future work
rather than quietly omitted.

## What a zero-knowledge proof does and does not fix

A ZK proof of tree well-formedness (the `feat/zk-solvency` branch) removes the
need to *trust* that no balance is negative and no customer is duplicated,
without publishing any balance. It does **not** touch the leak above: the
inclusion proof handed to a customer still carries sibling sums, because that is
how the customer checks their own path. Making inclusion itself zero-knowledge
means the customer verifies a SNARK instead of a hash chain — a different, much
heavier design.

The `feat/snarkless-solvency` branch changes the shape of the leak rather than
removing it: a KZG opening reveals only the customer's own evaluation, so there
are no sibling sums at all — but the commitment is unblinded, so an observer who
guesses a balance can test that guess against the pairing equation.
