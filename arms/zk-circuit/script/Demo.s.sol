// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MultiAssetSolvencyRegistry} from "../contracts/MultiAssetSolvencyRegistry.sol";
import {ReserveDirectory} from "../../../shared/contracts/ReserveDirectory.sol";
import {HonkVerifier, Errors} from "../contracts/MultiAssetHonkVerifier.sol";
import {MockAggregator, MockToken} from "../contracts/mocks/DemoMocks.sol";

contract MultiAssetDemo is Script {
    uint256 constant COMPANY_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant AUDITOR_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant RESERVE_KEY = uint256(keccak256("northwind cold wallet"));
    address constant FIXTURE_REGISTRY = 0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6;

    address company;
    address auditor;
    address reserve;

    MockToken btc;
    MockToken usdc;
    MockAggregator btcFeed;
    MockAggregator ethFeed;
    MockAggregator usdcFeed;
    MultiAssetSolvencyRegistry registry;
    ReserveDirectory directory;
    HonkVerifier verifier;

    function run() external {
        company = vm.addr(COMPANY_KEY);
        auditor = vm.addr(AUDITOR_KEY);
        reserve = vm.addr(RESERVE_KEY);
        vm.roll(block.number + 1);
        console.log("==> broadcast with --skip-simulation --slow: proofs and samples must precede the submission block");

        vm.startBroadcast(COMPANY_KEY);
        deployAssets();
        deployRegistry();
        fundReserve();
        proposeAndProveReserve();
        vm.stopBroadcast();

        vm.startBroadcast(AUDITOR_KEY);
        registry.reviewReserve(reserve, true);
        console.log("==> auditor approved the reserve; it now counts towards assets");
        registry.sampleReserves();
        console.log("==> auditor sampled the reserves in a block the company does not control");
        vm.stopBroadcast();
        vm.roll(block.number + 1);

        vm.startBroadcast(COMPANY_KEY);
        submit();
        vm.stopBroadcast();

        showReplayIsRejected();
        showPerAssetCheck();
    }

    function deployAssets() internal {
        btc = new MockToken();
        usdc = new MockToken();
        btcFeed = new MockAggregator(8, 60_000e8);
        ethFeed = new MockAggregator(8, 3_000e8);
        usdcFeed = new MockAggregator(8, 1e8);
        console.log("==> feeds deployed: BTC $60000, ETH $3000, USDC $1");
        verifier = new HonkVerifier();
    }

    function deployRegistry() internal {
        MultiAssetSolvencyRegistry.Asset[] memory assets = new MultiAssetSolvencyRegistry.Asset[](3);
        assets[0] = MultiAssetSolvencyRegistry.Asset(address(btc), address(btcFeed), 8, 1 hours);
        assets[1] = MultiAssetSolvencyRegistry.Asset(address(0), address(ethFeed), 18, 1 hours);
        assets[2] = MultiAssetSolvencyRegistry.Asset(address(usdc), address(usdcFeed), 6, 1 days);

        address expectedDirectory = vm.computeCreateAddress(company, vm.getNonce(company) + 1);
        registry = new MultiAssetSolvencyRegistry(
            company, auditor, assets, address(verifier), 1 days, 1 hours, ReserveDirectory(expectedDirectory)
        );
        require(address(registry) == FIXTURE_REGISTRY, "run against a fresh anvil: the proof is bound to the address");
        directory = new ReserveDirectory();
        require(address(directory) == expectedDirectory, "the registry points at the directory deployed next");
        console.log("==> reserve directory deployed at", address(directory));
        console.log("==> registry deployed at", address(registry));
        console.log("    company:", company);
        console.log("    auditor:", auditor);
    }

    function fundReserve() internal {
        btc.mint(reserve, 3e8);
        usdc.mint(reserve, 6000e6);
        payable(reserve).transfer(12 ether);
        console.log("==> reserve funded: 3 BTC, 12 ETH, 6000 USDC at", reserve);
        console.log("    customers are owed 2 BTC, 10 ETH, 5000 USDC");
    }

    function proposeAndProveReserve() internal {
        registry.proposeReserve(reserve);
        console.log("==> company proposed the reserve");

        proveControl();
        console.log("==> reserve signed the EIP-712 challenge off-chain; company relayed it");
    }

    function proveControl() internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(RESERVE_KEY, registry.reserveDigest(reserve));
        registry.proveReserve(reserve, abi.encodePacked(r, s, v));
    }

    function fixture() internal view returns (bytes memory proof, uint256 rootHash, uint64[3] memory floors) {
        string memory json = vm.readFile("arms/zk-circuit/fixtures/epoch.json");
        rootHash = vm.parseJsonUint(json, ".rootHash");
        uint256[] memory parsed = vm.parseJsonUintArray(json, ".floors");
        for (uint256 i = 0; i < 3; i++) {
            floors[i] = uint64(parsed[i]);
        }
        proof = vm.readFileBinary("arms/zk-circuit/fixtures/proof.bin");
    }

    function pinnedRounds() internal view returns (uint80[3] memory roundIds) {
        string memory json = vm.readFile("arms/zk-circuit/prover/snapshot.json");
        uint256[] memory parsed = vm.parseJsonUintArray(json, ".roundIds");
        for (uint256 i = 0; i < 3; i++) {
            roundIds[i] = uint80(parsed[i]);
        }
    }

    function submit() internal {
        (bytes memory proof, uint256 rootHash, uint64[3] memory floors) = fixture();
        uint256[3] memory units = registry.reserveUnits();
        console.log("==> reserves per asset:", units[0], units[1], units[2]);
        console.log("==> floors the proof shows liabilities stay under:", floors[0], floors[1], floors[2]);

        registry.submitEpoch(proof, rootHash, floors, pinnedRounds());
        MultiAssetSolvencyRegistry.Epoch memory epoch = registry.latestEpoch();
        console.log("OK: epoch 0 accepted; liabilities were never published");
        console.log("    reserves worth USD (8 decimals):", epoch.assetsUsd);
    }

    function showReplayIsRejected() internal {
        (bytes memory proof, uint256 rootHash, uint64[3] memory floors) = fixture();
        vm.warp(block.timestamp + 1 hours);
        btcFeed.set(60_000e8, block.timestamp);
        ethFeed.set(3_000e8, block.timestamp);
        (, uint80[3] memory roundIds) = registry.readPrices();
        proveControl();
        vm.prank(auditor);
        registry.sampleReserves();
        vm.roll(block.number + 1);
        console.log("==> an hour later, reserves re-proven and sampled; resubmitting the same proof as epoch 1");
        vm.prank(company);
        try registry.submitEpoch(proof, rootHash, floors, roundIds) {
            console.log("FAIL: a proof was accepted for a second epoch");
        } catch (bytes memory reason) {
            require(bytes4(reason) == Errors.SumcheckFailed.selector, "unexpected revert");
            console.log("OK: rejected, the proof is bound to epoch 0 of this registry");
        }
    }

    function showPerAssetCheck() internal {
        (bytes memory proof, uint256 rootHash, uint64[3] memory floors) = fixture();
        (, uint80[3] memory roundIds) = registry.readPrices();
        vm.deal(reserve, 2 ether);
        console.log("==> reserve now holds 2 ETH against 10 owed; BTC still covers it in USD");
        vm.prank(company);
        try registry.submitEpoch(proof, rootHash, floors, roundIds) {
            console.log("FAIL: an ETH shortfall was accepted");
        } catch (bytes memory reason) {
            require(bytes4(reason) == MultiAssetSolvencyRegistry.Insolvent.selector, "unexpected revert");
            console.log("OK: rejected as insolvent in ETH, whatever the USD total says");
        }
    }
}
