// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockOracle {
    uint8 public immutable decimals;
    address public immutable owner;

    struct Round {
        int256 answer;
        uint256 updatedAt;
        uint80 answeredInRound;
    }
    mapping(uint80 => Round) public rounds;

    constructor(uint8 d) {
        decimals = d;
        owner = msg.sender;
    }

    function setRound(uint80 id, int256 answer, uint256 updatedAt) external {
        require(msg.sender == owner, "owner");
        require(rounds[id].updatedAt == 0, "immutable round");
        rounds[id] = Round(answer, updatedAt, id);
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[id];
        return (id, r.answer, r.updatedAt, r.updatedAt, r.answeredInRound);
    }
}
