# Open decisions for Sepolia and publication

Updated 24 September 2026. The implementation choices below describe the public
coursework demo. Named owners and external prerequisites remain open.
Record answers without private keys, seed phrases or RPC credentials.

## Before the public Sepolia run

| Question | Why the answer is needed | Answer / Owner |
| --- | --- | --- |
| Who will carry out the run, and on which machine? | The pinned proving tools, Foundry and Node must be available on that machine. | One designated teammate runs locally with Node 22, Foundry 1.7.1, nargo 1.0.0-beta.26 and bb 6.0.0-nightly.20260902. Operator, backup and machine: team to name. CI has no deployment keys. |
| Who controls the five role keys and keeps their backups? Are the existing local keys intended for this test? | The same keys are needed for deployment, the operations drill and recovery after an interruption. | Five fresh test-only wallets, controlled by the demo operator, with an encrypted backup accessible to a named recovery operator. Existing local keys are not approved by this decision. On-chain roles are separate; independent custody is outside this demo scope. |
| Who will fund the company and auditor, and what is the Sepolia ETH budget? | Deployment, epochs and role transfers require test ETH. The documentation suggests about 0.1 ETH for the company and 0.01 ETH for the auditor as a starting point. | Operator obtains faucet funds: initially 0.1–0.2 Sepolia ETH for company and about 0.01 for auditor, then checks current fees. Reserve re-proofs are relayed by company; the drill funds reserve transactions. Funding remains outstanding. |
| Which RPC provider will be used for the run, and which public endpoint will the frontend use? | Transaction submission, historical reads and usage limits need to be checked. A private API key must not be included in the website build. | Private operator RPC in SEPOLIA_RPC_URL; public PublicNode preset for the browser. Provider/account and a tested fallback remain to be selected. Check CORS, history and limits. Frontend keys are public even with domain restrictions. |
| Should all three approaches be demonstrated publicly? | This determines the deployment scope, proving requirements and operating costs. Proposed scope: all three, as tested on the fork. | All three approaches. |
| Are seven days of validity and a minimum interval of 60 seconds between epochs appropriate? | These values are fixed at deployment. Changing them requires a new deployment. | Keep the existing seven-day validity and 60-second interval as the proposed default; confirm the grading period before deployment. If unattended grading requires 30 days, explicitly select it before deployment. This remains a release prerequisite. |
| May the operations drill temporarily transfer roles to the reserve wallets and remove and restore reserves on this deployment? | The drill is intended for a test-token deployment. Nobody should publish epochs concurrently during the drill. | Include the test-token operations drill, with one writer and the same original keys throughout. Restore roles and reserves and publish fresh epochs afterwards. Execution remains outstanding. |

## Before publication

| Question | Why the answer is needed | Answer / Owner |
| --- | --- | --- |
| Who is the website for: a public demo, a course or assessment, or a closed test? | This determines access, presentation and required features. | Public coursework demo for graders and fictional customers; no real customer data or real backing. |
| Which hosting provider and team account should be used? | The deployment target, access and configuration depend on this decision. GitHub Pages, Vercel and Netlify are still undecided options. | GitHub Pages under the repository owner account. Publish only open-solvency/dist/. Owner must enable Pages with GitHub Actions. |
| Which domain or URL subpath should be used? Who manages DNS? | This is needed for URLs and the final browser tests. | Use the default GitHub Pages project URL, /PubliclyVerifiableSolvencySystem/. No custom DNS. |
| Should every push publish the website, or should publication require manual approval? Which branch is the source? | This determines the publication workflow and prevents unintended releases. | Automatic publication from main after validation of the same commit. Implement on a feature branch from OpenSolvency; review and integrate the complete project into main before release. Manual workflow runs are restricted to main. |
| Who reviews and approves the public deployment data? | Only a complete record with no pending transaction should be committed and included in the website. | Operator prepares the record; a named teammate reviews addresses, chain ID, receipts, roles and epochs. No pending transaction may be committed. Reviewer remains to be named. |

## Private bundles and ongoing operations

| Question | Why the answer is needed | Answer / Owner |
| --- | --- | --- |
| Is manual, private delivery of demo bundles sufficient, or is a login with protected downloads required? | Static hosting alone does not provide access control for customer bundles. A backend would be additional scope. | Manual authenticated private delivery; no login/backend. An explicitly synthetic sample per method may be published after verifying it against the deployed epoch. Never copy the private output directory into the website. |
| Where will bundles and backups be stored, who can access them, and how long will they be retained? | Customers cannot verify their inclusion without a bundle. These files must not be stored in the public website directory. | PRIVATE_OUTPUT outside the repository, with encrypted private backup. Access limited to operator and named recovery operator; recipients receive only their own bundles. Retention period and backup location remain to be named. |
| Who publishes subsequent epochs and monitors expired snapshots? Should this be manual or automated? | Once the validity period expires, the website marks the snapshot as stale. | Operator publishes manually at least every five days during active grading if seven-day validity is selected. Website refreshes reads every 30 seconds while visible; it does not publish epochs or provide unattended monitoring. Sample bundles must be updated with each epoch. |
| Who handles troubleshooting, RPC outages and recovery after interrupted runs? | Only one process may write to a deployment at a time. Replacement transactions require investigation when their status is unclear. | Operator and named backup follow the recovery runbook, one writer at a time. Investigate uncertain receipts/nonces; do not invent replacement transactions or edit checkpoints. |
| What are the acceptance criteria: all three approaches, successful and intentionally failing customer verification, the operations drill, and the website at its target URL? | This makes completion verifiable. These are the proposed minimum requirements. | All three public Sepolia approaches; valid and intentionally invalid customer checks; completed drill and restored roles/reserves; fresh post-drill epochs; website and automatic refresh at the target URL. Record commit and transaction hashes. |
| Is the documented remaining gas discrepancy below 0.5% acceptable, or is a complete trace breakdown required? | The large historical difference has been explained. The remaining analysis is not a prerequisite for deployment or hosting. | Accept the documented residual below 0.5% for the coursework demo; retain measurement conditions and distinguish fork estimates from public receipts. |

## Work that can proceed independently

Transaction recovery, local tests and the local website build can be completed
without a hosting decision. This document does not imply that a public testnet run
or publication has already taken place.
