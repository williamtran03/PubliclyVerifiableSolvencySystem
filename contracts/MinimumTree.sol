// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library MinimumTree {
    bytes32 internal constant IDENTITY = keccak256("solvency.minimum.v1.identity");
    bytes32 internal constant BALANCE = keccak256("solvency.minimum.v1.balance");
    bytes32 internal constant PAIR = keccak256("solvency.minimum.v1.pair");
    bytes32 internal constant NODE = keccak256("solvency.minimum.v1.node");
    bytes32 internal constant PADDING = keccak256("solvency.minimum.v1.padding");
    error InvalidLedger();

    function identity(
        bytes32 snapshot,
        string memory customer,
        string memory dob,
        uint256 index,
        bytes32 salt,
        bytes32 nonce
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(IDENTITY, snapshot, customer, dob, index, salt, nonce));
    }

    function balance(bytes32 snapshot, uint256 position, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(BALANCE, snapshot, position, amount));
    }

    function pair(bytes32 id, bytes32 bal, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(PAIR, id, uint256(0), bal, amount));
    }

    function parent(bytes32 left, uint256 leftSum, bytes32 right, uint256 rightSum) internal pure returns (bytes32) {
        return keccak256(abi.encode(NODE, left, leftSum, right, rightSum));
    }

    function root(bytes32 snapshot, uint256 capacity, bytes32[] memory identities, uint256[] memory amounts)
        internal
        pure
        returns (bytes32, uint256)
    {
        if (
            capacity < 2 || capacity > 256 || capacity & (capacity - 1) != 0 || identities.length != amounts.length
                || identities.length > capacity
        ) revert InvalidLedger();
        bytes32[] memory hashes = new bytes32[](capacity);
        uint256[] memory sums = new uint256[](capacity);
        for (uint256 i; i < capacity; i++) {
            bytes32 id;
            if (i < identities.length) {
                if (amounts[i] == 0) revert InvalidLedger();
                for (uint256 j; j < i; j++) {
                    if (identities[i] == identities[j]) revert InvalidLedger();
                }
                id = identities[i];
                sums[i] = amounts[i];
            } else {
                id = keccak256(abi.encode(PADDING, snapshot, i));
            }
            hashes[i] = pair(id, balance(snapshot, i, sums[i]), sums[i]);
        }
        while (capacity > 1) {
            for (uint256 i; i < capacity; i += 2) {
                hashes[i / 2] = parent(hashes[i], sums[i], hashes[i + 1], sums[i + 1]);
                sums[i / 2] = sums[i] + sums[i + 1];
            }
            capacity /= 2;
        }
        return (hashes[0], sums[0]);
    }
}
