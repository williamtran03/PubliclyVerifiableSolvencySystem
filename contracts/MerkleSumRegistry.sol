// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Publishes pseudonymous partial balances, not a zero-knowledge proof.
/// @dev Reuses the baseline reserve model. Control/eligibility of reserves remains unproven.
contract MerkleSumRegistry {
    struct Epoch {
        uint256 rootHash;
        uint256 totalLiabilities;
        uint64 timestamp;
    }
    address public immutable owner;
    address[] public reserves;
    Epoch public currentEpoch;
    uint256 public epochCount;
    event EpochSubmitted(uint256 indexed epochId, uint256 rootHash, uint256 totalLiabilities, uint64 timestamp);
    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function totalReserves() public view returns (uint256 total) {
        for (uint256 i; i < reserves.length; ++i) {
            total += reserves[i].balance;
        }
    }
    uint256 public constant MAX_ENTRIES = 256;
    bytes32 public currentSnapshotId;
    mapping(bytes32 => bool) public usedSnapshots;
    event LedgerSubmitted(bytes32 indexed snapshotId, uint256 indexed epochId, uint256 assets);

    constructor(address[] memory reserveAddresses) {
        owner = msg.sender;
        reserves = reserveAddresses;
        for (uint256 i; i < reserveAddresses.length; ++i) {
            require(reserveAddresses[i] != address(0), "zero reserve");
            for (uint256 j; j < i; ++j) {
                require(reserveAddresses[i] != reserveAddresses[j], "duplicate reserve");
            }
        }
    }

    // Explicitly reject the legacy unverified submission route.
    function submitEpoch(uint256, uint256) external pure {
        revert("use submitLedger");
    }

    function submitLedger(bytes32 snapshotId, uint256[] calldata identities, uint256[] calldata amounts)
        external
        onlyOwner
    {
        require(snapshotId != bytes32(0) && !usedSnapshots[snapshotId], "invalid snapshot");
        (uint256 rootHash, uint256 liabilities) = computeRoot(identities, amounts);
        uint256 assets = totalReserves();
        require(assets >= liabilities, "insolvent");
        usedSnapshots[snapshotId] = true;
        currentSnapshotId = snapshotId;
        currentEpoch = Epoch(rootHash, liabilities, uint64(block.timestamp));
        emit EpochSubmitted(epochCount, rootHash, liabilities, uint64(block.timestamp));
        emit LedgerSubmitted(snapshotId, epochCount, assets);
        epochCount++;
    }

    /// @dev Same leaf/parent encoding and zero padding as prover/merkleSumTree.ts.
    function computeRoot(uint256[] calldata identities, uint256[] calldata amounts)
        public
        pure
        returns (uint256 rootHash, uint256 liabilities)
    {
        uint256 n = identities.length;
        require(n != 0 && n <= MAX_ENTRIES && n == amounts.length, "invalid length");
        uint256 size = 2;
        while (size < n) size *= 2;
        uint256[] memory hashes = new uint256[](size);
        uint256[] memory sums = new uint256[](size);
        for (uint256 i; i < size; ++i) {
            uint256 id = i < n ? identities[i] : 0;
            uint256 amount = i < n ? amounts[i] : 0;
            hashes[i] = uint256(keccak256(abi.encode(id, amount)));
            sums[i] = amount;
        }
        while (size > 1) {
            for (uint256 i; i < size; i += 2) {
                hashes[i / 2] = uint256(keccak256(abi.encode(hashes[i], sums[i], hashes[i + 1], sums[i + 1])));
                sums[i / 2] = sums[i] + sums[i + 1]; // Solidity checked arithmetic
            }
            size /= 2;
        }
        return (hashes[0], sums[0]);
    }
}

