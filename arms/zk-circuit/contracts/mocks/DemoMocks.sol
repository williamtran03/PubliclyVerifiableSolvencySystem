// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockAggregator {
    uint8 public decimals;
    uint80 public latestRound;
    mapping(uint80 => int256) public answers;
    mapping(uint80 => uint256) public updatedAts;
    mapping(uint80 => uint80) public answeredInOverride;

    constructor(uint8 _decimals, int256 _answer) {
        decimals = _decimals;
        _push(_answer, block.timestamp);
    }

    function set(int256 _answer, uint256 _updatedAt) external {
        _push(_answer, _updatedAt);
    }

    function setAnsweredInRound(uint80 roundId, uint80 answeredIn) external {
        answeredInOverride[roundId] = answeredIn;
    }

    function answeredIn(uint80 roundId) public view returns (uint80) {
        uint80 stored = answeredInOverride[roundId];
        return stored == 0 ? roundId : stored;
    }

    function _push(int256 _answer, uint256 _updatedAt) internal {
        latestRound += 1;
        answers[latestRound] = _answer;
        updatedAts[latestRound] = _updatedAt;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (latestRound, answers[latestRound], updatedAts[latestRound], updatedAts[latestRound], latestRound);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answers[roundId], updatedAts[roundId], updatedAts[roundId], answeredIn(roundId));
    }
}

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function burn(address from) external {
        balanceOf[from] = 0;
    }
}
