// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";

/// @notice Publishes pseudonymous partial balances, not a zero-knowledge proof.
/// One merkle-sum tree per asset, rebuilt here from calldata, so every total is computed
/// on-chain and compared with approved reserves of that same asset. Amounts are in each
/// token's base units, so no price or rounding is involved.
contract MerkleSumRegistry is ReserveRegistry {
    uint256 public constant MAX_ENTRIES = 256; // per asset
    uint256 public constant MAX_ASSETS = 8;

    struct Epoch {
        bytes32 snapshotId;
        uint256[] rootHashes;
        uint256[] liabilities;
        uint256[] reserves;
        uint64 timestamp;
    }

    address[] public assets; // address(0) = native ETH
    mapping(uint256 => Epoch) private epochs;
    uint256 public epochCount;
    mapping(bytes32 => bool) public usedSnapshots;

    event LedgerSubmitted(
        uint256 indexed epochId,
        bytes32 indexed snapshotId,
        uint256[] rootHashes,
        uint256[] liabilities,
        uint256[] reserves
    );

    error BadAssets();
    error InvalidSnapshot();
    error InvalidLength();
    error NoEpoch();
    error Insolvent(uint256 assetId, uint256 reserves, uint256 liabilities);

    constructor(address _company, address _auditor, address[] memory tokens)
        ReserveRegistry("MerkleSumRegistry", _company, _auditor)
    {
        if (tokens.length == 0 || tokens.length > MAX_ASSETS) revert BadAssets();
        for (uint256 i = 0; i < tokens.length; i++) {
            for (uint256 j = 0; j < i; j++) {
                if (tokens[i] == tokens[j]) revert BadAssets();
            }
            assets.push(tokens[i]);
        }
    }

    function assetCount() external view returns (uint256) {
        return assets.length;
    }

    function getEpoch(uint256 epochId) public view returns (Epoch memory) {
        if (epochId >= epochCount) revert NoEpoch();
        return epochs[epochId];
    }

    function latestEpoch() external view returns (Epoch memory) {
        if (epochCount == 0) revert NoEpoch();
        return epochs[epochCount - 1];
    }

    /// @param identities per asset id, the salted identity commitment of each part
    /// @param amounts per asset id, the matching part amounts
    function submitLedger(bytes32 snapshotId, uint256[][] calldata identities, uint256[][] calldata amounts)
        external
        onlyCompany
    {
        if (snapshotId == bytes32(0) || usedSnapshots[snapshotId]) revert InvalidSnapshot();
        if (identities.length != assets.length || amounts.length != assets.length) revert InvalidLength();

        uint256 n = assets.length;
        uint256[] memory rootHashes = new uint256[](n);
        uint256[] memory liabilities = new uint256[](n);
        uint256[] memory reserves = new uint256[](n);
        for (uint256 a = 0; a < n; a++) {
            (rootHashes[a], liabilities[a]) = computeRoot(identities[a], amounts[a]);
            reserves[a] = reserveBalance(assets[a]);
            if (reserves[a] < liabilities[a]) revert Insolvent(a, reserves[a], liabilities[a]);
        }

        usedSnapshots[snapshotId] = true;
        uint256 epochId = epochCount++;
        epochs[epochId] = Epoch(snapshotId, rootHashes, liabilities, reserves, uint64(block.timestamp));
        emit LedgerSubmitted(epochId, snapshotId, rootHashes, liabilities, reserves);
    }

    /// @dev Same leaf/parent encoding and zero padding as arms/published-ledger/prover/tree.ts.
    /// An asset nobody holds has an empty ledger, with root and total 0.
    function computeRoot(uint256[] calldata identities, uint256[] calldata amounts)
        public
        pure
        returns (uint256 rootHash, uint256 liabilities)
    {
        uint256 n = identities.length;
        if (n > MAX_ENTRIES || n != amounts.length) revert InvalidLength();
        if (n == 0) return (0, 0);
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
