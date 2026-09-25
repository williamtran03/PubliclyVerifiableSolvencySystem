# Remaining release inputs

The tool installation, fresh-proof integration and verifier reproduction are
complete. Public deployment, both epoch rounds, the operations drill and synthetic
example export completed on 25 September 2026. See [release evidence](sepolia-release-2026-09-25.md).
Public hosting remains pending final integration and hosted acceptance. Answers
must not contain private keys, seed phrases, vault recovery codes or RPC credentials.

| Input | Decision needed | Suggested starting point |
| --- | --- | --- |
| Operator and machine | Who runs deployment and subsequent epochs, and on which machine? | One named teammate; use the validated toolchain on that machine. Tools installed in the current workspace are not automatically installed on another machine. |
| Recovery and review | Who is the recovery operator, and who reviews the public deployment record? | Name both roles. If one person covers several roles, document that limitation. |
| Validity and grading | What are the grading dates? | 30-day validity selected on 25 September 2026 (`MAX_EPOCH_AGE=2592000`). Keep the 60-second minimum interval; renew epochs before expiry if grading continues. |
| Existing wallets | Were the five locally configured keys created exclusively for this demo, or should fresh wallets be created? | User created five distinct MetaMask accounts and configured their private keys locally. Valid key formats and distinct derived addresses were verified on 25 September 2026. |
| Private backup | Which encrypted vault or storage location, who has access, and when should keys and customer bundles be deleted? | User confirmed that all five accounts are backed up and recoverable on 25 September 2026. Backup location/access and retention remain private operational decisions. |
| Operator RPC | Keep the currently configured public PublicNode endpoint for this demo, or provide a local Alchemy/Infura endpoint? | PublicNode is already configured and answered a Sepolia chain/balance check. A keyed endpoint may offer more predictable quotas; keep its credentials local. The website can retain its public preset. |

## External setup still needed

- **Funding confirmed:** before deployment on 25 September 2026, Company held
  0.2 Sepolia ETH and Auditor held 0.1 Sepolia ETH. PublicNode returned the
  correct Sepolia chain ID. Subsequent transactions consume test ETH.
- **Pages configured:** on 25 September 2026 the user made the repository public
  and selected GitHub Actions for Pages. GitHub API confirmed `private=false`
  and `has_pages=true`. Publication from the reviewed main branch is still pending.

## Work after the answers

Record the selected owners and settings, verify the backups and funding, then run
the public deployment, epochs and drill. Export and review the real public example
bundles only after those epochs exist. Review the complete OpenSolvency changes for
promotion into main, preserve the atomic commit history, publish through Pages and
test the final hosted URL. See [the release runbook](public-demo-release.md).
