# Public demo preparation: validation record

Checked locally on 24 September 2026. This records preparation of the feature
branch, not a public Sepolia deployment or an executed GitHub Pages release.

## Passed

- Pinned proving tools installed locally: nargo 1.0.0-beta.26 and bb
  6.0.0-nightly.20260902. Official archive checksums and executable versions verified.
  The installer also rejected a deliberately modified archive before installation.
- Fresh-proof integration passed with those tools: two newly generated ZK epoch
  proofs, on-chain submission, customer verification and invalid-submission checks
  on a disposable local Anvil chain.
- The pinned tools regenerated `MultiAssetHonkVerifier.sol` byte for byte.
  SHA-256: `284203a0819b355d06db9f27819ce421dff7d36c69266446b3a5569281bf41b4`.
- TypeScript type checking and Solidity formatting.
- Foundry: 110 reported tests passed, including the reserve registry invariants.
- Node: all 19 test files passed, including synthetic export filtering and example matching.
- Local Anvil demo and journal recovery: both integration tests passed.
- Browser regression suite: 13 tests passed, including periodic refresh, preserved
  input values, changed epochs, expiration, RPC failure/recovery, connection races
  and visibility changes.
- Production website build and GitHub Pages project-subpath browser smoke test.
- A temporary deployment record with `pending` caused the website build to fail
  without printing its signed-transaction test value; the test record was removed.
- Workflow YAML structure checked locally. GitHub Actions
  [run 35931512335](https://github.com/williamtran03/PubliclyVerifiableSolvencySystem/actions/runs/35931512335)
  passed with Node 22 and Foundry 1.7.1. Feature-branch deployment was skipped.
  This does not validate Pages permissions or hosting eligibility.

Local network tests initially failed under filesystem/network sandbox restrictions;
Anvil and browser tests passed when allowed to open their local ports.

## Outstanding validation and release constraints

- This environment used Node 26.10.0 and Foundry 1.8.1. CI remains configured for
  Node 22 and Foundry 1.7.1. Confirm the pinned release environment before deploying.
- Add `$HOME/.local/share/opensolvency/proving-tools/bin` to PATH in the operator's
  shell. The installer intentionally leaves shell startup files unchanged.
- Existing local role keys have valid formats but their intended ownership and
  backup arrangements remain unconfirmed. A read-only Sepolia check found all five
  balances at zero. No keys were generated, replaced, copied into the repository or
  sent to an external service.
- No public Sepolia deployment, drill, funding transaction or epoch was performed.
- The synthetic exporter has local filtering/verification tests, but its full
  public Sepolia run and resulting example files still require a deployed system.
- No deployment addresses or sample files were fabricated. Export, review and
  commit them after the public run.
- The repository is private; confirm the owner plan supports GitHub Pages for
  private repositories. Repository visibility has not been changed.
- Pages must be enabled by the repository owner, the reviewed work integrated into
  main, and the final hosted URL tested. A feature-branch push does not publish it.
- Name the operator, recovery operator and reviewer; confirm grading dates,
  validity, RPC provider/fallback and private backup retention.
- The current workflow deliberately uses one operator with five test-only keys.
  Independent company/auditor key custody requires separate signing steps.
- Polling only refreshes the selected loaded snapshot while the browser is open;
  it does not publish epochs, generate proofs or provide unattended alerts.

Follow [the release runbook](public-demo-release.md) to complete the remaining work.

## Release execution on 25 September 2026

The following supersedes the preparation-only deployment and funding status above.

- User selected 30-day validity (`2592000` seconds), retaining a 60-second minimum
  interval, and confirmed that the five MetaMask accounts are backed up and recoverable.
- Before deployment, Company held 0.2 Sepolia ETH and Auditor held 0.1 Sepolia ETH.
- Type checking, Solidity formatting, 110 Foundry tests (including invariants),
  all 19 Node test files, the production build, both demo/recovery tests,
  13 browser tests, and the Pages subpath smoke test passed.
- Fresh-proof integration passed with nargo 1.0.0-beta.26 and bb
  6.0.0-nightly.20260902. Local Node was 26.10.0 and Foundry was 1.8.1;
  this does not replace validation under the CI-pinned Node 22 / Foundry 1.7.1.
- Local server tests required execution outside the network sandbox. The initial
  aggregate validation stopped at those restrictions; the demo, browser, Pages,
  and fresh-proof suites passed when rerun with local-port access.
- Fixed the Sepolia CLI build subprocess to stream stderr instead of buffering it:
  Foundry 1.8.1 lint output exceeded Node's default subprocess buffer before any
  transaction was sent. Type checking and the public CLI preflight passed afterwards.
- Public Sepolia deployment completed for all three registries. Receipt hashes,
  addresses, and deployment parameters are in `deployments/sepolia.json`.
- User enabled public repository visibility and Pages; GitHub API confirmed both.
- None of the five current private keys was found in reachable local Git history;
  `.env` remains ignored. This check is not a comprehensive historical secret audit.

- Initial epoch 0 published for all three approaches. Every demo customer's bundle
  verified through the website adapters; deliberately wrong balances were rejected.
- All three operations drills reached checkpoint 14: original Company/Auditor roles
  restored and reserves removed, re-proven and approved again.
- Ledger and ZK reserve restoration each needed a checkpoint resume after an RPC
  simulation/state-check disagreement immediately following confirmed transactions.
  Resuming succeeded without editing checkpoints or changing contracts. This is
  consistent with inconsistent latest-state reads from the public RPC; the provider
  cause was not independently established.

Post-drill epoch 1 and verified synthetic example export completed for all three
approaches. See [the release record](sepolia-release-2026-09-25.md) for public
addresses, transaction hashes and expiry dates. Hosted acceptance remains pending.
