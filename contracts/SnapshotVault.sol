// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// ETH-only teaching custodian. Eligible reserves are ETH held by this vault.
/// No caller-supplied reserve addresses, prices or asset totals are accepted.
abstract contract SnapshotVault {
    address public immutable owner;
    uint256 public epochCount;
    uint256 public pending;
    struct Snapshot {
        bytes32 commitment;
        uint128 liabilities;
        uint128 assets;
        uint64 blockNumber;
        uint64 timestamp;
        bool verified;
        bool cancelled;
    }
    mapping(uint256 => Snapshot) public snapshots;
    event SnapshotStarted(uint256 indexed epoch, bytes32 commitment, uint128 liabilities, uint128 assets);
    event SnapshotVerified(uint256 indexed epoch);
    event SnapshotCancelled(uint256 indexed epoch);
    constructor() { owner = msg.sender; }
    receive() external payable {}
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    function beginSnapshot(bytes32 commitment, uint128 liabilities) external onlyOwner returns (uint256 epoch) {
        require(pending == 0, "pending proof");
        require(address(this).balance <= type(uint128).max, "assets overflow");
        require(liabilities <= address(this).balance, "insolvent");
        epoch = ++epochCount;
        snapshots[epoch] = Snapshot(commitment, liabilities, uint128(address(this).balance),
            uint64(block.number), uint64(block.timestamp), false, false);
        pending = epoch;
        emit SnapshotStarted(epoch, commitment, liabilities, uint128(address(this).balance));
    }
    function submitProof(uint256 epoch, bytes calldata proof) external {
        require(epoch != 0 && pending == epoch, "not pending");
        Snapshot memory s = snapshots[epoch];
        require(_verify(epoch, s, proof), "invalid proof");
        snapshots[epoch].verified = true;
        pending = 0;
        emit SnapshotVerified(epoch);
    }
    function cancelSnapshot() external onlyOwner {
        uint256 epoch = pending;
        require(epoch != 0, "not pending");
        require(block.timestamp >= snapshots[epoch].timestamp + 1 days, "locked");
        snapshots[epoch].cancelled = true;
        pending = 0;
        emit SnapshotCancelled(epoch);
    }
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(pending == 0, "pending proof");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "transfer failed");
    }
    function _verify(uint256 epoch, Snapshot memory s, bytes calldata proof) internal view virtual returns (bool);
}
