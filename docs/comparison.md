# Two ways to prove the tree is honest

`main` publishes a Merkle-sum root and a total. Every customer can check their
own leaf, and the contract refuses to record a total its reserves cannot cover.
What neither the customer nor the contract can see is whether the *rest* of the
customer list is honest — a leaf holding a negative balance (in a prime field,
an enormous positive number) cancels a real customer and shrinks the published
total, while every individual inclusion check still passes.

Both branches close that hole. They disagree about how.

| | `feat/zk-solvency` | `feat/snarkless-solvency` |
|---|---|---|
| approach | one SNARK over the whole tree | polynomial commitments, checked directly |
| stack | Noir + Barretenberg (UltraHonk) | `@noble/curves` + BN254 precompiles |
| proving system | yes | none |
| circuit language | Noir | none |
| liabilities structure | Merkle-sum tree | polynomial over roots of unity |
| non-negativity | `u128` inputs, range-constrained by the compiler | committed bit decomposition + quotient argument |
| distinctness | strictly increasing leaf ids, in-circuit | strictly increasing leaf ids, by construction |
| `submitEpoch` | **3,858,239 gas** | **391,992 gas** |
| customer inclusion check | off-chain hash path (free) | on-chain view call, 153,631 gas (free to call) |
| verifier deployment | 3,973,521 gas, 18,463 bytes | 2,302,683 gas, 11,833 bytes |
| epoch proof size | 8,384 bytes | 64 bytes |
| extra artifacts | none | ~17 KB range argument, off-chain |
| trusted setup | universal SRS, shipped with the backend | universal SRS, must come from a ceremony |
| changing the customer count | recompile the circuit, redeploy the verifier, republish the key | change one deploy parameter |
| toolchain to build a proof | `nargo` + `bb` (~1 GB of installs) | Node, and nothing else |
| what verifies on-chain | everything | the total; the range argument is pinned by hash and verified off-chain |

## Reading that table

**The SNARK branch verifies more, on-chain.** One proof covers range,
distinctness, the sums, and the root, and the contract checks all of it. There
is nothing a reader has to go and verify somewhere else.

**The snarkless branch is an order of magnitude cheaper and much simpler to
operate.** Ten times less gas, a proof that fits in one word pair, no circuit
toolchain, and a customer count that is a constructor argument rather than a
recompile. The cost is that the range argument does not fit on-chain at a
sensible price, so the contract commits to its hash and anyone who cares runs
`cli/verify-range.ts` themselves. That is a weaker deployment story, and it is
the honest way to describe it: the guarantee is the same, but part of it is
checked by whoever bothers rather than by the chain.

**The fixed-size circuit is the sharper practical constraint.** A verification
key commits to the leaf count. Growing past it means recompiling, redeploying,
and telling everyone the new verifier address; the production answer is to
compile for the largest tree you will ever have and pad, paying that cost every
epoch. The KZG side has no equivalent problem — the SRS is universal and the
domain size is a parameter.

**Neither touches the assets side.** Both inherit the same attested-reserve
mechanism, and both refuse to publish an insolvent epoch. Both are equally
silent about borrowed reserves, omitted liability classes, and everything else
in [manipulations.md](manipulations.md).

## Which one would ship

For a daily snapshot with a stable customer base and a real need for a
self-contained on-chain guarantee, the SNARK. For anything that publishes often,
grows unpredictably, or has to be operated by people who did not write it, the
snarkless version — 392k gas and no circuit toolchain is a very different
maintenance story from 3.9M gas and a pinned `nargo`/`bb` pair.

The interesting result is that they are *comparable at all*. The received
framing is that proving something about hidden balances requires a proof system.
It does not; it requires a statement simple enough to check, and "these
evaluations sum to this total" is simple enough. What genuinely needs the heavy
machinery is the range check — which is exactly the part this branch could not
fit on-chain either.
