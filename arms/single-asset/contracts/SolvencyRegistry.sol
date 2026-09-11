// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVerifier} from "./HonkVerifier.sol";

contract SolvencyRegistry {
    struct Epoch {
        uint256 rootHash;
        uint256 totalReservesAtEpoch;
        uint64 timestamp;
    }

    address public owner;
    Epoch public currentEpoch;
    uint256 public epochCount;
    address[] public reserves;
    IVerifier public immutable verifier;
    event EpochSubmitted(
        uint256 indexed epochId,
        uint256 rootHash,
        uint256 totalReservesAtEpoch,
        uint64 timestamp
    );

    constructor(address[] memory _reserves, address _verifier) {
        owner = msg.sender;
        reserves = _reserves;
        verifier = IVerifier(_verifier);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function totalReserves() public view returns (uint256 total) {
        for (uint256 i = 0; i < reserves.length; i++) {
            total += reserves[i].balance;
        }
    }

    /// @notice Publishes an epoch. Total liabilities are never revealed: the
    ///         circuit proves they are covered by `totalReserves()`, which this
    ///         contract reads itself so the prover cannot choose it.
    function submitEpoch(bytes calldata proof, uint256 rootHash) external onlyOwner {
        uint256 assets = totalReserves();

        // Public input order is Noir's: public parameters first, then returns.
        bytes32[] memory publicInputs = new bytes32[](2);
        publicInputs[0] = bytes32(assets);
        publicInputs[1] = bytes32(rootHash);
        require(verifier.verify(proof, publicInputs), "invalid proof");

        currentEpoch = Epoch(rootHash, assets, uint64(block.timestamp));
        emit EpochSubmitted(epochCount, rootHash, assets, uint64(block.timestamp));
        epochCount++;
    }
}
