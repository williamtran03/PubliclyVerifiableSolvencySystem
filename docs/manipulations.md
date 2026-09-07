# Attacking your own system

Every entry is an attack that survives the current implementation, or one the
implementation stops and it is worth being explicit about why.

## Stopped

**Understating the total.** The root's `sum` is computed by hashing, not typed
in. Shrinking it requires changing some customer's leaf, and that customer's
next inclusion check fails.

**Omitting a customer.** Same mechanism — but only if the customer checks. A
scheme where nobody runs `verify-inclusion` is a scheme with no liabilities-side
guarantee at all. This is the system's single largest operational dependency and
it is not a cryptographic property.

**Giving two customers the same leaf.** `id = keccak256(username) mod r` plus
strictly-increasing leaf order. Without hashing, usernames past 32 bytes collide
by truncation; without ordering, distinctness is not checkable.

**Listing a wallet the custodian does not control.** `addReserve` requires an
EIP-191 signature from the wallet itself, bound to the chain id and the registry
address, so a signature cannot be replayed onto another deployment. Signature
malleability is rejected (upper-half `s` values).

**Publishing an insolvent epoch.** `submitEpoch` reverts. There is no "record it
and argue later" path.

**Replaying an old good root.** The customer CLI compares the proof's root
against what the chain says *right now*, so a proof from a healthier epoch does
not verify today.

## Not stopped

**Window dressing.** Borrow assets before the snapshot, return them after. The
contract sees a real balance at a real block. Mitigations: unannounced snapshot
times (the custodian chooses when to publish, so this is weak), continuous
attestation, or requiring the reserve set to be stable across a window.
Currently: nothing.

**Shared reserve wallets.** Two custodians can both get a signature from the
same wallet and both count its balance. The signature proves control, not
exclusive control, and nothing stops one address from signing for both. A
registry of attested wallets across custodians would surface this; none exists.

**Omitted liability classes.** The customer CSV is the custodian's own. Debts to
lenders, to counterparties, to a bankruptcy estate, or to customers deliberately
excluded from the file are invisible. No cryptography reaches this; it is what
an auditor is for.

**Assets the custodian does not really own.** Signing key custody is not
ownership. Assets can be pledged, rehypothecated, or subject to a lien while the
key still signs.

**Silence.** The custodian can simply stop publishing. That is the intended
failure signal, but it is a social signal, not an enforced one — nothing on
chain compels the next epoch.

**Everything that is not ETH on this chain.** `totalReserves()` sums native
balances of listed addresses. ERC-20s, other chains, and off-exchange custody
are all out of scope of the current contract.

**Negative or overflowing balances in the tree** — on `main`. The prover checks
them, but the prover is the adversary; nothing a *verifier* sees rules out a
tree built with a negative balance that cancels a real one. That is precisely
the hole the two branches close, by two different routes:

- `feat/zk-solvency` proves every leaf is a valid `u128` inside a circuit;
- `feat/snarkless-solvency` proves the same thing with a committed
  bit-decomposition and KZG openings, with no circuit at all.
