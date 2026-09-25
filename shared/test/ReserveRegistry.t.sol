// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReserveRegistry} from "../contracts/ReserveRegistry.sol";
import {ReserveDirectory} from "../contracts/ReserveDirectory.sol";

contract Registry is ReserveRegistry {
    address[] private tokens;

    constructor(address company, address auditor, ReserveDirectory directory, address[] memory _tokens)
        ReserveRegistry(company, auditor, 1 days, 1 hours, directory)
    {
        tokens = _tokens;
    }

    function _reserveTokens() internal view override returns (address[] memory) {
        return tokens;
    }

    function recordEpoch() external {
        _recordEpoch();
    }

    function attested(address token) external view returns (uint256) {
        _requireSample();
        return attestedBalance(token);
    }
}

contract BoundedRegistry is ReserveRegistry {
    constructor(address company, address auditor, uint64 maxAge, uint64 minInterval, ReserveDirectory directory)
        ReserveRegistry(company, auditor, maxAge, minInterval, directory)
    {}

    function _reserveTokens() internal pure override returns (address[] memory tokens) {}
}

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract MockMultisig {
    bytes public approvedSignature;

    function approve(bytes calldata signature) external {
        approvedSignature = signature;
    }

    function isValidSignature(bytes32, bytes calldata signature) external view returns (bytes4) {
        return keccak256(signature) == keccak256(approvedSignature) ? this.isValidSignature.selector : bytes4(0);
    }
}

contract ReserveRegistryTest is Test {
    ReserveDirectory directory;
    MockToken token;
    Registry registry;
    address company = makeAddr("company");
    address auditor = makeAddr("auditor");
    address wallet;
    uint256 key;

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.roll(1_000);
        (wallet, key) = makeAddrAndKey("reserve");
        directory = new ReserveDirectory();
        token = new MockToken();
        registry = newRegistry();
    }

    function newRegistry() internal returns (Registry) {
        address[] memory tokens = new address[](2);
        tokens[1] = address(token);
        return new Registry(company, auditor, directory, tokens);
    }

    function sign(Registry target, address signer, uint256 signerKey) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, target.reserveDigest(signer));
        return abi.encodePacked(r, s, v);
    }

    function sign(address signer, uint256 signerKey) internal view returns (bytes memory) {
        return sign(registry, signer, signerKey);
    }

    function prove(address target, uint256 targetKey) internal {
        registry.proveReserve(target, sign(target, targetKey));
    }

    function propose(address target) internal {
        vm.prank(company);
        registry.proposeReserve(target);
    }

    function status(address target) internal view returns (uint256) {
        return uint256(registry.reserveStatus(target));
    }

    function approve(address target, uint256 targetKey) internal {
        propose(target);
        prove(target, targetKey);
        vm.prank(auditor);
        registry.reviewReserve(target, true);
    }

    function sample() internal {
        vm.prank(auditor);
        registry.sampleReserves();
    }

    function test_RejectsMissingOrMergedRoles() public {
        address[] memory none;
        vm.expectRevert(ReserveRegistry.BadRoles.selector);
        new Registry(address(0), auditor, directory, none);
        vm.expectRevert(ReserveRegistry.BadRoles.selector);
        new Registry(company, address(0), directory, none);
        vm.expectRevert(ReserveRegistry.BadRoles.selector);
        new Registry(company, company, directory, none);
    }

    function test_RejectsAScheduleWithoutAWindow() public {
        vm.expectRevert(ReserveRegistry.BadSchedule.selector);
        new BoundedRegistry(company, auditor, 0, 0, directory);
        vm.expectRevert(ReserveRegistry.BadSchedule.selector);
        new BoundedRegistry(company, auditor, 1 days, 1 days + 1, directory);
        new BoundedRegistry(company, auditor, 1 days, 1 days, directory);
    }

    function test_RejectsAMissingDirectory() public {
        vm.expectRevert(ReserveRegistry.BadDirectory.selector);
        new BoundedRegistry(company, auditor, 1 days, 1 hours, ReserveDirectory(address(0)));
    }

    function test_OnlyTheCompanyProposes() public {
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.NotCompany.selector);
        registry.proposeReserve(wallet);
    }

    function test_OnlyTheAuditorApproves() public {
        propose(wallet);
        prove(wallet, key);

        vm.prank(company);
        vm.expectRevert(ReserveRegistry.NotAuditor.selector);
        registry.reviewReserve(wallet, true);
    }

    function test_OutsidersCannotRemove() public {
        propose(wallet);
        vm.prank(makeAddr("outsider"));
        vm.expectRevert(ReserveRegistry.NotAuthorized.selector);
        registry.removeReserve(wallet);
    }

    function test_Lifecycle() public {
        propose(wallet);
        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.Proposed));
        assertEq(directory.registryOf(wallet), address(0), "proposing claims nothing");

        prove(wallet, key);
        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.Proven));
        assertEq(directory.registryOf(wallet), address(registry));
        assertEq(registry.reserveCount(), 0);

        vm.prank(auditor);
        registry.reviewReserve(wallet, true);
        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.Approved));
        assertEq(registry.reserveCount(), 1);
        assertEq(registry.reserves(0), wallet);

        vm.prank(auditor);
        registry.removeReserve(wallet);
        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.None));
        assertEq(registry.reserveCount(), 0);
        assertEq(directory.registryOf(wallet), address(0), "removal releases the claim");
    }

    function test_RemovalKeepsTheOtherReserves() public {
        address[3] memory wallets;
        for (uint256 i = 0; i < 3; i++) {
            uint256 walletKey;
            (wallets[i], walletKey) = makeAddrAndKey(string.concat("reserve", vm.toString(i)));
            approve(wallets[i], walletKey);
        }

        vm.prank(company);
        registry.removeReserve(wallets[0]);
        assertEq(registry.reserveCount(), 2);
        assertEq(registry.reserves(0), wallets[2]);
        assertEq(registry.reserves(1), wallets[1]);
    }

    function test_AuditorCannotApproveAnUnprovenReserve() public {
        propose(wallet);
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.BadReserve.selector);
        registry.reviewReserve(wallet, true);
    }

    function test_RejectedReserveCanBeProposedAgain() public {
        propose(wallet);
        prove(wallet, key);
        vm.prank(auditor);
        registry.reviewReserve(wallet, false);

        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.None));
        assertEq(registry.reserveCount(), 0);
        assertEq(directory.registryOf(wallet), address(0), "rejection releases the claim");
        propose(wallet);
    }

    function test_RejectsZeroAndDuplicateReserves() public {
        propose(wallet);
        vm.startPrank(company);
        vm.expectRevert(ReserveRegistry.BadReserve.selector);
        registry.proposeReserve(address(0));
        vm.expectRevert(ReserveRegistry.BadReserve.selector);
        registry.proposeReserve(wallet);
        vm.stopPrank();
    }

    function test_SumsOnlyApprovedReserves() public {
        (address other, uint256 otherKey) = makeAddrAndKey("other");
        token.mint(wallet, 5);
        token.mint(other, 7);
        vm.deal(wallet, 1 ether);

        propose(wallet);
        prove(wallet, key);
        propose(other);
        prove(other, otherKey);
        vm.prank(auditor);
        registry.reviewReserve(wallet, true);

        assertEq(registry.reserveBalance(address(token)), 5);
        assertEq(registry.reserveBalance(address(0)), 1 ether);
    }

    function test_AWalletBacksOnlyOneRegistry() public {
        token.mint(wallet, 5);
        approve(wallet, key);

        Registry rival = newRegistry();
        vm.prank(company);
        rival.proposeReserve(wallet);
        bytes memory signature = sign(rival, wallet, key);
        vm.expectRevert(abi.encodeWithSelector(ReserveDirectory.ClaimedByAnotherRegistry.selector, address(registry)));
        rival.proveReserve(wallet, signature);

        vm.prank(company);
        registry.removeReserve(wallet);
        rival.proveReserve(wallet, sign(rival, wallet, key));
        assertEq(directory.registryOf(wallet), address(rival), "released wallets can move, one registry at a time");
    }

    function test_ReservesStopCountingAtTheNextWindowUntilProvenAgain() public {
        token.mint(wallet, 5);
        approve(wallet, key);
        assertEq(registry.reserveBalance(address(token)), 5);

        registry.recordEpoch();
        assertEq(registry.reserveBalance(address(token)), 0, "control shown last window does not carry over");

        vm.roll(block.number + 1);
        prove(wallet, key);
        assertEq(status(wallet), uint256(ReserveRegistry.ReserveStatus.Approved));
        assertEq(registry.reserveBalance(address(token)), 5);
    }

    function test_ControlSignatureIsBoundToTheWindowItWasSignedFor() public {
        propose(wallet);
        bytes32 challenge = registry.windowChallenge();
        bytes memory signature = sign(wallet, key);

        registry.recordEpoch();
        assertTrue(registry.windowChallenge() != challenge, "every window opens with a challenge of its own");

        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, signature);
        registry.proveReserve(wallet, sign(wallet, key));
    }

    function test_AChallengeIsNeverEmpty() public {
        vm.expectRevert(ReserveDirectory.BadChallenge.selector);
        directory.controlDigest(wallet, address(registry), bytes32(0));
        assertTrue(
            registry.windowChallenge() != bytes32(0), "an empty challenge would be a signature anyone can prepare"
        );
    }

    function test_EpochsRespectTheMinimumInterval() public {
        registry.recordEpoch();
        uint256 earliest = block.timestamp + 1 hours;

        vm.warp(earliest - 1);
        vm.expectRevert(abi.encodeWithSelector(ReserveRegistry.EpochTooSoon.selector, earliest));
        registry.recordEpoch();

        vm.warp(earliest);
        registry.recordEpoch();
        assertEq(registry.lapses(), 0);
    }

    function test_ALateEpochIsRecordedAsALapse() public {
        registry.recordEpoch();
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectEmit(address(registry));
        emit ReserveRegistry.EpochLapsed(2, 1 days + 1);
        registry.recordEpoch();
        assertEq(registry.lapses(), 1, "the missed deadline stays on record after publishing resumes");
        assertTrue(registry.isCurrent());
    }

    function test_OnlyTheAuditorSamples() public {
        vm.prank(company);
        vm.expectRevert(ReserveRegistry.NotAuditor.selector);
        registry.sampleReserves();
    }

    function test_SubmissionNeedsASampleFromAnEarlierBlock() public {
        token.mint(wallet, 5);
        approve(wallet, key);

        vm.expectRevert(ReserveRegistry.ReservesNotSampled.selector);
        registry.attested(address(token));

        sample();
        vm.expectRevert(ReserveRegistry.ReservesNotSampled.selector);
        registry.attested(address(token));

        vm.roll(block.number + 1);
        assertEq(registry.attested(address(token)), 5);
    }

    function test_FundsBorrowedAfterTheSampleDoNotCount() public {
        token.mint(wallet, 5);
        approve(wallet, key);
        sample();
        vm.roll(block.number + 1);

        token.mint(wallet, 1_000_000);
        assertEq(registry.reserveBalance(address(token)), 1_000_005);
        assertEq(registry.attested(address(token)), 5, "a flash loan inside the submission cannot reach the sample");
    }

    function test_FundsGoneAfterTheSampleDoNotCount() public {
        vm.deal(wallet, 10);
        approve(wallet, key);
        sample();
        vm.roll(block.number + 1);

        vm.deal(wallet, 4);
        assertEq(registry.attested(address(0)), 4);
    }

    function test_SamplingKeepsTheLowestBalanceOfTheWindow() public {
        vm.deal(wallet, 10);
        approve(wallet, key);
        sample();
        vm.deal(wallet, 3);
        sample();
        vm.deal(wallet, 10);
        sample();
        vm.roll(block.number + 1);

        assertEq(registry.attested(address(0)), 3);
    }

    function test_APrematureSampleCanBeDiscarded() public {
        token.mint(wallet, 5);
        approve(wallet, key);
        registry.recordEpoch();
        vm.roll(block.number + 1);

        sample();
        prove(wallet, key);
        vm.roll(block.number + 1);
        assertEq(registry.attested(address(token)), 0, "a sample taken before the re-proof pins zero for the window");

        vm.prank(auditor);
        vm.expectEmit(address(registry));
        emit ReserveRegistry.SampleDiscarded(2);
        registry.discardSample();
        vm.expectRevert(ReserveRegistry.ReservesNotSampled.selector);
        registry.attested(address(token));

        sample();
        vm.roll(block.number + 1);
        assertEq(registry.attested(address(token)), 5, "a fresh sample starts the window's minimum over");
    }

    function test_OnlyTheAuditorDiscardsASample() public {
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.ReservesNotSampled.selector);
        registry.discardSample();

        sample();
        vm.prank(company);
        vm.expectRevert(ReserveRegistry.NotAuditor.selector);
        registry.discardSample();
    }

    function test_AnEpochRetiresTheSample() public {
        vm.deal(wallet, 10);
        approve(wallet, key);
        sample();
        vm.roll(block.number + 1);
        registry.recordEpoch();

        assertEq(registry.attestedBalance(address(0)), 0);
        vm.expectRevert(ReserveRegistry.ReservesNotSampled.selector);
        registry.attested(address(0));
    }

    function test_CompanyRotatesInTwoSteps() public {
        address next = makeAddr("next company");

        vm.prank(company);
        registry.transferCompany(next);
        assertEq(registry.pendingCompany(), next);
        assertEq(registry.company(), company, "not transferred until accepted");

        vm.prank(next);
        registry.acceptCompany();
        assertEq(registry.company(), next);
        assertEq(registry.pendingCompany(), address(0));

        vm.prank(next);
        registry.proposeReserve(wallet);
        vm.prank(company);
        vm.expectRevert(ReserveRegistry.NotCompany.selector);
        registry.proposeReserve(makeAddr("another"));
    }

    function test_AuditorRotatesInTwoSteps() public {
        address next = makeAddr("next auditor");

        vm.prank(auditor);
        registry.transferAuditor(next);
        vm.prank(next);
        registry.acceptAuditor();
        assertEq(registry.auditor(), next);

        propose(wallet);
        prove(wallet, key);
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.NotAuditor.selector);
        registry.reviewReserve(wallet, true);
        vm.prank(next);
        registry.reviewReserve(wallet, true);
    }

    function test_NeitherRoleCanRotateTheOther() public {
        vm.prank(company);
        vm.expectRevert(ReserveRegistry.NotAuditor.selector);
        registry.transferAuditor(makeAddr("puppet"));

        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.NotCompany.selector);
        registry.transferCompany(makeAddr("puppet"));
    }

    function test_RotationCannotMergeTheRoles() public {
        vm.prank(company);
        registry.transferCompany(auditor);
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.BadRoles.selector);
        registry.acceptCompany();
        assertEq(registry.company(), company);
    }

    function test_OnlyThePendingRoleCanAccept() public {
        vm.prank(company);
        registry.transferCompany(makeAddr("next"));

        vm.prank(makeAddr("outsider"));
        vm.expectRevert(ReserveRegistry.NotAuthorized.selector);
        registry.acceptCompany();

        vm.prank(makeAddr("outsider"));
        vm.expectRevert(ReserveRegistry.NotAuthorized.selector);
        registry.acceptAuditor();
    }

    function test_RotationCanBeRetargetedBeforeAcceptance() public {
        address first = makeAddr("first");
        address second = makeAddr("second");

        vm.startPrank(company);
        registry.transferCompany(first);
        registry.transferCompany(second);
        vm.stopPrank();

        vm.prank(first);
        vm.expectRevert(ReserveRegistry.NotAuthorized.selector);
        registry.acceptCompany();
        vm.prank(second);
        registry.acceptCompany();
        assertEq(registry.company(), second);
    }

    function test_NoEpochIsNeverCurrent() public view {
        assertFalse(registry.isCurrent());
        assertEq(registry.epochAge(), type(uint64).max);
    }

    function test_EpochGoesStaleAtTheBound() public {
        registry.recordEpoch();
        assertTrue(registry.isCurrent());
        assertEq(registry.epochAge(), 0);

        vm.warp(block.timestamp + 1 days);
        assertEq(registry.epochAge(), 1 days);
        assertTrue(registry.isCurrent(), "exactly at the bound is still current");

        vm.warp(block.timestamp + 1);
        assertFalse(registry.isCurrent(), "one second past the bound is not");

        registry.recordEpoch();
        assertTrue(registry.isCurrent(), "publishing again restores it");
    }

    function test_ApprovalStopsAtMaxReserves() public {
        uint256 cap = registry.MAX_RESERVES();
        for (uint256 i = 0; i < cap; i++) {
            (address w, uint256 k) = makeAddrAndKey(string.concat("capped", vm.toString(i)));
            approve(w, k);
        }
        assertEq(registry.reserveCount(), cap);

        (address extra, uint256 extraKey) = makeAddrAndKey("one too many");
        propose(extra);
        prove(extra, extraKey);
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.TooManyReserves.selector);
        registry.reviewReserve(extra, true);

        address dropped = registry.reserves(0);
        vm.prank(company);
        registry.removeReserve(dropped);
        vm.prank(auditor);
        registry.reviewReserve(extra, true);
        assertEq(registry.reserveCount(), cap);
    }

    function testFuzz_ReserveBalanceSumsExactlyTheApproved(uint96 a, uint96 b, bool approveSecond) public {
        (address other, uint256 otherKey) = makeAddrAndKey("fuzz other");
        token.mint(wallet, a);
        token.mint(other, b);

        approve(wallet, key);
        propose(other);
        prove(other, otherKey);
        vm.prank(auditor);
        registry.reviewReserve(other, approveSecond);

        assertEq(registry.reserveBalance(address(token)), approveSecond ? uint256(a) + b : uint256(a));
    }

    function testFuzz_OnlyTheNamedSuccessorCanAccept(address next, address caller) public {
        vm.assume(next != address(0) && next != company && next != auditor);
        vm.assume(caller != next);

        vm.prank(company);
        registry.transferCompany(next);
        vm.prank(caller);
        vm.expectRevert(ReserveRegistry.NotAuthorized.selector);
        registry.acceptCompany();
        assertEq(registry.company(), company);
    }

    function test_RemovalInvalidatesAnOldSignature() public {
        propose(wallet);
        bytes memory signature = sign(wallet, key);
        registry.proveReserve(wallet, signature);

        vm.prank(company);
        registry.removeReserve(wallet);

        propose(wallet);
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, signature);
    }

    function test_ASignatureProvesControlOnlyOnce() public {
        propose(wallet);
        bytes memory signature = sign(wallet, key);
        registry.proveReserve(wallet, signature);

        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, signature);
    }

    function test_RejectsASignatureFromAnotherKey() public {
        (, uint256 wrongKey) = makeAddrAndKey("attacker");
        propose(wallet);

        bytes memory signature = sign(wallet, wrongKey);
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, signature);
    }

    function test_RejectsMalformedAndHighSSignatures() public {
        propose(wallet);

        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, hex"00");

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.reserveDigest(wallet));
        uint256 n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        bytes memory twin = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, twin);
    }

    function test_SignatureIsBoundToChainAndRegistry() public {
        bytes memory signature = sign(wallet, key);

        Registry other = newRegistry();
        vm.prank(company);
        other.proposeReserve(wallet);
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        other.proveReserve(wallet, signature);

        propose(wallet);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, signature);
    }

    function test_SignatureCannotBeReplayedAfterRemoval() public {
        bytes memory signature = sign(wallet, key);

        propose(wallet);
        registry.proveReserve(wallet, signature);
        vm.prank(company);
        registry.removeReserve(wallet);

        propose(wallet);
        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(wallet, signature);
    }

    function test_ContractWalletProvesControlThroughERC1271() public {
        MockMultisig multisig = new MockMultisig();
        multisig.approve(hex"c0ffee");
        propose(address(multisig));

        vm.expectRevert(ReserveRegistry.InvalidSignature.selector);
        registry.proveReserve(address(multisig), hex"bad0");

        registry.proveReserve(address(multisig), hex"c0ffee");
        assertEq(status(address(multisig)), uint256(ReserveRegistry.ReserveStatus.Proven));
    }
}
