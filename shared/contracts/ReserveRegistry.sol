// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

interface IERC1271 {
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4);
}

abstract contract ReserveRegistry {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant RESERVE_TYPEHASH =
        keccak256("ReserveControl(address wallet,uint256 nonce,uint256 expiry)");
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    uint256 public constant MAX_RESERVES = 64;

    enum ReserveStatus {
        None,
        Proposed,
        Proven,
        Approved
    }

    address public company;
    address public auditor;
    address public pendingCompany;
    address public pendingAuditor;

    uint64 public immutable maxEpochAge;
    uint64 public lastEpochAt;

    bytes32 private immutable domainNameHash;
    address[] public reserves;
    mapping(address => ReserveStatus) public reserveStatus;
    mapping(address => uint256) public reserveNonce;

    event ReserveProposed(address indexed wallet);
    event ReserveProven(address indexed wallet, uint256 nonce);
    event ReserveReviewed(address indexed wallet, bool approved);
    event ReserveRemoved(address indexed wallet, address by);
    event RoleTransferStarted(bytes32 indexed role, address indexed from, address indexed to);
    event RoleTransferred(bytes32 indexed role, address indexed from, address indexed to);

    error NotCompany();
    error NotAuditor();
    error NotAuthorized();
    error BadRoles();
    error BadReserve();
    error TooManyReserves();
    error SignatureExpired();
    error InvalidSignature();

    constructor(string memory domainName, address _company, address _auditor, uint64 _maxEpochAge) {
        if (_company == address(0) || _auditor == address(0) || _company == _auditor) revert BadRoles();
        if (_maxEpochAge == 0) revert BadRoles();
        company = _company;
        auditor = _auditor;
        maxEpochAge = _maxEpochAge;
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

    function transferCompany(address to) external onlyCompany {
        pendingCompany = to;
        emit RoleTransferStarted("company", company, to);
    }

    function transferAuditor(address to) external onlyAuditor {
        pendingAuditor = to;
        emit RoleTransferStarted("auditor", auditor, to);
    }

    function acceptCompany() external {
        if (msg.sender != pendingCompany || msg.sender == address(0)) revert NotAuthorized();
        if (msg.sender == auditor) revert BadRoles();
        emit RoleTransferred("company", company, msg.sender);
        company = msg.sender;
        pendingCompany = address(0);
    }

    function acceptAuditor() external {
        if (msg.sender != pendingAuditor || msg.sender == address(0)) revert NotAuthorized();
        if (msg.sender == company) revert BadRoles();
        emit RoleTransferred("auditor", auditor, msg.sender);
        auditor = msg.sender;
        pendingAuditor = address(0);
    }

    function _recordEpoch() internal {
        lastEpochAt = uint64(block.timestamp);
    }

    function epochAge() public view returns (uint64) {
        if (lastEpochAt == 0) return type(uint64).max;
        return uint64(block.timestamp) - lastEpochAt;
    }

    function isCurrent() public view returns (bool) {
        return lastEpochAt != 0 && block.timestamp - lastEpochAt <= maxEpochAge;
    }

    function reserveCount() external view returns (uint256) {
        return reserves.length;
    }

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

    function reserveDigest(address wallet, uint256 expiry) public view returns (bytes32) {
        bytes32 domain =
            keccak256(abi.encode(DOMAIN_TYPEHASH, domainNameHash, keccak256("1"), block.chainid, address(this)));
        bytes32 message = keccak256(abi.encode(RESERVE_TYPEHASH, wallet, reserveNonce[wallet], expiry));
        return keccak256(abi.encodePacked("\x19\x01", domain, message));
    }

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
            if (reserves.length >= MAX_RESERVES) revert TooManyReserves();
            reserves.push(wallet);
            reserveStatus[wallet] = ReserveStatus.Approved;
        } else {
            reserveStatus[wallet] = ReserveStatus.None;
        }
        emit ReserveReviewed(wallet, approved);
    }

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
        reserveNonce[wallet]++;
        reserveStatus[wallet] = ReserveStatus.None;
        emit ReserveRemoved(wallet, msg.sender);
    }

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
        if (uint256(s) > SECP256K1_HALF_ORDER) return false;
        return ecrecover(digest, v, r, s) == wallet;
    }
}
