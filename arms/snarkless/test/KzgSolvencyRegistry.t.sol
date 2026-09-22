// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KzgVerifier} from "../contracts/KzgVerifier.sol";
import {KzgSolvencyRegistry} from "../contracts/KzgSolvencyRegistry.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";
import {ReserveDirectory} from "../../../shared/contracts/ReserveDirectory.sol";

contract UnitToken {
    mapping(address => uint256) public balanceOf;

    function set(address account, uint256 amount) external {
        balanceOf[account] = amount;
    }
}

contract KzgSolvencyRegistryTest is Test {
    address constant FIXTURE_REGISTRY = 0x34A1D3fff3958843C43aD80F30b94c510645C316;

    KzgSolvencyRegistry registry;
    UnitToken token;
    address company = makeAddr("company");
    address auditor = makeAddr("auditor");
    address reserve;
    uint256 reserveKey;
    ReserveDirectory directory;
    KzgSolvencyRegistry.Srs srs;

    KzgSolvencyRegistry.GrandSum sum;
    KzgSolvencyRegistry.RangeProof range;
    string inclusion;

    uint64 constant MAX_EPOCH_AGE = 1 days;
    uint64 constant MIN_EPOCH_INTERVAL = 1 hours;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_700_000_000);
        vm.roll(1_000);
        (reserve, reserveKey) = makeAddrAndKey("reserve");

        string memory epoch = vm.readFile("arms/snarkless/fixtures/epoch.json");
        srs = KzgSolvencyRegistry.Srs(g2(epoch, ".g2"), g2(epoch, ".tauG2"), g2(epoch, ".boundG2"));
        token = new UnitToken();
        directory = new ReserveDirectory();
        deployCodeTo(
            "KzgSolvencyRegistry.sol:KzgSolvencyRegistry",
            abi.encode(company, auditor, address(token), uint8(0), srs, MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory),
            FIXTURE_REGISTRY
        );
        registry = KzgSolvencyRegistry(FIXTURE_REGISTRY);

        token.set(reserve, 50_000);
        vm.prank(company);
        registry.proposeReserve(reserve);
        proveControl();
        vm.prank(auditor);
        registry.reviewReserve(reserve, true);
        sample();

        sum.balanceCommitment = g1(epoch, ".balanceCommitment");
        sum.shiftedCommitment = g1(epoch, ".shiftedCommitment");
        sum.identityCommitment = g1(epoch, ".identityCommitment");
        sum.totalLiabilities = vm.parseJsonUint(epoch, ".totalLiabilities");
        sum.sumProof = g1(epoch, ".sumProof");

        loadRange(vm.readFile("arms/snarkless/fixtures/range-proof.json"), "");

        inclusion = vm.readFile("arms/snarkless/fixtures/inclusion.json");
    }

    function loadRange(string memory json, string memory prefix) internal {
        delete range;
        for (uint256 k = 0; k < 64; k++) {
            range.bitCommitments.push(g1(json, string.concat(prefix, ".bitCommitments[", vm.toString(k), "]")));
        }
        range.quotientCommitment = g1(json, string.concat(prefix, ".quotientCommitment"));
        uint256[] memory values = vm.parseJsonUintArray(json, string.concat(prefix, ".values"));
        for (uint256 i = 0; i < values.length; i++) {
            range.values.push(values[i]);
        }
        range.batchProof = g1(json, string.concat(prefix, ".batchProof"));
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

    function ceremonyG2(string memory json, string memory key) internal pure returns (KzgVerifier.G2Point memory) {
        uint256[] memory parts = vm.parseJsonUintArray(json, key);
        return KzgVerifier.G2Point(parts[1], parts[0], parts[3], parts[2]);
    }

    function proveControl() internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(reserveKey, registry.reserveDigest(reserve));
        registry.proveReserve(reserve, abi.encodePacked(r, s, v));
    }

    function sample() internal {
        vm.prank(auditor);
        registry.sampleReserves();
        vm.roll(block.number + 1);
    }

    function submit() internal {
        vm.prank(company);
        registry.submitEpoch(sum, range);
    }

    function test_PublishesTheSetupItVerifiesAgainst() public view {
        string memory ceremony = vm.readFile("arms/snarkless/fixtures/srs.json");
        KzgSolvencyRegistry.Srs memory published = registry.getSrs();
        string memory why = "a verifier has to be able to compare the deployed points with the public ceremony";
        assertEq(abi.encode(published.g2), abi.encode(ceremonyG2(ceremony, ".g2")), why);
        assertEq(abi.encode(published.tauG2), abi.encode(ceremonyG2(ceremony, ".tauG2")), why);
        assertEq(abi.encode(published.boundG2), abi.encode(ceremonyG2(ceremony, ".boundG2")), why);
    }

    function test_SubmitEpoch() public {
        submit();
        KzgSolvencyRegistry.Epoch memory epoch = registry.getEpoch(0);
        assertEq(epoch.totalLiabilities, 49_550);
        assertEq(epoch.reserveUnits, 50_000);
        assertEq(epoch.balanceCommitment.x, sum.balanceCommitment.x);
        assertEq(registry.epochCount(), 1);
    }

    function test_GasForASuccessfulSubmission() public {
        vm.prank(company);
        uint256 before = gasleft();
        registry.submitEpoch(sum, range);
        uint256 used = before - gasleft();
        emit log_named_uint("kzg submitEpoch gas", used);
        assertLt(used, 2_500_000, "a regression beyond the figure the comparison quotes");
    }

    function test_GasForDeployment() public {
        uint256 before = gasleft();
        new KzgSolvencyRegistry(
            company, auditor, address(token), uint8(0), srs, MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory
        );
        uint256 used = before - gasleft();
        emit log_named_uint("kzg registry deployment gas, excluding the 21000 intrinsic and calldata", used);
        assertLt(used, 5_500_000, "a regression beyond the figure the comparison quotes");
    }

    function test_GasForVerifyInclusion() public {
        submit();
        (uint256 index, uint256 identity, uint256 balance, KzgVerifier.G1Point memory proof) = customerAt(0);
        uint256 before = gasleft();
        bool included = registry.verifyInclusion(0, index, identity, balance, proof);
        uint256 used = before - gasleft();
        assertTrue(included);
        emit log_named_uint("kzg verifyInclusion gas", used);
        assertLt(used, 250_000, "a regression beyond the figure the comparison quotes");
    }

    function test_AProofDoesNotCarryToTheNextEpoch() public {
        submit();
        assertEq(registry.epochCount(), 1);
        vm.warp(block.timestamp + MIN_EPOCH_INTERVAL);
        proveControl();
        sample();

        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidRangeProof.selector);
        registry.submitEpoch(sum, range);
    }

    function test_OnlyTheCompanySubmits() public {
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.NotCompany.selector);
        registry.submitEpoch(sum, range);
    }

    function test_RevertsIfInsolvent() public {
        token.set(reserve, 49_549);
        sample();
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(KzgSolvencyRegistry.Insolvent.selector, 49_549, 49_550));
        registry.submitEpoch(sum, range);
    }

    function test_FundsBorrowedForTheSubmissionDoNotCount() public {
        token.set(reserve, 49_549);
        sample();
        token.set(reserve, 1_000_000);
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(KzgSolvencyRegistry.Insolvent.selector, 49_549, 49_550));
        registry.submitEpoch(sum, range);
    }

    function test_NoEpochBeforeTheFirstSubmission() public {
        vm.expectRevert(KzgSolvencyRegistry.NoEpoch.selector);
        registry.getEpoch(0);
    }

    function test_RejectsAnUnderstatedTotal() public {
        sum.totalLiabilities = 49_549;
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidOpening.selector);
        registry.submitEpoch(sum, range);
    }

    function test_RefusesTheVanishingPolynomialAttack() public {
        string memory attack = vm.readFile("arms/snarkless/fixtures/attack.json");
        KzgVerifier.G1Point memory cheat = g1(attack, ".balanceCommitment");
        KzgVerifier.G1Point memory cheatProof = g1(attack, ".sumProof");
        string memory epoch = vm.readFile("arms/snarkless/fixtures/epoch.json");

        assertTrue(
            KzgVerifier.verifyOpening(
                cheat, 0, vm.parseJsonUint(attack, ".constantTerm"), cheatProof, g2(epoch, ".g2"), g2(epoch, ".tauG2")
            )
        );

        loadRange(attack, ".range");
        sum.balanceCommitment = cheat;
        sum.sumProof = cheatProof;
        sum.totalLiabilities = vm.parseJsonUint(attack, ".totalLiabilities");
        assertEq(sum.totalLiabilities, 9550);
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.DegreeTooHigh.selector);
        registry.submitEpoch(sum, range);
    }

    function test_RejectsATamperedRangeValue() public {
        range.values[5] = addmod(range.values[5], 1, KzgVerifier.FR);
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidRangeProof.selector);
        registry.submitEpoch(sum, range);
    }

    function test_RejectsATamperedBitCommitment() public {
        range.bitCommitments[3] = range.bitCommitments[4];
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidRangeProof.selector);
        registry.submitEpoch(sum, range);
    }

    function test_RejectsARangeProofWithTooFewBits() public {
        range.bitCommitments.pop();
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidRangeProof.selector);
        registry.submitEpoch(sum, range);
    }

    function customerAt(uint256 i)
        internal
        view
        returns (uint256 index, uint256 identity, uint256 balance, KzgVerifier.G1Point memory proof)
    {
        string memory key = string.concat("[", vm.toString(i), "]");
        index = vm.parseJsonUint(inclusion, string.concat(key, ".index"));
        identity = vm.parseJsonUint(inclusion, string.concat(key, ".identity"));
        balance = vm.parseJsonUint(inclusion, string.concat(key, ".balance"));
        proof = g1(inclusion, string.concat(key, ".proof"));
    }

    function test_EveryCustomerVerifiesTheirSlot() public {
        submit();
        for (uint256 i = 0; i < 3; i++) {
            (uint256 index, uint256 identity, uint256 balance, KzgVerifier.G1Point memory proof) = customerAt(i);
            assertTrue(registry.verifyInclusion(0, index, identity, balance, proof));
        }
    }

    function test_AWrongBalanceIdentityOrSlotFails() public {
        submit();
        (uint256 index, uint256 identity, uint256 balance, KzgVerifier.G1Point memory proof) = customerAt(1);
        assertFalse(registry.verifyInclusion(0, index, identity, balance + 1, proof));
        assertFalse(registry.verifyInclusion(0, index, identity + 1, balance, proof));
        assertFalse(registry.verifyInclusion(0, index + 1, identity, balance, proof));
        assertFalse(registry.verifyInclusion(0, 8, identity, balance, proof));
        assertFalse(registry.verifyInclusion(1, index, identity, balance, proof));
    }
}
