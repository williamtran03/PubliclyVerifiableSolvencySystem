# Accounting manipulations against this system

How a custodian could try to look solvent without being solvent, and what each of the three
arms does about it. Every "stopped by" names the check and the test that exercises it.
"Remains" is what a determined company can still do; those points also appear in
[`limitations.md`](limitations.md).

| # | Manipulation | Status |
|---|---|---|
| 1 | Omit customers or whole liability classes | Detectable only by customers who check |
| 2 | Understate one customer's balance | Detected by that customer |
| 3 | Negative or wrapped balances | Stopped |
| 4 | Serve one leaf to two customers, or count a leaf twice | Stopped (arms 2, 3); arm 1 partly |
| 5 | Understate the total behind a valid-looking commitment (KZG degree attack) | Stopped |
| 6 | Replay a proof from another epoch or registry | Stopped |
| 7 | Re-publish on demand for whoever asks to check | Rate-limited; a delivery rule closes the rest |
| 8 | Flash-loan window dressing inside the submission | Stopped |
| 9 | Borrow across the snapshot for longer (classic window dressing) | Narrowed, not stopped |
| 10 | Claim one wallet for two custodians | Stopped within the shared directory |
| 11 | Keep counting a wallet after losing or selling its key | Stopped per epoch |
| 12 | Count encumbered assets (lent out, pledged) | Not detectable |
| 13 | Stop publishing when insolvent | Visible, and recorded permanently, but not preventable |
| 14 | Pick a favourable oracle round | Harmless to the solvency check itself |
| 15 | Company and auditor collude | Breaks the asset side |

## 1. Omitting liabilities

**Attack.** Leave accounts out of the tree (dormant customers, a whole product line, a
margin book). Liabilities shrink; every proof still verifies.

**Stopped by.** Nothing cryptographic, in any arm or in any deployed system. The only
check is customers verifying their own inclusion. If the company omits `m` accounts and
each customer checks independently with probability `p`, detection has probability
`1 − (1 − p)^m`: with 5% of customers checking, omitting 50 accounts is caught with
probability 92%; with 1% checking, omitting 100 is caught with probability 63%. The
company picks whom to omit, so dormant accounts are the realistic target and the
effective `p` for them is lower.

**Remains.** Completeness of the liability set is an auditor's attestation, not a proof.
Arm 1 publishes every part, so the number of parts is public and can be compared with the
customer count an auditor attests; arms 2 and 3 do not publish it.

## 2. Understating one balance

**Attack.** Record a customer at less than they are owed.

**Stopped by.** The customer's own check. They enter the balance from their own records;
a changed amount fails in all three arms (`scripts/demo/demo.test.ts` changes one proof
unit and expects failure). An entered zero for an asset the customer does not hold now
counts as "no holding", so honest customers are not pushed into false alarms.

**Remains.** A customer who does not check, or trusts the figure the company shows them.

## 3. Negative and wrapped balances

**Attack.** Insert a negative "phantom" leaf, or push a sum past the field or word size so
it wraps, to cancel out real liabilities.

**Stopped by.** Arm 2 types every amount as `u64` and Noir rejects overflowing additions,
so neither a negative value nor a wrapped per-asset total can satisfy the circuit.
Arm 3's on-chain range argument proves every slot is a 64-bit value
(`test_RejectsATamperedRangeValue`, `test_RejectsARangeProofWithTooFewBits`). Arm 1's
contract sums with checked `uint256` arithmetic (`test_RejectsOverflowAndInvalidLength`),
and the prover rejects negative input (`splitLiabilities.test.ts`).

## 4. Sharing or double-counting leaves

**Attack.** Give two customers with the same balance the same leaf, so one liability
covers both; or show a customer one leaf twice under two different paths.

**Stopped by.** In arms 2 and 3 the leaf commits to the username and salt the customer
enters at verification, so a leaf built for one customer fails for another (`two customers
cannot be served one leaf` in `multiAssetTree.test.ts`). Paths must have the circuit's
depth and use only 0/1 directions, so a leaf cannot be counted twice (`one leaf cannot be
counted twice by giving it a second path encoding`).

**Remains.** The company issues both the username and the salt, in every arm
(`shared/customers.csv`). Nothing stops it handing one credential to two customers who
are owed the same amount: both check against one leaf and pass, and that liability is
counted once. No circuit constraint helps, because the attack uses a single leaf. Letting
the customer choose the secret at signup would close it; publishing the leaf count so an
auditor can compare it with an attested customer count would at least expose it. Neither
is built. Arm 1 additionally relies on the identity commitment (name, date of birth, salt)
rather than a secret the customer holds.

## 5. Understating the KZG total

**Attack.** Commit to `p(X) + c·Z_H(X)` instead of `p(X)`. Every slot still evaluates the
same, so inclusion and range proofs verify, but `p(0)` moves and the published total drops
(49,550 → 9,550 in the fixture).

**Stopped by.** A degree bound: the registry checks a shifted commitment against
`[τ^(D−7)]₂` with one pairing (`test_RefusesTheVanishingPolynomialAttack`). The bound is
only as good as the setup, which is why the SRS now comes from a public ceremony (see
`limitations.md`, *Trusted setup*).

## 6. Replaying proofs

**Attack.** Reuse last epoch's proof, or a proof built for another deployment.

**Stopped by.** Arm 2 hashes `keccak(chainid, registry, epoch)` into the committed root;
arm 3 absorbs the same context into both Fiat–Shamir transcripts; arm 1 refuses a reused
snapshot ID. Tests: `test_ProofCannotBeReplayedForTheNextEpoch`,
`test_ProofIsBoundToTheRegistryItWasBuiltFor`, `test_AProofDoesNotCarryToTheNextEpoch`,
`test_RejectsReplayAndNonCompany`.

## 7. Re-publishing on demand

**Attack.** Customers obtain their proof file from the company, so the company learns who
is about to check. An insolvent company waits for a request, publishes a fresh epoch
that includes the requester and leaves out someone who has not asked, then hands over the
file. The customer verifies against the latest epoch and passes.

**Stopped by.**
- An on-chain minimum interval between epochs (`minEpochInterval`, enforced in
  `_recordEpoch`; `test_EpochsRespectTheMinimumInterval`,
  `test_ANextLedgerWaitsForTheMinimumInterval`). Together with `maxEpochAge` this gives
  every registry a publication window: not before `lastEpochAt + minEpochInterval`, not
  after `lastEpochAt + maxEpochAge`. The website refuses to prepare an early submission,
  and the demo test checks that refusal.
- After a successful check the site shows when the epoch was published, and tells the
  customer that the snapshot could only have been adjusted to their request if they asked
  for the file before that time.
- Operationally, proof files are pushed to every customer when an epoch is published
  instead of being fetched on request. The company then learns nothing about who checks,
  and a customer's file always belongs to an epoch that predates their decision to check.

**Remains.** With a one-day interval, a company can still delay the answer to a request
until the next epoch. A customer who receives a file for an epoch published after they
asked should treat it as suspect. The push rule is a policy; the contract cannot enforce
how files are delivered.

## 8. Flash-loan window dressing

**Attack.** Balances used to be read inside `submitEpoch`. The company role can be a
contract and reserves can be contract wallets (ERC-1271), so one transaction could borrow
from a flash-loan pool, move the funds into a reserve, submit, and repay, all for the
loan fee.

**Stopped by.** Solvency is checked against the **attested balance**: the lower of the
live balance and the lowest balance the auditor sampled in this window
(`sampleReserves`). A submission needs a sample from an earlier block than its own, so the
sample is a separate transaction the company cannot wrap in its loan, even if the auditor
role is a contract anyone can trigger. Tests: `test_FundsBorrowedAfterTheSampleDoNotCount`,
`test_SubmissionNeedsASampleFromAnEarlierBlock`, `test_SamplingKeepsTheLowestBalanceOfTheWindow`,
and `test_FundsBorrowedForTheSubmissionDoNotCount` in each arm.

## 9. Borrowing across the snapshot

**Attack.** Take an ordinary (collateralised or friendly) loan before the auditor samples
and repay after the epoch.

**Stopped by.** Nothing. Two things shrink the gap: the auditor can sample several times
at unannounced moments (the minimum is kept), and funds withdrawn after a sample count at
the lower live figure. A loan has to cover every sample and the submission.

**Remains.** A company that can borrow for the whole window passes. This is the classic
proof-of-reserves weakness, and time-averaged balances or storage proofs over random
historical blocks would be the next step.

## 10. One wallet, two custodians

**Attack.** Two custodians (or two registries of one custodian) point at the same wallet
and both count it.

**Stopped by.** Control is proven through one shared `ReserveDirectory`. A wallet backs
one registry at a time: a second registry's proof reverts with `ClaimedByAnotherRegistry`
until the first removes it (`test_AWalletBacksOnlyOneRegistry`). An invariant checks that
every proven or approved wallet is claimed by exactly the registry that lists it.

**Remains.** This only holds among registries that use the same directory. An observer
has to check that a registry's `directory()` is the canonical one. Wallets on other
chains, and assets held by a third-party custodian for several clients, are outside it.
Sequential reuse (release, then claim elsewhere next week) is allowed by design.

## 11. A wallet whose key is gone

**Attack.** Prove control once, then lose or sell the key and keep counting the balance.

**Stopped by.** Control proofs are valid for one window. Every recorded epoch starts a new
window, and a wallet counts only after it has proven control again in that window
(`test_ReservesStopCountingAtTheNextWindowUntilProvenAgain`). The signed message includes
that window's challenge, which the registry fixes when the window opens, from the previous
block hash, `prevrandao`, the block number, its own address and the window number. Nobody
can sign for a window that has not opened yet
(`test_ControlSignatureIsBoundToTheWindowItWasSignedFor`), and the challenge is never empty
(`test_AChallengeIsNeverEmpty`).

**Remains.** A key sold in the middle of a window still counts until the next epoch, which
is what "valid for one window" means. The window is also the time a signer has to collect
signatures, so it has to be long enough for a distributed multisig: the earlier design
signed over a block hash and expired after 256 blocks, about 51 minutes on mainnet and
8.5 on a two-second L2, which a multisig cannot reliably meet.

## 12. Encumbered assets

**Attack.** Count assets that are lent out, pledged as collateral, or owed to someone
else.

**Stopped by.** Nothing on-chain can see an off-chain pledge. See `limitations.md`.

## 13. Going quiet

**Attack.** Stop publishing once insolvent and keep pointing at the last good epoch.

**Stopped by.** `isCurrent()` turns false after `maxEpochAge`, and the site labels the
snapshot expired. When the company later resumes, the missed deadline stays on record:
`lapses()` counts every epoch published after its deadline and `EpochLapsed` is emitted
(`test_ALateEpochIsRecordedAsALapse`). The site shows the count next to the freshness.

**Remains.** No contract can force a transaction. Real enforcement needs a regulator or an
economic bond that is forfeited on a lapse; neither is built.

## 14. Oracle rounds

**Attack.** In arm 2, choose which pinned Chainlink round to submit within the staleness
bound.

**Stopped by.** Solvency is decided per asset in base units, without prices
(`test_RejectsAShortfallInOneAssetEvenWhenUsdCoversIt`). The round only moves the
published USD figure, which is informational.

## 15. Collusion with the auditor

**Attack.** A friendly auditor approves wallets the company does not control, times its
samples to the company's loans, or never samples at inconvenient moments.

**Stopped by.** Role separation: each role rotates only itself, so the company cannot
install a new auditor (`test_NeitherRoleCanRotateTheOther`). Beyond that, the asset side
trusts the auditor, as every proof-of-reserves design does.
