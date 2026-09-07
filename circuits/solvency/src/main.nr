use std::hash::poseidon2_permutation;

// Length-separated Poseidon2 sponge, rate 3, capacity 1.
fn hash<let N: u32>(input: [Field; N]) -> Field {
    let mut state = [0, 0, 0, (N as Field) * 18446744073709551616];
    for i in 0..N/3 {
        for j in 0..3 { state[j] += input[3*i+j]; }
        state = poseidon2_permutation(state);
    }
    for j in 0..N%3 { state[j] += input[3*(N/3)+j]; }
    poseidon2_permutation(state)[0]
}

// Four private, salted customer records. Amounts are integer wei.
// The statement is bound to a registry, chain and immutable snapshot number.
fn main(
    root: pub Field, total: pub u128, assets: pub u128,
    epoch: pub Field, chain: pub Field, registry: pub Field,
    ids: [Field; 4], salts: [Field; 4], balances: [u64; 4],
) {
    let mut hashes = [0; 4];
    let mut sums: [u128; 4] = [0; 4];
    for i in 0..4 {
        assert(ids[i] != 0);
        assert(salts[i] != 0);
        for j in 0..4 { if i != j { assert(ids[i] != ids[j]); } }
        hashes[i] = hash([1, epoch, chain, registry, ids[i], salts[i], balances[i] as Field]);
        sums[i] = balances[i] as u128;
    }
    for i in 0..2 {
        hashes[i] = hash([2, hashes[2*i], sums[2*i] as Field, hashes[2*i+1], sums[2*i+1] as Field]);
        sums[i] = sums[2*i] + sums[2*i+1];
    }
    assert(root == hash([2, hashes[0], sums[0] as Field, hashes[1], sums[1] as Field]));
    assert(total == sums[0] + sums[1]);
    assert(total <= assets);
}
