# Limitations

Things this system does not claim, stated plainly so that nobody has to infer
them from silence.

**Solvency at one instant is not solvency tomorrow.** An epoch is a statement
about one block. Everything can change in the next one. Publishing frequently
narrows the window; it never closes it.

**Solvency is not liquidity.** Assets ≥ liabilities says nothing about whether
the custodian can meet withdrawals today. Reserves can be illiquid, locked,
staked with an unbonding period, or concentrated in an asset whose price is a
function of the custodian not selling it.

**Off-chain debts are invisible.** Bank loans, lawsuits, tax liabilities, and
obligations to anyone who is not in `customers.csv` do not appear anywhere in
the model. A custodian can be provably "solvent" here and bankrupt in fact.

**The liability list is self-declared.** The cryptography guarantees that the
published total matches the tree, and that each customer is in the tree. It
cannot guarantee that the tree covers every customer. Only customers who
actually run the check can detect their own omission, and a customer who has
lost access to their account cannot check anything.

**Control is not ownership.** A signature from a reserve wallet proves someone
with the key participated. It does not prove the assets are unencumbered, not
borrowed, and not simultaneously claimed by another custodian.

**Native ETH only.** No ERC-20s, no other chains, no off-chain custody. Adding
tokens means an oracle for prices and a decision about which valuation to use at
snapshot time — both of which are attack surface.

**The custodian chooses the moment.** Nothing forces a schedule, so snapshots
land when the balance sheet looks best. Randomised or third-party-triggered
epochs would fix this; they are not implemented.

**Privacy is partial and is quantified elsewhere.** See
[privacy.md](privacy.md): every customer learns one other customer's exact
balance, and stable leaf ordering turns that into a time series across epochs.

**The trust that remains.** After all of this, a verifier still trusts: that the
customer list is complete, that the reserve wallets are unencumbered, and that
the custodian keeps publishing. What the system removes is the need to trust the
*arithmetic* — and that is a smaller claim than "proof of solvency" usually
sounds like.
