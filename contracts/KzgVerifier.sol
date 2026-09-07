// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// BN254 KZG openings plus explicit degree bounds; SRS fixed at deployment.
contract KzgVerifier {
    uint256 internal constant R=21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant P=21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256[4][9] internal g2;
    constructor(uint256[4][9] memory srs) {
        // These parameters must originate in a trusted ceremony. This constructor
        // cannot prove that the deployer has erased the toxic-waste scalar.
        g2=srs;
        require(srs[0][0]==11559732032986387107991004021392285783925812861821192530917403151452391805634, "bad G2 generator");
        require(srs[0][1]==10857046999023057135944570762232829481370756359578518086990519993285655852781, "bad G2 generator");
        require(srs[0][2]==4082367875863433681332203403145435568316851327593401208105741076214120093531, "bad G2 generator");
        require(srs[0][3]==8495653923123431417604973247489272438418190587263600148770280649306958101930, "bad G2 generator");
    }
    function add(uint256[2] memory a,uint256[2] memory b) internal view returns(uint256[2] memory o) {
        uint256[4] memory input=[a[0],a[1],b[0],b[1]];bool ok;
        assembly("memory-safe") { ok := staticcall(gas(),6,input,128,o,64) }
        require(ok,"ECADD failed");
    }
    function mul(uint256[2] memory a,uint256 s) internal view returns(uint256[2] memory o) {
        uint256[3] memory input=[a[0],a[1],s];bool ok;
        assembly("memory-safe") { ok := staticcall(gas(),7,input,96,o,64) }
        require(ok,"ECMUL failed");
    }
    function neg(uint256[2] memory a) internal pure returns(uint256[2] memory) {
        require(a[0]<P&&a[1]<P,"noncanonical point");return [a[0],a[1]==0?0:P-a[1]];
    }
    function equalPairing(uint256[2] memory a,uint256[4] memory b,uint256[2] memory c,uint256[4] memory d) internal view returns(bool) {
        c=neg(c);
        uint256[12] memory input=[a[0],a[1],b[0],b[1],b[2],b[3],c[0],c[1],d[0],d[1],d[2],d[3]];
        uint256[1] memory out;bool ok;
        assembly("memory-safe") {ok := staticcall(gas(),8,input,384,out,32)}
        return ok&&out[0]==1;
    }
    function verifyOpening(uint256[2] memory c,uint256 x,uint256 y,uint256[2] memory pi) public view returns(bool) {
        if(x>=R||y>=R)return false;
        uint256[2] memory lhs=add(add(c,neg(mul([uint256(1),uint256(2)],y))),mul(pi,x));
        return equalPairing(lhs,g2[0],pi,g2[1]);
    }
    function verifyDegree(uint256[2] memory c,uint256[2] memory shifted,uint256 bound) public view returns(bool) {
        if(bound>8)return false;return equalPairing(c,g2[8-bound],shifted,g2[0]);
    }
}
