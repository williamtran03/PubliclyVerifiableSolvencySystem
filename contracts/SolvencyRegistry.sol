// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVerifier} from "./HonkVerifier.sol";

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
    IVerifier public immutable verifier;
    event EpochSubmitted(
        uint256 indexed epochId,
        uint256 rootHash,
        uint256 totalLiabilities,
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

    function submitEpoch(
        bytes calldata proof,
        uint256 rootHash,
        uint256 totalLiabilities
    ) external onlyOwner {
        bytes32[] memory publicInputs = new bytes32[](2);
        publicInputs[0] = bytes32(rootHash);
        publicInputs[1] = bytes32(totalLiabilities);
        require(verifier.verify(proof, publicInputs), "invalid proof");

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
