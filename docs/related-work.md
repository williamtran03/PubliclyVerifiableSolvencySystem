# Related work

What this builds on, and where it departs. Each row names the scheme and the one thing
this repository took from it or did differently.

| Work | What it established | Here |
|---|---|---|
| Maxwell's merkle-sum tree (2014), described in Provisions §2 and in Wilcox, *Proving Your Bitcoin Reserves* | Liabilities as a merkle tree carrying subtree sums; each customer checks one path | Arm 1's tree, with the known leak made explicit: a path reveals sibling subtree sums |
| [Provisions](https://crypto.stanford.edu/~dabo/pubs/papers/provisions.pdf) — Dagher, Bünz, Bonneau, Clark, Boneh, CCS 2015 | Assets, liabilities and solvency as three separate proofs; Pedersen commitments; proof of non-collusion across exchanges | The same three-way split (`limitations.md`); non-collusion is replaced by an on-chain directory that gives a wallet to one registry at a time |
| [DAPOL / DAPOL+](https://eprint.iacr.org/2020/468) — Chalkias et al., 2020 | Sparse merkle tree with committed leaves, range proofs and padding, so the customer count leaks nothing | Arm 2 shuffles leaves and salts the padding for the same reason; range proofs move on-chain in arm 3 |
| [Generalized Proof of Liabilities](https://eprint.iacr.org/2021/1350) — Ji and Chalkias, CCS 2021 | Proof of liabilities as a general summation problem, with privacy and verification cost as separate axes | The framing used in `comparison.md` when the three arms are compared on what each publishes |
| [Broken Proofs of Solvency](https://eprint.iacr.org/2022/043) — Chalkias, Chatzigiannis, Ji, FC 2022 | Deployed proofs fail on weak hashing, missing data binding and missing user-ID uniqueness | Every epoch binds `keccak(chainId, registry, epochId)` into the commitment, and the customer supplies the identity at verification rather than reading it from the bundle. User-ID uniqueness is only partly addressed: a leaf issued to one customer cannot serve another, but the company issues both the identifier and the salt, so nothing stops it handing one credential to two customers (`manipulations.md` §4) |
| [Summa](https://summa.gitbook.io/summa) — Privacy & Scaling Explorations | Polynomial commitments to user balances, built inside a Halo2 circuit so the degree bound comes for free | Arm 3 takes the polynomial route without a circuit, and therefore has to buy the degree bound with an extra pairing |
| [Xiezhi](https://eprint.iacr.org/2024/2001) — Deng and Clark, 2024 | Solvency split into sub-proofs, each judged on whether verifier time and proof size stay constant | The same question asked per arm in `comparison.md`: what is constant in N, and what is not |

## Where this goes further

**Solvency is decided in the transaction.** In most of the literature the reader
compares a published asset figure with a published liability figure. Here the contract
holds both sides: reserves come from wallets that proved control in the current window
and were sampled by the auditor, liabilities from the commitment being submitted, and an
epoch that fails the comparison cannot be recorded at all.

**Per asset, not in aggregate.** Solvency is checked per asset in base units, with no
prices, so a surplus in one asset never covers a shortfall in another. Prices appear only
in an informational USD figure.

**The asset side is treated as seriously as the liability side.** Control is re-proven
every window against a challenge that window opened with, balances count at the lower of
the auditor's sample and the live balance, and one shared directory stops two registries
counting one wallet. `manipulations.md` lists what each of those stops and what it does
not.

## What none of them solve

Completeness. Inclusion proves a customer is in the commitment; nothing proves everyone
is. Every scheme above leaves this to an auditor's attestation and to customers checking
their own inclusion, and so does this one.
