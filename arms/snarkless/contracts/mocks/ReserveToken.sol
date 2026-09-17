// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Minimal balance source for the demo; the registry only reads balanceOf.
contract ReserveToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}
