// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract DemoAsset {
    string public symbol;
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;

    constructor(string memory _symbol, uint8 _decimals) {
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}
