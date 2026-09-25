# Three approaches to publicly verifiable solvency — comparison and conclusion

This is the Phase 2 deliverable: not any single approach, but what we learned by
building three and measuring them against each other.

Unless explicitly labelled otherwise, gas figures below are `make compare` (`forge test --gas-report`) at domain size
N = 8, on the committed fixtures, with the optimizer off (the `foundry.toml`
default), under the Osaka (Fusaka) gas rules that Ethereum has run since December 2025
(`evm_version = "osaka"`). Until 2026-09-22 they were measured under `cancun`; the
switch changed only the ZK verifier's figures (see *Sepolia rehearsal versus fixture
probes*). They are call-level numbers including dispatch overhead, and N = 8 is a
toy size — see *Gaps* below. Revised 2026-09-13 after the per-asset redesign and
the fixes listed at the end; the previous figures are superseded.

## The three arms

| Arm | Prover | Contract | Core idea |
|---|---|---|---|
| 1. Published ledger | `arms/published-ledger/` | `MerkleSumRegistry.sol` | Publish every anonymised part on-chain, one merkle-sum tree per asset; the contract recomputes every total |
| 2. ZK circuit | `arms/zk-circuit/` | `MultiAssetSolvencyRegistry.sol` | A Noir/UltraHonk proof that each asset's liabilities are under a public reserve floor; liabilities stay private |
| 3. Snarkless | `arms/snarkless/` | `KzgSolvencyRegistry.sol` | KZG polynomial commitments: the total is an opening at 0, non-negativity a range argument, both verified on-chain, no circuit |

All three registries share `shared/contracts/ReserveRegistry.sol`: a company that
proposes reserve wallets and submits epochs, wallets that prove control with an
EIP-712 signature (ERC-1271 for multisigs), and an auditor who approves them. Both
roles rotate in two steps and each rotates only itself; the approved set is capped so
the reserve sum cannot outgrow a block; and every arm publishes how long ago it last
submitted, through `isCurrent()` and `epochAge()`.

Every recorded epoch opens a new *window*. In it, a wallet counts only after proving
control again, with a signature over that window's challenge, through the shared
`ReserveDirectory`, which lets one wallet back only one registry at a time. The
auditor samples balances with `sampleReserves()`; a submission needs a sample from an
earlier block and counts the lower of the sampled and the live balance, so a flash loan
inside the submission adds nothing. Epochs must be at least `minEpochInterval` apart, and
an epoch that arrives after `maxEpochAge` is recorded as a lapse. `docs/manipulations.md`
walks through what each of these stops.

## The control group

`arms/single-asset/` is superseded by arm 2, but it is not dead weight: it is the
measurement that separates the two constructions. Its circuit proves a materially
simpler statement — one asset, a merkle-sum tree, no context binding — and its
verifier costs **3,910,843** gas against arm 2's **3,916,301**. A 0.14% difference,
5,458 gas, for a much harder statement.

That reads as the empirical form of "a SNARK's verification cost is set by the proof
system, not by what is being proved" — but the scaling sweep (*How it scales*, below)
shows the control is weaker than that. Both generated verifiers carry `N = 8192,
LOG_N = 13`: the two circuits pad to the **same** power of two, and UltraHonk's cost is
set by that padded size. So arm 4 measures that two circuits of equal padded size cost
equally, which is true but close to tautological; the 5,458 gas between them is three
extra public inputs, not the harder statement.

The claim that survives measurement, and which covers both arm 4 and the sweep, is
narrower and more useful: **UltraHonk verification is logarithmic in circuit size, at
~106,700 gas per round.** Statement complexity only matters when it pushes the circuit
across a power of two. Arm 4 deliberately stays off the shared reserve registry, so its
figures do not move when the shared base changes and the comparison stays like-for-like.

## Measured cost

| Operation | Gas | Notes |
|---|---:|---|
| `MerkleSumRegistry.submitLedger` | 408,350 | max observed (4 parts, 2 assets); grows with parts |
| `KzgSolvencyRegistry.submitEpoch` | 1,556,777 | degree bound + opening at 0 + 64-bit range argument; constant in N |
| `KzgSolvencyRegistry.verifyInclusion` | 150,233 ‡ | a view: free through `eth_call` |
| `MultiAssetHonkVerifier.verify` | 3,916,301 | |
| `MultiAssetSolvencyRegistry.submitEpoch` | 4,366,256 | verification + per-asset reserve check + oracle valuation + epoch record |
| `HonkVerifier.verify` (single-asset) | 3,910,843 | |
| `readPrices` (3 Chainlink-style feeds) | 73,221 | |
| `proposeReserve` / `proveReserve` / `reviewReserve` | 47,916 / 119,154 / 76,065 | `proveReserve` again once per window; same in every arm |
| `sampleReserves` | 100,268 / 132,818 | once or more per window, by the auditor; 2 assets (arm 1) / 3 assets (arm 2), one wallet |
| `transferCompany` / `acceptCompany` | 48,404 / 23,566 | role rotation, same in every arm |

The two `submitEpoch` figures, and the ‡ figures below, come from `gasleft()` probes that
live in the test suites (`test_GasForPreparedSubmission` in arms 2 and 3, which encodes
the call before starting the timer so that copying the proof out of test storage is not
counted;
`test_GasForDeployment` and `test_GasForVerifyInclusion` in arm 3); `make compare` prints
them after the gas report. They exist because the gas report cannot supply them: its max column includes the reverting calls, and the zk registry is
placed at a fixed address the report does not track. Calldata cost comes on top: about
7.6 KB of proof for arm 2, about 6.4 KB of commitments and values for arm 3.

**Role-gated calls cost about 2,200 gas more than they did**, because `company` and
`auditor` moved from `immutable` to storage when they became rotatable. That is the
price of the registry surviving a lost key, and it is charged on every gated call.

Deployment:

| Contract | Deploy gas | Runtime code | Init code |
|---|---:|---:|---:|
| `MultiAssetHonkVerifier` | 5,279,139 | **24,200 bytes** | 24,614 bytes |
| `HonkVerifier` (single-asset) | 5,251,615 | 24,074 bytes | 24,488 bytes |
| `MultiAssetSolvencyRegistry` | 5,176,701 | 22,451 bytes | 25,426 bytes |
| `KzgSolvencyRegistry` | 4,917,705 ‡ | 22,360 bytes | 24,804 bytes |
| `MerkleSumRegistry` | 4,131,981 | 18,102 bytes | 20,604 bytes |
| `ReserveDirectory` (once per chain, shared) | 973,326 | 4,266 bytes | 4,294 bytes |
| `SolvencyRegistry` (single-asset) | 798,600 | 2,973 bytes | 3,893 bytes |

‡ Execution gas from a `gasleft()` probe, without the 21,000 intrinsic cost and the
calldata or init-code charge that the gas report's figures include. The like-for-like
figures, from the same probes under Foundry's isolation mode
(`forge test --match-test '^test_Gas' --isolate -vv`), are 5,352,355 for the deployment and
176,233 for `verifyInclusion`. The earlier 4,530,110 and ~173,459 could not be reproduced
after the registry moved to `deployCodeTo`; the probes replace them. Bytecode sizes come
from `forge build --sizes`.

Each registry grew by almost exactly 3,005 bytes — the shared base gaining rotatable
roles, the epoch-freshness view and the reserve cap — then by another 1,650–1,790
bytes for the publication window, the auditor's sampling and the directory calls, and
by 236 more for the per-window control challenge (505 on top of that in arm 3, for the
public `getSrs()` that lets anyone check the deployed setup against the ceremony), and by 396 more for
`discardSample()`, which lets the auditor retract a sample taken too early. The two verifiers and the
single-asset registry are byte-for-byte unchanged, because arm 4 does not use the
shared base; that is what keeps it usable as a control (see *The control group*).

**The generated ZK verifier's runtime code is 376 bytes under the EIP-170 limit of
24,576.** Earlier versions of this document said 23 bytes: that compared the
*init code* size from the gas report with a limit that applies to the *runtime*
code (init code has its own limit of 49,152, EIP-3860). The margin is still thin
and the verifier is by far the largest contract here, but it is not the hard wall
we described; whether a fourth asset fits has to be measured, not assumed.

**Correction to earlier notes:** the UltraHonk check costs ~3.9M gas (~2.8M before
Fusaka repriced MODEXP), not the
~200–250k first written in `REPORT.md` and `NOTES.md`. And the "KZG is 18× cheaper"
headline compared a single pairing check (~154k) with the full SNARK verification
while leaving the range check off-chain. With the degree bound and the range
argument verified on-chain — both needed for the total to mean anything — the
snarkless registry costs **1.56M against 4.37M, about 2.8× cheaper** (2.7× in Sepolia-fork
receipts; 1.8× under the pre-Fusaka rules and the older probe) — on one asset
against three, which *Like for like* below corrects.

## Like for like: one asset, the same customers

The table above compares arms with different assets and different customers. This one
runs all three on `shared/customers.csv` (three customers, 49,550 units, one asset,
50,000 reserve units), each through its own prover. Probes: `MerkleSumRegistrySharedCustomersTest`,
the single-asset `test_GasForPrepared*` and `test_GasForTheSameSubmissionWithoutKzgVerification`.

| Arm | Checking the liabilities | Full submission | Calldata | Public |
|---|---:|---:|---:|---|
| Published ledger, 1 part per customer | 15,420 | 304,806 | 484 B | every amount |
| Published ledger, 2 parts per customer | 25,637 | 317,526 | 676 B | every part |
| Snarkless (KZG) | ≈1,343,234 | 1,556,777 | 6,788 B | the total |
| ZK, single-asset control | 3,915,741 | 4,023,440 | 7,716 B | nothing but the root |

- **The ledger check** is `computeRoot` called on its own, a keccak merkle-sum tree.
  It grows with the number of parts, up to 256 per asset.
- **The KZG check** is 1,556,777 minus 213,543, the same `submitEpoch` with every KZG
  check removed (`KzgBookkeepingOnly`). It is a difference of two probes, not one probe.
- **The ZK row is not on the shared registry.** The control arm has no sampling, windows
  or context binding, so its bookkeeping (about 108k) is lighter. On the shared registry
  it would cost roughly 3.92M plus KZG's 214k, about 4.13M. That is an estimate.

On one asset and the same data, KZG costs 2.6× less than ZK, and publishing the ledger
costs another 5× less than KZG. Each step up buys privacy: the ledger hides only who
owns which part, KZG hides every balance but publishes the total, and ZK hides the
total too.

## Sepolia rehearsal versus fixture probes

The `submitEpoch` figures above are execution gas from a probe. A Sepolia receipt differs
from the original probe (`test_GasForASuccessfulSubmission`) in four ways. Each can be
measured on its own, so the probe and the receipt can be reconciled step by step.

The receipts come from a rehearsal of `npm run sepolia -- deploy` then `epoch` on
`anvil --fork-url` Sepolia, pinned at block **11,759,567** (Anvil 1.7.1 applied the
current Sepolia rules there, Fusaka), with the pinned nargo, bb and Foundry, on
2026-09-22. It reproduces the earlier unpinned rehearsal to within 36 gas
(ZK 4,536,849, KZG 1,679,229). The probe rows are `forge test --match-test
'test_GasFor(ASuccessful|Prepared)Submission' -vv`, run with the flags shown; the
first four rows add `--evm-version cancun`, the rules before Fusaka.

| Step | ZK `submitEpoch` | KZG `submitEpoch` |
|---|---:|---:|
| Original probe | 3,766,705 | 2,074,669 |
| Payload encoded before the timer starts (`test_GasForPreparedSubmission`) | 3,237,774 | 1,556,777 |
| The same call as its own transaction (`--isolate`) | 3,389,790 | 1,683,829 |
| The same under Fusaka rules (`--isolate`, now the default rules) | 4,518,272 | 1,683,829 |
| First-epoch receipt on the Sepolia fork | 4,536,873 | 1,679,265 |
| Remaining difference | +18,601 (0.4%) | −4,564 (0.3%) |

1. **Test storage.** The original probe starts its timer before the test contract
   copies the proof out of its own storage into the call. A real sender supplies
   calldata instead. This inflates both original probes by about 0.52M.
2. **Transaction overhead.** `--isolate` runs the call as its own transaction: the
   21,000 intrinsic gas, calldata (7,908 bytes for ZK, 6,788 for KZG) and cold storage
   access. `forge test --gas-report` always isolates, which is why the gas report
   prints the isolated figures.
3. **MODEXP repricing.** Fusaka's EIP-7883 triples the cost of the MODEXP precompile.
   The Honk verifier inverts field elements with 419 MODEXP calls. Each costs 4,048 gas
   on the fork against about 1,349 under `cancun`, which adds 1,128,482 gas to the
   verifier call (2,787,819 under `cancun`, 3,916,301 under Osaka and in the trace). The KZG verifier
   uses only ecAdd, ecMul and the pairing, so its cost is unchanged.
4. **Live feeds and state.** The fork reads real Chainlink proxies (3 × 17,014 gas
   against 3 × 8,395 for the mocks, +25,857) and holds different proofs and
   storage. The two remaining differences (+18,601 and −4,564, under 0.5%) are left
   unattributed.

The second epoch costs less than the first (ZK 4,502,957, KZG 1,645,577) because the
epoch record overwrites storage slots that are already non-zero.

This changes the comparison. Under the rules Ethereum runs today, a receipt for the ZK
submission costs about **4.54M** gas and one for KZG about **1.68M**, a factor of
**2.7** rather than the 1.8 this document reported before the switch to Osaka. A
precompile repricing moved the ratio by half, without any change to the contracts.

The rehearsal as a whole used 28.4M gas to deploy and 6.93M for the first three-arm
epoch round (one sample and one submission per arm). At 1 gwei that is 0.0284 ETH
and 0.0069 ETH. These figures are for budgeting and do not quote a current gas price.
For the public run, cite the receipt `gasUsed`, hash and block from
`deployments/sepolia.json`, and keep deployment, reserve maintenance and submission
costs separate.

## How it scales

The raw outputs behind this section (`arms/zk-circuit/bench/results.json`, `results.md`,
`verifier.json`) are committed in `arms/zk-circuit/bench/`. `verifier.json` was
re-measured on 2026-09-22 under Osaka rules
(`BENCH_N=8,32,128,512,2048,8192 npx tsx arms/zk-circuit/bench/verifier.ts`). The proving
figures do not depend on the EVM rules.

Everything above is measured at N = 8. `make zk-bench` sweeps the zk arm's circuit over
N and records what proving costs, where it stops, and what the on-chain verifier does as
the circuit grows. Noir array sizes are compile-time constants, so the benchmark
generates one project per N rather than parameterising the committed circuit; the
generated statement is a copy of `circuit/src/main.nr`, and at N = 8 it returns the same
root `multiAssetTree.ts` computes, which is what makes it a fair stand-in.

**Proving is linear in N**, at 240 gates per (customer, asset) leaf:

| N | Gates | `nargo execute` | `bb write_vk` | `bb prove` | Peak RSS | Proof |
|---:|---:|---:|---:|---:|---:|---:|
| 8 | 4,795 | 0.18 s | 0.03 s | 0.08 s | 0.03 GiB | 7,616 B |
| 512 | 125,797 | 0.26 s | 0.24 s | 0.68 s | 0.26 GiB | 9,152 B |
| 2,048 | 494,565 | 0.59 s | 0.86 s | 2.49 s | 1.02 GiB | 9,920 B |
| 8,192 | 1,969,637 | 2.12 s | 3.07 s | 10.15 s | 3.98 GiB | 10,688 B |
| 16,384 | 3,936,399 | 2.47 s | 13.37 s | 19.78 s | 6.50 GiB | 11,072 B |

**Where it stops is the toolchain, not the hardware, and that is the more useful result.**
The committed circuit's shape — one `combine_level` call per tree level — fails to compile
at N = 16,384, because each call instantiates a fresh array type and Noir refuses the
fourteenth: `Type is too complex (complexity: 100022, max: 100000)`. Writing the tree into
a single flat array of `2N-1` nodes compiles to a *byte-identical* circuit (the gate counts
match at every N) and buys exactly one doubling, to N = 16,384. It then fails at N = 32,768
inside Barretenberg rather than Noir:

```
bb write_vk: Assertion failed: (MAX_SMALL_RANGE_CONSTRAINT_VAL >= target_range)
  Left: 65535   Right: 65541
```

The 65,535-node array is itself what needs the out-of-range constraint, so the rewrite that
lifts the first ceiling builds the second. The largest run that succeeded used **6.50 GiB of
16 GiB**: the prover curve never came close to saturating the machine. A bigger laptop does
not move either wall.

So this construction — the whole tree inside one circuit, one proof per epoch — caps out
near 10⁴ customers regardless of hardware, against the 10⁷–10⁸ a real exchange has. That is
not an argument against SNARKs for solvency; it is an argument about *this shape*. Binance
proves millions of accounts by batching many small proofs rather than one large tree, and
the measurements above are the concrete reason that architecture exists.

**Verification is not flat in N.** Gas tracks `LOG_N` — the padded circuit size the proof
system actually works over, read from the generated verifier's own constants — at a strikingly
constant **106,715 gas per sumcheck round** (74,327 under the pre-Fusaka rules, when
the rounds' field inversions used cheaper MODEXP calls):

| N | `LOG_N` | Padded size | `verify` gas | Per round | Runtime code | EIP-170 margin |
|---:|---:|---:|---:|---:|---:|---:|
| 8 | 13 | 8,192 | 3,919,521 | — | 24,200 B | +376 B |
| 32 | 14 | 16,384 | 4,026,013 | 106,492 | 24,203 B | +373 B |
| 128 | 16 | 65,536 | 4,239,272 | 106,630 | 24,203 B | +373 B |
| 512 | 17 | 131,072 | 4,345,972 | 106,700 | 24,201 B | +375 B |
| 2,048 | 19 | 524,288 | 4,559,512 | 106,770 | 24,204 B | +372 B |
| 8,192 | 21 | 2,097,152 | 4,773,241 | 106,864 | 24,200 B | +376 B |

That is +21% from N = 8 to N = 8,192, and the proof grows with it, 7,616 B to 10,688 B, which
is calldata charged on top. The verifier's *runtime bytecode*, by contrast, is constant at
~24,200 bytes: **the EIP-170 margin of 376 bytes is not a function of N** — only the gas is.
Extrapolating the line to a 10⁸-customer tree (`LOG_N` ≈ 34) puts verification near 4.4M gas,
still an ordinary transaction; it is the prover, not the verifier, that fails to get there.

This is also what *The control group* above is really measuring: arm 4 and arm 2 both pad to
`N = 8192, LOG_N = 13`, which is why they land 0.2% apart. Statement complexity is free until
it crosses a power of two, and then it costs one round.

## What each arm actually guarantees on-chain

This matters more than the gas numbers, and the arms are not equivalent.

**Arm 1 (published ledger)** guarantees everything, because there is nothing to
hide: the contract holds every `(identity, amount)` part and recomputes each asset's
total itself, then compares it with the approved reserves of that asset in base
units — no price, no rounding. The cost is that the entire balance distribution is
public.

**Arm 2 (ZK circuit)** guarantees, in one submission: the root, non-negativity of
every balance (the `u64` type is the constraint), and that for **every asset
separately** customer liabilities are at most a public floor, while the contract
checks approved reserves hold at least that floor. Liabilities themselves are never
published. The root is bound to `keccak(chain id, registry, epoch)`, so a proof
verifies for one epoch of one deployment only. Prices play no part in solvency: a
surplus in BTC cannot cover a shortfall in ETH, which the earlier USD-aggregate
check allowed (3 BTC + 2 ETH + 1000 USDC passed against 10 ETH owed). The oracle
now only values reserves in USD, at round ids pinned from the prover's snapshot.

**Arm 3 (snarkless KZG)** guarantees on-chain, for one epoch of one deployment — both its
Fiat–Shamir transcripts absorb `keccak(chain id, registry, epoch)` first, so neither a range
proof nor an inclusion opening carries to another epoch, registry or chain: the total, via
an opening at 0
**and a degree bound**; non-negativity of every balance, via the range argument
(64 bit polynomials plus a quotient, folded into one batched opening); and a
gasless inclusion check per customer. The degree bound is not a detail: `n·p(0)` is
the sum of the balances only if `deg p < n`. Without it, committing to
`p + c·Z_H` keeps every balance on the domain — so the range proof still verifies —
while the total drops by `n·c`. We reproduced this: a published total of 9,550
instead of 49,550, accepted by the old check (`KzgSolvencyRegistry.t.sol`
replays it and the fixture includes a valid range proof for the forged commitment).
The earlier version of this section claimed the range argument was too expensive
to verify on-chain; measured, it is not.

## Privacy

**The Merkle sum tree leaks by construction.** To verify an inclusion proof you must
be handed the sibling subtree *sums*. At capacity 8 every customer learns a
sibling's exact value, a 2-leaf subtree total and a 4-leaf subtree total. This is
inherent to merkle-sum trees and applies to arm 1 and the single-asset arm.

**Arm 2 no longer has a sum tree.** Once the circuit computes the per-asset totals
itself, sums in the nodes add nothing to soundness and only leak siblings' balances,
so the tree became a plain Merkle tree (as Binance's is). Siblings are hashes;
padding leaves get random salts and all leaves are shuffled with a seed, so neither
the customer count nor ledger order can be read off a proof. Splitting balances into
random parts — arm 1's mitigation for the sum leak — is therefore unnecessary here.
What arm 2 does publish is one reserve floor per asset: set to the reserves it reveals
nothing already public; set to the liabilities it publishes the totals, as Summa does.

**Arm 3 reveals the total** (the opening at 0 is the published figure) and each
customer's opening reveals only their own slot. Its remaining leak: the range
argument opens the balance polynomial at the public challenge, which discloses one
linear combination of all balances. Blinding that away is not a small change — the obvious
blinding adds a multiple of `Z_H`, which shifts `p(0)` and so collides with the degree bound
the total depends on — so it stays a stated limitation rather than a fix.

**Two customers cannot be shown one leaf or slot.** In arms 2 and 3 the leaf identity
is `H(username, salt)` with the salt kept by the customer since signup, and the
verifier takes it from the customer, never from the bundle. An in-circuit
distinct-ID constraint, which we had listed as the fix, does not prevent this: one
leaf can serve two customers the exchange gave the same ID, and distinctness only
compares different leaves.

**How bundles reach customers leaks more than any tree does.** `demo-site/` serves
each customer's inclusion bundle as a static file at `/bundles/<username>.json`.
The "sign in" only picks which file to fetch, so anyone who guesses an account ID
gets that customer's holdings and salt. The `minimum` branch closes it with an
authenticated backend: one bundle per bearer token, no customer ID or file name in
the request, the private store outside the served tree. We did not port it, because
the demo site is scheduled to be replaced. A real deployment needs that delivery
layer regardless of which arm it uses.

## Known gaps

Honest limitations, ordered by how much they matter.

**Nothing prevents omitting customers.** Inclusion proves *you* are in the commitment;
nothing proves *everyone* is. Liabilities shrink by leaving people out, and only
customers who verify can notice. No deployed system solves this cryptographically.

**Window dressing narrowed, not closed.** Control is now re-proven every window against
the challenge that window opened with, balances count at the lower of the auditor's sample and the live
figure, and the shared directory stops two registries counting one wallet. That closes
flash loans inside the submission, stale keys and double claims *within one directory*.
It does not stop an ordinary loan that spans the auditor's samples and the submission,
a registry that uses a different directory, or assets that are pledged elsewhere
(Provisions' proof of non-collusion addresses double claims across exchanges for Bitcoin).
See `docs/manipulations.md` §8–§11.

**Scale.** N = 8 against a real exchange's 10⁷–10⁸ customers. Proving cost is now
measured as N grows (*How it scales*, below) and the toolchain stops well short of a
real ledger — but the statement is still only ever demonstrated on 3 customers, and no
arm has been run against a realistic one.

**Assets are single-chain.** Reserves are read on one EVM chain. BTC is not an EVM
chain at all; real reserves span chains, custodians and cold storage.

**Arm 3 is single-asset.** One polynomial pair per asset would be needed — and, per *What
the measurements say about the choice*, each would carry its own range argument, which is
what makes the cost linear in assets.

**Operational.** One oracle feed per asset with no fallback; no public testnet
deployment. The KZG SRS now comes from the Perpetual Powers of Tau ceremony (80
contributions and a beacon), pinned by hash and checked with pairings in
`make kzg-setup`, so the degree bound and the openings rest on that ceremony rather than
on a `tau` generated on one machine. The single-asset arm passes live reserves as a public input, so a
1 wei deposit to a reserve between proving and submission invalidates its proof (arm 2
uses a floor for exactly this reason).

**A bounded reserve set, not a cached one.** The reserve sum is a loop over approved
wallets, and it runs inside `submitEpoch`. The obvious fix is to cache per-token totals
and refresh them in a separate transaction, which makes the submission O(1). We chose a
hard cap (`MAX_RESERVES = 64`) instead, and the reasoning is worth stating because the
cheaper-looking option is the worse one: a cached total is read at refresh time, not at
submission time, so it widens the window-dressing gap above from one block to whatever
freshness bound the cache carries. Atomicity between counting reserves and checking
solvency is what makes the check mean anything, and the scale that would justify trading
it away is scale this project does not have. A deployment with thousands of reserve
wallets would have to revisit that, and would be buying O(1) submissions with a weaker
guarantee.

Deliberately out of scope for a pitch: gas golfing, upgradeability, formal
verification.

## What the measurements say about the choice

The evidence points toward **polynomial-commitment first, with the Merkle tree
removed entirely** — which arm 3 largely is. Stated carefully, because arm 3 is
single-asset and arm 2 is not, so the headline ratio is not like-for-like:

1. Commit to balances as a polynomial, one commitment per asset, with a degree bound.
2. Customer inclusion is an opening at that customer's index — private, constant
   size, free of the sibling leak — batched with an identity polynomial.
3. The total per asset is an opening at 0 (total = n · p(0)).
4. Non-negativity is the range argument, verified on-chain at ~2M gas, constant in N.
5. Solvency is decided per asset, so no conversion table is needed at all. Arm 2 now
   does the same: the requirement to prove which table was used dissolves rather
   than being met.

**What a circuit still buys.** Measured, not a range proof: arm 3 verifies that on-chain
more cheaply than the SNARK. The circuit buys *private totals* — arm 2 proves
"liabilities ≤ floor" without publishing liabilities, whereas a KZG grand sum is a
published opening — and it keeps customer-side verification to a hash path.

**The asymmetry the gas table hides.** Arm 3's 1.56M covers one asset; arm 2's 4.37M
covers three. The two curves have different shapes, and the shape is structural rather
than incidental:

- **The SNARK is flat in asset count, in steps.** Assets are constraints inside the
  circuit, and verification depends on the circuit's *padded* size, so a marginal asset
  is free until it pushes past a power of two and then costs one round, ~106,700 gas.
  Measured at ~106,700 per round over 2^13 … 2^21 (*How it scales*).
- **The polynomial path is linear in asset count.** Each asset needs its own balance
  polynomial, its own degree bound, its own opening at 0 and — the dominant term — its
  own 64-bit range argument. Arm 3's cost is mostly those 64 bit-commitments and the
  batched opening over them, and none of it is shared between assets.

So the marginal asset costs arm 2 nothing at the verifier and costs arm 3 close to a
full range argument. **The ordering reverses somewhere between two and three assets.**
We derived this rather than measured it — building a multi-asset arm 3 would confirm a
fact that follows from what the two constructions are — so it is stated as a structural
argument a reader can check, not as a number to be taken on trust.

**Why the obvious hybrid does not work cleanly.** Using KZG for inclusion and a
SNARK to hide the total requires the circuit to prove a statement about an *external*
KZG commitment, which means elliptic-curve MSM inside the circuit over a non-native
field. Commit-and-prove and linked-proof schemes solve this in principle; Noir and
UltraHonk do not expose it. This is why arm 2 needs a Merkle root at all: **the tree
is the link between what customers verify against and what the SNARK proves about.**
Summa v2 avoids the problem by building the polynomial inside a Halo2 circuit, which
also gives it the degree bound for free.

## Where this came from

`feat/snarkless-solvency` prototyped a `KzgSolvencyRegistry.sol` with a gasless
`verifyInclusion`, an identity commitment and a `TotalOutOfField` guard. The arm-3
registry on this branch now has all three, plus the degree bound and on-chain range
verification that prototype lacked.

## Conclusion

The professor's original challenge was "challenge the need for ZKPs". Having built all
three, the answer is not a single ratio but a crossover.

For **one asset**, less ZK is needed than it first appears: a polynomial commitment
delivers a sound public total, per-customer inclusion and on-chain non-negativity for
1.56M gas against 4.37M for the SNARK path — cheaper, though by 2.8×, not the 18× we
first reported. But that comparison is one asset against three. The SNARK's verification
cost grows only logarithmically in circuit size — ~106,700 gas per doubling, measured —
while the polynomial path pays a fresh range argument per asset, so **which construction
is cheaper is a question about the deployment, not about the cryptography** — and past
two or three assets the circuit wins.

Put the other way: ZK's value here is not that it proves range cheaply, because measured,
it does not. It is that **verification cost grows only logarithmically in what is proved** —
and a real solvency statement, spanning many assets with margin, collateral and haircuts,
is exactly the case where that decoupling pays. The snarkless path is cheaper only in the
degenerate case.

Two lessons generalise beyond the gas. The constructions were only as sound as their
least obvious check — the degree bound in the snarkless arm, the path-bit check in a
customer's verifier — neither of which a passing demo would ever exercise. And the
engineering, not the cryptography, held the disqualifying faults: an unbounded loop in
the reserve sum, roles that could not be rotated after a lost key, and no way for a
customer to tell a solvent exchange from one that had stopped publishing.

## Revision log

- 2026-09-13: per-asset solvency with private liabilities in arm 2 (plain Merkle tree,
  context-bound root, epoch history, oracle prices kept at 8 decimals with per-feed
  staleness and pinned rounds); degree bound, inclusion proofs and on-chain range
  verification in arm 3; per-asset trees and signed reserves in arm 1; shared reserve
  registry for all arms; EIP-170 margin corrected; KZG cost ratio corrected.
- 2026-09-17: arm 3 is deployable at any address. Its transcripts still bind to
  `keccak(chain id, registry, epoch)`, but `arms/snarkless/script/demo.ts` (`make kzg-demo`)
  deploys the registry, writes the address into `snapshot.json`, regenerates the epoch
  against it and submits — so the binding no longer implies a pinned address. Generated
  artifacts go to `fixtures/demo/`; the committed fixtures stay bound to the address the
  Foundry tests place the registry at.
- 2026-09-16 (later): arm 2 counts liabilities in per-asset base units at 8 decimals, so
  fractional balances are representable (18 decimals would overflow the circuit's `u64` at
  18 ether); arm 3's transcripts are bound to chain, registry and epoch, with replay refused
  in the prover tests and on-chain.
- 2026-09-16: the shared registry gained a bounded reserve set, two-step role rotation
  and an on-chain epoch-freshness view, so all three arms have them; duplicate asset
  tokens and carried-over oracle rounds are refused; the reserve sum is read once per
  asset instead of twice. Every gas figure re-measured against that base, with the two
  `submitEpoch` costs now produced by tests rather than a throwaway script. The
  conclusion was rewritten: the previous "1.8x cheaper" headline compared a one-asset
  arm 3 with a three-asset arm 2, and the honest statement is a crossover, derived from
  the flat-versus-linear cost structure and anchored by arm 4 as a control.
- 2026-09-22: gas is measured under the Osaka (Fusaka) rules Ethereum runs today instead
  of `cancun`. Fusaka's MODEXP repricing (EIP-7883) raises the ZK verifier from 2.79M to
  3.92M gas and the per-round cost from 74,327 to 106,715. The runtime bytecode is
  unchanged. The `submitEpoch` probes now encode the call first, which removes about
  0.52M of test-storage reads from both arms. KZG is now 2.8× cheaper than ZK by probe
  and 2.7× by Sepolia-fork receipt. The previous figure was 1.8×.
