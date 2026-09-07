// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SolvencyRegistry} from "../contracts/SolvencyRegistry.sol";

contract SolvencyRegistryTest is Test {
    SolvencyRegistry internal registry;

    uint256 internal constant RESERVE_1_KEY = 0xA11CE;
    uint256 internal constant RESERVE_2_KEY = 0xB0B;
    address internal reserve1 = vm.addr(RESERVE_1_KEY);
    address internal reserve2 = vm.addr(RESERVE_2_KEY);
    address internal outsider = address(0xBEEF);

    event EpochSubmitted(
        uint256 indexed epochId,
        uint256 rootHash,
        uint256 totalLiabilities,
        uint256 totalReserves,
        uint64 timestamp
    );
    event ReserveAdded(address indexed wallet);
    event ReserveRemoved(address indexed wallet);

    function setUp() public virtual {
        registry = new SolvencyRegistry();
        _attest(reserve1, RESERVE_1_KEY);
        _attest(reserve2, RESERVE_2_KEY);

        vm.deal(reserve1, 40 ether);
        vm.deal(reserve2, 30 ether);
    }

    // --- helpers -----------------------------------------------------------

    function _sign(uint256 key, address wallet) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.reserveDigest(wallet));
        return abi.encodePacked(r, s, v);
    }

    function _attest(address wallet, uint256 key) internal {
        registry.addReserve(wallet, _sign(key, wallet));
    }

    /// The real root and total, as produced by `prover/buildTree.ts`.
    function _epochFixture() internal view returns (uint256 rootHash, uint256 totalLiabilities) {
        string memory json = vm.readFile("fixtures/epoch.json");
        rootHash = vm.parseJsonUint(json, ".rootHash");
        totalLiabilities = vm.parseJsonUint(json, ".totalLiabilities");
    }

    // --- reserves ----------------------------------------------------------

    function test_ReservesAreAttestedByTheWalletItself() public view {
        assertTrue(registry.isReserve(reserve1));
        assertTrue(registry.isReserve(reserve2));
        assertEq(registry.reserveCount(), 2);
        assertEq(registry.totalReserves(), 70 ether);
    }

    function test_RevertsWhenTheReserveSignatureIsFromSomeoneElse() public {
        address stranger = vm.addr(0xC0FFEE);
        bytes memory wrongSignature = _sign(RESERVE_1_KEY, stranger);

        vm.expectRevert(
            abi.encodeWithSelector(
                SolvencyRegistry.BadReserveSignature.selector, stranger, reserve1
            )
        );
        registry.addReserve(stranger, wrongSignature);
    }

    function test_RevertsWhenTheSameWalletIsAddedTwice() public {
        // Signed up front: `vm.expectRevert` binds to the next call, and
        // `_sign` itself calls into the registry.
        bytes memory signature = _sign(RESERVE_1_KEY, reserve1);

        vm.expectRevert(
            abi.encodeWithSelector(SolvencyRegistry.AlreadyAReserve.selector, reserve1)
        );
        registry.addReserve(reserve1, signature);
    }

    function test_RevertsWhenAReserveSignatureIsMalleable() public {
        address wallet = vm.addr(0xC0FFEE);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xC0FFEE, registry.reserveDigest(wallet));

        uint256 order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(order - uint256(s)), v == 27 ? 28 : 27);

        vm.expectRevert();
        registry.addReserve(wallet, flipped);
    }

    function test_RemovingAReserveDropsItsBalance() public {
        vm.expectEmit(true, false, false, false);
        emit ReserveRemoved(reserve2);
        registry.removeReserve(reserve2);

        assertFalse(registry.isReserve(reserve2));
        assertEq(registry.reserveCount(), 1);
        assertEq(registry.totalReserves(), 40 ether);
    }

    function test_RevertsWhenAnOutsiderTouchesTheReserveSet() public {
        vm.prank(outsider);
        vm.expectRevert(SolvencyRegistry.NotOwner.selector);
        registry.removeReserve(reserve1);
    }

    // --- epochs ------------------------------------------------------------

    function test_SubmitsTheRealProverFixture() public {
        (uint256 rootHash, uint256 totalLiabilities) = _epochFixture();
        registry.submitEpoch(rootHash, totalLiabilities);

        (uint256 storedHash, uint256 storedLiabilities, uint256 storedReserves, uint64 timestamp) =
            registry.currentEpoch();

        assertEq(storedHash, rootHash);
        assertEq(storedLiabilities, totalLiabilities);
        assertEq(storedReserves, 70 ether);
        assertEq(timestamp, block.timestamp);
        assertEq(registry.epochCount(), 1);
    }

    function test_EmitsEpochSubmittedWithTheStoredValues() public {
        (uint256 rootHash, uint256 totalLiabilities) = _epochFixture();

        vm.expectEmit(true, false, false, true);
        emit EpochSubmitted(0, rootHash, totalLiabilities, 70 ether, uint64(block.timestamp));
        registry.submitEpoch(rootHash, totalLiabilities);
    }

    function test_LaterEpochsOverwriteEarlierOnesAndBumpTheCounter() public {
        (uint256 rootHash, uint256 totalLiabilities) = _epochFixture();
        registry.submitEpoch(rootHash, totalLiabilities);

        vm.warp(block.timestamp + 1 days);
        registry.submitEpoch(rootHash + 1, totalLiabilities - 1);

        (uint256 storedHash, uint256 storedLiabilities,, uint64 timestamp) = registry.currentEpoch();
        assertEq(storedHash, rootHash + 1);
        assertEq(storedLiabilities, totalLiabilities - 1);
        assertEq(timestamp, block.timestamp);
        assertEq(registry.epochCount(), 2);
    }

    function test_RevertsForNonOwner() public {
        vm.prank(outsider);
        vm.expectRevert(SolvencyRegistry.NotOwner.selector);
        registry.submitEpoch(123, 1 ether);
    }

    function test_RevertsIfInsolvent() public {
        (uint256 rootHash, uint256 totalLiabilities) = _epochFixture();

        vm.deal(reserve1, 1 ether);
        vm.deal(reserve2, 1 ether);

        vm.expectRevert(
            abi.encodeWithSelector(SolvencyRegistry.Insolvent.selector, 2 ether, totalLiabilities)
        );
        registry.submitEpoch(rootHash, totalLiabilities);
    }

    function test_RevertsWhenReservesFallJustOneWeiShort() public {
        (uint256 rootHash, uint256 totalLiabilities) = _epochFixture();

        vm.deal(reserve1, totalLiabilities - 1);
        vm.deal(reserve2, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                SolvencyRegistry.Insolvent.selector, totalLiabilities - 1, totalLiabilities
            )
        );
        registry.submitEpoch(rootHash, totalLiabilities);

        vm.deal(reserve2, 1);
        registry.submitEpoch(rootHash, totalLiabilities);
        assertEq(registry.epochCount(), 1);
    }

    function testFuzz_AcceptsExactlyWhenReservesCover(uint96 liabilities, uint96 funding) public {
        vm.deal(reserve1, funding);
        vm.deal(reserve2, 0);

        if (funding >= liabilities) {
            registry.submitEpoch(1, liabilities);
            assertEq(registry.epochCount(), 1);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(SolvencyRegistry.Insolvent.selector, funding, liabilities)
            );
            registry.submitEpoch(1, liabilities);
        }
    }
}
