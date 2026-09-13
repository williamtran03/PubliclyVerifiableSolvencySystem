use poseidon::poseidon2::Poseidon2;

global NUM_ASSETS: u32 = 3; // 0: BTC, 1: ETH, 2: USDC

// A plain Merkle tree: the circuit computes the per-asset totals from the leaves
// itself, so node sums would add nothing but a leak of every sibling's balance.
fn combine_level<let M: u32>(hashes: [Field; M]) -> [Field; M / 2] {
    let mut next: [Field; M / 2] = [0; M / 2];
    for i in 0..(M / 2) {
        next[i] = Poseidon2::hash([hashes[2 * i], hashes[2 * i + 1]], 2);
    }
    next
}

// reserve_floors: per asset, in whole units. The registry checks its approved reserves
// hold at least this much, so liabilities never have to be published: only that they
// stay under the floor. Checked per asset, so a surplus in one cannot hide a shortfall
// in another, and no price enters the proof.
//
// context: keccak(chain id, registry, epoch id) mod p, supplied by the registry. Hashed
// into the published root, so a proof is only valid for one epoch of one deployment.
fn main(
    usernames: [Field; 8],
    salts: [Field; 8],
    asset_ids: [u32; 8],
    amounts: [u64; 8],
    reserve_floors: pub [u64; NUM_ASSETS],
    context: pub Field,
) -> pub Field {
    let mut leaves: [Field; 8] = [0; 8];
    let mut liabilities: [u64; NUM_ASSETS] = [0; NUM_ASSETS];

    for i in 0..8 {
        assert(asset_ids[i] < NUM_ASSETS); // rejects an asset the registry does not track
        leaves[i] =
            Poseidon2::hash([usernames[i], salts[i], asset_ids[i] as Field, amounts[i] as Field], 4);
        liabilities[asset_ids[i]] += amounts[i]; // u64 addition is checked, so a wrap is unsatisfiable
    }

    for a in 0..NUM_ASSETS {
        assert(liabilities[a] <= reserve_floors[a]);
    }

    let level2 = combine_level(leaves); // 8 leaves -> 4 nodes
    let level1 = combine_level(level2); // 4 nodes -> 2 nodes
    let level0 = combine_level(level1); // 2 nodes -> 1 root

    Poseidon2::hash([level0[0], context], 2)
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
global TEST_ASSETS: [u32; 8] = [0, 1, 2, 0, 0, 0, 0, 0];
global TEST_AMOUNTS: [u64; 8] = [2, 10, 5000, 0, 0, 0, 0, 0]; // 2 BTC, 10 ETH, 5000 USDC

#[test]
fn test_accepts_floors_that_cover_every_asset() {
    let _ = main(TEST_USERNAMES, TEST_SALTS, TEST_ASSETS, TEST_AMOUNTS, [2, 10, 5000], 7);
}

// 3 BTC + 2 ETH + 1000 USDC is worth more than the liabilities in USD at any sane
// price, but ETH and USDC are short. The USD-aggregate check used to accept this.
#[test(should_fail)]
fn test_rejects_a_shortfall_in_one_asset_hidden_by_a_surplus_in_another() {
    let _ = main(TEST_USERNAMES, TEST_SALTS, TEST_ASSETS, TEST_AMOUNTS, [3, 2, 1000], 7);
}

#[test(should_fail)]
fn test_rejects_an_asset_outside_the_registry() {
    let asset_ids: [u32; 8] = [3, 0, 0, 0, 0, 0, 0, 0];
    let amounts: [u64; 8] = [1, 0, 0, 0, 0, 0, 0, 0];
    let _ = main([0; 8], [0; 8], asset_ids, amounts, [10, 10, 10], 7);
}

#[test]
fn test_root_is_bound_to_the_context() {
    let root_a = main(TEST_USERNAMES, TEST_SALTS, TEST_ASSETS, TEST_AMOUNTS, [2, 10, 5000], 7);
    let root_b = main(TEST_USERNAMES, TEST_SALTS, TEST_ASSETS, TEST_AMOUNTS, [2, 10, 5000], 8);
    assert(root_a != root_b);
}

#[test]
fn test_root_does_not_depend_on_the_floors() {
    // Customers check inclusion against the root without knowing the floors.
    let root_a = main(TEST_USERNAMES, TEST_SALTS, TEST_ASSETS, TEST_AMOUNTS, [2, 10, 5000], 7);
    let root_b = main(TEST_USERNAMES, TEST_SALTS, TEST_ASSETS, TEST_AMOUNTS, [9, 99, 9999], 7);
    assert(root_a == root_b);
}
