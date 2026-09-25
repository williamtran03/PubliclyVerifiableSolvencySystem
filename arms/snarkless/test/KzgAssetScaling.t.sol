// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KzgVerifier} from "../contracts/KzgVerifier.sol";
import {KzgSolvencyRegistry} from "../contracts/KzgSolvencyRegistry.sol";
import {ReserveDirectory} from "../../../shared/contracts/ReserveDirectory.sol";
import {UnitToken} from "./KzgSolvencyRegistry.t.sol";

contract KzgAssetBench {
    uint256 private constant FR = KzgVerifier.FR;
    uint256 private constant DOMAIN_SIZE = 8;
    uint256 private constant BALANCE_BITS = 64;
    uint256 private constant DOMAIN_SIZE_INVERSE =
        19152212512859365819465605027100115702479818850364030050735928663253832433665;

    KzgSolvencyRegistry.Srs private srs;

    error LengthMismatch();
    error DegreeTooHigh();
    error InvalidOpening();
    error InvalidRangeProof();
    error BatchFailed();

    struct Folded {
        KzgVerifier.G1Point commitment;
        uint256 value;
        uint256 zeta;
    }

    struct Accumulator {
        KzgVerifier.G1Point onG2;
        KzgVerifier.G1Point onTau;
        KzgVerifier.G1Point onBound;
        uint256 generatorScalar;
    }

    constructor(KzgSolvencyRegistry.Srs memory _srs) {
        srs = _srs;
    }

    function assetContext(uint256 asset) public view returns (uint256) {
        return uint256(keccak256(abi.encode(block.chainid, address(this), asset))) % FR;
    }

    function verifyEach(KzgSolvencyRegistry.GrandSum[] calldata sums, KzgSolvencyRegistry.RangeProof[] calldata ranges)
        external
        view
        returns (bool)
    {
        if (sums.length != ranges.length) revert LengthMismatch();
        for (uint256 i = 0; i < sums.length; i++) {
            KzgSolvencyRegistry.GrandSum calldata sum = sums[i];
            if (!KzgVerifier.verifyDegreeBound(sum.balanceCommitment, sum.shiftedCommitment, srs.g2, srs.boundG2)) {
                revert DegreeTooHigh();
            }
            if (sum.totalLiabilities >= FR) revert InvalidOpening();
            uint256 constantTerm = mulmod(sum.totalLiabilities, DOMAIN_SIZE_INVERSE, FR);
            if (!KzgVerifier.verifyOpening(sum.balanceCommitment, 0, constantTerm, sum.sumProof, srs.g2, srs.tauG2)) {
                revert InvalidOpening();
            }
            (bool ok, Folded memory folded,) = prepareRange(sum.balanceCommitment, ranges[i], assetContext(i));
            if (!ok) revert InvalidRangeProof();
            if (!KzgVerifier.verifyOpening(
                    folded.commitment, folded.zeta, folded.value, ranges[i].batchProof, srs.g2, srs.tauG2
                )) {
                revert InvalidRangeProof();
            }
        }
        return true;
    }

    function verifyBatched(
        KzgSolvencyRegistry.GrandSum[] calldata sums,
        KzgSolvencyRegistry.RangeProof[] calldata ranges
    ) external view returns (bool) {
        if (sums.length != ranges.length) revert LengthMismatch();
        Folded[] memory folded = new Folded[](sums.length);
        bytes32 seed = keccak256("solvency/multi-asset-batch/v1");
        for (uint256 i = 0; i < sums.length; i++) {
            (seed, folded[i]) = bindAsset(seed, sums[i], ranges[i], i);
        }
        Accumulator memory acc;
        for (uint256 i = 0; i < sums.length; i++) {
            accumulate(acc, sums[i], ranges[i].batchProof, folded[i], seed, i);
        }
        acc.onG2 = KzgVerifier.sub(acc.onG2, KzgVerifier.mul(KzgVerifier.generator(), acc.generatorScalar));
        if (!threePairingProductIsOne(acc.onG2, KzgVerifier.negate(acc.onTau), KzgVerifier.negate(acc.onBound))) {
            revert BatchFailed();
        }
        return true;
    }

    function bindAsset(
        bytes32 seed,
        KzgSolvencyRegistry.GrandSum calldata sum,
        KzgSolvencyRegistry.RangeProof calldata range,
        uint256 asset
    ) private view returns (bytes32, Folded memory folded) {
        KzgVerifier.requireOnCurve(sum.balanceCommitment);
        KzgVerifier.requireOnCurve(sum.shiftedCommitment);
        KzgVerifier.requireOnCurve(sum.sumProof);
        KzgVerifier.requireOnCurve(range.batchProof);
        if (sum.totalLiabilities >= FR) revert InvalidOpening();
        bool ok;
        bytes32 state;
        (ok, folded, state) = prepareRange(sum.balanceCommitment, range, assetContext(asset));
        if (!ok) revert InvalidRangeProof();
        seed = keccak256(
            abi.encodePacked(
                seed,
                state,
                sum.shiftedCommitment.x,
                sum.shiftedCommitment.y,
                sum.totalLiabilities,
                sum.sumProof.x,
                sum.sumProof.y,
                range.batchProof.x,
                range.batchProof.y
            )
        );
        return (seed, folded);
    }

    function accumulate(
        Accumulator memory acc,
        KzgSolvencyRegistry.GrandSum calldata sum,
        KzgVerifier.G1Point calldata batchProof,
        Folded memory folded,
        bytes32 seed,
        uint256 asset
    ) private view {
        uint256 a = uint256(keccak256(abi.encode(seed, asset, 0))) % FR;
        uint256 b = uint256(keccak256(abi.encode(seed, asset, 1))) % FR;
        uint256 c = uint256(keccak256(abi.encode(seed, asset, 2))) % FR;
        uint256 constantTerm = mulmod(sum.totalLiabilities, DOMAIN_SIZE_INVERSE, FR);
        acc.generatorScalar =
            addmod(acc.generatorScalar, addmod(mulmod(a, constantTerm, FR), mulmod(b, folded.value, FR), FR), FR);
        acc.onG2 = KzgVerifier.add(acc.onG2, KzgVerifier.mul(sum.balanceCommitment, a));
        acc.onG2 = KzgVerifier.add(acc.onG2, KzgVerifier.mul(folded.commitment, b));
        acc.onG2 = KzgVerifier.add(acc.onG2, KzgVerifier.mul(batchProof, mulmod(b, folded.zeta, FR)));
        acc.onG2 = KzgVerifier.add(acc.onG2, KzgVerifier.mul(sum.shiftedCommitment, c));
        acc.onTau = KzgVerifier.add(acc.onTau, KzgVerifier.mul(sum.sumProof, a));
        acc.onTau = KzgVerifier.add(acc.onTau, KzgVerifier.mul(batchProof, b));
        acc.onBound = KzgVerifier.add(acc.onBound, KzgVerifier.mul(sum.balanceCommitment, c));
    }

    function threePairingProductIsOne(
        KzgVerifier.G1Point memory withG2,
        KzgVerifier.G1Point memory withTau,
        KzgVerifier.G1Point memory withBound
    ) private view returns (bool) {
        KzgVerifier.G2Point memory g2 = srs.g2;
        KzgVerifier.G2Point memory tauG2 = srs.tauG2;
        KzgVerifier.G2Point memory boundG2 = srs.boundG2;
        uint256[18] memory input = [
            withG2.x,
            withG2.y,
            g2.xImag,
            g2.xReal,
            g2.yImag,
            g2.yReal,
            withTau.x,
            withTau.y,
            tauG2.xImag,
            tauG2.xReal,
            tauG2.yImag,
            tauG2.yReal,
            withBound.x,
            withBound.y,
            boundG2.xImag,
            boundG2.xReal,
            boundG2.yImag,
            boundG2.yReal
        ];
        uint256[1] memory out;
        bool success;
        assembly ("memory-safe") {
            success := staticcall(gas(), 0x08, input, 0x240, out, 0x20)
        }
        if (!success) revert KzgVerifier.PairingFailed();
        return out[0] == 1;
    }

    function prepareRange(
        KzgVerifier.G1Point memory balanceCommitment,
        KzgSolvencyRegistry.RangeProof calldata proof,
        uint256 context
    ) private view returns (bool ok, Folded memory folded, bytes32 state) {
        if (proof.bitCommitments.length != BALANCE_BITS || proof.values.length != BALANCE_BITS + 2) {
            return (false, folded, state);
        }
        for (uint256 i = 0; i < proof.values.length; i++) {
            if (proof.values[i] >= FR) return (false, folded, state);
        }
        uint256 gamma;
        uint256 nu;
        (gamma, folded.zeta, nu, state) = rangeChallenges(balanceCommitment, proof, context);
        uint256 vanishing = addmod(power(folded.zeta, DOMAIN_SIZE), FR - 1, FR);
        if (folded.zeta == 0 || vanishing == 0) return (false, folded, state);
        if (!rangeIdentityHolds(proof.values, gamma, vanishing)) return (false, folded, state);

        folded.commitment = balanceCommitment;
        folded.value = proof.values[0];
        uint256 nuPower = 1;
        for (uint256 k = 0; k <= BALANCE_BITS; k++) {
            nuPower = mulmod(nuPower, nu, FR);
            KzgVerifier.G1Point memory commitment =
                k < BALANCE_BITS ? proof.bitCommitments[k] : proof.quotientCommitment;
            KzgVerifier.requireOnCurve(commitment);
            folded.commitment = KzgVerifier.add(folded.commitment, KzgVerifier.mul(commitment, nuPower));
            folded.value = addmod(folded.value, mulmod(proof.values[1 + k], nuPower, FR), FR);
        }
        ok = true;
    }

    function rangeChallenges(
        KzgVerifier.G1Point memory balanceCommitment,
        KzgSolvencyRegistry.RangeProof calldata proof,
        uint256 context
    ) private pure returns (uint256 gamma, uint256 zeta, uint256 nu, bytes32 state) {
        state = keccak256("solvency/range/v1");
        state = absorbScalar(state, context);
        state = absorbPoint(state, balanceCommitment);
        for (uint256 k = 0; k < BALANCE_BITS; k++) {
            state = absorbPoint(state, proof.bitCommitments[k]);
        }
        (state, gamma) = challenge(state);
        state = absorbPoint(state, proof.quotientCommitment);
        (state, zeta) = challenge(state);
        for (uint256 i = 0; i < proof.values.length; i++) {
            state = absorbScalar(state, proof.values[i]);
        }
        (state, nu) = challenge(state);
    }

    function rangeIdentityHolds(uint256[] calldata values, uint256 gamma, uint256 vanishing)
        private
        pure
        returns (bool)
    {
        uint256 left;
        uint256 gammaPower = 1;
        uint256 reconstructed;
        for (uint256 k = 0; k < BALANCE_BITS; k++) {
            uint256 bit = values[1 + k];
            left = addmod(left, mulmod(gammaPower, addmod(mulmod(bit, bit, FR), FR - bit, FR), FR), FR);
            reconstructed = addmod(reconstructed, mulmod(1 << k, bit, FR), FR);
            gammaPower = mulmod(gammaPower, gamma, FR);
        }
        left = addmod(left, mulmod(gammaPower, addmod(reconstructed, FR - values[0], FR), FR), FR);
        return left == mulmod(vanishing, values[BALANCE_BITS + 1], FR);
    }

    function absorbPoint(bytes32 state, KzgVerifier.G1Point memory point) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(state, point.x, point.y));
    }

    function absorbScalar(bytes32 state, uint256 value) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(state, value % FR));
    }

    function challenge(bytes32 state) private pure returns (bytes32 next, uint256 value) {
        next = keccak256(abi.encodePacked(state, bytes1(0x01)));
        value = uint256(next) % FR;
    }

    function power(uint256 base, uint256 exponent) private pure returns (uint256 result) {
        result = 1;
        for (uint256 i = 0; i < exponent; i++) {
            result = mulmod(result, base, FR);
        }
    }
}

contract KzgAssetScalingTest is Test {
    uint256 constant ASSETS = 4;
    address constant HARNESS = address(uint160(0xbe0c00));
    uint64 constant MAX_EPOCH_AGE = 1 days;
    uint64 constant MIN_EPOCH_INTERVAL = 1 hours;

    KzgSolvencyRegistry.Srs srs;
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

        string memory epoch = vm.readFile("arms/snarkless/fixtures/epoch.json");
        srs = KzgSolvencyRegistry.Srs(g2(epoch, ".g2"), g2(epoch, ".tauG2"), g2(epoch, ".boundG2"));
        string memory bench = benchJson();
        assertEq(vm.parseJsonAddress(bench, ".harness"), HARNESS, "the harness fixtures are bound to this address");

        deployCodeTo("KzgAssetScaling.t.sol:KzgAssetBench", abi.encode(srs), HARNESS);
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
                abi.encode(
                    company, auditor, address(token), uint8(0), srs, MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory
                ),
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
        returns (KzgSolvencyRegistry.GrandSum memory sum, KzgSolvencyRegistry.RangeProof memory range)
    {
        sum = KzgSolvencyRegistry.GrandSum(
            g1(bench, string.concat(prefix, ".sum.balanceCommitment")),
            g1(bench, string.concat(prefix, ".sum.shiftedCommitment")),
            g1(bench, string.concat(prefix, ".sum.identityCommitment")),
            vm.parseJsonUint(bench, string.concat(prefix, ".sum.totalLiabilities")),
            g1(bench, string.concat(prefix, ".sum.sumProof"))
        );
        range.bitCommitments = new KzgVerifier.G1Point[](64);
        for (uint256 k = 0; k < 64; k++) {
            range.bitCommitments[k] = g1(bench, string.concat(prefix, ".range.bitCommitments[", vm.toString(k), "]"));
        }
        range.quotientCommitment = g1(bench, string.concat(prefix, ".range.quotientCommitment"));
        range.values = vm.parseJsonUintArray(bench, string.concat(prefix, ".range.values"));
        range.batchProof = g1(bench, string.concat(prefix, ".range.batchProof"));
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
        returns (KzgSolvencyRegistry.GrandSum[] memory sums, KzgSolvencyRegistry.RangeProof[] memory ranges)
    {
        string memory bench = benchJson();
        sums = new KzgSolvencyRegistry.GrandSum[](k);
        ranges = new KzgSolvencyRegistry.RangeProof[](k);
        for (uint256 i = 0; i < k; i++) {
            (sums[i], ranges[i]) = load(bench, string.concat(".assets[", vm.toString(i), "].", binding));
        }
    }

    function firstAssets(uint256 k)
        internal
        view
        returns (KzgSolvencyRegistry.GrandSum[] memory, KzgSolvencyRegistry.RangeProof[] memory)
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
        (KzgSolvencyRegistry.GrandSum[] memory sums, KzgSolvencyRegistry.RangeProof[] memory ranges) = firstAssets(k);
        return measure(abi.encodeCall(harness.verifyEach, (sums, ranges)));
    }

    function batchedGas(uint256 k) internal returns (uint256) {
        (KzgSolvencyRegistry.GrandSum[] memory sums, KzgSolvencyRegistry.RangeProof[] memory ranges) = firstAssets(k);
        return measure(abi.encodeCall(harness.verifyBatched, (sums, ranges)));
    }

    function registriesGas(uint256 k) internal returns (uint256 total) {
        (KzgSolvencyRegistry.GrandSum[] memory sums, KzgSolvencyRegistry.RangeProof[] memory ranges) =
            assets(k, "registry");
        bytes[] memory payloads = new bytes[](k);
        for (uint256 i = 0; i < k; i++) {
            payloads[i] = abi.encodeCall(registries[i].submitEpoch, (sums[i], ranges[i]));
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

    function test_EachHarnessRejectsATamperedRangeValueInAnyAsset() public {
        for (uint256 i = 0; i < ASSETS; i++) {
            (KzgSolvencyRegistry.GrandSum[] memory sums, KzgSolvencyRegistry.RangeProof[] memory ranges) =
                firstAssets(ASSETS);
            ranges[i].values[5] = addmod(ranges[i].values[5], 1, KzgVerifier.FR);
            vm.expectRevert(KzgAssetBench.InvalidRangeProof.selector);
            harness.verifyEach(sums, ranges);
            vm.expectRevert(KzgAssetBench.InvalidRangeProof.selector);
            harness.verifyBatched(sums, ranges);
        }
    }

    function test_EachHarnessRejectsAnUnderstatedTotalInAnyAsset() public {
        for (uint256 i = 0; i < ASSETS; i++) {
            (KzgSolvencyRegistry.GrandSum[] memory sums, KzgSolvencyRegistry.RangeProof[] memory ranges) =
                firstAssets(ASSETS);
            sums[i].totalLiabilities -= 1;
            vm.expectRevert(KzgAssetBench.InvalidOpening.selector);
            harness.verifyEach(sums, ranges);
            vm.expectRevert(KzgAssetBench.BatchFailed.selector);
            harness.verifyBatched(sums, ranges);
        }
    }

    function test_EachHarnessRejectsASwappedDegreeWitnessInAnyAsset() public {
        for (uint256 i = 0; i < ASSETS; i++) {
            (KzgSolvencyRegistry.GrandSum[] memory sums, KzgSolvencyRegistry.RangeProof[] memory ranges) =
                firstAssets(ASSETS);
            sums[i].shiftedCommitment = sums[(i + 1) % ASSETS].shiftedCommitment;
            vm.expectRevert(KzgAssetBench.DegreeTooHigh.selector);
            harness.verifyEach(sums, ranges);
            vm.expectRevert(KzgAssetBench.BatchFailed.selector);
            harness.verifyBatched(sums, ranges);
        }
    }

    function test_EachHarnessBindsEveryProofToItsAssetSlot() public {
        (KzgSolvencyRegistry.GrandSum[] memory sums, KzgSolvencyRegistry.RangeProof[] memory ranges) = firstAssets(2);
        (sums[0], sums[1]) = (sums[1], sums[0]);
        (ranges[0], ranges[1]) = (ranges[1], ranges[0]);
        vm.expectRevert(KzgAssetBench.InvalidRangeProof.selector);
        harness.verifyEach(sums, ranges);
        vm.expectRevert(KzgAssetBench.InvalidRangeProof.selector);
        harness.verifyBatched(sums, ranges);
    }
}
