// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {AuditedAssets} from "./AuditedAssets.sol";
import {MinimumTree} from "./MinimumTree.sol";
import {SnapshotOracle} from "./SnapshotOracle.sol";

/// @notice Auditor-attested historical reserves against a publicly recomputable liability ledger.
contract MinimumSolvencyRegistry is AuditedAssets {
    uint256 public constant USD_SCALE = 1e8;
    uint256 public immutable capacity;
    uint256 public immutable maxOracleAge;

    struct Liability {
        bytes32 rootHash;
        uint256 rootSum;
        bytes32 rateManifestHash;
        uint256 snapshotTime;
        uint256 snapshotBlock;
        uint256 submittedAt;
        uint256 verifiedAt;
        address verifiedBy;
        Status status;
        bool removalPending;
    }

    struct Claim {
        bytes32 snapshotId;
        bytes32 rootHash;
        uint256 totalLiabilitiesUsd;
        uint256 totalEligibleAssetsUsd;
        uint256 surplus;
        bytes32 rateManifestHash;
        uint256 snapshotTime;
        uint256 snapshotBlock;
        uint256 submittedAt;
        uint256 liabilityVerifiedAt;
        uint256 finalizedAt;
        address verifiedBy;
        bool finalized;
    }

    struct Observation {
        uint256 assetId;
        uint256 rawAmount;
        uint256 usd;
        uint256 rateIndex;
        uint256 verifiedAt;
    }

    struct ClaimProposal {
        bool exists;
        bool decided;
        uint256 submittedAt;
        uint256[] assetIds;
        uint256[] rawAmounts;
    }
    mapping(bytes32 => Liability) private liabilities;
    mapping(bytes32 => SnapshotOracle.Rate[]) private manifests;
    mapping(bytes32 => uint256) public pinnedRateSnapshotTime;
    mapping(bytes32 => ClaimProposal) private proposals;
    mapping(bytes32 => Claim) private claims;
    mapping(bytes32 => Observation[]) private observations;
    bytes32[] public snapshotIds;
    bytes32 public currentClaimId;
    event LiabilityProposed(
        bytes32 indexed snapshotId,
        bytes32 rootHash,
        uint256 rootSum,
        bytes32 rateManifestHash,
        uint256 snapshotTime,
        uint256 snapshotBlock
    );
    event RatesPinned(bytes32 indexed snapshotId, uint256 snapshotTime, bytes32 rateManifestHash);
    event PublicLedger(bytes32 indexed snapshotId, bytes32[] identities, uint256[] amounts, uint256 capacity);
    event LiabilityVerified(bytes32 indexed snapshotId, bool approved, address auditor);
    event LiabilityRemovalRequested(bytes32 indexed snapshotId);
    event LiabilityRemovalVerified(bytes32 indexed snapshotId, bool approved);
    event ClaimProposed(bytes32 indexed snapshotId, uint256[] assetIds, uint256[] rawAmounts);
    event ClaimRejected(bytes32 indexed snapshotId, address auditor);
    event ClaimFinalized(
        bytes32 indexed snapshotId, uint256 assets, uint256 liabilities, uint256 surplus, address auditor
    );
    error Insolvent();

    constructor(address company_, address auditor_, uint256 capacity_, uint256 maxAge_)
        AuditedAssets(company_, auditor_)
    {
        if (capacity_ < 2 || capacity_ > 256 || capacity_ & (capacity_ - 1) != 0 || maxAge_ == 0 || maxAge_ > 7 days) {
            revert InvalidInput();
        }
        capacity = capacity_;
        maxOracleAge = maxAge_;
    }

    function computeRoot(bytes32 id, bytes32[] calldata identities, uint256[] calldata amounts)
        external
        view
        returns (bytes32, uint256)
    {
        return MinimumTree.root(id, capacity, identities, amounts);
    }

    struct SnapshotInput {
        bytes32 id;
        bytes32 rootHash;
        uint256 totalLiabilitiesUsd;
        bytes32 rateManifestHash;
        uint256 snapshotTime;
        uint256 snapshotBlock;
    }

    /// @notice Pin and validate the exact oracle rounds that the off-chain prover must use.
    function pinRates(bytes32 id, uint256 snapshotTime, SnapshotOracle.Rate[] calldata rates) external onlyCompany {
        if (
            id == bytes32(0) || pinnedRateSnapshotTime[id] != 0 || snapshotTime == 0 || snapshotTime > block.timestamp
                || block.timestamp - snapshotTime > maxOracleAge || rates.length == 0 || rates.length > 32
        ) revert InvalidInput();
        address previous;
        for (uint256 i; i < rates.length; i++) {
            if (rates[i].token <= previous) revert InvalidInput();
            previous = rates[i].token;
            SnapshotOracle.validate(rates[i], snapshotTime, maxOracleAge);
            manifests[id].push(rates[i]);
        }
        pinnedRateSnapshotTime[id] = snapshotTime;
        emit RatesPinned(id, snapshotTime, keccak256(abi.encode(keccak256("solvency.minimum.v1.rates"), id, rates)));
    }

    /// @notice Submit a liability root using rates previously pinned on-chain.
    function addLiability(SnapshotInput calldata input, bytes32[] calldata identities, uint256[] calldata amounts)
        external
        onlyCompany
    {
        if (manifests[input.id].length == 0 || pinnedRateSnapshotTime[input.id] != input.snapshotTime) {
            revert InvalidInput();
        }
        _addLiability(input, identities, amounts);
    }

    function addLiability(
        SnapshotInput calldata input,
        bytes32[] calldata identities,
        uint256[] calldata amounts,
        SnapshotOracle.Rate[] calldata rates
    ) external onlyCompany {
        if (
            input.id == bytes32(0) || liabilities[input.id].status != Status.None || input.snapshotTime == 0
                || input.snapshotTime > block.timestamp || block.timestamp - input.snapshotTime > maxOracleAge
                || input.snapshotBlock >= block.number || block.number - input.snapshotBlock > 256 || rates.length == 0
                || rates.length > 32
        ) revert InvalidInput();
        _pinRates(input.id, input.snapshotTime, rates);
        _addLiability(input, identities, amounts);
    }

    function _pinRates(bytes32 id, uint256 snapshotTime, SnapshotOracle.Rate[] calldata rates) private {
        if (pinnedRateSnapshotTime[id] != 0) revert InvalidInput();
        address previous;
        for (uint256 i; i < rates.length; i++) {
            if (rates[i].token <= previous) revert InvalidInput();
            previous = rates[i].token;
            SnapshotOracle.validate(rates[i], snapshotTime, maxOracleAge);
            manifests[id].push(rates[i]);
        }
        pinnedRateSnapshotTime[id] = snapshotTime;
    }

    function _addLiability(SnapshotInput calldata input, bytes32[] calldata identities, uint256[] calldata amounts)
        private
    {
        if (
            input.id == bytes32(0) || liabilities[input.id].status != Status.None
                || pinnedRateSnapshotTime[input.id] != input.snapshotTime || input.snapshotTime == 0
                || input.snapshotTime > block.timestamp || block.timestamp - input.snapshotTime > maxOracleAge
                || input.snapshotBlock >= block.number || block.number - input.snapshotBlock > 256
        ) revert InvalidInput();
        (bytes32 computed, uint256 sum) = MinimumTree.root(input.id, capacity, identities, amounts);
        SnapshotOracle.Rate[] storage rates = manifests[input.id];
        if (
            input.rootHash != computed || input.totalLiabilitiesUsd != sum
                || input.rateManifestHash
                    != keccak256(abi.encode(keccak256("solvency.minimum.v1.rates"), input.id, rates))
        ) revert InvalidInput();
        Liability storage l = liabilities[input.id];
        l.rootHash = computed;
        l.rootSum = sum;
        l.rateManifestHash = input.rateManifestHash;
        l.snapshotTime = input.snapshotTime;
        l.snapshotBlock = input.snapshotBlock;
        l.submittedAt = block.timestamp;
        l.status = Status.Pending;
        snapshotIds.push(input.id);
        emitLiability(input);
        emit PublicLedger(input.id, identities, amounts, capacity);
    }

    function emitLiability(SnapshotInput calldata input) private {
        emit LiabilityProposed(
            input.id,
            input.rootHash,
            input.totalLiabilitiesUsd,
            input.rateManifestHash,
            input.snapshotTime,
            input.snapshotBlock
        );
    }

    /// @dev Attests completeness, conversion records, and the time/block association checked off-chain.
    function verifyAddLiability(bytes32 id, bool approved) external onlyAuditor {
        Liability storage l = liabilities[id];
        if (l.status != Status.Pending || l.removalPending) revert InvalidState();
        l.status = approved ? Status.Approved : Status.Rejected;
        l.verifiedBy = msg.sender;
        l.verifiedAt = block.timestamp;
        emit LiabilityVerified(id, approved, msg.sender);
    }

    function removeLiability(bytes32 id) external onlyCompany {
        Liability storage l = liabilities[id];
        if ((l.status != Status.Pending && l.status != Status.Approved) || l.removalPending) revert InvalidState();
        l.removalPending = true;
        emit LiabilityRemovalRequested(id);
    }

    function verifyRemoveLiability(bytes32 id, bool approved) external onlyAuditor {
        Liability storage l = liabilities[id];
        if (!l.removalPending) revert InvalidState();
        l.removalPending = false;
        if (approved) l.status = Status.Retired;
        emit LiabilityRemovalVerified(id, approved);
    }

    function proposeClaim(bytes32 id, uint256[] calldata assetIds, uint256[] calldata rawAmounts) external onlyCompany {
        if (
            liabilities[id].status != Status.Approved || liabilities[id].removalPending || proposals[id].exists
                || assetIds.length > 64 || assetIds.length != rawAmounts.length
        ) revert InvalidState();
        uint256 previous;
        for (uint256 i; i < assetIds.length; i++) {
            if (
                assetIds[i] <= previous || assets[assetIds[i]].status != Status.Approved
                    || !assets[assetIds[i]].ownershipVerified
            ) revert InvalidInput();
            previous = assetIds[i];
        }
        proposals[id] = ClaimProposal(true, false, block.timestamp, assetIds, rawAmounts);
        emit ClaimProposed(id, assetIds, rawAmounts);
    }

    function rateIndex(bytes32 id, address token, address feed) private view returns (uint256) {
        SnapshotOracle.Rate[] storage rates = manifests[id];
        for (uint256 i; i < rates.length; i++) {
            if (rates[i].token == token && rates[i].feed == feed) return i;
        }
        revert InvalidInput();
    }

    /// @notice Auditor MUST independently check raw balances at snapshotBlock before approving.
    function finalizeClaim(bytes32 id, bool approved) external onlyAuditor {
        ClaimProposal storage p = proposals[id];
        Liability storage l = liabilities[id];
        if (!p.exists || p.decided || l.status != Status.Approved || l.removalPending) revert InvalidState();
        p.decided = true;
        if (!approved) {
            emit ClaimRejected(id, msg.sender);
            return;
        }
        for (uint256 i; i < manifests[id].length; i++) {
            SnapshotOracle.validate(manifests[id][i], l.snapshotTime, maxOracleAge);
        }
        uint256 total;
        for (uint256 i; i < p.assetIds.length; i++) {
            Asset storage a = assets[p.assetIds[i]];
            if (a.status != Status.Approved || !a.ownershipVerified || a.removalPending) revert InvalidState();
            uint256 index = rateIndex(id, a.token, a.feed);
            uint256 value = SnapshotOracle.usd(p.rawAmounts[i], manifests[id][index]);
            total += value;
            observations[id].push(Observation(p.assetIds[i], p.rawAmounts[i], value, index, block.timestamp));
        }
        if (total < l.rootSum) revert Insolvent();
        claims[id] = Claim(
            id,
            l.rootHash,
            l.rootSum,
            total,
            total - l.rootSum,
            l.rateManifestHash,
            l.snapshotTime,
            l.snapshotBlock,
            p.submittedAt,
            l.verifiedAt,
            block.timestamp,
            msg.sender,
            true
        );
        // A later-finalized old snapshot must not roll the public dashboard backwards.
        if (!claims[currentClaimId].finalized || l.snapshotBlock > claims[currentClaimId].snapshotBlock) {
            currentClaimId = id;
        }
        emit ClaimFinalized(id, total, l.rootSum, total - l.rootSum, msg.sender);
    }

    function getLiability(bytes32 id) external view returns (Liability memory) {
        return liabilities[id];
    }

    function getClaim(bytes32 id) external view returns (Claim memory) {
        return claims[id];
    }

    function currentClaim() external view returns (Claim memory) {
        return claims[currentClaimId];
    }

    function getRates(bytes32 id) external view returns (SnapshotOracle.Rate[] memory) {
        return manifests[id];
    }

    function getClaimAssets(bytes32 id) external view returns (Observation[] memory) {
        return observations[id];
    }

    function getClaimProposal(bytes32 id) external view returns (ClaimProposal memory) {
        return proposals[id];
    }

    function snapshotCount() external view returns (uint256) {
        return snapshotIds.length;
    }
}
