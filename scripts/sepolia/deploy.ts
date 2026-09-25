import { getAddress, parseAbi, parseEther, zeroAddress, type Abi, type Address, type Hex } from "viem";
import { loadSrs, g2ForPrecompile } from "../../arms/snarkless/prover/srs.ts";
import { artifact } from "../demo/chain.ts";
import { ARMS, FEEDS, armNames, type Arm, type Network } from "./network.ts";

const feedAbi = parseAbi(["function description() view returns (string)", "function decimals() view returns (uint8)"]);
const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export const TOKENS = { BTC: 8, WETH: 18, USDC: 6, TEST: 0 } as const;

export function holdings(tokens: Record<keyof typeof TOKENS, Address>): Record<Arm, [Address, bigint][]> {
  return {
    "published-ledger": [[zeroAddress, parseEther("0.00012")], [tokens.TEST, 3n]],
    "zk-circuit": [[tokens.BTC, 3n * 10n ** 8n], [tokens.WETH, parseEther("12")], [tokens.USDC, 6000n * 10n ** 6n]],
    snarkless: [[tokens.TEST, 50000n]],
  };
}

export async function proveReserve(network: Network, arm: Arm) {
  const reserve = network.reserves[arm];
  const digest = await network.read<Hex>(arm, "reserveDigest", [reserve.address]);
  return network.send(network.company, network.registryOf(arm), network.abiOf(arm), "proveReserve", [reserve.address, await reserve.sign({ hash: digest })]);
}

export async function deploy(network: Network) {
  const { client, record, save, company, auditor, maxEpochAge, minEpochInterval } = network;
  for (const { feed, description } of Object.values(FEEDS)) {
    const [text, decimals] = await Promise.all([
      client.readContract({ address: feed, abi: feedAbi, functionName: "description" }),
      client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
    ]);
    if (text !== description || decimals !== 8) throw new Error(`${feed} reports "${text}" with ${decimals} decimals, expected "${description}" with 8.`);
  }
  async function ensure(key: string, create: () => Promise<Address>) {
    const known = record.contracts[key];
    if (known && (await client.getCode({ address: known }))?.length) return known;
    network.setStep(key);
    const address = getAddress(await create());
    record.contracts[key] = address;
    record.deployBlocks[key] = record.transactions.at(-1)!.block;
    save();
    console.log(`${key}: ${address}`);
    return address;
  }

  const directory = await ensure("ReserveDirectory", () => network.deploy("ReserveDirectory.sol", "ReserveDirectory"));
  const tokens = {} as Record<keyof typeof TOKENS, Address>;
  for (const [symbol, decimals] of Object.entries(TOKENS) as [keyof typeof TOKENS, number][]) {
    tokens[symbol] = await ensure(symbol, () => network.deploy("DemoAsset.sol", "DemoAsset", [symbol, decimals]));
  }
  const relations = await ensure("RelationsLib", () => network.deploy("MultiAssetHonkVerifier.sol", "RelationsLib"));
  const transcript = await ensure("ZKTranscriptLib", () => network.deploy("MultiAssetHonkVerifier.sol", "ZKTranscriptLib"));
  const verifier = await ensure("HonkVerifier", () => network.deploy("MultiAssetHonkVerifier.sol", "HonkVerifier", [], { RelationsLib: relations, ZKTranscriptLib: transcript }));

  const srs = loadSrs("arms/snarkless/fixtures/srs.json");
  const g2 = (p: typeof srs.g2) => {
    const [xImag, xReal, yImag, yReal] = g2ForPrecompile(p);
    return { xImag, xReal, yImag, yReal };
  };
  const constructorArgs: Record<Arm, unknown[]> = {
    "published-ledger": [company.address, auditor.address, [zeroAddress, tokens.TEST], maxEpochAge, minEpochInterval, directory],
    "zk-circuit": [company.address, auditor.address, [
      { token: tokens.BTC, feed: FEEDS.BTC.feed, decimals: TOKENS.BTC, maxPriceAge: FEEDS.BTC.maxPriceAge },
      { token: tokens.WETH, feed: FEEDS.ETH.feed, decimals: TOKENS.WETH, maxPriceAge: FEEDS.ETH.maxPriceAge },
      { token: tokens.USDC, feed: FEEDS.USDC.feed, decimals: TOKENS.USDC, maxPriceAge: FEEDS.USDC.maxPriceAge },
    ], verifier, maxEpochAge, minEpochInterval, directory],
    snarkless: [company.address, auditor.address, tokens.TEST, TOKENS.TEST, { g2: g2(srs.g2), tauG2: g2(srs.tauG2), boundG2: g2(srs.boundG2) }, maxEpochAge, minEpochInterval, directory],
  };
  const wanted = holdings(tokens);
  const tokenAbi = artifact("DemoAsset.sol", "DemoAsset").abi as Abi;
  for (const arm of armNames) {
    const registry = await ensure(arm, () => network.deploy(ARMS[arm].source, ARMS[arm].name, constructorArgs[arm]));
    const reserve = network.reserves[arm].address;
    record.reserves[arm] = reserve;
    save();
    network.setStep(arm);
    for (const [token, amount] of wanted[arm]) {
      const balance = token === zeroAddress
        ? await client.getBalance({ address: reserve })
        : await client.readContract({ address: token, abi: balanceAbi, functionName: "balanceOf", args: [reserve] });
      if (balance >= amount) continue;
      if (token === zeroAddress) await network.transfer(reserve, amount - balance);
      else await network.send(company, token, tokenAbi, "mint", [reserve, amount - balance]);
    }
    const abi = network.abiOf(arm);
    if (await network.read<number>(arm, "reserveStatus", [reserve]) === 0) await network.send(company, registry, abi, "proposeReserve", [reserve]);
    if (await network.read<number>(arm, "reserveStatus", [reserve]) === 1) await proveReserve(network, arm);
    if (await network.read<number>(arm, "reserveStatus", [reserve]) === 2) await network.send(auditor, registry, abi, "reviewReserve", [reserve, true]);
    if (await network.read<number>(arm, "reserveStatus", [reserve]) !== 3) throw new Error(`${arm}: reserve ${reserve} is not approved.`);
    console.log(`${arm}: reserve ${reserve} approved`);
  }
  network.setStep("");
}
