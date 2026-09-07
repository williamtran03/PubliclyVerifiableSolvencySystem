// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {KzgVerifier} from "./KzgVerifier.sol";

/// Research prototype: four records, 16-bit balances, direct polynomial identities.
/// No general-purpose SNARK and no Merkle tree. See docs/SNARKLESS.md for leakage.
contract SnarklessVerifier is KzgVerifier {
    struct Proof {
        uint256[2][35] commitments;
        uint256[2][35] degrees;
        uint256[35] values;
        uint256[2][35] openings;
        uint256[2] sumProof;
    }
    constructor(uint256[4][9] memory srs) KzgVerifier(srs) {}
    function verify(bytes calldata encoded,bytes32 commitment,uint256 total,uint256 assets,uint256 epoch,uint256 chain,uint256 registry) external view returns(bool) {
        if(total>=262144||total>assets)return false;
        Proof memory p=abi.decode(encoded,(Proof));
        if(keccak256(abi.encodePacked(p.commitments[0],p.commitments[1]))!=commitment)return false;
        return verifyIdentities(p,total,challenge(p,[chain,registry,epoch,assets,total]));
    }
    function challenge(Proof memory p,uint256[5] memory context) internal pure returns(uint256) {
        uint256[] memory transcript=new uint256[](146);
        transcript[0]=uint256(keccak256("Case5/Snarkless/v1"));
        for(uint256 i=0;i<5;i++)transcript[i+1]=context[i];
        for(uint256 i=0;i<35;i++)for(uint256 j=0;j<2;j++) {
            transcript[6+2*i+j]=p.commitments[i][j];transcript[76+2*i+j]=p.degrees[i][j];
        }
        return uint256(keccak256(abi.encodePacked(transcript)))%R;
    }
    function verifyIdentities(Proof memory p,uint256 total,uint256 z) internal view returns(bool) {
        uint256 z2=mulmod(z,z,R);uint256 z4=mulmod(z2,z2,R);
        if(z==0||z4==1)return false;
        uint256 inv4=(3*R+1)/4;
        if(!verifyOpening(p.commitments[0],0,mulmod(total,inv4,R),p.sumProof))return false;
        for(uint256 i=0;i<35;i++) {
            uint256 bound=i<2?3:i<18?5:i<34?6:1;
            if(!verifyDegree(p.commitments[i],p.degrees[i],bound))return false;
            if(i<2||i==34) {
                if(p.values[i]!=0||p.openings[i][0]!=0||p.openings[i][1]!=0)return false;
            } else if(!verifyOpening(p.commitments[i],z,p.values[i],p.openings[i]))return false;
        }
        uint256 van=addmod(z4,R-1,R);uint256[2] memory weighted;
        for(uint256 j=0;j<16;j++) {
            uint256 b=p.values[2+j];
            if(mulmod(b,addmod(b,R-1,R),R)!=mulmod(van,p.values[18+j],R))return false;
            weighted=add(weighted,mul(p.commitments[2+j],1<<j));
        }
        return equalPairing(add(add(weighted,neg(p.commitments[0])),p.commitments[34]),g2[0],p.commitments[34],g2[4]);
    }
}
