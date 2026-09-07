// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {SolvencyRegistry} from "../contracts/SolvencyRegistry.sol";

/**
 * Deploys the registry to a real network. Reserve wallets are added afterwards,
 * one signature at a time, because each wallet has to sign for itself.
 *
 *   forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $KEY --broadcast
 */
contract Deploy is Script {
    function run() external returns (SolvencyRegistry registry) {
        vm.startBroadcast();
        registry = new SolvencyRegistry();
        vm.stopBroadcast();
    }
}
