import { formatUnits } from "viem";
import type { Asset, Freshness } from "./types.ts";

export function parseBalance(value: string, decimals = 0): bigint {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error("Enter a non-negative amount using a decimal point.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`This asset supports at most ${decimals} decimal places in the proof. No rounding is applied.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function displayAmount(value: bigint, asset: Asset): string {
  return asset.unitDecimals === undefined ? `${value} proof units` : `${formatUnits(value, asset.unitDecimals)} ${asset.label}`;
}

export function freshnessText(freshness: Freshness | undefined): string {
  if (!freshness) return "Freshness unavailable";
  const duration = (seconds: bigint) => seconds >= 3600n ? `${seconds / 3600n}h ${(seconds % 3600n) / 60n}m` : `${seconds / 60n}m ${seconds % 60n}s`;
  return `${freshness.current ? "Current" : "Expired"} · age ${duration(freshness.age)} · maximum age ${duration(freshness.maxAge)} (at last chain read)`;
}
