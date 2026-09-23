# Open decisions for Sepolia and publication

As of 23 September 2026. These questions are intended for team discussion.
Record answers without private keys, seed phrases or RPC credentials.

## Before the public Sepolia run

| Question | Why the answer is needed | Answer / Owner |
| --- | --- | --- |
| Who will carry out the run, and on which machine? | The pinned proving tools, Foundry and Node must be available on that machine. | Open |
| Who controls the five role keys and keeps their backups? Are the existing local keys intended for this test? | The same keys are needed for deployment, the operations drill and recovery after an interruption. | Open |
| Who will fund the company and auditor, and what is the Sepolia ETH budget? | Deployment, epochs and role transfers require test ETH. The documentation suggests about 0.1 ETH for the company and 0.01 ETH for the auditor as a starting point. | Open |
| Which RPC provider will be used for the run, and which public endpoint will the frontend use? | Transaction submission, historical reads and usage limits need to be checked. A private API key must not be included in the website build. | Open |
| Should all three approaches be demonstrated publicly? | This determines the deployment scope, proving requirements and operating costs. Proposed scope: all three, as tested on the fork. | Open |
| Are seven days of validity and a minimum interval of 60 seconds between epochs appropriate? | These values are fixed at deployment. Changing them requires a new deployment. | Open |
| May the operations drill temporarily transfer roles to the reserve wallets and remove and restore reserves on this deployment? | The drill is intended for a test-token deployment. Nobody should publish epochs concurrently during the drill. | Open |

## Before publication

| Question | Why the answer is needed | Answer / Owner |
| --- | --- | --- |
| Who is the website for: a public demo, a course or assessment, or a closed test? | This determines access, presentation and required features. | Open |
| Which hosting provider and team account should be used? | The deployment target, access and configuration depend on this decision. GitHub Pages, Vercel and Netlify are still undecided options. | Open |
| Which domain or URL subpath should be used? Who manages DNS? | This is needed for URLs and the final browser tests. | Open |
| Should every push publish the website, or should publication require manual approval? Which branch is the source? | This determines the publication workflow and prevents unintended releases. | Open |
| Who reviews and approves the public deployment data? | Only a complete record with no pending transaction should be committed and included in the website. | Open |

## Private bundles and ongoing operations

| Question | Why the answer is needed | Answer / Owner |
| --- | --- | --- |
| Is manual, private delivery of demo bundles sufficient, or is a login with protected downloads required? | Static hosting alone does not provide access control for customer bundles. A backend would be additional scope. | Open |
| Where will bundles and backups be stored, who can access them, and how long will they be retained? | Customers cannot verify their inclusion without a bundle. These files must not be stored in the public website directory. | Open |
| Who publishes subsequent epochs and monitors expired snapshots? Should this be manual or automated? | Once the validity period expires, the website marks the snapshot as stale. | Open |
| Who handles troubleshooting, RPC outages and recovery after interrupted runs? | Only one process may write to a deployment at a time. Replacement transactions require investigation when their status is unclear. | Open |
| What are the acceptance criteria: all three approaches, successful and intentionally failing customer verification, the operations drill, and the website at its target URL? | This makes completion verifiable. These are the proposed minimum requirements. | Open |
| Is the documented remaining gas discrepancy below 0.5% acceptable, or is a complete trace breakdown required? | The large historical difference has been explained. The remaining analysis is not a prerequisite for deployment or hosting. | Open |

## Work that can proceed independently

Transaction recovery, local tests and the local website build can be completed
without a hosting decision. This document does not imply that a public testnet run
or publication has already taken place.
