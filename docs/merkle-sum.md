# Merkle-sum solution

This branch extends `main` (361c3ed) without adding a ZK stack. Existing `prover/`,
`cli/`, `contracts/`, `script/`, and `test/` directories remain. The original
`buildTree`, `createProof`, `verifyProof`, uint256 Keccak hashing, padding, and
reserve registry are reused. Existing baseline commands still work.

## Construction

A customer can split an ETH liability into multiple non-negative amounts, in wei.
For each part the builder generates an independent 32-byte cryptographic salt:

```
identityHash = keccak256(abi.encode(
  "solvency.split.v1", snapshotId, customerId, name, dateOfBirth, partIndex, salt
))
leaf.hash = keccak256(abi.encode(identityHash, amount))
leaf.sum = amount
parent.hash = keccak256(abi.encode(left.hash, left.sum, right.hash, right.sum))
parent.sum = left.sum + right.sum
```

Identity and amount are fields of one leaf, not two unrelated children. ABI
encoding avoids ambiguous concatenation. Entries are shuffled before building.
Zero padding matches main: at least two leaves, then the next power of two.
Names and birth dates implement the proposed identity opening; they are not
verified KYC. Prefer pseudonymous identifiers in a real deployment and leave
unnecessary name/birth-date fields empty. All identity fields must match exactly.

## Public and private data

Public: snapshot ID, identity commitments, every partial amount, root and total.
Transaction calldata permanently exposes the public entries. Do NOT submit names,
birth dates, salts or customer proof bundles to the contract. Share each bundle
privately with its intended customer only. Hashing with a private salt is not
zero knowledge or encryption. Splitting and shuffling do not guarantee anonymity:
amount patterns, repeated publications and colluding customers can reveal links.

Private: source ledger and `private/customer-N.json` files containing identity
openings and inclusion proofs. Every customer gets a bundle, not only a hard-coded
example. The output directory must be new and is created with restrictive file
permissions. Never commit real customer records; the example uses fictional data.

## Run

Use the repository's Node dependencies (`npm ci`) and Foundry/Solidity 0.8.28.

```sh
npm run test:merkle
npx tsc --noEmit
forge test
npm run merkle -- build fixtures/split-customers.example.json merkle-output
npm run merkle -- audit merkle-output/ledger.json
```

The builder makes a fresh snapshot ID and fresh salts. Amounts in the input JSON
must be decimal strings in wei, never JavaScript floating-point numbers. The
example has Alice's 40 + 60 wei and Bob's 20 wei, total 120 wei (not 120 ETH).

Deploy **MerkleSumRegistry** with the reserve addresses. As the owner call:

```
submitLedger(snapshotId, entries.map(e => e.identityHash), entries.map(e => e.balance))
```

Take those arguments from the public `ledger.json` using viem, as demonstrated in
`script/merkle-sum-demo.ts`. The contract computes the complete root and total
itself, checks current reserve ETH >= computed total, then stores/emits the epoch.
There is no caller-supplied total. The inherited `submitEpoch` route is disabled
in this contract to prevent bypass. The baseline `SolvencyRegistry` retains its
original behavior; its method is merely marked `virtual` for reuse.

Customer verification fetches root, total and snapshot ID from one pinned block:

```sh
npm run merkle -- verify <registry-address> <rpc-url> merkle-output/private/customer-0.json 100 alice
```

The expected balance and customer ID must come from the customer's own records.
The checker validates each opening and path, rejects duplicate part indices,
compares both root and sum with the on-chain values, and sums all parts against
that expected balance. A proof for only 40 wei cannot pass when Alice expects 100.
The customer must use the correct chain/RPC and independently trusted registry
address. Current-epoch verification can fail after a newer snapshot is published.

For the local end-to-end demo, start your own Anvil instance on port 8545 in one
terminal, then run in another:

```sh
forge build
npm run demo:merkle
```

The demo uses the standard PUBLIC Anvil development key, only a loopback RPC and
chain ID 31337. Never fund that key on a real network. It deploys, submits,
compares TS and Solidity roots, verifies every customer and rejects the inherited
false-total submission route. It does not stop unrelated processes.

## Guarantees and limits

- Every accepted snapshot has a total equal to the submitted leaf amounts.
  Unsigned integers and checked addition prevent negative balances and overflow.
- Up to 256 partial entries per snapshot, deliberately capped for this prototype.
  Publishing and recomputing costs O(n) calldata/gas; inclusion paths are O(log n).
  This is the privacy/scalability tradeoff versus a ZK circuit.
- The contract rejects duplicate/zero reserve addresses and repeated snapshot IDs.
- It cannot discover omitted customers, missing portions or off-chain loans.
  Customers checking their full balance can detect their own underreporting.
- Reserve ownership, legal eligibility and encumbrances remain unproven. Reserves
  are external wallets and are not locked. The ledger's real-world timestamp is
  not established by a snapshot label. This is historical evidence over submitted
  liabilities, not a guarantee of complete solvency or future withdrawals.
- There is no upgrade proxy, token valuation, L2 integration or security audit.

## Validation in this change

Eight TypeScript tests (including the four baseline tests) passed, along with
TypeScript checking and the build/audit CLI round trip. Solidity 0.8.28 was
compiled and executed in a Cancun EVM: TS/Solidity root parity, stored totals,
legacy bypass, replay, authorization, insolvency, overflow, input bounds and
invalid reserve configurations were checked. Foundry regression tests are
included; the Foundry runner and live Anvil demo were not run in this workspace.
Dependency installation was not revalidated: validation reused available local
packages, including TypeScript 5.9.3, rather than installing main's version range.
