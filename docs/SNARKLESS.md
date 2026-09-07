# SNARKless branch: Summa V2-inspired polynomial approach

This is an independent TypeScript/Solidity research prototype, not Summa's
production implementation or a claim of equivalent security/performance. It
uses no Merkle tree and no general-purpose SNARK circuit. The fixed demo has
four slots and 16-bit balances in wei. It is intentionally small enough to
inspect; these parameters are not suitable for a commercial custodian.

## Sum and membership

Work in the BN254 scalar field F_r. For a primitive fourth root of unity w,
interpolate degree-at-most-3 polynomials B and H so B(w^i)=balance_i and
H(w^i)=opaqueID_i. KZG commitments bind both columns. A customer checks both
openings at the SAME index against the two public commitments, stopping the
reuse of a same-balance proof for a different ID. IDs should be high-entropy
private account tokens; numeric IDs in the fixture are examples only.

The sum identity is `total = 4 * B(0) mod r`. The public total is additionally
bounded below 4*2^16, and every balance is range-proven, so this is an integer
sum without modular wraparound. The opening at zero proves the total. Ordinary
KZG openings without degree/range checks would not prove financial solvency.

## Range and degree extension

For each bit j, interpolate its four values and mask the polynomial with
`F_j = bitPolynomial_j + (X^4-1)*(a_j+b_j*X)`, using independent random scalars.
Unmasked bit commitments are unsafe: only 16 bit vectors exist at this capacity.
Commit quotient polynomials `Q_j = F_j*(F_j-1)/(X^4-1)` and the relation
`T = (sum 2^j F_j - B)/(X^4-1)`.

Before choosing the Fiat-Shamir challenge z, commit all these polynomials and
their degree witnesses. The transcript includes the version tag, vault, chain,
epoch, captured assets and total. KZG openings at z verify each boolean identity.
The weighted-bits relation is checked directly with a pairing of commitments:
`e(sum 2^j C_Fj - C_B + C_T, G2) = e(C_T, tau^4 G2)`.
Thus neither B(z) nor H(z) is disclosed to the public. Only masked bit/quotient
evaluations are published, in addition to B(0). Reserved opening slots are zero.

The SRS supports maximum degree D=8. Every committed polynomial has a shifted
degree witness and a pairing check: B/H <=3, F <=5, Q <=6, T <=1.
Without these checks, adding X^4 terms could invalidate the sum argument.
The implementation is a custom direct polynomial protocol and needs specialist
cryptographic review. It has no audited end-to-end zero-knowledge guarantee.

## Setup and privacy limits

KZG requires a trusted SRS. `demo-setup` generates a random SINGLE-PARTY LOCAL
DEMO SRS and never serializes tau. This is not a multiparty ceremony: its creator
could retain tau and forge proofs. Real use must replace this with reviewed,
ceremony-derived, consistently generated G1/G2 powers. The verifier pins its G2
parameters at deployment; users must pin the entire SRS and verifier deployment.
No demo-generated parameters are presented as production trust anchors.

The public sees two dataset commitments, total liabilities, assets, capacity,
snapshot context, masked range witnesses and proof outcome. B and H use ordinary
deterministic KZG; they are not hiding commitments. A sufficiently small or
predictable dataset permits dictionary attacks. Customer openings reveal that
customer's index, opaque ID and balance to the recipient. Enough colluding
customers can interpolate the degree-3 polynomial; published totals also allow
deduction of a final unknown balance. Masked bit columns reduce direct leakage
but do not justify calling this entire construction zero knowledge.

## Performance and limitations

Interpolation here is a simple O(n^2) inverse DFT, not an FFT implementation or
Summa's amortized KZG. The range verifier performs many pairings and is more
expensive than the ZK branch. No million-customer scalability claim is made.
Accounting/omission limitations and customer verification procedures are in
`docs/CASE5.md`.

Primary references:
- https://hackmd.io/@summa/BkglBWsDp
- https://hackmd.io/@summa/r18MaCK7p
- https://paragraph.com/@privacy-scaling-explorations/retrospective-summa
- https://eips.ethereum.org/EIPS/eip-196
- https://eips.ethereum.org/EIPS/eip-197

The range protocol and explicit degree checks above are additions to the linked
introductory Summa descriptions, not code copied from Summa V2.
