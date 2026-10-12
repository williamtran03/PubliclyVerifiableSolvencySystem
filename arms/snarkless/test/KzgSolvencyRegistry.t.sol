// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KzgVerifier} from "../contracts/KzgVerifier.sol";
import {KzgSolvencyRegistry} from "../contracts/KzgSolvencyRegistry.sol";
import {KzgLiabilityArgument} from "../contracts/KzgLiabilityArgument.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";
import {ReserveDirectory} from "../../../shared/contracts/ReserveDirectory.sol";

contract UnitToken {
    mapping(address => uint256) public balanceOf;

    function set(address account, uint256 amount) external {
        balanceOf[account] = amount;
    }
}

contract KzgBookkeepingOnly is ReserveRegistry {
    address public immutable token;
    mapping(uint256 => KzgSolvencyRegistry.Epoch) private epochs;
    uint256 public epochCount;

    event EpochSubmitted(uint256 indexed epochId, uint256 totalLiabilities, uint256 reserveUnits);

    constructor(address _company, address _auditor, address _token, ReserveDirectory _directory)
        ReserveRegistry(_company, _auditor, 1 days, 1 hours, _directory)
    {
        token = _token;
    }

    function _reserveTokens() internal view override returns (address[] memory tokens) {
        tokens = new address[](1);
        tokens[0] = token;
    }

    function submitEpoch(KzgSolvencyRegistry.GrandSum calldata sum, KzgLiabilityArgument.Proof calldata)
        external
        onlyCompany
    {
        _requireSample();
        uint256 units = attestedBalance(token) / (10 ** 0);
        require(units >= sum.totalLiabilities, "insolvent");
        _recordEpoch();
        epochs[epochCount] = KzgSolvencyRegistry.Epoch(
            sum.balanceCommitment, sum.identityCommitment, sum.totalLiabilities, units, uint64(block.timestamp)
        );
        emit EpochSubmitted(epochCount, sum.totalLiabilities, units);
        epochCount++;
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

    KzgSolvencyRegistry.GrandSum sum;
    KzgLiabilityArgument.Proof proof;
    string inclusion;

    uint64 constant MAX_EPOCH_AGE = 1 days;
    uint64 constant MIN_EPOCH_INTERVAL = 1 hours;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_700_000_000);
        vm.roll(1_000);
        (reserve, reserveKey) = makeAddrAndKey("reserve");

        string memory epoch = vm.readFile("arms/snarkless/fixtures/epoch.json");
        token = new UnitToken();
        directory = new ReserveDirectory();
        deployCodeTo(
            "KzgSolvencyRegistry.sol:KzgSolvencyRegistry",
            abi.encode(company, auditor, address(token), uint8(0), MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory),
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
        sum.identityCommitment = g1(epoch, ".identityCommitment");
        sum.totalLiabilities = vm.parseJsonUint(epoch, ".totalLiabilities");

        loadProof(vm.readFile("arms/snarkless/fixtures/liability-proof.json"), "");

        inclusion = vm.readFile("arms/snarkless/fixtures/inclusion.json");
    }

    function loadProof(string memory json, string memory prefix) internal {
        delete proof;
        for (uint256 k = 0; k < 64; k++) {
            proof.bitCommitments.push(g1(json, string.concat(prefix, ".bitCommitments[", vm.toString(k), "]")));
        }
        proof.accumulatorCommitment = g1(json, string.concat(prefix, ".accumulatorCommitment"));
        proof.quotientCommitment = g1(json, string.concat(prefix, ".quotientCommitment"));
        uint256[] memory values = vm.parseJsonUintArray(json, string.concat(prefix, ".values"));
        for (uint256 i = 0; i < values.length; i++) {
            proof.values.push(values[i]);
        }
        proof.shiftedAccumulator = vm.parseJsonUint(json, string.concat(prefix, ".shiftedAccumulator"));
        proof.proofAtZeta = g1(json, string.concat(prefix, ".proofAtZeta"));
        proof.proofAtShiftedZeta = g1(json, string.concat(prefix, ".proofAtShiftedZeta"));
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
        registry.submitEpoch(sum, proof);
    }

    function test_PublishesTheSetupItVerifiesAgainst() public view {
        string memory ceremony = vm.readFile("arms/snarkless/fixtures/srs.json");
        KzgSolvencyRegistry.Srs memory published = registry.getSrs();
        string memory why = "a verifier has to be able to compare the deployed points with the public ceremony";
        assertEq(abi.encode(published.g2), abi.encode(ceremonyG2(ceremony, ".g2")), why);
        assertEq(abi.encode(published.tauG2), abi.encode(ceremonyG2(ceremony, ".tauG2")), why);
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
        registry.submitEpoch(sum, proof);
        uint256 used = before - gasleft();
        emit log_named_uint("kzg submitEpoch gas", used);
        assertLt(used, 2_500_000, "a regression beyond the figure the comparison quotes");
    }

    function test_GasForPreparedSubmission() public {
        bytes memory payload = abi.encodeCall(registry.submitEpoch, (sum, proof));
        address target = address(registry);
        vm.prank(company);
        uint256 before = gasleft();
        (bool ok,) = target.call(payload);
        uint256 used = before - gasleft();
        assertTrue(ok);
        emit log_named_uint("kzg prepared submitEpoch gas", used);
    }

    function test_GasForTheSameSubmissionWithoutKzgVerification() public {
        ReserveDirectory otherDirectory = new ReserveDirectory();
        KzgBookkeepingOnly bookkeeping = new KzgBookkeepingOnly(company, auditor, address(token), otherDirectory);
        vm.prank(company);
        bookkeeping.proposeReserve(reserve);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(reserveKey, bookkeeping.reserveDigest(reserve));
        bookkeeping.proveReserve(reserve, abi.encodePacked(r, s, v));
        vm.prank(auditor);
        bookkeeping.reviewReserve(reserve, true);
        vm.prank(auditor);
        bookkeeping.sampleReserves();
        vm.roll(block.number + 1);

        bytes memory payload = abi.encodeCall(bookkeeping.submitEpoch, (sum, proof));
        address target = address(bookkeeping);
        vm.prank(company);
        uint256 before = gasleft();
        (bool ok,) = target.call(payload);
        uint256 used = before - gasleft();
        assertTrue(ok, "the bookkeeping-only copy must accept the same calldata");
        assertEq(bookkeeping.epochCount(), 1);
        emit log_named_uint("kzg prepared submitEpoch bookkeeping-only gas, no KZG checks", used);
        emit log_named_uint("kzg submitEpoch calldata bytes", payload.length);
    }

    function test_GasForDeployment() public {
        uint256 before = gasleft();
        new KzgSolvencyRegistry(
            company, auditor, address(token), uint8(0), MAX_EPOCH_AGE, MIN_EPOCH_INTERVAL, directory
        );
        uint256 used = before - gasleft();
        emit log_named_uint("kzg registry deployment gas, excluding the 21000 intrinsic and calldata", used);
        assertLt(used, 6_000_000, "a regression beyond the figure the comparison quotes");
    }

    function test_GasForVerifyInclusion() public {
        submit();
        (uint256 index, uint256 identity, uint256 balance, KzgVerifier.G1Point memory opening) = customerAt(0);
        uint256 before = gasleft();
        bool included = registry.verifyInclusion(0, index, identity, balance, opening);
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
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_OnlyTheCompanySubmits() public {
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.NotCompany.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_RevertsIfInsolvent() public {
        token.set(reserve, 49_549);
        sample();
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(KzgSolvencyRegistry.Insolvent.selector, 49_549, 49_550));
        registry.submitEpoch(sum, proof);
    }

    function test_FundsBorrowedForTheSubmissionDoNotCount() public {
        token.set(reserve, 49_549);
        sample();
        token.set(reserve, 1_000_000);
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(KzgSolvencyRegistry.Insolvent.selector, 49_549, 49_550));
        registry.submitEpoch(sum, proof);
    }

    function test_NoEpochBeforeTheFirstSubmission() public {
        vm.expectRevert(KzgSolvencyRegistry.NoEpoch.selector);
        registry.getEpoch(0);
    }

    function test_RejectsAnUnderstatedTotal() public {
        sum.totalLiabilities = 49_549;
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function loadAttack() internal returns (uint256 understated) {
        string memory attack = vm.readFile("arms/snarkless/fixtures/attack.json");
        loadProof(attack, ".proof");
        sum.balanceCommitment = g1(attack, ".balanceCommitment");
        sum.totalLiabilities = vm.parseJsonUint(attack, ".totalLiabilities");
        understated = vm.parseJsonUint(attack, ".understatedTotal");
    }

    function test_APaddedBalancePolynomialCannotUnderstateTheTotal() public {
        uint256 understated = loadAttack();
        assertEq(understated, 9550);
        sum.totalLiabilities = understated;
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_APaddedBalancePolynomialStillProvesOnlyItsTrueTotal() public {
        loadAttack();
        submit();
        assertEq(
            registry.getEpoch(0).totalLiabilities,
            49_550,
            "the running sum covers the domain points, whatever the degree of the committed polynomial"
        );
    }

    function test_RejectsATamperedOpenedValue() public {
        proof.values[5] = addmod(proof.values[5], 1, KzgVerifier.FR);
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_RejectsATamperedBitCommitment() public {
        proof.bitCommitments[3] = proof.bitCommitments[4];
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_RejectsAProofWithTooFewBits() public {
        proof.bitCommitments.pop();
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_RejectsATamperedRunningSum() public {
        proof.shiftedAccumulator = addmod(proof.shiftedAccumulator, 1, KzgVerifier.FR);
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_RejectsASwappedAccumulatorCommitment() public {
        proof.accumulatorCommitment = proof.quotientCommitment;
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_RejectsAnOpenedValueOutsideTheField() public {
        proof.values[0] = KzgVerifier.FR;
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_RejectsARunningSumOutsideTheField() public {
        proof.shiftedAccumulator += KzgVerifier.FR;
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_RejectsATotalWrappedAroundTheField() public {
        token.set(reserve, type(uint256).max);
        vm.prank(auditor);
        registry.discardSample();
        sample();
        sum.totalLiabilities += KzgVerifier.FR;
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function test_RejectsACommitmentOffTheCurve() public {
        proof.accumulatorCommitment = KzgVerifier.G1Point(1, 3);
        vm.prank(company);
        vm.expectRevert();
        registry.submitEpoch(sum, proof);
    }

    function test_RejectsAnOpeningProofAtInfinity() public {
        proof.proofAtShiftedZeta = KzgVerifier.G1Point(0, 0);
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidLiabilityProof.selector);
        registry.submitEpoch(sum, proof);
    }

    function customerAt(uint256 i)
        internal
        view
        returns (uint256 index, uint256 identity, uint256 balance, KzgVerifier.G1Point memory opening)
    {
        string memory key = string.concat("[", vm.toString(i), "]");
        index = vm.parseJsonUint(inclusion, string.concat(key, ".index"));
        identity = vm.parseJsonUint(inclusion, string.concat(key, ".identity"));
        balance = vm.parseJsonUint(inclusion, string.concat(key, ".balance"));
        opening = g1(inclusion, string.concat(key, ".proof"));
    }

    function test_EveryCustomerVerifiesTheirSlot() public {
        submit();
        for (uint256 i = 0; i < 3; i++) {
            (uint256 index, uint256 identity, uint256 balance, KzgVerifier.G1Point memory opening) = customerAt(i);
            assertTrue(registry.verifyInclusion(0, index, identity, balance, opening));
        }
    }

    function test_AWrongBalanceIdentityOrSlotFails() public {
        submit();
        (uint256 index, uint256 identity, uint256 balance, KzgVerifier.G1Point memory opening) = customerAt(1);
        assertFalse(registry.verifyInclusion(0, index, identity, balance + 1, opening));
        assertFalse(registry.verifyInclusion(0, index, identity + 1, balance, opening));
        assertFalse(registry.verifyInclusion(0, index + 1, identity, balance, opening));
        assertFalse(registry.verifyInclusion(0, 8, identity, balance, opening));
        assertFalse(registry.verifyInclusion(1, index, identity, balance, opening));
    }
}
