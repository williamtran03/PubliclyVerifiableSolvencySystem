// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVerifier} from "./MultiAssetHonkVerifier.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";

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

contract MultiAssetSolvencyRegistry is ReserveRegistry {
    uint256 public constant NUM_ASSETS = 3;
    uint256 public constant PRICE_DECIMALS = 8;
    uint256 public constant BASE_DECIMALS = 8;
    uint256 private constant FIELD_ORDER =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    struct Asset {
        address token;
        address feed;
        uint8 decimals;
        uint32 maxPriceAge;
    }

    struct Epoch {
        uint256 rootHash;
        uint256 context;
        uint64[NUM_ASSETS] floors;
        uint256[NUM_ASSETS] reserveUnits;
        uint256[NUM_ASSETS] prices;
        uint80[NUM_ASSETS] roundIds;
        uint256 assetsUsd;
        uint64 timestamp;
    }

    IVerifier public immutable verifier;
    Asset[] public assets;
    mapping(uint256 => Epoch) private epochs;
    uint256 public epochCount;

    event EpochSubmitted(
        uint256 indexed epochId,
        uint256 rootHash,
        uint64[NUM_ASSETS] floors,
        uint256[NUM_ASSETS] reserveUnits,
        uint256 assetsUsd,
        uint80[NUM_ASSETS] roundIds
    );

    error BadAssetCount();
    error DuplicateAsset();
    error StaleRound();
    error BadPrice();
    error StalePrice();
    error InvalidProof();
    error NoEpoch();
    error Insolvent(uint256 assetId, uint256 reserveUnits, uint256 floor);

    constructor(address _company, address _auditor, Asset[] memory _assets, address _verifier, uint64 _maxEpochAge)
        ReserveRegistry("MultiAssetSolvencyRegistry", _company, _auditor, _maxEpochAge)
    {
        if (_assets.length != NUM_ASSETS) revert BadAssetCount();
        for (uint256 i = 0; i < _assets.length; i++) {
            for (uint256 j = 0; j < i; j++) {
                if (_assets[i].token == _assets[j].token) revert DuplicateAsset();
            }
            assets.push(_assets[i]);
        }
        verifier = IVerifier(_verifier);
    }

    function getEpoch(uint256 epochId) public view returns (Epoch memory) {
        if (epochId >= epochCount) revert NoEpoch();
        return epochs[epochId];
    }

    function latestEpoch() external view returns (Epoch memory) {
        if (epochCount == 0) revert NoEpoch();
        return epochs[epochCount - 1];
    }

    function epochContext(uint256 epochId) public view returns (uint256) {
        return uint256(keccak256(abi.encode(block.chainid, address(this), epochId))) % FIELD_ORDER;
    }

    function reserveRaw() public view returns (uint256[NUM_ASSETS] memory raw) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            raw[i] = reserveBalance(assets[i].token);
        }
    }

    function reserveUnits() public view returns (uint256[NUM_ASSETS] memory units) {
        return unitsOf(reserveRaw());
    }

    function unitsOf(uint256[NUM_ASSETS] memory raw) internal view returns (uint256[NUM_ASSETS] memory units) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            uint8 d = assets[i].decimals;
            units[i] = d > BASE_DECIMALS ? raw[i] / 10 ** (d - BASE_DECIMALS) : raw[i] * 10 ** (BASE_DECIMALS - d);
        }
    }

    function readPrices() public view returns (uint256[NUM_ASSETS] memory prices, uint80[NUM_ASSETS] memory roundIds) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            (uint80 roundId,,,,) = IAggregatorV3(assets[i].feed).latestRoundData();
            roundIds[i] = roundId;
        }
        prices = readPricesAt(roundIds);
    }

    function readPricesAt(uint80[NUM_ASSETS] memory roundIds) public view returns (uint256[NUM_ASSETS] memory prices) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            IAggregatorV3 feed = IAggregatorV3(assets[i].feed);
            (, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.getRoundData(roundIds[i]);
            if (answer <= 0) revert BadPrice();
            if (answeredInRound < roundIds[i]) revert StaleRound();
            if (block.timestamp - updatedAt > assets[i].maxPriceAge) revert StalePrice();

            uint8 feedDecimals = feed.decimals();
            prices[i] = feedDecimals > PRICE_DECIMALS
                ? uint256(answer) / 10 ** (feedDecimals - PRICE_DECIMALS)
                : uint256(answer) * 10 ** (PRICE_DECIMALS - feedDecimals);
        }
    }

    function reservesUsd(uint256[NUM_ASSETS] memory prices) public view returns (uint256) {
        return usdOf(reserveRaw(), prices);
    }

    function usdOf(uint256[NUM_ASSETS] memory raw, uint256[NUM_ASSETS] memory prices)
        internal
        view
        returns (uint256 total)
    {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            total += raw[i] * prices[i] / (10 ** assets[i].decimals);
        }
    }

    function submitEpoch(
        bytes calldata proof,
        uint256 rootHash,
        uint64[NUM_ASSETS] calldata floors,
        uint80[NUM_ASSETS] calldata roundIds
    ) external onlyCompany {
        uint256[NUM_ASSETS] memory raw = reserveRaw();
        uint256[NUM_ASSETS] memory units = unitsOf(raw);
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            if (units[i] < floors[i]) revert Insolvent(i, units[i], floors[i]);
        }

        uint256 epochId = epochCount;
        uint256 context = epochContext(epochId);
        bytes32[] memory publicInputs = new bytes32[](NUM_ASSETS + 2);
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            publicInputs[i] = bytes32(uint256(floors[i]));
        }
        publicInputs[NUM_ASSETS] = bytes32(context);
        publicInputs[NUM_ASSETS + 1] = bytes32(rootHash);
        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        uint256[NUM_ASSETS] memory prices = readPricesAt(roundIds);
        uint256 assetsUsd = usdOf(raw, prices);

        _recordEpoch();
        epochs[epochId] = Epoch(rootHash, context, floors, units, prices, roundIds, assetsUsd, uint64(block.timestamp));
        epochCount++;
        emit EpochSubmitted(epochId, rootHash, floors, units, assetsUsd, roundIds);
    }
}
