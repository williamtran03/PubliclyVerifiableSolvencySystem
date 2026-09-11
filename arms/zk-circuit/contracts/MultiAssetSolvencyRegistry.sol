// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVerifier} from "./MultiAssetHonkVerifier.sol";

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

contract MultiAssetSolvencyRegistry {
    // must equal NUM_ASSETS in arms/zk-circuit/circuit; the verifier expects NUM_ASSETS + 2 public inputs
    uint256 public constant NUM_ASSETS = 3;

    struct Asset {
        address token; // address(0) = native ETH
        address feed;
        uint8 decimals;
    }

    struct Epoch {
        uint256 rootHash;
        uint256 liabilitiesUsd;
        uint256 assetsUsd;
        uint64 timestamp;
    }

    // Recorded so an auditor can refetch the exact rounds and recompute the epoch.
    uint256[NUM_ASSETS] public epochPrices;
    uint80[NUM_ASSETS] public epochRoundIds;

    address public owner;
    IVerifier public immutable verifier;
    uint256 public immutable maxPriceAge;
    Asset[] public assets;
    address[] public reserves;
    Epoch public currentEpoch;
    uint256 public epochCount;

    event EpochSubmitted(
        uint256 indexed epochId,
        uint256 rootHash,
        uint256 liabilitiesUsd,
        uint256 assetsUsd,
        uint256[NUM_ASSETS] prices,
        uint80[NUM_ASSETS] roundIds,
        uint64 timestamp
    );

    error NotOwner();
    error BadAssetCount();
    error BadPrice();
    error StalePrice();
    error InvalidProof();
    error Insolvent(uint256 assetsUsd, uint256 liabilitiesUsd);

    constructor(Asset[] memory _assets, address[] memory _reserves, address _verifier, uint256 _maxPriceAge) {
        if (_assets.length != NUM_ASSETS) revert BadAssetCount();
        owner = msg.sender;
        for (uint256 i = 0; i < _assets.length; i++) {
            assets.push(_assets[i]);
        }
        reserves = _reserves;
        verifier = IVerifier(_verifier);
        maxPriceAge = _maxPriceAge;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // The conversion table the prover should use: latest round of each feed, plus the
    // round ids to pin so the contract values the epoch at exactly the same numbers.
    function readPrices() public view returns (uint256[NUM_ASSETS] memory prices, uint80[NUM_ASSETS] memory roundIds) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            (uint80 roundId,,,,) = IAggregatorV3(assets[i].feed).latestRoundData();
            roundIds[i] = roundId;
        }
        prices = readPricesAt(roundIds);
    }

    // Pinned to explicit rounds rather than whatever is live at mining time, so the
    // prover and this contract cannot disagree, and an auditor can refetch the rounds.
    // Staleness still applies, which is what bounds round shopping.
    function readPricesAt(uint80[NUM_ASSETS] memory roundIds) public view returns (uint256[NUM_ASSETS] memory prices) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            IAggregatorV3 feed = IAggregatorV3(assets[i].feed);
            (, int256 answer,, uint256 updatedAt,) = feed.getRoundData(roundIds[i]);
            if (answer <= 0) revert BadPrice();
            if (block.timestamp - updatedAt > maxPriceAge) revert StalePrice();

            prices[i] = uint256(answer) / (10 ** feed.decimals());
            if (prices[i] == 0) revert BadPrice();
        }
    }

    // Truncating division rounds reserves down, so the solvency check errs against the exchange.
    function totalAssetsUsd(uint256[NUM_ASSETS] memory prices) public view returns (uint256 total) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            uint256 raw = 0;
            for (uint256 j = 0; j < reserves.length; j++) {
                raw += assets[i].token == address(0)
                    ? reserves[j].balance
                    : IERC20Balance(assets[i].token).balanceOf(reserves[j]);
            }
            total += (raw / (10 ** assets[i].decimals)) * prices[i];
        }
    }

    function submitEpoch(
        bytes calldata proof,
        uint256 rootHash,
        uint256 liabilitiesUsd,
        uint80[NUM_ASSETS] calldata roundIds
    ) external onlyOwner {
        uint256[NUM_ASSETS] memory prices = readPricesAt(roundIds);

        // Prices are public inputs, so a proof built against any other conversion
        // table fails here rather than needing a separate table commitment.
        bytes32[] memory publicInputs = new bytes32[](NUM_ASSETS + 2);
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            publicInputs[i] = bytes32(prices[i]);
        }
        publicInputs[NUM_ASSETS] = bytes32(rootHash);
        publicInputs[NUM_ASSETS + 1] = bytes32(liabilitiesUsd);
        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        uint256 assetsUsd = totalAssetsUsd(prices);
        if (assetsUsd < liabilitiesUsd) revert Insolvent(assetsUsd, liabilitiesUsd);

        currentEpoch = Epoch(rootHash, liabilitiesUsd, assetsUsd, uint64(block.timestamp));
        epochPrices = prices;
        epochRoundIds = roundIds;
        emit EpochSubmitted(epochCount, rootHash, liabilitiesUsd, assetsUsd, prices, roundIds, uint64(block.timestamp));
        epochCount++;
    }
}
