import test from "node:test";
import assert from "node:assert/strict";
import { deployedNetworks, explorerLink } from "./networks.ts";

const contracts = {
  "published-ledger": "0x1111111111111111111111111111111111111111",
  "zk-circuit": "0x2222222222222222222222222222222222222222",
  snarkless: "0x3333333333333333333333333333333333333333",
};

test("a complete Sepolia deployment record becomes a preset for all three arms", () => {
  const [sepolia] = deployedNetworks([{ chainId: 11155111, contracts, transactions: [] }]);
  assert.equal(sepolia.name, "Sepolia");
  assert.deepEqual(Object.keys(sepolia.connections).sort(), ["published-ledger", "snarkless", "zk-circuit"]);
  assert.equal(sepolia.connections["zk-circuit"].registry, contracts["zk-circuit"]);
  assert.match(sepolia.connections.snarkless.rpc, /^https:\/\//);
  assert.equal(explorerLink([sepolia], "snarkless", contracts.snarkless.toUpperCase().replace("0X", "0x"))?.url, `https://sepolia.etherscan.io/address/${contracts.snarkless}`);
  assert.equal(explorerLink([sepolia], "zk-circuit", contracts.snarkless), undefined);
});

test("partial, unknown-chain and malformed deployment records are ignored", () => {
  assert.deepEqual(deployedNetworks([
    { chainId: 11155111, contracts: { ...contracts, snarkless: undefined } },
    { chainId: 31337, contracts },
    { chainId: "11155111", contracts },
    { chainId: 11155111, contracts: { ...contracts, "zk-circuit": "0x1234" } },
    { chainId: 11155111, contracts, pending: { serializedTransaction: "0x1234" } },
    null,
  ]), []);
});
