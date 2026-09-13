// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

interface IERC1271 {
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4);
}

// The assets side every arm shares: who may act, and which wallets count as reserves.
// Ownership is not eligibility: a wallet's signature proves control, the auditor's
// approval decides whether it counts. Only Approved wallets are summed.
abstract contract ReserveRegistry {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant RESERVE_TYPEHASH =
        keccak256("ReserveControl(address wallet,uint256 nonce,uint256 expiry)");
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    enum ReserveStatus {
        None,
        Proposed,
        Proven,
        Approved
    }

    address public immutable company;
    address public immutable auditor;
    bytes32 private immutable domainNameHash;
    address[] public reserves;
    mapping(address => ReserveStatus) public reserveStatus;
    mapping(address => uint256) public reserveNonce;

    event ReserveProposed(address indexed wallet);
    event ReserveProven(address indexed wallet, uint256 nonce);
    event ReserveReviewed(address indexed wallet, bool approved);
    event ReserveRemoved(address indexed wallet, address by);

    error NotCompany();
    error NotAuditor();
    error NotAuthorized();
    error BadRoles();
    error BadReserve();
    error SignatureExpired();
    error InvalidSignature();

    constructor(string memory domainName, address _company, address _auditor) {
        // An auditor who is also the company approves its own reserves, which is no check at all.
        if (_company == address(0) || _auditor == address(0) || _company == _auditor) revert BadRoles();
        company = _company;
        auditor = _auditor;
        domainNameHash = keccak256(bytes(domainName));
    }

    modifier onlyCompany() {
        if (msg.sender != company) revert NotCompany();
        _;
    }

    modifier onlyAuditor() {
        if (msg.sender != auditor) revert NotAuditor();
        _;
    }

    function reserveCount() external view returns (uint256) {
        return reserves.length;
    }

    // Raw balance of `token` (address(0) = native ETH) across approved reserves.
    function reserveBalance(address token) public view returns (uint256 raw) {
        for (uint256 i = 0; i < reserves.length; i++) {
            raw += token == address(0) ? reserves[i].balance : IERC20Balance(token).balanceOf(reserves[i]);
        }
    }

    function proposeReserve(address wallet) external onlyCompany {
        if (wallet == address(0) || reserveStatus[wallet] != ReserveStatus.None) revert BadReserve();
        reserveStatus[wallet] = ReserveStatus.Proposed;
        emit ReserveProposed(wallet);
    }

    // EIP-712, so a wallet shows what it is signing instead of an opaque hash. The chain id
    // and this contract's address sit in the domain, so the signature cannot be replayed on
    // another chain or into another registry; the nonce stops replay after a removal.
    // Recomputed per call rather than cached, so it stays correct after a chain fork.
    function reserveDigest(address wallet, uint256 expiry) public view returns (bytes32) {
        bytes32 domain =
            keccak256(abi.encode(DOMAIN_TYPEHASH, domainNameHash, keccak256("1"), block.chainid, address(this)));
        bytes32 message = keccak256(abi.encode(RESERVE_TYPEHASH, wallet, reserveNonce[wallet], expiry));
        return keccak256(abi.encodePacked("\x19\x01", domain, message));
    }

    // Anyone may relay the signature, so a cold wallet never needs gas or to send a transaction.
    function proveReserve(address wallet, uint256 expiry, bytes calldata signature) external {
        if (reserveStatus[wallet] != ReserveStatus.Proposed) revert BadReserve();
        if (block.timestamp > expiry) revert SignatureExpired();
        if (!signedBy(wallet, reserveDigest(wallet, expiry), signature)) revert InvalidSignature();

        emit ReserveProven(wallet, reserveNonce[wallet]);
        reserveNonce[wallet]++;
        reserveStatus[wallet] = ReserveStatus.Proven;
    }

    function reviewReserve(address wallet, bool approved) external onlyAuditor {
        if (reserveStatus[wallet] != ReserveStatus.Proven) revert BadReserve();
        if (approved) {
            reserves.push(wallet);
            reserveStatus[wallet] = ReserveStatus.Approved;
        } else {
            reserveStatus[wallet] = ReserveStatus.None;
        }
        emit ReserveReviewed(wallet, approved);
    }

    // Either role may drop a reserve at any stage. Removal can only lower the assets
    // figure, so unlike adding one it needs no second sign-off.
    function removeReserve(address wallet) external {
        if (msg.sender != company && msg.sender != auditor) revert NotAuthorized();
        if (reserveStatus[wallet] == ReserveStatus.None) revert BadReserve();

        if (reserveStatus[wallet] == ReserveStatus.Approved) {
            for (uint256 i = 0; i < reserves.length; i++) {
                if (reserves[i] == wallet) {
                    reserves[i] = reserves[reserves.length - 1];
                    reserves.pop();
                    break;
                }
            }
        }
        // Also invalidates a signature collected while the wallet was only proposed.
        reserveNonce[wallet]++;
        reserveStatus[wallet] = ReserveStatus.None;
        emit ReserveRemoved(wallet, msg.sender);
    }

    // Exchanges commonly hold reserves in multisigs, which cannot produce an ECDSA
    // signature, so a wallet with code is asked through ERC-1271 instead.
    function signedBy(address wallet, bytes32 digest, bytes calldata signature) private view returns (bool) {
        if (wallet.code.length > 0) {
            try IERC1271(wallet).isValidSignature(digest, signature) returns (bytes4 magic) {
                return magic == IERC1271.isValidSignature.selector;
            } catch {
                return false;
            }
        }

        if (signature.length != 65) return false;
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        // A high-s twin of a valid signature would also recover; accept only one encoding.
        if (uint256(s) > SECP256K1_HALF_ORDER) return false;
        // wallet is never address(0), so ecrecover's failure value cannot match it.
        return ecrecover(digest, v, r, s) == wallet;
    }
}
