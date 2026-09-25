// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC1271 {
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4);
}

contract ReserveDirectory {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CONTROL_TYPEHASH =
        keccak256("ReserveControl(address wallet,address registry,uint256 nonce,bytes32 challenge)");
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    mapping(address => address) public registryOf;
    mapping(address => uint256) public nonces;

    event ControlProven(address indexed wallet, address indexed registry, uint256 nonce, bytes32 challenge);
    event Released(address indexed wallet, address indexed registry);

    error ClaimedByAnotherRegistry(address registry);
    error NotClaimant();
    error BadChallenge();

    function controlDigest(address wallet, address registry, bytes32 challenge) public view returns (bytes32) {
        if (challenge == bytes32(0)) revert BadChallenge();
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("ReserveDirectory"), keccak256("1"), block.chainid, address(this))
        );
        bytes32 message = keccak256(abi.encode(CONTROL_TYPEHASH, wallet, registry, nonces[wallet], challenge));
        return keccak256(abi.encodePacked("\x19\x01", domain, message));
    }

    function proveControl(address wallet, bytes32 challenge, bytes calldata signature) external returns (bool) {
        address holder = registryOf[wallet];
        if (holder != address(0) && holder != msg.sender) revert ClaimedByAnotherRegistry(holder);
        if (!signedBy(wallet, controlDigest(wallet, msg.sender, challenge), signature)) return false;

        emit ControlProven(wallet, msg.sender, nonces[wallet], challenge);
        nonces[wallet]++;
        registryOf[wallet] = msg.sender;
        return true;
    }

    function release(address wallet) external {
        if (registryOf[wallet] != msg.sender) revert NotClaimant();
        delete registryOf[wallet];
        nonces[wallet]++;
        emit Released(wallet, msg.sender);
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
