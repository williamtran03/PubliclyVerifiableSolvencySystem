# Remaining release inputs

The tool installation, fresh-proof integration and verifier reproduction are
complete. Deployment and public hosting remain pending the inputs below. Answers
must not contain private keys, seed phrases, vault recovery codes or RPC credentials.

| Input | Decision needed | Suggested starting point |
| --- | --- | --- |
| Operator and machine | Who runs deployment and subsequent epochs, and on which machine? | One named teammate; use the validated toolchain on that machine. Tools installed in the current workspace are not automatically installed on another machine. |
| Recovery and review | Who is the recovery operator, and who reviews the public deployment record? | Name both roles. If one person covers several roles, document that limitation. |
| Validity and grading | What are the grading dates, and should snapshots be valid for seven or 30 days? | Seven days if someone publishes at least every five days; otherwise explicitly choose 30 days before deployment. Keep the 60-second minimum interval. |
| Existing wallets | Were the five locally configured keys created exclusively for this demo, or should fresh wallets be created? | Confirm their origin before using them. No existing key has been changed or copied. |
| Private backup | Which encrypted vault or storage location, who has access, and when should keys and customer bundles be deleted? | Limit access to the operator and recovery operator. Decide the retention period using the grading end date. |
| Operator RPC | Keep the currently configured public PublicNode endpoint for this demo, or provide a local Alchemy/Infura endpoint? | PublicNode is already configured and answered a Sepolia chain/balance check. A keyed endpoint may offer more predictable quotas; keep its credentials local. The website can retain its public preset. |

## External setup still needed

- **Funding:** all five configured wallets had zero Sepolia ETH at the read-only
  check on 24 September 2026. After confirming which wallets to use, obtain about
  0.1–0.2 Sepolia ETH for company and 0.01 for auditor, then check current fees.
  Normal reserve re-proofs do not need separate faucet funding; the company relays
  them and funds reserve-wallet transactions during the drill. Faucet login or
  anti-abuse challenges must be completed by the account holder when required.
- **Pages:** the repository is private. The owner must check whether the account
  plan permits Pages for private repositories and select GitHub Actions in
  Settings → Pages. Report whether that works or requests an upgrade. The connected
  GitHub app does not expose Pages administration, and this machine has no
  authenticated shell GitHub session. Do not change repository visibility as a
  workaround without an explicit team decision.

## Work after the answers

Record the selected owners and settings, verify the backups and funding, then run
the public deployment, epochs and drill. Export and review the real public example
bundles only after those epochs exist. Review the complete OpenSolvency changes for
promotion into main, preserve the atomic commit history, publish through Pages and
test the final hosted URL. See [the release runbook](public-demo-release.md).
