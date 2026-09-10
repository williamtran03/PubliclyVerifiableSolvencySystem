// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IContractSignature {
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4);
}

/// @notice Ownership is separate from auditor eligibility. Historical balances require attestation.
contract AuditedAssets {
    enum Status {
        None,
        Pending,
        Approved,
        Rejected,
        Retired
    }

    struct Asset {
        address token;
        address reserve;
        address feed;
        bool nativeAsset;
        bool ownershipVerified;
        Status status;
        bool removalPending;
        uint256 nonce;
        uint256 proposedAt;
        uint256 verifiedAt;
    }
    address public immutable company;
    address public immutable auditor;
    uint256 public assetCount;
    mapping(uint256 => Asset) internal assets;
    mapping(bytes32 => bool) private activeKeys;
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant OWNERSHIP_TYPEHASH = keccak256("Ownership(uint256 assetId,uint256 nonce,uint256 expiry)");
    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error InvalidSignature();
    error Expired();
    event AssetProposed(uint256 indexed assetId, address token, address reserve, address feed);
    event ReserveVerified(uint256 indexed assetId, address reserve, uint256 nonce);
    event AssetVerified(uint256 indexed assetId, bool approved, address auditor);
    event AssetRemovalRequested(uint256 indexed assetId);
    event AssetRemovalVerified(uint256 indexed assetId, bool approved);

    modifier onlyCompany() {
        if (msg.sender != company) revert Unauthorized();
        _;
    }
    modifier onlyAuditor() {
        if (msg.sender != auditor) revert Unauthorized();
        _;
    }

    constructor(address company_, address auditor_) {
        if (company_ == address(0) || auditor_ == address(0) || company_ == auditor_) revert InvalidInput();
        company = company_;
        auditor = auditor_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MinimumSolvency"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function getAsset(uint256 id) public view returns (Asset memory) {
        return assets[id];
    }

    function addAsset(address token, address reserve, address feed, bool nativeAsset)
        external
        onlyCompany
        returns (uint256 id)
    {
        // Native currency uses the nonzero 0xEeee... sentinel, never a token contract.
        if (
            token == address(0) || reserve == address(0) || feed == address(0) || feed.code.length == 0
                || (nativeAsset ? token != address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE) : token.code.length == 0)
        ) revert InvalidInput();
        bytes32 key = keccak256(abi.encode(token, reserve));
        if (activeKeys[key]) revert InvalidState();
        activeKeys[key] = true;
        id = ++assetCount;
        assets[id] = Asset(token, reserve, feed, nativeAsset, false, Status.Pending, false, 0, block.timestamp, 0);
        emit AssetProposed(id, token, reserve, feed);
    }

    function ownershipDigest(uint256 id, uint256 expiry) public view returns (bytes32) {
        // Compute with the current chain ID to remain replay-safe after a chain fork.
        bytes32 separator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MinimumSolvency"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
        return keccak256(
            abi.encodePacked(
                "\x19\x01", separator, keccak256(abi.encode(OWNERSHIP_TYPEHASH, id, assets[id].nonce, expiry))
            )
        );
    }

    function verifyAsset(uint256 id, uint256 expiry, bytes calldata signature) external {
        Asset storage a = assets[id];
        if (a.status != Status.Pending || a.ownershipVerified) revert InvalidState();
        if (expiry < block.timestamp) revert Expired();
        if (msg.sender != a.reserve) {
            bytes32 digest = ownershipDigest(id, expiry);
            if (a.reserve.code.length > 0) {
                try IContractSignature(a.reserve).isValidSignature(digest, signature) returns (bytes4 result) {
                    if (result != 0x1626ba7e) revert InvalidSignature();
                } catch {
                    revert InvalidSignature();
                }
            } else {
                if (signature.length != 65) revert InvalidSignature();
                bytes32 r;
                bytes32 s;
                uint8 v;
                assembly {
                    r := calldataload(signature.offset)
                    s := calldataload(add(signature.offset, 32))
                    v := byte(0, calldataload(add(signature.offset, 64)))
                }
                if (
                    uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0
                        || (v != 27 && v != 28) || ecrecover(digest, v, r, s) != a.reserve
                ) revert InvalidSignature();
            }
        }
        a.ownershipVerified = true;
        a.nonce++;
        emit ReserveVerified(id, a.reserve, a.nonce);
    }

    function approveAsset(uint256 id, bool approved) external onlyAuditor {
        Asset storage a = assets[id];
        if (a.status != Status.Pending || a.removalPending || (approved && !a.ownershipVerified)) {
            revert InvalidState();
        }
        a.status = approved ? Status.Approved : Status.Rejected;
        a.verifiedAt = block.timestamp;
        if (!approved) activeKeys[keccak256(abi.encode(a.token, a.reserve))] = false;
        emit AssetVerified(id, approved, msg.sender);
    }

    function removeAsset(uint256 id) external onlyCompany {
        Asset storage a = assets[id];
        if ((a.status != Status.Pending && a.status != Status.Approved) || a.removalPending) revert InvalidState();
        a.removalPending = true;
        emit AssetRemovalRequested(id);
    }

    function verifyRemoveAsset(uint256 id, bool approved) external onlyAuditor {
        Asset storage a = assets[id];
        if (!a.removalPending) revert InvalidState();
        a.removalPending = false;
        if (approved) {
            a.status = Status.Retired;
            activeKeys[keccak256(abi.encode(a.token, a.reserve))] = false;
        }
        emit AssetRemovalVerified(id, approved);
    }
}
