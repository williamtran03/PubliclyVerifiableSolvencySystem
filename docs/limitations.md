# What the system proves, and what it cannot

## Three claims, kept apart

A proof of reserves is not a proof of solvency. The system makes three separate claims,
and each arm makes them differently.

| Claim | Question it answers | How it is established |
|---|---|---|
| **Proof of assets** | Which funds does the company control right now? | Shared by all arms (`shared/contracts/`). A wallet counts only if the auditor approved it, it proved control in the current window with a signature over the challenge that window opened with, and the shared `ReserveDirectory` records it for this registry alone. Its balance counts at the lower of the auditor's sample in an earlier block and the live balance at submission. |
| **Proof of liabilities** | What does the company owe, and is each customer in it? | Arm 1: every anonymised part is published and the contract recomputes one merkle-sum root and total per asset. Arm 2: a Poseidon2 Merkle commitment to every `(customer, salt, asset, amount)` leaf, bound to the epoch; totals stay private. Arm 3: a KZG commitment whose total is an opening at 0 under a degree bound, with a 64-bit range argument. In every arm, each customer checks their own inclusion. |
| **Proof of solvency** | Do assets cover liabilities? | Enforced inside the submission transaction, per asset: arm 1 and arm 3 compare the exact total, arm 2 compares a public floor that the ZK proof shows every per-asset total stays under. An insolvent epoch cannot be recorded. A surplus in one asset never covers a shortfall in another, and prices play no part in the check. |

Each claim is only as strong as its weakest input. A perfect liability proof over an
incomplete ledger still proves nothing about the missing customers, and a perfect reserve
proof says nothing about who else has a claim on those reserves.

## What cannot be proven

**Completeness of liabilities.** Inclusion proves a customer is in the commitment, not
that everyone is. Omitted accounts are found only by customers who check
(`manipulations.md` §1). No deployed system proves completeness; it is an auditor's
attestation everywhere.

**Off-chain debts.** Bank loans, lawsuits, tax and any obligation not recorded as a
customer balance are invisible to all three arms. Customer debts (margin, loans against
collateral) are not modelled either: every leaf is a non-negative claim on the company.

**Unencumbered assets.** A balance in a controlled wallet may be lent out, pledged or
owed. Control is not ownership.

**Solvency tomorrow, or liquidity.** Each epoch is a statement about one moment. Assets
can leave right after it; nothing locks them. A minimum and maximum epoch interval bound
how stale a statement can be, but not what happens between epochs.

**Borrowed assets across the snapshot.** Flash loans inside the submission are stopped
(`manipulations.md` §8), but an ordinary loan that spans the auditor's samples and the
submission still passes (§9).

**Assets on other chains or with other custodians.** Reserves are read on one EVM chain.
BTC, cold storage at a third party and assets on other chains are outside the system.
The shared directory stops two registries on this chain from counting the same wallet,
but only among registries that use the same directory.

**An honest auditor.** The auditor approves wallets and samples balances. A colluding
auditor breaks the asset side.

**An auditor who is still there.** `sampleReserves()` is auditor-only and no epoch can be
submitted without a sample, and only the auditor rotates the auditor, so a lost or
unresponsive auditor key stops every future epoch; recovery is a redeploy, which starts
the epoch history over. Both halves of that are deliberate. Permissionless sampling would
hand anyone a veto: a sample taken at the lowest moment of a window pins the attested
balance there for the rest of it, blocking an honest submission. A company-side escape
hatch after a timeout would let a company that simply waits install a friendly auditor,
which is exactly what `test_NeitherRoleCanRotateTheOther` exists to prevent. The role
therefore belongs to a multisig or a contract with its own recovery policy, not to one
key. The same pinning makes order matter within a window: a sample taken before a wallet
has re-proven control counts that wallet at zero, and only a new epoch would open a new
window. The auditor can retract such a sample with `discardSample()` and sample again
(`test_APrematureSampleCanBeDiscarded`); the company cannot, so it gains no way to erase
an inconvenient sample.

**A receipt a customer can take to a third party.** A customer checks their own inclusion,
but nothing the company hands them is signed by the company. A customer whose balance is
understated has their own records and a proof that verifies against a root — evidence that
the company committed to *some* number, not that it agreed to owe a different one. Signed
per-customer receipts bound to the epoch would close this; they are not built.

**An honest RPC.** Customers read the committed root through an RPC endpoint; a dishonest
endpoint can show a false one. Customers should use a node they trust. Arm 3's inclusion
check sends the identity commitment, the balance and the opening to that endpoint.

**Publication.** Nothing can force a company to publish. A stale registry is visible
(`isCurrent()`), and every late epoch is recorded permanently in `lapses()`, but an
enforcement mechanism (a regulator, or a bond that is forfeited on a lapse) is not built.

## One credential for two customers

**The attack.** Every arm lets a customer find their own leaf with a credential the company
issued: a username and salt in arms 2 and 3, a customer ID with per-part salts in arm 1
(`shared/customers.csv`, `customers.example.json`). Nothing stops the company handing the
same credential and the same bundle to two customers who are owed the same amounts. Both
check, both find the leaf, both pass, and the liability is counted once. Each extra
customer on a shared credential removes one balance from the total, and the solvency
check then compares reserves against that smaller total (`manipulations.md` §4).

**Why an inclusion check cannot see it.** Each customer asks one question: is my balance in
the commitment? It is. The attack uses one valid leaf, so no circuit constraint, degree
bound or merkle-sum check is violated. The two customers would notice only by comparing
their credentials or bundles with each other.

**Per arm.**

| Arm | What must match for two customers to share | What binds the leaf today |
|---|---|---|
| 1, published ledger | Every per-asset total, since the site sums a customer's parts per asset and compares them with what they enter | `keccak(snapshot, customer ID, name, date of birth, asset, part, salt)`. The site checks the customer ID the customer enters; the name and date of birth come from the bundle, so they bind the leaf to a person only if the customer reads them |
| 2, ZK circuit | The balance in every asset, since `verifyBundle` requires the customer's parts to sum to exactly what they enter, asset by asset | `Poseidon2(username, salt, asset, amount)`, both issued by the company |
| 3, KZG | One balance, since the arm is single-asset | `Poseidon2(username, salt)`, both issued by the company |

Multiple assets make the attack narrower, not impossible: in arms 1 and 2 two customers
must hold identical portfolios. Small accounts that hold one round amount of one asset
are common, so the pool of matching pairs is still large, and in arm 3 any two equal
balances will do.

**The fix: a secret the customer chooses.** At signup the customer picks a secret `s`
and gives the company only a commitment `c = H(s)`. The leaf binds `c` in place of the
company's salt, for example `Poseidon2(username, c, asset, amount)` in arm 2 and
`Poseidon2(username, c)` in arm 3. A customer verifies by entering `s`, so the site
recomputes `c` itself. Two customers chose different secrets, so no single leaf can
satisfy both, and the company cannot pick a colliding `c` because it never sees `s`.
Arm 1 would add `c` to its identity commitment and keep its fresh per-part salts, which
keep parts unlinkable across epochs.

**What it costs.** Nothing on-chain: the leaf hashes keep their arity, so the circuit,
the verifier and the gas are unchanged. The cost is operational: a signup step, a secret
the customer must keep (losing it loses the ability to check, not the claim), and a way
to rotate it. The company also has to acknowledge which `c` belongs to which account;
otherwise a dispute is one customer's word against the company's, which is the signed
receipt gap above.

**What it does not solve.** It stops one leaf serving two customers. It does not stop
omission: a customer the company leaves out entirely is still found only if they check
(completeness, above). It says nothing about customers who never verify, and it does
not help if a customer hands their secret to someone else.

**Status.** Not built. Every arm still uses company-issued salts. Publishing the leaf
count, so that an auditor can compare it with an attested customer count, would at
least expose the attack; that is not built either.

## Trusted setup

- Arm 2 (UltraHonk, via Barretenberg) uses the SRS from Aztec's Ignition ceremony.
- Arm 3's SRS is extracted from the Perpetual Powers of Tau ceremony: 80 contributions
  and a beacon from Ethereum's RANDAO, in the file PSE publishes as
  `ppot_0080_08.ptau`. `make kzg-setup` downloads it, checks the pinned SHA-256, checks
  that the G1 and G2 points are valid powers of one `τ` with pairings, and writes
  `srs.json`. The setup is sound if any one contributor destroyed their secret. The degree
  bound depends on this: whoever knows `τ` can forge openings and escape the bound. The
  registry publishes the three G2 points it verifies against through `getSrs()`, so anyone
  can compare a deployment with the ceremony instead of trusting the deployer
  (`test_PublishesTheSetupItVerifiesAgainst`); `loadSrs` refuses a file whose points are
  off the curve or are not successive powers of one `τ`.
- The unit tests still use locally generated SRSs, which is fine for tests and never
  reaches a fixture.

## What each proof reveals

The full privacy analysis is in `comparison.md`. The short version:

- **Arm 1** publishes every anonymised part and every per-asset total. A customer's
  inclusion proof carries sibling subtree sums, so at capacity 8 a customer learns a
  sibling's exact balance. Splitting and pseudonyms are not anonymity.
- **Arm 2** publishes a root, the epoch context and one floor per asset. Floors default to
  the reserves, which are public anyway, so the proof adds no information about
  liabilities beyond "at most the reserves". A customer's path reveals only salted
  hashes.
- **Arm 3** publishes the exact total. Its range argument opens the balance polynomial at
  a public challenge, which leaks one linear combination of all balances; blinding it
  would collide with the degree bound.
- **All arms** publish every reserve wallet address, in the `reserves` array and in the
  events, so the asset side has no privacy at all. Publishing treasury addresses is a
  commercial cost, and Provisions (`related-work.md`) hides which addresses in an
  anonymity set are the company's. Large exchanges publish their addresses too, so this
  is a deliberate choice rather than an oversight, but it is a choice.

## Repeated snapshots

What an observer learns from a series of epochs:

- **Arm 1:** every total and every part per epoch. Differences between epochs expose
  flows, and a part whose amount is unusual can be followed across epochs.
- **Arm 2:** only the floors, and with them the reserves, which are public on-chain
  anyway. Roots are bound to the epoch, so identical ledgers give unrelated roots.
- **Arm 3:** the exact total per epoch, so the series is the company's liability curve.
- **All arms:** publication times, lapses, and reserve-wallet activity. A customer who
  checks every epoch sees their own leaf, and in arms 1 and 2 the sibling hashes (and in
  arm 1 the sibling sums) change as neighbours move.

## Engineering limits

- **Scale.** Every arm runs with 8 slots. The ZK circuit as committed compiles up to
  8,192 leaves; the flat-array form in `arms/zk-circuit/bench/generate.ts` reaches 16,384
  and fails inside Barretenberg at 32,768. Both walls are the toolchain, not the hardware:
  the largest run used 6.5 of 16 GiB. A leaf is one (customer, asset) pair, so a customer
  holding three assets takes three and the customer ceiling is lower still. Real
  custodians need batching or recursion across many proofs.
- **Amount range.** Arm 2 types amounts as `u64` in base units at 8 decimals, so each
  asset's total liabilities are capped at 2^64 − 1 units, about 184.5 billion tokens.
  Large stablecoin issuers are near that. Arm 3 caps each balance at 2^64 − 1 units
  through its range argument.
- **Arm 3 is single-asset.** A multi-asset version would need one range argument per
  asset.
- **Salts are issued by the company** in every arm, so customers do not hold a secret of
  their own, and nothing enforces one credential per customer (*One credential for two
  customers*, above; `manipulations.md` §4).
- **Arm 2's committed demo proof** is bound to one registry address, which only arises on
  a fresh Anvil node where the company deploys at nonce 8.
- **The single-asset control arm** passes live reserves as a public input, so one wei sent
  to a reserve between proving and submission invalidates its proof. It is kept only as
  a measurement control and does not use the shared reserve registry.
- **Public testnet:** all three approaches were deployed and exercised on Sepolia
  on 25 September 2026; see [the release evidence](sepolia-release-2026-09-25.md).
- **Not yet done:** an independent audit and the non-cryptographic "attestation" baseline (a bond plus an attested
  customer count) that would test whether ZK is needed at all.
