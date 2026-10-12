// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KzgVerifier} from "../contracts/KzgVerifier.sol";
import {KzgSolvencyRegistry} from "../contracts/KzgSolvencyRegistry.sol";
import {KzgLiabilityArgument} from "../contracts/KzgLiabilityArgument.sol";
import {ReserveDirectory} from "../../../shared/contracts/ReserveDirectory.sol";
import {UnitToken} from "./KzgSolvencyRegistry.t.sol";

contract KzgAssetBench {
    uint256 private constant FR = KzgVerifier.FR;

    error LengthMismatch();
    error InvalidLiabilityProof();
    error BatchFailed();

    function assetContext(uint256 asset) public view returns (uint256) {
        return uint256(keccak256(abi.encode(block.chainid, address(this), asset))) % FR;
    }

    function verifyEach(KzgSolvencyRegistry.GrandSum[] calldata sums, KzgLiabilityArgument.Proof[] calldata proofs)
        external
        view
        returns (bool)
    {
        if (sums.length != proofs.length) revert LengthMismatch();
        for (uint256 i = 0; i < sums.length; i++) {
            if (!KzgLiabilityArgument.verify(
                    sums[i].balanceCommitment, sums[i].totalLiabilities, proofs[i], assetContext(i)
                )) {
                revert InvalidLiabilityProof();
            }
        }
        return true;
    }

    function verifyBatched(KzgSolvencyRegistry.GrandSum[] calldata sums, KzgLiabilityArgument.Proof[] calldata proofs)
        external
        view
        returns (bool)
    {
        if (sums.length != proofs.length) revert LengthMismatch();
        KzgLiabilityArgument.PairingInput[] memory inputs = new KzgLiabilityArgument.PairingInput[](sums.length);
        bytes32 seed = keccak256("solvency/multi-asset-batch/v1");
        for (uint256 i = 0; i < sums.length; i++) {
            (bool ok, KzgLiabilityArgument.PairingInput memory input, bytes32 state) = KzgLiabilityArgument.prepare(
                sums[i].balanceCommitment, sums[i].totalLiabilities, proofs[i], assetContext(i)
            );
            if (!ok) revert InvalidLiabilityProof();
            inputs[i] = input;
            seed = keccak256(abi.encodePacked(seed, state));
        }
        KzgVerifier.G1Point memory withG2;
        KzgVerifier.G1Point memory withTau;
        for (uint256 i = 0; i < sums.length; i++) {
            uint256 weight = uint256(keccak256(abi.encode(seed, i))) % FR;
            withG2 = KzgVerifier.add(withG2, KzgVerifier.mul(inputs[i].withG2, weight));
            withTau = KzgVerifier.add(withTau, KzgVerifier.mul(inputs[i].withTau, weight));
        }
        if (!KzgVerifier.pairingProductIsOne(
                withG2, KzgLiabilityArgument.g2(), KzgVerifier.negate(withTau), KzgLiabilityArgument.tauG2()
            )) {
            revert BatchFailed();
        }
        return true;
    }
}

contract KzgAssetScalingTest is Test {
    uint256 constant ASSETS = 4;
    address constant HARNESS = address(uint160(0xbe0c00));
    uint64 constant MAX_EPOCH_AGE = 1 days;
    uint64 constant MIN_EPOCH_INTERVAL = 1 hours;

    KzgAssetBench harness;
    UnitToken token;
    ReserveDirectory directory;
    address company = makeAddr("company");
    address auditor = makeAddr("auditor");
    KzgSolvencyRegistry[] registries;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_700_000_000);
        vm.roll(1_000);

        string memory bench = benchJson();
        assertEq(vm.parseJsonAddress(bench, ".harness"), HARNESS, "the harness fixtures are bound to this address");

        deployCodeTo("KzgAssetScaling.t.sol:KzgAssetBench", HARNESS);
        harness = KzgAssetBench(HARNESS);
        token = new UnitToken();
        directory = new ReserveDirectory();
        deployRegistries(ASSETS);
    }

    function benchJson() internal view returns (string memory) {
        return vm.readFile("arms/snarkless/fixtures/bench-assets.json");
    }

    function deployRegistries(uint256 k) internal {
        string memory bench = benchJson();
        for (uint256 i = 0; i < k; i++) {
            address at = vm.parseJsonAddress(bench, string.concat(".assets[", vm.toString(i), "].registry.address"));
            deployCodeTo(
                "KzgSolvencyRegistry.sol:KzgSolvencyRegistry",
                abi.encode(company, auditor, address(token), uint8(0), MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory),
                at
            );
            KzgSolvencyRegistry registry = KzgSolvencyRegistry(at);
            registries.push(registry);
            (address reserve, uint256 key) = makeAddrAndKey(string.concat("reserve-", vm.toString(i)));
            token.set(reserve, type(uint128).max);
            vm.prank(company);
            registry.proposeReserve(reserve);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.reserveDigest(reserve));
            registry.proveReserve(reserve, abi.encodePacked(r, s, v));
            vm.prank(auditor);
            registry.reviewReserve(reserve, true);
            vm.prank(auditor);
            registry.sampleReserves();
        }
        vm.roll(block.number + 1);
    }

    function load(string memory bench, string memory prefix)
        internal
        pure
        returns (KzgSolvencyRegistry.GrandSum memory sum, KzgLiabilityArgument.Proof memory proof)
    {
        sum = KzgSolvencyRegistry.GrandSum(
            g1(bench, string.concat(prefix, ".sum.balanceCommitment")),
            g1(bench, string.concat(prefix, ".sum.identityCommitment")),
            vm.parseJsonUint(bench, string.concat(prefix, ".sum.totalLiabilities"))
        );
        proof.bitCommitments = new KzgVerifier.G1Point[](64);
        for (uint256 k = 0; k < 64; k++) {
            proof.bitCommitments[k] = g1(bench, string.concat(prefix, ".proof.bitCommitments[", vm.toString(k), "]"));
        }
        proof.accumulatorCommitment = g1(bench, string.concat(prefix, ".proof.accumulatorCommitment"));
        proof.quotientCommitment = g1(bench, string.concat(prefix, ".proof.quotientCommitment"));
        proof.values = vm.parseJsonUintArray(bench, string.concat(prefix, ".proof.values"));
        proof.shiftedAccumulator = vm.parseJsonUint(bench, string.concat(prefix, ".proof.shiftedAccumulator"));
        proof.proofAtZeta = g1(bench, string.concat(prefix, ".proof.proofAtZeta"));
        proof.proofAtShiftedZeta = g1(bench, string.concat(prefix, ".proof.proofAtShiftedZeta"));
    }

    function g1(string memory json, string memory key) internal pure returns (KzgVerifier.G1Point memory) {
        return KzgVerifier.G1Point(
            vm.parseJsonUint(json, string.concat(key, ".x")), vm.parseJsonUint(json, string.concat(key, ".y"))
        );
    }

    function g2(string memory json, string memory key) internal pure returns (KzgVerifier.G2Point memory) {
        return KzgVerifier.G2Point(
            vm.parseJsonUint(json, string.concat(key, ".xImag")),
            vm.parseJsonUint(json, string.concat(key, ".xReal")),
            vm.parseJsonUint(json, string.concat(key, ".yImag")),
            vm.parseJsonUint(json, string.concat(key, ".yReal"))
        );
    }

    function assets(uint256 k, string memory binding)
        internal
        view
        returns (KzgSolvencyRegistry.GrandSum[] memory sums, KzgLiabilityArgument.Proof[] memory proofs)
    {
        string memory bench = benchJson();
        sums = new KzgSolvencyRegistry.GrandSum[](k);
        proofs = new KzgLiabilityArgument.Proof[](k);
        for (uint256 i = 0; i < k; i++) {
            (sums[i], proofs[i]) = load(bench, string.concat(".assets[", vm.toString(i), "].", binding));
        }
    }

    function firstAssets(uint256 k)
        internal
        view
        returns (KzgSolvencyRegistry.GrandSum[] memory, KzgLiabilityArgument.Proof[] memory)
    {
        return assets(k, "harness");
    }

    function measure(bytes memory payload) internal returns (uint256 used) {
        uint256 before = gasleft();
        (bool ok,) = HARNESS.call(payload);
        used = before - gasleft();
        assertTrue(ok, "every bench asset carries a valid proof");
    }

    function perAssetGas(uint256 k) internal returns (uint256) {
        (KzgSolvencyRegistry.GrandSum[] memory sums, KzgLiabilityArgument.Proof[] memory proofs) = firstAssets(k);
        return measure(abi.encodeCall(harness.verifyEach, (sums, proofs)));
    }

    function batchedGas(uint256 k) internal returns (uint256) {
        (KzgSolvencyRegistry.GrandSum[] memory sums, KzgLiabilityArgument.Proof[] memory proofs) = firstAssets(k);
        return measure(abi.encodeCall(harness.verifyBatched, (sums, proofs)));
    }

    function registriesGas(uint256 k) internal returns (uint256 total) {
        (KzgSolvencyRegistry.GrandSum[] memory sums, KzgLiabilityArgument.Proof[] memory proofs) = assets(k, "registry");
        bytes[] memory payloads = new bytes[](k);
        for (uint256 i = 0; i < k; i++) {
            payloads[i] = abi.encodeCall(registries[i].submitEpoch, (sums[i], proofs[i]));
        }
        for (uint256 i = 0; i < k; i++) {
            address target = address(registries[i]);
            vm.cool(address(token));
            vm.cool(address(directory));
            vm.prank(company);
            uint256 before = gasleft();
            (bool ok,) = target.call(payloads[i]);
            uint256 used = before - gasleft();
            assertTrue(ok, "each single-asset registry accepts its own epoch");
            total += used;
        }
    }

    function test_GasForKzgAssets1() public {
        emit log_named_uint("kzg 1-asset verification gas, per-asset harness", perAssetGas(1));
    }

    function test_GasForKzgAssets2() public {
        emit log_named_uint("kzg 2-asset verification gas, per-asset harness", perAssetGas(2));
    }

    function test_GasForKzgAssets3() public {
        emit log_named_uint("kzg 3-asset verification gas, per-asset harness", perAssetGas(3));
    }

    function test_GasForKzgAssets4() public {
        emit log_named_uint("kzg 4-asset verification gas, per-asset harness", perAssetGas(4));
    }

    function test_GasForKzgAssetsBatched1() public {
        emit log_named_uint("kzg 1-asset verification gas, one batched pairing", batchedGas(1));
    }

    function test_GasForKzgAssetsBatched2() public {
        emit log_named_uint("kzg 2-asset verification gas, one batched pairing", batchedGas(2));
    }

    function test_GasForKzgAssetsBatched3() public {
        emit log_named_uint("kzg 3-asset verification gas, one batched pairing", batchedGas(3));
    }

    function test_GasForKzgAssetsBatched4() public {
        emit log_named_uint("kzg 4-asset verification gas, one batched pairing", batchedGas(4));
    }

    function test_GasForKzgRegistries1() public {
        emit log_named_uint("kzg 1-asset gas, sum of separate submitEpoch calls", registriesGas(1));
    }

    function test_GasForKzgRegistries2() public {
        emit log_named_uint("kzg 2-asset gas, sum of separate submitEpoch calls", registriesGas(2));
    }

    function test_GasForKzgRegistries3() public {
        emit log_named_uint("kzg 3-asset gas, sum of separate submitEpoch calls", registriesGas(3));
    }

    function test_GasForKzgRegistries4() public {
        emit log_named_uint("kzg 4-asset gas, sum of separate submitEpoch calls", registriesGas(4));
    }

    function test_HarnessCostTracksTheRegistryVerifier() public {
        uint256 harnessGas = perAssetGas(1);
        uint256 registryGas = registriesGas(1);
        assertLt(harnessGas, registryGas, "the harness leaves out the registry's reserve and storage work");
        assertGt(harnessGas, (registryGas * 80) / 100, "the verification should dominate a single-asset submission");
    }

    function test_EachHarnessRejectsATamperedOpenedValueInAnyAsset() public {
        for (uint256 i = 0; i < ASSETS; i++) {
            (KzgSolvencyRegistry.GrandSum[] memory sums, KzgLiabilityArgument.Proof[] memory proofs) =
                firstAssets(ASSETS);
            proofs[i].values[5] = addmod(proofs[i].values[5], 1, KzgVerifier.FR);
            vm.expectRevert(KzgAssetBench.InvalidLiabilityProof.selector);
            harness.verifyEach(sums, proofs);
            vm.expectRevert(KzgAssetBench.InvalidLiabilityProof.selector);
            harness.verifyBatched(sums, proofs);
        }
    }

    function test_EachHarnessRejectsAnUnderstatedTotalInAnyAsset() public {
        for (uint256 i = 0; i < ASSETS; i++) {
            (KzgSolvencyRegistry.GrandSum[] memory sums, KzgLiabilityArgument.Proof[] memory proofs) =
                firstAssets(ASSETS);
            sums[i].totalLiabilities -= 1;
            vm.expectRevert(KzgAssetBench.InvalidLiabilityProof.selector);
            harness.verifyEach(sums, proofs);
            vm.expectRevert(KzgAssetBench.InvalidLiabilityProof.selector);
            harness.verifyBatched(sums, proofs);
        }
    }

    function test_EachHarnessRejectsASwappedOpeningProofInAnyAsset() public {
        for (uint256 i = 0; i < ASSETS; i++) {
            (KzgSolvencyRegistry.GrandSum[] memory sums, KzgLiabilityArgument.Proof[] memory proofs) =
                firstAssets(ASSETS);
            proofs[i].proofAtShiftedZeta = proofs[(i + 1) % ASSETS].proofAtShiftedZeta;
            vm.expectRevert(KzgAssetBench.InvalidLiabilityProof.selector);
            harness.verifyEach(sums, proofs);
            vm.expectRevert(KzgAssetBench.BatchFailed.selector);
            harness.verifyBatched(sums, proofs);
        }
    }

    function test_EachHarnessBindsEveryProofToItsAssetSlot() public {
        (KzgSolvencyRegistry.GrandSum[] memory sums, KzgLiabilityArgument.Proof[] memory proofs) = firstAssets(2);
        (sums[0], sums[1]) = (sums[1], sums[0]);
        (proofs[0], proofs[1]) = (proofs[1], proofs[0]);
        vm.expectRevert(KzgAssetBench.InvalidLiabilityProof.selector);
        harness.verifyEach(sums, proofs);
        vm.expectRevert(KzgAssetBench.InvalidLiabilityProof.selector);
        harness.verifyBatched(sums, proofs);
    }
}
