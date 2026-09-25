// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";
import {ReserveDirectory} from "../../../shared/contracts/ReserveDirectory.sol";

contract MerkleSumRegistry is ReserveRegistry {
    uint256 public constant MAX_ENTRIES = 256;
    uint256 public constant MAX_ASSETS = 8;

    struct Epoch {
        bytes32 snapshotId;
        uint256[] rootHashes;
        uint256[] liabilities;
        uint256[] reserves;
        uint64 timestamp;
    }

    address[] public assets;
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

    constructor(
        address _company,
        address _auditor,
        address[] memory tokens,
        uint64 _maxEpochAge,
        uint64 _minEpochInterval,
        ReserveDirectory _directory
    ) ReserveRegistry(_company, _auditor, _maxEpochAge, _minEpochInterval, _directory) {
        if (tokens.length == 0 || tokens.length > MAX_ASSETS) revert BadAssets();
        for (uint256 i = 0; i < tokens.length; i++) {
            for (uint256 j = 0; j < i; j++) {
                if (tokens[i] == tokens[j]) revert BadAssets();
            }
            assets.push(tokens[i]);
        }
    }

    function _reserveTokens() internal view override returns (address[] memory) {
        return assets;
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

    function submitLedger(bytes32 snapshotId, uint256[][] calldata identities, uint256[][] calldata amounts)
        external
        onlyCompany
    {
        if (snapshotId == bytes32(0) || usedSnapshots[snapshotId]) revert InvalidSnapshot();
        if (identities.length != assets.length || amounts.length != assets.length) revert InvalidLength();
        _requireSample();

        uint256 n = assets.length;
        uint256[] memory rootHashes = new uint256[](n);
        uint256[] memory liabilities = new uint256[](n);
        uint256[] memory attested = new uint256[](n);
        for (uint256 a = 0; a < n; a++) {
            (rootHashes[a], liabilities[a]) = computeRoot(identities[a], amounts[a]);
            attested[a] = attestedBalance(assets[a]);
            if (attested[a] < liabilities[a]) revert Insolvent(a, attested[a], liabilities[a]);
        }

        usedSnapshots[snapshotId] = true;
        _recordEpoch();
        uint256 epochId = epochCount++;
        epochs[epochId] = Epoch(snapshotId, rootHashes, liabilities, attested, uint64(block.timestamp));
        emit LedgerSubmitted(epochId, snapshotId, rootHashes, liabilities, attested);
    }

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
                sums[i / 2] = sums[i] + sums[i + 1];
            }
            size /= 2;
        }
        return (hashes[0], sums[0]);
    }
}
