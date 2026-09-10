use poseidon::poseidon2::Poseidon2;

global NUM_ASSETS: u32 = 3; // 0: BTC, 1: ETH, 2: USDC

fn combine_level<let M: u32>(hashes: [Field; M], sums: [Field; M]) -> ([Field; M / 2], [Field; M / 2]) {
    let mut next_hashes: [Field; M / 2] = [0; M / 2];
    let mut next_sums: [Field; M / 2] = [0; M / 2];

    for i in 0..(M / 2) {
        next_hashes[i] = Poseidon2::hash([hashes[2 * i], sums[2 * i], hashes[2 * i + 1], sums[2 * i + 1]], 4);
        next_sums[i] = sums[2 * i] + sums[2 * i + 1];
    }

    (next_hashes, next_sums)
}

fn price_of(asset_id: u32, prices: [u64; NUM_ASSETS]) -> Field {
    let mut selected: Field = 0;
    let mut matched: Field = 0;

    for k in 0..NUM_ASSETS {
        let is_match = (asset_id == k) as Field;
        selected = selected + is_match * prices[k] as Field;
        matched = matched + is_match;
    }

    assert(matched == 1); // rejects an asset_id outside the published price table
    selected
}

fn main(
    usernames: [Field; 8],
    salts: [Field; 8],
    asset_ids: [u32; 8],
    amounts: [u64; 8],
    prices: pub [u64; NUM_ASSETS],
) -> pub (Field, Field) {
    let mut leaf_hashes: [Field; 8] = [0; 8];
    let mut leaf_sums: [Field; 8] = [0; 8];

    for i in 0..8 {
        leaf_hashes[i] =
            Poseidon2::hash([usernames[i], salts[i], asset_ids[i] as Field, amounts[i] as Field], 4);
        leaf_sums[i] = amounts[i] as Field * price_of(asset_ids[i], prices);
    }

    let (hashes2, sums2) = combine_level(leaf_hashes, leaf_sums); // 8 leaves -> 4 nodes
    let (hashes1, sums1) = combine_level(hashes2, sums2); // 4 nodes -> 2 nodes
    let (hashes0, sums0) = combine_level(hashes1, sums1); // 2 nodes -> 1 root

    (hashes0[0], sums0[0])
}

#[test]
fn test_total_usd_uses_the_public_price_table() {
    let usernames: [Field; 8] = [
        30781005513205101228431847987, // "customer-123"
        30781005513205101228432045366, // "customer-456"
        30781005513205101228432242745, // "customer-789"
        0, 0, 0, 0, 0, // padding
    ];
    let salts: [Field; 8] = [
        84731920475619283746152039485761029384,
        19283746501928374650192837465019283746,
        55018273645019283746501928374650192837,
        0, 0, 0, 0, 0,
    ];
    let asset_ids: [u32; 8] = [0, 1, 2, 0, 0, 0, 0, 0];
    let amounts: [u64; 8] = [2, 10, 5000, 0, 0, 0, 0, 0];
    let prices: [u64; 3] = [60000, 3000, 1];

    let (_root_hash, total_usd) = main(usernames, salts, asset_ids, amounts, prices);

    assert(total_usd == 155000); // 2*60000 + 10*3000 + 5000*1
}

#[test]
fn test_root_is_bound_to_the_price_table() {
    let usernames: [Field; 8] = [1, 2, 3, 0, 0, 0, 0, 0];
    let salts: [Field; 8] = [4, 5, 6, 0, 0, 0, 0, 0];
    let asset_ids: [u32; 8] = [0, 1, 2, 0, 0, 0, 0, 0];
    let amounts: [u64; 8] = [2, 10, 5000, 0, 0, 0, 0, 0];

    let (root_a, total_a) = main(usernames, salts, asset_ids, amounts, [60000, 3000, 1]);
    let (root_b, total_b) = main(usernames, salts, asset_ids, amounts, [30000, 3000, 1]);

    assert(total_a == 155000);
    assert(total_b == 95000);
    assert(root_a != root_b); // sums are hashed into every node, so the root commits to the prices too
}

#[test(should_fail)]
fn test_asset_id_outside_the_price_table_is_rejected() {
    let asset_ids: [u32; 8] = [3, 0, 0, 0, 0, 0, 0, 0];
    let amounts: [u64; 8] = [1, 0, 0, 0, 0, 0, 0, 0];

    let _ = main([0; 8], [0; 8], asset_ids, amounts, [60000, 3000, 1]);
}
