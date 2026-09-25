use poseidon::poseidon2::Poseidon2;

global NUM_ASSETS: u32 = 3;

fn combine_level<let M: u32>(hashes: [Field; M]) -> [Field; M / 2] {
    let mut next: [Field; M / 2] = [0; M / 2];
    for i in 0..(M / 2) {
        next[i] = Poseidon2::hash([hashes[2 * i], hashes[2 * i + 1]], 2);
    }
    next
}

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
        assert(asset_ids[i] < NUM_ASSETS);
        leaves[i] =
            Poseidon2::hash([usernames[i], salts[i], asset_ids[i] as Field, amounts[i] as Field], 4);
        liabilities[asset_ids[i]] += amounts[i];
    }

    for a in 0..NUM_ASSETS {
        assert(liabilities[a] <= reserve_floors[a]);
    }

    let level2 = combine_level(leaves);
    let level1 = combine_level(level2);
    let level0 = combine_level(level1);

    Poseidon2::hash([level0[0], context], 2)
}

global TEST_USERNAMES: [Field; 8] = [
    30781005513205101228431847987,
    30781005513205101228432045366,
    30781005513205101228432242745,
    0, 0, 0, 0, 0,
];
global TEST_SALTS: [Field; 8] = [
    84731920475619283746152039485761029384,
    19283746501928374650192837465019283746,
    55018273645019283746501928374650192837,
    0, 0, 0, 0, 0,
];
global FLOORS: [u64; NUM_ASSETS] = [300_000_000, 1_200_000_000, 600_000_000_000];
global TEST_ASSETS: [u32; 8] = [0, 1, 2, 0, 0, 0, 0, 0];
global TEST_AMOUNTS: [u64; 8] = [250_000_000, 1_025_000_000, 500_075_000_000, 0, 0, 0, 0, 0];

#[test]
fn test_accepts_floors_that_cover_every_asset() {
    let _ = main(
        TEST_USERNAMES,
        TEST_SALTS,
        TEST_ASSETS,
        TEST_AMOUNTS,
        [300_000_000, 1_200_000_000, 600_000_000_000],
        7,
    );
}

#[test(should_fail)]
fn test_rejects_a_shortfall_in_one_asset_hidden_by_a_surplus_in_another() {
    let _ = main(
        TEST_USERNAMES,
        TEST_SALTS,
        TEST_ASSETS,
        TEST_AMOUNTS,
        [300_000_000, 200_000_000, 100_000_000_000],
        7,
    );
}

#[test(should_fail)]
fn test_rejects_an_asset_outside_the_registry() {
    let asset_ids: [u32; 8] = [3, 0, 0, 0, 0, 0, 0, 0];
    let amounts: [u64; 8] = [1, 0, 0, 0, 0, 0, 0, 0];
    let _ = main([0; 8], [0; 8], asset_ids, amounts, [10, 10, 10], 7);
}

#[test]
fn test_root_is_bound_to_the_context() {
    let root_a = main(TEST_USERNAMES, TEST_SALTS, TEST_ASSETS, TEST_AMOUNTS, FLOORS, 7);
    let root_b = main(TEST_USERNAMES, TEST_SALTS, TEST_ASSETS, TEST_AMOUNTS, FLOORS, 8);
    assert(root_a != root_b);
}

#[test]
fn test_root_does_not_depend_on_the_floors() {
    let root_a = main(TEST_USERNAMES, TEST_SALTS, TEST_ASSETS, TEST_AMOUNTS, FLOORS, 7);
    let root_b = main(TEST_USERNAMES, TEST_SALTS, TEST_ASSETS, TEST_AMOUNTS, [900_000_000, 9_900_000_000, 999_900_000_000], 7);
    assert(root_a == root_b);
}
