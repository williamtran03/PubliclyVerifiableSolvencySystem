// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract SolvencyRegistry {
    struct Epoch {
        uint256 rootHash;
        uint256 totalLiabilities;
        uint64 timestamp;
    }

    address public owner;
    Epoch public currentEpoch;
    uint256 public epochCount;
    event EpochSubmitted(
        uint256 indexed epochId,
        uint256 rootHash,
        uint256 totalLiabilities,
        uint64 timestamp
    );

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function submitEpoch(
        uint256 rootHash,
        uint256 totalLiabilities
    ) external onlyOwner {
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
