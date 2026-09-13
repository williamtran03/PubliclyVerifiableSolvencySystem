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
    // must equal NUM_ASSETS in arms/zk-circuit/circuit; the verifier expects NUM_ASSETS + 2 public inputs
    uint256 public constant NUM_ASSETS = 3;
    uint256 public constant PRICE_DECIMALS = 8;
    uint256 private constant FIELD_ORDER =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    struct Asset {
        address token; // address(0) = native ETH
        address feed;
        uint8 decimals;
        // Per feed, because heartbeats differ: USDC/USD updates about daily, BTC/USD hourly.
        uint32 maxPriceAge;
    }

    // Everything an auditor needs to recheck the epoch later: the floors the proof was
    // checked against, the reserves that covered them, and the exact oracle rounds used
    // for the USD figure.
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
    error BadPrice();
    error StalePrice();
    error InvalidProof();
    error NoEpoch();
    error Insolvent(uint256 assetId, uint256 reserveUnits, uint256 floor);

    constructor(address _company, address _auditor, Asset[] memory _assets, address _verifier)
        ReserveRegistry("MultiAssetSolvencyRegistry", _company, _auditor)
    {
        if (_assets.length != NUM_ASSETS) revert BadAssetCount();
        for (uint256 i = 0; i < _assets.length; i++) {
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

    // Bound into the published root, so a proof built for one epoch of one deployment on
    // one chain verifies nowhere else. The prover reads it before proving.
    function epochContext(uint256 epochId) public view returns (uint256) {
        return uint256(keccak256(abi.encode(block.chainid, address(this), epochId))) % FIELD_ORDER;
    }

    // Approved reserves per asset, in the whole units the circuit counts liabilities in.
    // Truncating division rounds reserves down, so the check errs against the exchange.
    function reserveUnits() public view returns (uint256[NUM_ASSETS] memory units) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            units[i] = reserveBalance(assets[i].token) / (10 ** assets[i].decimals);
        }
    }

    // The latest round of each feed, plus the round ids to pin at submission.
    function readPrices() public view returns (uint256[NUM_ASSETS] memory prices, uint80[NUM_ASSETS] memory roundIds) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            (uint80 roundId,,,,) = IAggregatorV3(assets[i].feed).latestRoundData();
            roundIds[i] = roundId;
        }
        prices = readPricesAt(roundIds);
    }

    // Prices with PRICE_DECIMALS decimals, pinned to explicit rounds so an auditor can
    // refetch exactly what the epoch used. Kept at full precision: dividing to whole
    // dollars turned USDC at $0.9998 into 0.
    function readPricesAt(uint80[NUM_ASSETS] memory roundIds) public view returns (uint256[NUM_ASSETS] memory prices) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            IAggregatorV3 feed = IAggregatorV3(assets[i].feed);
            (, int256 answer,, uint256 updatedAt,) = feed.getRoundData(roundIds[i]);
            if (answer <= 0) revert BadPrice();
            if (block.timestamp - updatedAt > assets[i].maxPriceAge) revert StalePrice();

            uint8 feedDecimals = feed.decimals();
            prices[i] = feedDecimals > PRICE_DECIMALS
                ? uint256(answer) / 10 ** (feedDecimals - PRICE_DECIMALS)
                : uint256(answer) * 10 ** (PRICE_DECIMALS - feedDecimals);
        }
    }

    // USD value of approved reserves, with PRICE_DECIMALS decimals. Informational: solvency
    // is decided per asset in submitEpoch, where no price is involved.
    function reservesUsd(uint256[NUM_ASSETS] memory prices) public view returns (uint256 total) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            total += reserveBalance(assets[i].token) * prices[i] / (10 ** assets[i].decimals);
        }
    }

    // floors are chosen by the exchange: set to its reserves they reveal nothing that is
    // not already on-chain; set to its liabilities they publish the totals, as Summa does.
    // Either way the proof shows every asset's liabilities are at most its floor.
    function submitEpoch(
        bytes calldata proof,
        uint256 rootHash,
        uint64[NUM_ASSETS] calldata floors,
        uint80[NUM_ASSETS] calldata roundIds
    ) external onlyCompany {
        // A floor rather than the live balance as the public input, so a 1 wei deposit to a
        // reserve between proving and submission cannot invalidate the proof.
        uint256[NUM_ASSETS] memory units = reserveUnits();
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
        uint256 assetsUsd = reservesUsd(prices);

        epochs[epochId] = Epoch(rootHash, context, floors, units, prices, roundIds, assetsUsd, uint64(block.timestamp));
        epochCount++;
        emit EpochSubmitted(epochId, rootHash, floors, units, assetsUsd, roundIds);
    }
}
