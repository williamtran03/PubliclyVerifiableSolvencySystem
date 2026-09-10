// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal fixed-supply token for local demonstrations only.
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address holder, uint256 supply) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        totalSupply = supply;
        balanceOf[holder] = supply;
    }
}
