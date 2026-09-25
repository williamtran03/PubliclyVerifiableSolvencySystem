// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReserveDirectory} from "./ReserveDirectory.sol";

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

abstract contract ReserveRegistry {
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

    ReserveDirectory public immutable directory;
    uint64 public immutable maxEpochAge;
    uint64 public immutable minEpochInterval;
    uint64 public lastEpochAt;
    uint64 public lapses;
    uint64 public window;
    uint64 public sampledWindow;
    uint64 public sampledBlock;
    bytes32 public windowChallenge;

    address[] public reserves;
    mapping(address => ReserveStatus) public reserveStatus;
    mapping(address => uint64) public confirmedWindow;
    mapping(address => uint256) private sampledBalance;

    event ReserveProposed(address indexed wallet);
    event ReserveProven(address indexed wallet, uint64 window);
    event ReserveReviewed(address indexed wallet, bool approved);
    event ReserveRemoved(address indexed wallet, address by);
    event ReservesSampled(uint64 indexed window, uint256 blockNumber);
    event SampleDiscarded(uint64 indexed window);
    event WindowOpened(uint64 indexed window, bytes32 challenge);
    event EpochLapsed(uint64 indexed window, uint256 gap);
    event RoleTransferStarted(bytes32 indexed role, address indexed from, address indexed to);
    event RoleTransferred(bytes32 indexed role, address indexed from, address indexed to);

    error NotCompany();
    error NotAuditor();
    error NotAuthorized();
    error BadRoles();
    error BadSchedule();
    error BadDirectory();
    error BadReserve();
    error TooManyReserves();
    error InvalidSignature();
    error EpochTooSoon(uint256 earliest);
    error ReservesNotSampled();

    constructor(
        address _company,
        address _auditor,
        uint64 _maxEpochAge,
        uint64 _minEpochInterval,
        ReserveDirectory _directory
    ) {
        if (_company == address(0) || _auditor == address(0) || _company == _auditor) {
            revert BadRoles();
        }
        if (_maxEpochAge == 0 || _minEpochInterval > _maxEpochAge) revert BadSchedule();
        if (address(_directory) == address(0)) revert BadDirectory();
        company = _company;
        auditor = _auditor;
        maxEpochAge = _maxEpochAge;
        minEpochInterval = _minEpochInterval;
        directory = _directory;
        window = 1;
        _openWindow();
    }

    modifier onlyCompany() {
        if (msg.sender != company) revert NotCompany();
        _;
    }

    modifier onlyAuditor() {
        if (msg.sender != auditor) revert NotAuditor();
        _;
    }

    function _reserveTokens() internal view virtual returns (address[] memory);

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
        if (lastEpochAt != 0) {
            uint256 gap = block.timestamp - lastEpochAt;
            if (gap < minEpochInterval) revert EpochTooSoon(lastEpochAt + minEpochInterval);
            if (gap > maxEpochAge) {
                lapses++;
                emit EpochLapsed(window, gap);
            }
        }
        lastEpochAt = uint64(block.timestamp);
        window++;
        _openWindow();
    }

    function _openWindow() private {
        windowChallenge =
            keccak256(abi.encode(blockhash(block.number - 1), block.prevrandao, block.number, address(this), window));
        emit WindowOpened(window, windowChallenge);
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
            address wallet = reserves[i];
            if (confirmedWindow[wallet] != window) continue;
            raw += token == address(0) ? wallet.balance : IERC20Balance(token).balanceOf(wallet);
        }
    }

    function sampleReserves() external onlyAuditor {
        address[] memory tokens = _reserveTokens();
        bool first = sampledWindow != window;
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 balance = reserveBalance(tokens[i]);
            if (first || balance < sampledBalance[tokens[i]]) sampledBalance[tokens[i]] = balance;
        }
        sampledWindow = window;
        sampledBlock = uint64(block.number);
        emit ReservesSampled(window, block.number);
    }

    function discardSample() external onlyAuditor {
        if (sampledWindow != window) revert ReservesNotSampled();
        sampledWindow = 0;
        emit SampleDiscarded(window);
    }

    function attestedBalance(address token) public view returns (uint256) {
        if (sampledWindow != window) return 0;
        uint256 live = reserveBalance(token);
        uint256 sampled = sampledBalance[token];
        return live < sampled ? live : sampled;
    }

    function _requireSample() internal view {
        if (sampledWindow != window || sampledBlock >= block.number) revert ReservesNotSampled();
    }

    function proposeReserve(address wallet) external onlyCompany {
        if (wallet == address(0) || reserveStatus[wallet] != ReserveStatus.None) revert BadReserve();
        reserveStatus[wallet] = ReserveStatus.Proposed;
        emit ReserveProposed(wallet);
    }

    function reserveDigest(address wallet) public view returns (bytes32) {
        return directory.controlDigest(wallet, address(this), windowChallenge);
    }

    function proveReserve(address wallet, bytes calldata signature) external {
        ReserveStatus current = reserveStatus[wallet];
        if (current == ReserveStatus.None) revert BadReserve();
        if (!directory.proveControl(wallet, windowChallenge, signature)) revert InvalidSignature();

        if (current == ReserveStatus.Proposed) reserveStatus[wallet] = ReserveStatus.Proven;
        confirmedWindow[wallet] = window;
        emit ReserveProven(wallet, window);
    }

    function reviewReserve(address wallet, bool approved) external onlyAuditor {
        if (reserveStatus[wallet] != ReserveStatus.Proven) revert BadReserve();
        if (approved) {
            if (reserves.length >= MAX_RESERVES) revert TooManyReserves();
            reserves.push(wallet);
            reserveStatus[wallet] = ReserveStatus.Approved;
        } else {
            reserveStatus[wallet] = ReserveStatus.None;
            directory.release(wallet);
        }
        emit ReserveReviewed(wallet, approved);
    }

    function removeReserve(address wallet) external {
        if (msg.sender != company && msg.sender != auditor) revert NotAuthorized();
        ReserveStatus current = reserveStatus[wallet];
        if (current == ReserveStatus.None) revert BadReserve();

        if (current == ReserveStatus.Approved) {
            for (uint256 i = 0; i < reserves.length; i++) {
                if (reserves[i] == wallet) {
                    reserves[i] = reserves[reserves.length - 1];
                    reserves.pop();
                    break;
                }
            }
        }
        if (current != ReserveStatus.Proposed) directory.release(wallet);
        reserveStatus[wallet] = ReserveStatus.None;
        emit ReserveRemoved(wallet, msg.sender);
    }
}
