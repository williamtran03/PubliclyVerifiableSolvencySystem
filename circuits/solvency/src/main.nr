//! Proves that a published Merkle-sum root was built from a well-formed
//! customer list, without revealing any customer's balance.
//!
//! An inclusion proof already lets one customer check their own leaf. What it
//! cannot show is that the *rest* of the tree is honest: nothing in a hash path
//! rules out a leaf carrying a negative balance that cancels a real one, or the
//! same customer appearing twice. Both are invisible to every individual
//! verifier and both let a custodian publish a total smaller than what it owes.
//!
//! This circuit closes exactly that gap. Public: the root hash and the total.
//! Private: every id and every balance.

use poseidon::poseidon::bn254::{hash_2, hash_4};
use std::field::bn254::assert_gt;

/// Number of leaves, padding included. A circuit is fixed-size, so changing the
/// customer count means recompiling and republishing the verification key —
/// see docs/zk.md on why that is a design constraint, not an oversight.
global LEAVES: u32 = 8;
global LEVEL_1: u32 = LEAVES / 2;
global LEVEL_2: u32 = LEVEL_1 / 2;

fn main(
    ids: [Field; LEAVES],
    balances: [u128; LEAVES],
    root_hash: pub Field,
    total_liabilities: pub Field,
) {
    // 1. Every leaf id is strictly greater than the one before it.
    //
    //    Strictly increasing implies pairwise distinct, which is the property
    //    that matters: without it the prover could give two customers the same
    //    leaf, so that only one of them is really committed to while both see a
    //    passing inclusion check. Checking adjacent pairs costs LEAVES-1
    //    comparisons; checking distinctness directly would cost LEAVES^2/2.
    for i in 1..LEAVES {
        assert_gt(ids[i], ids[i - 1]);
    }

    // 2. Leaves.
    //
    //    `balances` is typed u128, so Noir range-constrains each one to 128 bits
    //    on the way in. That is the non-negativity guarantee: a "negative"
    //    balance in a prime field is an enormous positive number, and an
    //    enormous number is not a u128.
    let mut hashes: [Field; LEAVES] = [0; LEAVES];
    let mut sums: [u128; LEAVES] = [0; LEAVES];
    for i in 0..LEAVES {
        hashes[i] = hash_2([ids[i], balances[i] as Field]);
        sums[i] = balances[i];
    }

    // 3. Fold the tree. u128 addition is checked, so a total that would wrap is
    //    an unsatisfiable constraint rather than a silently wrong root.
    let mut level_1_hashes: [Field; LEVEL_1] = [0; LEVEL_1];
    let mut level_1_sums: [u128; LEVEL_1] = [0; LEVEL_1];
    for i in 0..LEVEL_1 {
        let (h, s) = combine(hashes[2 * i], sums[2 * i], hashes[2 * i + 1], sums[2 * i + 1]);
        level_1_hashes[i] = h;
        level_1_sums[i] = s;
    }

    let mut level_2_hashes: [Field; LEVEL_2] = [0; LEVEL_2];
    let mut level_2_sums: [u128; LEVEL_2] = [0; LEVEL_2];
    for i in 0..LEVEL_2 {
        let (h, s) = combine(
            level_1_hashes[2 * i],
            level_1_sums[2 * i],
            level_1_hashes[2 * i + 1],
            level_1_sums[2 * i + 1],
        );
        level_2_hashes[i] = h;
        level_2_sums[i] = s;
    }

    let (root, total) = combine(
        level_2_hashes[0],
        level_2_sums[0],
        level_2_hashes[1],
        level_2_sums[1],
    );

    // 4. The root the custodian published is this root, and the total it
    //    published is the one this tree actually adds up to.
    assert(root == root_hash, "root hash does not match the published epoch");
    assert(total as Field == total_liabilities, "total does not match the published epoch");
}

fn combine(left_hash: Field, left_sum: u128, right_hash: Field, right_sum: u128) -> (Field, u128) {
    (
        hash_4([left_hash, left_sum as Field, right_hash, right_sum as Field]),
        left_sum + right_sum,
    )
}

mod tests {
    use super::{combine, LEAVES};
    use poseidon::poseidon::bn254::hash_2;

    /// Builds the same tree the circuit does, outside the constraint system, so
    /// the tests can state a root without hardcoding one.
    fn root_of(ids: [Field; LEAVES], balances: [u128; LEAVES]) -> (Field, u128) {
        let mut hashes: [Field; LEAVES] = [0; LEAVES];
        let mut sums: [u128; LEAVES] = [0; LEAVES];
        for i in 0..LEAVES {
            hashes[i] = hash_2([ids[i], balances[i] as Field]);
            sums[i] = balances[i];
        }

        let mut width = LEAVES;
        for _ in 0..3 {
            let half = width / 2;
            for i in 0..LEAVES / 2 {
                if i < half {
                    let (h, s) = combine(hashes[2 * i], sums[2 * i], hashes[2 * i + 1], sums[2 * i + 1]);
                    hashes[i] = h;
                    sums[i] = s;
                }
            }
            width = half;
        }
        (hashes[0], sums[0])
    }

    global IDS: [Field; LEAVES] = [11, 22, 33, 44, 55, 66, 77, 88];
    global BALANCES: [u128; LEAVES] = [5, 0, 12, 3, 0, 40, 1, 9];

    #[test]
    fn accepts_a_well_formed_tree() {
        let (root, total) = root_of(IDS, BALANCES);
        assert(total == 70);
        super::main(IDS, BALANCES, root, total as Field);
    }

    #[test(should_fail_with = "root hash does not match the published epoch")]
    fn rejects_a_root_from_a_different_tree() {
        let (root, total) = root_of(IDS, BALANCES);
        super::main(IDS, BALANCES, root + 1, total as Field);
    }

    #[test(should_fail_with = "total does not match the published epoch")]
    fn rejects_a_total_smaller_than_the_tree() {
        let (root, total) = root_of(IDS, BALANCES);
        super::main(IDS, BALANCES, root, total as Field - 1);
    }

    #[test(should_fail)]
    fn rejects_a_repeated_leaf_id() {
        let mut ids = IDS;
        ids[3] = ids[2];
        let (root, total) = root_of(ids, BALANCES);
        super::main(ids, BALANCES, root, total as Field);
    }

    #[test(should_fail)]
    fn rejects_unsorted_leaves() {
        let mut ids = IDS;
        let swap = ids[5];
        ids[5] = ids[4];
        ids[4] = swap;
        let (root, total) = root_of(ids, BALANCES);
        super::main(ids, BALANCES, root, total as Field);
    }
}
