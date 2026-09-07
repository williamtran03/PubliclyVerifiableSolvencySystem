// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {SnapshotVault} from "./SnapshotVault.sol";
import {SnarklessVerifier} from "./SnarklessVerifier.sol";
contract SnarklessSolvencyVault is SnapshotVault {
    SnarklessVerifier public immutable verifier;
    constructor(address verifier_) {
        require(verifier_.code.length!=0,"verifier has no code");verifier=SnarklessVerifier(verifier_);
    }
    function _verify(uint256 epoch,Snapshot memory s,bytes calldata proof) internal view override returns(bool) {
        return verifier.verify(proof,s.commitment,s.liabilities,s.assets,epoch,block.chainid,uint256(uint160(address(this))));
    }
}
