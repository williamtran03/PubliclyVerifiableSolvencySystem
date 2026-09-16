// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KzgVerifier} from "../contracts/KzgVerifier.sol";
import {KzgSolvencyRegistry} from "../contracts/KzgSolvencyRegistry.sol";
import {ReserveRegistry} from "../../../shared/contracts/ReserveRegistry.sol";

contract UnitToken {
    mapping(address => uint256) public balanceOf;

    function set(address account, uint256 amount) external {
        balanceOf[account] = amount;
    }
}

// Reserve mechanics are tested in shared/test/ReserveRegistry.t.sol; this covers the arm.
contract KzgSolvencyRegistryTest is Test {
    KzgSolvencyRegistry registry;
    UnitToken token;
    address company = makeAddr("company");
    address auditor = makeAddr("auditor");
    address reserve;

    KzgSolvencyRegistry.GrandSum sum;
    KzgSolvencyRegistry.RangeProof range;
    string inclusion;

    uint64 constant MAX_EPOCH_AGE = 1 days;

    function setUp() public {
        vm.warp(1_700_000_000);
        uint256 key;
        (reserve, key) = makeAddrAndKey("reserve");

        string memory epoch = vm.readFile("arms/snarkless/fixtures/epoch.json");
        KzgSolvencyRegistry.Srs memory srs =
            KzgSolvencyRegistry.Srs(g2(epoch, ".g2"), g2(epoch, ".tauG2"), g2(epoch, ".boundG2"));
        token = new UnitToken();
        registry = new KzgSolvencyRegistry(company, auditor, address(token), 0, srs, MAX_EPOCH_AGE);

        token.set(reserve, 50_000); // liabilities are 49,550
        vm.prank(company);
        registry.proposeReserve(reserve);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.reserveDigest(reserve, block.timestamp));
        registry.proveReserve(reserve, block.timestamp, abi.encodePacked(r, s, v));
        vm.prank(auditor);
        registry.reviewReserve(reserve, true);

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

    function submit() internal {
        vm.prank(company);
        registry.submitEpoch(sum, range);
    }

    // ---- epochs -------------------------------------------------------------

    function test_SubmitEpoch() public {
        submit();
        KzgSolvencyRegistry.Epoch memory epoch = registry.getEpoch(0);
        assertEq(epoch.totalLiabilities, 49_550);
        assertEq(epoch.reserveUnits, 50_000);
        assertEq(epoch.balanceCommitment.x, sum.balanceCommitment.x);
        assertEq(registry.epochCount(), 1);
    }

    // The figure docs/comparison.md quotes. The gas report cannot supply it: its max
    // column includes the reverting calls.
    function test_GasForASuccessfulSubmission() public {
        vm.prank(company);
        uint256 before = gasleft();
        registry.submitEpoch(sum, range);
        uint256 used = before - gasleft();
        emit log_named_uint("kzg submitEpoch gas", used);
        assertLt(used, 2_500_000, "a regression beyond the figure the comparison quotes");
    }

    function test_OnlyTheCompanySubmits() public {
        vm.prank(auditor);
        vm.expectRevert(ReserveRegistry.NotCompany.selector);
        registry.submitEpoch(sum, range);
    }

    function test_RevertsIfInsolvent() public {
        token.set(reserve, 49_549);
        vm.prank(company);
        vm.expectRevert(abi.encodeWithSelector(KzgSolvencyRegistry.Insolvent.selector, 49_549, 49_550));
        registry.submitEpoch(sum, range);
    }

    function test_NoEpochBeforeTheFirstSubmission() public {
        vm.expectRevert(KzgSolvencyRegistry.NoEpoch.selector);
        registry.getEpoch(0);
    }

    // ---- the published total ------------------------------------------------

    function test_RejectsAnUnderstatedTotal() public {
        sum.totalLiabilities = 49_549;
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.InvalidOpening.selector);
        registry.submitEpoch(sum, range);
    }

    function test_RefusesTheVanishingPolynomialAttack() public {
        // p + 5000·Z_H: same balances on the domain, total 9,550 instead of 49,550.
        string memory attack = vm.readFile("arms/snarkless/fixtures/attack.json");
        KzgVerifier.G1Point memory cheat = g1(attack, ".balanceCommitment");
        KzgVerifier.G1Point memory cheatProof = g1(attack, ".sumProof");
        string memory epoch = vm.readFile("arms/snarkless/fixtures/epoch.json");

        // The opening at 0 alone, which was the whole check before, accepts it.
        assertTrue(
            KzgVerifier.verifyOpening(
                cheat, 0, vm.parseJsonUint(attack, ".constantTerm"), cheatProof, g2(epoch, ".g2"), g2(epoch, ".tauG2")
            )
        );

        // A range proof for the cheating commitment verifies too: the balances on the domain
        // are real. Only the degree bound is left to catch it.
        loadRange(attack, ".range");
        sum.balanceCommitment = cheat;
        sum.sumProof = cheatProof;
        sum.totalLiabilities = vm.parseJsonUint(attack, ".totalLiabilities");
        assertEq(sum.totalLiabilities, 9550);
        vm.prank(company);
        vm.expectRevert(KzgSolvencyRegistry.DegreeTooHigh.selector);
        registry.submitEpoch(sum, range);
    }

    // ---- range argument -----------------------------------------------------

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

    // ---- inclusion ----------------------------------------------------------

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
