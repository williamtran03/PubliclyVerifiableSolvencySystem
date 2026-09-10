import type { Address, Hex } from "viem";
import { encodeAbiParameters, keccak256, isAddress } from "viem";
import { domain, uint, USD_SCALE } from "./tree.ts";
export type Rate = {
  token: Address;
  feed: Address;
  tokenDecimals: number;
  oracleDecimals: number;
  rate: bigint;
  roundId: bigint;
  updatedAt: bigint;
};
export type Conversion = Rate & { rawAmount: bigint; usd: bigint };
export interface Oracle {
  getRate(token: Address, snapshotTime: bigint): Promise<Rate>;
}
export class MockOracle implements Oracle {
  constructor(private rates: Rate[]) {}
  async getRate(token: Address): Promise<Rate> {
    const rate = this.rates.find((r) => r.token.toLowerCase() === token.toLowerCase());
    if (!rate) throw Error("unsupported asset or missing rate");
    return { ...rate };
  }
}
export function validateRate(rate: Rate, snapshotTime: bigint, maxAge: bigint) {
  uint(snapshotTime);
  uint(maxAge);
  uint(rate.rate);
  uint(rate.roundId);
  uint(rate.updatedAt);
  if (
    !isAddress(rate.token) ||
    !isAddress(rate.feed) ||
    BigInt(rate.token) === 0n ||
    BigInt(rate.feed) === 0n ||
    !Number.isInteger(rate.tokenDecimals) ||
    !Number.isInteger(rate.oracleDecimals) ||
    rate.tokenDecimals < 0 ||
    rate.tokenDecimals > 18 ||
    rate.oracleDecimals < 0 ||
    rate.oracleDecimals > 18 ||
    rate.rate === 0n ||
    rate.roundId === 0n ||
    rate.roundId >= 1n << 80n ||
    rate.updatedAt === 0n ||
    rate.updatedAt > snapshotTime ||
    snapshotTime - rate.updatedAt > maxAge
  )
    throw Error("invalid or stale oracle rate");
}
export function toUsd(
  raw: bigint,
  rate: Rate,
  snapshotTime: bigint,
  maxAge: bigint,
  rounding: "up" | "down" = "up",
): bigint {
  uint(raw);
  validateRate(rate, snapshotTime, maxAge);
  const numerator = uint(uint(raw * rate.rate) * USD_SCALE);
  const denominator = 10n ** BigInt(rate.tokenDecimals + rate.oracleDecimals);
  const quotient = numerator / denominator;
  return uint(quotient + (rounding === "up" && numerator % denominator !== 0n ? 1n : 0n));
}
export async function convert(
  oracle: Oracle,
  token: Address,
  rawAmount: bigint,
  snapshotTime: bigint,
  maxAge: bigint,
): Promise<Conversion> {
  const rate = await oracle.getRate(token, snapshotTime);
  return { ...rate, rawAmount, usd: toUsd(rawAmount, rate, snapshotTime, maxAge) };
}
export const rateComponents = [
  { name: "token", type: "address" },
  { name: "feed", type: "address" },
  { name: "tokenDecimals", type: "uint8" },
  { name: "oracleDecimals", type: "uint8" },
  { name: "rate", type: "uint256" },
  { name: "roundId", type: "uint80" },
  { name: "updatedAt", type: "uint256" },
] as const;
export function manifestHash(snapshot: Hex, rates: Rate[], time: bigint, maxAge: bigint): Hex {
  if (!rates.length || rates.length > 32) throw Error("manifest size");
  let previous = 0n;
  for (const rate of rates) {
    validateRate(rate, time, maxAge);
    if (BigInt(rate.token) <= previous)
      throw Error("rates must be unique and sorted by token address");
    previous = BigInt(rate.token);
  }
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "tuple[]", components: rateComponents }],
      [domain("rates"), snapshot, rates],
    ),
  );
}
