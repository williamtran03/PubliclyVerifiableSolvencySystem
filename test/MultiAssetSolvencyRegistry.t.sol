// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MultiAssetSolvencyRegistry} from "../contracts/MultiAssetSolvencyRegistry.sol";
import {HonkVerifier} from "../contracts/MultiAssetHonkVerifier.sol";

contract MockAggregator {
    uint8 public decimals;
    int256 public answer;
    uint256 public updatedAt;

    constructor(uint8 _decimals, int256 _answer) {
        decimals = _decimals;
        answer = _answer;
        updatedAt = block.timestamp;
    }

    function set(int256 _answer, uint256 _updatedAt) external {
        answer = _answer;
        updatedAt = _updatedAt;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, answer, updatedAt, updatedAt, 0);
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

contract MultiAssetSolvencyRegistryTest is Test {
    MultiAssetSolvencyRegistry registry;
    MockAggregator btcFeed;
    MockAggregator ethFeed;
    MockAggregator usdcFeed;
    MockToken btc;
    MockToken usdc;

    address reserve = address(0xA11CE);
    bytes proof;
    uint256 rootHash;
    uint256 liabilitiesUsd;

    function setUp() public {
        vm.warp(1_700_000_000);

        btc = new MockToken();
        usdc = new MockToken();
        btcFeed = new MockAggregator(8, 60_000e8);
        ethFeed = new MockAggregator(8, 3_000e8);
        usdcFeed = new MockAggregator(8, 1e8);

        MultiAssetSolvencyRegistry.Asset[] memory assets = new MultiAssetSolvencyRegistry.Asset[](3);
        assets[0] = MultiAssetSolvencyRegistry.Asset(address(btc), address(btcFeed), 8);
        assets[1] = MultiAssetSolvencyRegistry.Asset(address(0), address(ethFeed), 18);
        assets[2] = MultiAssetSolvencyRegistry.Asset(address(usdc), address(usdcFeed), 6);

        address[] memory reserves = new address[](1);
        reserves[0] = reserve;

        registry = new MultiAssetSolvencyRegistry(assets, reserves, address(new HonkVerifier()), 1 hours);

        // 3 BTC + 2 ETH + 1000 USDC = 180000 + 6000 + 1000 = 187000 USD
        btc.mint(reserve, 3e8);
        vm.deal(reserve, 2 ether);
        usdc.mint(reserve, 1000e6);

        string memory json = vm.readFile("fixtures/multiasset-epoch.json");
        rootHash = vm.parseJsonUint(json, ".rootHash");
        liabilitiesUsd = vm.parseJsonUint(json, ".totalLiabilitiesUsd");
        proof = vm.readFileBinary("fixtures/multiasset-proof.bin");
    }

    function test_ReadsTheConversionTableFromTheOracles() public view {
        uint256[3] memory prices = registry.readPrices();
        assertEq(prices[0], 60_000);
        assertEq(prices[1], 3_000);
        assertEq(prices[2], 1);
    }

    function test_ValuesReservesAcrossAllThreeAssets() public view {
        assertEq(registry.totalAssetsUsd(registry.readPrices()), 187_000);
    }

    function test_SubmitEpoch() public {
        registry.submitEpoch(proof, rootHash, liabilitiesUsd);

        (uint256 storedRoot, uint256 storedLiabilities, uint256 storedAssets, uint64 timestamp) =
            registry.currentEpoch();

        assertEq(storedRoot, rootHash);
        assertEq(storedLiabilities, 155_000);
        assertEq(storedAssets, 187_000);
        assertEq(timestamp, block.timestamp);
        assertEq(registry.epochCount(), 1);
    }

    function test_RevertsWhenTheOraclePriceDiffersFromTheProvenTable() public {
        btcFeed.set(59_000e8, block.timestamp);
        vm.expectRevert(); // the verifier rejects the wrong price table with its own error
        registry.submitEpoch(proof, rootHash, liabilitiesUsd);
    }

    function test_RevertsIfInsolvent() public {
        btc.burn(reserve);
        vm.deal(reserve, 0);
        usdc.burn(reserve);

        vm.expectRevert(abi.encodeWithSelector(MultiAssetSolvencyRegistry.Insolvent.selector, 0, 155_000));
        registry.submitEpoch(proof, rootHash, liabilitiesUsd);
    }

    function test_RevertsOnStalePrice() public {
        ethFeed.set(3_000e8, block.timestamp - 2 hours);
        vm.expectRevert(MultiAssetSolvencyRegistry.StalePrice.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd);
    }

    function test_RevertsOnNonPositivePrice() public {
        ethFeed.set(0, block.timestamp);
        vm.expectRevert(MultiAssetSolvencyRegistry.BadPrice.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd);
    }

    function test_RevertsForNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(MultiAssetSolvencyRegistry.NotOwner.selector);
        registry.submitEpoch(proof, rootHash, liabilitiesUsd);
    }
}
