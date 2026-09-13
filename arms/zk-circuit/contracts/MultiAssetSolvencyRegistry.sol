// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVerifier} from "./MultiAssetHonkVerifier.sol";

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

interface IERC1271 {
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4);
}

contract MultiAssetSolvencyRegistry {
    // must equal NUM_ASSETS in arms/zk-circuit/circuit; the verifier expects NUM_ASSETS + 2 public inputs
    uint256 public constant NUM_ASSETS = 3;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant RESERVE_TYPEHASH =
        keccak256("ReserveControl(address wallet,uint256 nonce,uint256 expiry)");
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct Asset {
        address token; // address(0) = native ETH
        address feed;
        uint8 decimals;
    }

    struct Epoch {
        uint256 rootHash;
        uint256 liabilitiesUsd;
        uint256 assetsUsd;
        uint64 timestamp;
    }

    // Ownership is not eligibility: a wallet's signature proves control, the auditor's
    // approval decides whether it counts. Only Approved wallets are summed.
    enum ReserveStatus {
        None,
        Proposed,
        Proven,
        Approved
    }

    // Recorded so an auditor can refetch the exact rounds and recompute the epoch.
    uint256[NUM_ASSETS] public epochPrices;
    uint80[NUM_ASSETS] public epochRoundIds;

    address public immutable company;
    address public immutable auditor;
    IVerifier public immutable verifier;
    uint256 public immutable maxPriceAge;
    Asset[] public assets;
    address[] public reserves;
    mapping(address => ReserveStatus) public reserveStatus;
    mapping(address => uint256) public reserveNonce;
    Epoch public currentEpoch;
    uint256 public epochCount;

    event ReserveProposed(address indexed wallet);
    event ReserveProven(address indexed wallet, uint256 nonce);
    event ReserveReviewed(address indexed wallet, bool approved);
    event ReserveRemoved(address indexed wallet, address by);
    event EpochSubmitted(
        uint256 indexed epochId,
        uint256 rootHash,
        uint256 liabilitiesUsd,
        uint256 assetsUsd,
        uint256[NUM_ASSETS] prices,
        uint80[NUM_ASSETS] roundIds,
        uint64 timestamp
    );

    error NotCompany();
    error NotAuditor();
    error NotAuthorized();
    error BadRoles();
    error BadAssetCount();
    error BadReserve();
    error SignatureExpired();
    error InvalidSignature();
    error BadPrice();
    error StalePrice();
    error InvalidProof();
    error Insolvent(uint256 assetsUsd, uint256 liabilitiesUsd);

    constructor(address _company, address _auditor, Asset[] memory _assets, address _verifier, uint256 _maxPriceAge) {
        // An auditor who is also the company approves its own reserves, which is no check at all.
        if (_company == address(0) || _auditor == address(0) || _company == _auditor) revert BadRoles();
        if (_assets.length != NUM_ASSETS) revert BadAssetCount();
        company = _company;
        auditor = _auditor;
        for (uint256 i = 0; i < _assets.length; i++) {
            assets.push(_assets[i]);
        }
        verifier = IVerifier(_verifier);
        maxPriceAge = _maxPriceAge;
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
        bytes32 domain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("MultiAssetSolvencyRegistry"), keccak256("1"), block.chainid, address(this)
            )
        );
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

    // The conversion table the prover should use: latest round of each feed, plus the
    // round ids to pin so the contract values the epoch at exactly the same numbers.
    function readPrices() public view returns (uint256[NUM_ASSETS] memory prices, uint80[NUM_ASSETS] memory roundIds) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            (uint80 roundId,,,,) = IAggregatorV3(assets[i].feed).latestRoundData();
            roundIds[i] = roundId;
        }
        prices = readPricesAt(roundIds);
    }

    // Pinned to explicit rounds rather than whatever is live at mining time, so the
    // prover and this contract cannot disagree, and an auditor can refetch the rounds.
    // Staleness still applies, which is what bounds round shopping.
    function readPricesAt(uint80[NUM_ASSETS] memory roundIds) public view returns (uint256[NUM_ASSETS] memory prices) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            IAggregatorV3 feed = IAggregatorV3(assets[i].feed);
            (, int256 answer,, uint256 updatedAt,) = feed.getRoundData(roundIds[i]);
            if (answer <= 0) revert BadPrice();
            if (block.timestamp - updatedAt > maxPriceAge) revert StalePrice();

            prices[i] = uint256(answer) / (10 ** feed.decimals());
            if (prices[i] == 0) revert BadPrice();
        }
    }

    // Only approved reserves are summed.
    // Truncating division rounds reserves down, so the solvency check errs against the exchange.
    function totalAssetsUsd(uint256[NUM_ASSETS] memory prices) public view returns (uint256 total) {
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            uint256 raw = 0;
            for (uint256 j = 0; j < reserves.length; j++) {
                raw += assets[i].token == address(0)
                    ? reserves[j].balance
                    : IERC20Balance(assets[i].token).balanceOf(reserves[j]);
            }
            total += (raw / (10 ** assets[i].decimals)) * prices[i];
        }
    }

    function submitEpoch(
        bytes calldata proof,
        uint256 rootHash,
        uint256 liabilitiesUsd,
        uint80[NUM_ASSETS] calldata roundIds
    ) external onlyCompany {
        uint256[NUM_ASSETS] memory prices = readPricesAt(roundIds);

        // Prices are public inputs, so a proof built against any other conversion
        // table fails here rather than needing a separate table commitment.
        bytes32[] memory publicInputs = new bytes32[](NUM_ASSETS + 2);
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            publicInputs[i] = bytes32(prices[i]);
        }
        publicInputs[NUM_ASSETS] = bytes32(rootHash);
        publicInputs[NUM_ASSETS + 1] = bytes32(liabilitiesUsd);
        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        uint256 assetsUsd = totalAssetsUsd(prices);
        if (assetsUsd < liabilitiesUsd) revert Insolvent(assetsUsd, liabilitiesUsd);

        currentEpoch = Epoch(rootHash, liabilitiesUsd, assetsUsd, uint64(block.timestamp));
        epochPrices = prices;
        epochRoundIds = roundIds;
        emit EpochSubmitted(epochCount, rootHash, liabilitiesUsd, assetsUsd, prices, roundIds, uint64(block.timestamp));
        epochCount++;
    }
}
