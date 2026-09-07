// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {SnapshotVault} from "./SnapshotVault.sol";

interface INoirVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
contract ZkSolvencyVault is SnapshotVault {
    INoirVerifier public immutable verifier;
    constructor(address verifier_) {
        require(verifier_.code.length != 0, "verifier has no code");
        verifier = INoirVerifier(verifier_);
    }
    function publicInputs(uint256 epoch) public view returns (bytes32[] memory p) {
        Snapshot memory s = snapshots[epoch];
        p = new bytes32[](6);
        p[0] = s.commitment;
        p[1] = bytes32(uint256(s.liabilities));
        p[2] = bytes32(uint256(s.assets));
        p[3] = bytes32(epoch);
        p[4] = bytes32(block.chainid);
        p[5] = bytes32(uint256(uint160(address(this))));
    }
    function _verify(uint256 epoch, Snapshot memory, bytes calldata proof) internal view override returns (bool) {
        return verifier.verify(proof, publicInputs(epoch));
    }
}
