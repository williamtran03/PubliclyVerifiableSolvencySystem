// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IOracleFeed {
    function decimals() external view returns (uint8);
    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80);
}

interface ITokenDecimals {
    function decimals() external view returns (uint8);
}

library SnapshotOracle {
    struct Rate {
        address token;
        address feed;
        uint8 tokenDecimals;
        uint8 oracleDecimals;
        uint256 rate;
        uint80 roundId;
        uint256 updatedAt;
    }
    error InvalidRate();

    function validate(Rate memory r, uint256 snapshotTime, uint256 maxAge) internal view {
        if (
            r.token == address(0) || r.feed == address(0) || r.tokenDecimals > 18 || r.oracleDecimals > 18
                || r.rate == 0 || r.roundId == 0 || r.updatedAt == 0 || r.updatedAt > snapshotTime
                || snapshotTime - r.updatedAt > maxAge || r.updatedAt > block.timestamp
                || block.timestamp - r.updatedAt > maxAge
        ) revert InvalidRate();
        if (r.token == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)) {
            if (r.tokenDecimals != 18) revert InvalidRate();
        } else if (ITokenDecimals(r.token).decimals() != r.tokenDecimals) {
            revert InvalidRate();
        }
        if (IOracleFeed(r.feed).decimals() != r.oracleDecimals) revert InvalidRate();
        (uint80 round, int256 answer,, uint256 updated, uint80 answeredInRound) =
            IOracleFeed(r.feed).getRoundData(r.roundId);
        if (
            round != r.roundId || answer <= 0 || uint256(answer) != r.rate || updated != r.updatedAt
                || answeredInRound < round
        ) {
            revert InvalidRate();
        }
    }

    function usd(uint256 raw, Rate memory r) internal pure returns (uint256) {
        return raw * r.rate * 1e8 / (10 ** uint256(r.tokenDecimals + r.oracleDecimals));
    }
}
