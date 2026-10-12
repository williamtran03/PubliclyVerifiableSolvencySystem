// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KzgVerifier} from "./KzgVerifier.sol";
import {KzgLiabilityArgument} from "./KzgLiabilityArgument.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";
import {ReserveDirectory} from "../../../shared/contracts/ReserveDirectory.sol";

contract KzgSolvencyRegistry is ReserveRegistry {
    uint256 private constant FR = KzgVerifier.FR;

    struct Srs {
        KzgVerifier.G2Point g2;
        KzgVerifier.G2Point tauG2;
    }

    struct GrandSum {
        KzgVerifier.G1Point balanceCommitment;
        KzgVerifier.G1Point identityCommitment;
        uint256 totalLiabilities;
    }

    struct Epoch {
        KzgVerifier.G1Point balanceCommitment;
        KzgVerifier.G1Point identityCommitment;
        uint256 totalLiabilities;
        uint256 reserveUnits;
        uint64 timestamp;
    }

    address public immutable token;
    uint8 public immutable decimals;
    mapping(uint256 => Epoch) private epochs;
    uint256 public epochCount;

    event EpochSubmitted(uint256 indexed epochId, uint256 totalLiabilities, uint256 reserveUnits);

    error Insolvent(uint256 reserveUnits, uint256 totalLiabilities);
    error InvalidLiabilityProof();
    error NoEpoch();

    constructor(
        address _company,
        address _auditor,
        address _token,
        uint8 _decimals,
        uint64 _maxEpochAge,
        uint64 _minEpochInterval,
        ReserveDirectory _directory
    ) ReserveRegistry(_company, _auditor, _maxEpochAge, _minEpochInterval, _directory) {
        token = _token;
        decimals = _decimals;
    }

    function _reserveTokens() internal view override returns (address[] memory tokens) {
        tokens = new address[](1);
        tokens[0] = token;
    }

    function getSrs() external pure returns (Srs memory) {
        return Srs(KzgLiabilityArgument.g2(), KzgLiabilityArgument.tauG2());
    }

    function getEpoch(uint256 epochId) external view returns (Epoch memory) {
        if (epochId >= epochCount) revert NoEpoch();
        return epochs[epochId];
    }

    function epochContext(uint256 epochId) public view returns (uint256) {
        return uint256(keccak256(abi.encode(block.chainid, address(this), epochId))) % FR;
    }

    function reserveUnits() public view returns (uint256) {
        return attestedBalance(token) / (10 ** decimals);
    }

    function submitEpoch(GrandSum calldata sum, KzgLiabilityArgument.Proof calldata proof) external onlyCompany {
        _requireSample();
        uint256 units = reserveUnits();
        if (units < sum.totalLiabilities) revert Insolvent(units, sum.totalLiabilities);
        if (!KzgLiabilityArgument.verify(sum.balanceCommitment, sum.totalLiabilities, proof, epochContext(epochCount)))
        {
            revert InvalidLiabilityProof();
        }

        _recordEpoch();
        epochs[epochCount] =
            Epoch(sum.balanceCommitment, sum.identityCommitment, sum.totalLiabilities, units, uint64(block.timestamp));
        emit EpochSubmitted(epochCount, sum.totalLiabilities, units);
        epochCount++;
    }

    function verifyInclusion(
        uint256 epochId,
        uint256 index,
        uint256 identity,
        uint256 balance,
        KzgVerifier.G1Point calldata proof
    ) external view returns (bool) {
        if (epochId >= epochCount || index >= KzgLiabilityArgument.DOMAIN_SIZE || identity >= FR || balance >= FR) {
            return false;
        }
        Epoch storage epoch = epochs[epochId];

        uint256 z = 1;
        for (uint256 i = 0; i < index; i++) {
            z = mulmod(z, KzgLiabilityArgument.OMEGA, FR);
        }

        bytes32 state = keccak256("solvency/inclusion/v1");
        state = KzgLiabilityArgument.absorbScalar(state, epochContext(epochId));
        state = KzgLiabilityArgument.absorbPoint(state, epoch.identityCommitment);
        state = KzgLiabilityArgument.absorbPoint(state, epoch.balanceCommitment);
        state = KzgLiabilityArgument.absorbScalar(state, z);
        state = KzgLiabilityArgument.absorbScalar(state, identity);
        state = KzgLiabilityArgument.absorbScalar(state, balance);
        (, uint256 nu) = KzgLiabilityArgument.challenge(state);

        KzgVerifier.G1Point memory folded =
            KzgVerifier.add(epoch.identityCommitment, KzgVerifier.mul(epoch.balanceCommitment, nu));
        uint256 value = addmod(identity, mulmod(nu, balance, FR), FR);
        return
            KzgVerifier.verifyOpening(folded, z, value, proof, KzgLiabilityArgument.g2(), KzgLiabilityArgument.tauG2());
    }
}
