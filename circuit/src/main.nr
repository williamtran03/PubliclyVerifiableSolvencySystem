use poseidon::poseidon2::Poseidon2;

fn combine_level<let M: u32>(hashes: [Field; M], sums: [Field; M]) -> ([Field; M / 2], [Field; M / 2]) {
    let mut next_hashes: [Field; M / 2] = [0; M / 2];
    let mut next_sums: [Field; M / 2] = [0; M / 2];

    for i in 0..(M / 2) {
        next_hashes[i] = Poseidon2::hash([hashes[2 * i], sums[2 * i], hashes[2 * i + 1], sums[2 * i + 1]], 4);
        next_sums[i] = sums[2 * i] + sums[2 * i + 1];
    }

    (next_hashes, next_sums)
}

fn main(usernames: [Field; 8], balances: [u64; 8]) -> pub (Field, Field) {
    // u64 as non-negativ guarantee
    let mut leaf_hashes: [Field; 8] = [0; 8];
    let mut leaf_sums: [Field; 8] = [0; 8];

    for i in 0..8 {
        leaf_sums[i] = balances[i] as Field;
        leaf_hashes[i] = Poseidon2::hash([usernames[i], leaf_sums[i]], 2);
    }

    let (hashes2, sums2) = combine_level(leaf_hashes, leaf_sums);   // 8 leaves -> 4 nodes
    let (hashes1, sums1) = combine_level(hashes2, sums2);           // 4 nodes -> 2 nodes
    let (hashes0, sums0) = combine_level(hashes1, sums1);           // 2 nodes -> 1 root

    (hashes0[0], sums0[0])
}

#[test]
fn test_root_sum_matches_expected_total() {
    let usernames: [Field; 8] = [
        30781005513205101228431847987, // "customer-123"
        30781005513205101228432045366, // "customer-456"
        30781005513205101228432242745, // "customer-789"
        0, 0, 0, 0, 0, // padding
    ];
    let balances: [u64; 8] = [12550, 5000, 32000, 0, 0, 0, 0, 0];

    let (_root_hash, root_sum) = main(usernames, balances);

    assert(root_sum == 49550);
}
