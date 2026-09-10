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

// total_assets is public and supplied by the registry from its own on-chain
// reserves, so the prover cannot choose it. total_liabilities stays private:
// the solvency relation is proved here rather than published and compared.
fn main(
    usernames: [Field; 8],
    salts: [Field; 8],
    balances: [u64; 8],
    total_assets: pub u64,
) -> pub Field {
    let mut leaf_hashes: [Field; 8] = [0; 8];
    let mut leaf_sums: [Field; 8] = [0; 8];
    let mut total_liabilities: u64 = 0;

    for i in 0..8 {
        leaf_sums[i] = balances[i] as Field;
        leaf_hashes[i] = Poseidon2::hash([usernames[i], salts[i], leaf_sums[i]], 3);
        total_liabilities += balances[i]; // u64 addition is checked, so a wrap is unsatisfiable
    }

    assert(total_liabilities <= total_assets);

    let (hashes2, sums2) = combine_level(leaf_hashes, leaf_sums); // 8 leaves -> 4 nodes
    let (hashes1, sums1) = combine_level(hashes2, sums2); // 4 nodes -> 2 nodes
    let (hashes0, _) = combine_level(hashes1, sums1); // 2 nodes -> 1 root

    hashes0[0]
}

global TEST_USERNAMES: [Field; 8] = [
    30781005513205101228431847987, // "customer-123"
    30781005513205101228432045366, // "customer-456"
    30781005513205101228432242745, // "customer-789"
    0, 0, 0, 0, 0, // padding
];
global TEST_SALTS: [Field; 8] = [
    84731920475619283746152039485761029384,
    19283746501928374650192837465019283746,
    55018273645019283746501928374650192837,
    0, 0, 0, 0, 0,
];
global TEST_BALANCES: [u64; 8] = [12550, 5000, 32000, 0, 0, 0, 0, 0]; // 49550 total

#[test]
fn test_accepts_reserves_that_cover_liabilities() {
    let _ = main(TEST_USERNAMES, TEST_SALTS, TEST_BALANCES, 50000);
}

#[test]
fn test_accepts_reserves_exactly_equal_to_liabilities() {
    let _ = main(TEST_USERNAMES, TEST_SALTS, TEST_BALANCES, 49550);
}

#[test(should_fail)]
fn test_rejects_reserves_below_liabilities() {
    let _ = main(TEST_USERNAMES, TEST_SALTS, TEST_BALANCES, 49549);
}

#[test]
fn test_root_does_not_depend_on_the_assets_figure() {
    // The root commits to the tree only; solvency is a constraint, not an output.
    assert(
        main(TEST_USERNAMES, TEST_SALTS, TEST_BALANCES, 50000)
            == main(TEST_USERNAMES, TEST_SALTS, TEST_BALANCES, 60000),
    );
}
