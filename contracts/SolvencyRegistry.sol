// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title SolvencyRegistry
 * @notice Public, append-only record of a custodian's solvency claims.
 *
 * The contract is deliberately small. It stores one commitment to the
 * custodian's liabilities per epoch and refuses to store one that the
 * custodian's own on-chain reserves cannot cover. Everything expensive — the
 * customer list, the tree, the proofs — stays off-chain; the only thing that
 * needs to be public and unforgeable is the commitment.
 *
 * What the contract does NOT do, and cannot:
 *  - vouch that the reserve wallets hold assets the custodian actually owns
 *    rather than assets borrowed an hour before the snapshot (see
 *    docs/manipulations.md);
 *  - say anything about liabilities the custodian left out of its own CSV;
 *  - say anything about the next block. Solvency here is a statement about one
 *    instant.
 */
contract SolvencyRegistry {
    struct Epoch {
        uint256 rootHash;
        uint256 totalLiabilities;
        uint256 totalReserves;
        uint64 timestamp;
    }

    error NotOwner();
    error Insolvent(uint256 totalReserves, uint256 totalLiabilities);
    error NotAReserve(address wallet);
    error AlreadyAReserve(address wallet);
    error BadReserveSignature(address wallet, address recovered);

    event EpochSubmitted(
        uint256 indexed epochId,
        uint256 rootHash,
        uint256 totalLiabilities,
        uint256 totalReserves,
        uint64 timestamp
    );
    event ReserveAdded(address indexed wallet);
    event ReserveRemoved(address indexed wallet);

    address public immutable owner;

    Epoch public currentEpoch;
    uint256 public epochCount;

    address[] private _reserves;
    mapping(address => bool) public isReserve;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // --- Assets side -------------------------------------------------------

    /**
     * @notice The 32 bytes a wallet must sign to be listed as a reserve.
     * @dev Bound to this contract and this chain so a signature collected for
     *      one deployment cannot be replayed into another.
     */
    function reserveMessage(address wallet) public view returns (bytes32) {
        return keccak256(abi.encode("SolvencyRegistry.reserve", block.chainid, address(this), wallet));
    }

    /**
     * @notice `reserveMessage` under the EIP-191 prefix, which is what
     *         `addReserve` actually recovers against.
     * @dev The prefix is what keeps the digest from ever being a valid
     *      transaction payload, so signing it can never move funds.
     */
    function reserveDigest(address wallet) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reserveMessage(wallet)));
    }

    /**
     * @notice Adds a wallet to the reserve set, but only if the wallet itself
     *         signs for it.
     * @dev Without this signature the custodian could list Coinbase's cold
     *      wallet and claim its balance. It is a proof of *control*, not of
     *      ownership — see docs/manipulations.md for what that still leaves open.
     */
    function addReserve(address wallet, bytes calldata signature) external onlyOwner {
        if (isReserve[wallet]) revert AlreadyAReserve(wallet);

        address recovered = _recover(reserveDigest(wallet), signature);
        if (recovered != wallet) revert BadReserveSignature(wallet, recovered);

        isReserve[wallet] = true;
        _reserves.push(wallet);
        emit ReserveAdded(wallet);
    }

    function removeReserve(address wallet) external onlyOwner {
        if (!isReserve[wallet]) revert NotAReserve(wallet);

        isReserve[wallet] = false;
        uint256 length = _reserves.length;
        for (uint256 i = 0; i < length; i++) {
            if (_reserves[i] == wallet) {
                _reserves[i] = _reserves[length - 1];
                _reserves.pop();
                break;
            }
        }
        emit ReserveRemoved(wallet);
    }

    function reserves() external view returns (address[] memory) {
        return _reserves;
    }

    function reserveCount() external view returns (uint256) {
        return _reserves.length;
    }

    /// @notice Live sum of ETH held by every attested reserve wallet.
    function totalReserves() public view returns (uint256 total) {
        uint256 length = _reserves.length;
        for (uint256 i = 0; i < length; i++) {
            total += _reserves[i].balance;
        }
    }

    // --- Liabilities side --------------------------------------------------

    /**
     * @notice Publishes the commitment to this epoch's liabilities.
     * @param rootHash Commitment to the customer balances.
     * @param totalLiabilities Total owed to customers, in wei, as committed to.
     *
     * Reverting on insolvency rather than merely recording it is the point:
     * an insolvent epoch cannot be published at all, so "they never posted an
     * epoch" is the only shape a failure can take, and that is loud.
     */
    function submitEpoch(uint256 rootHash, uint256 totalLiabilities) external virtual onlyOwner {
        _submitEpoch(rootHash, totalLiabilities);
    }

    function _submitEpoch(uint256 rootHash, uint256 totalLiabilities) internal {
        uint256 reservesNow = totalReserves();
        if (reservesNow < totalLiabilities) revert Insolvent(reservesNow, totalLiabilities);

        currentEpoch = Epoch({
            rootHash: rootHash,
            totalLiabilities: totalLiabilities,
            totalReserves: reservesNow,
            timestamp: uint64(block.timestamp)
        });

        emit EpochSubmitted(
            epochCount, rootHash, totalLiabilities, reservesNow, uint64(block.timestamp)
        );
        epochCount++;
    }

    // --- Internals ---------------------------------------------------------

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;

        // Reject the upper half of the curve order: without this, (r, -s) is a
        // second valid signature for the same digest.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }

        return ecrecover(digest, v, r, s);
    }
}
