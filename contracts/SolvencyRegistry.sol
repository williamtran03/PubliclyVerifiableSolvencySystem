// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Legacy baseline: accepts unproven liabilities. Use the proof-backed
/// vault provided by this branch for the Case 5 demonstration.
contract SolvencyRegistry {
    struct Epoch {
        uint256 rootHash;
        uint256 totalLiabilities;
        uint64 timestamp;
    }

    address public owner;
    Epoch public currentEpoch;
    uint256 public epochCount;
    address[] public reserves;
    event EpochSubmitted(
        uint256 indexed epochId,
        uint256 rootHash,
        uint256 totalLiabilities,
        uint64 timestamp
    );

    constructor(address[] memory _reserves) {
        owner = msg.sender;
        reserves = _reserves;
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

    function submitEpoch(
        uint256 rootHash,
        uint256 totalLiabilities
    ) external onlyOwner {
        require(totalReserves() >= totalLiabilities, "insolvent");
        currentEpoch = Epoch(
            rootHash,
            totalLiabilities,
            uint64(block.timestamp)
        );
        emit EpochSubmitted(
            epochCount,
            rootHash,
            totalLiabilities,
            uint64(block.timestamp)
        );
        epochCount++;
    }
}
