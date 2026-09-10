import type { Address } from "viem";
import { registryClient } from "./minimumClient.ts";

const SETTINGS = "solvency.minimum.connection";
export type Settings = { rpcUrl: string; registryAddress: string };
export const DEFAULT_RPC = "http://127.0.0.1:8545";

/** Stored per browser. Nothing private is kept here. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { rpcUrl: parsed.rpcUrl || DEFAULT_RPC, registryAddress: parsed.registryAddress || "" };
    }
  } catch {
    /* private browsing or corrupt value */
  }
  return { rpcUrl: DEFAULT_RPC, registryAddress: "" };
}
export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(settings));
  } catch {
    /* private browsing */
  }
}

export const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const value = (id: string) => element<HTMLInputElement>(id).value.trim();
export const button = (id: string) => element<HTMLButtonElement>(id);

/** Colours the block from the leading verdict keyword. */
export function output(id: string, text: string) {
  const target = element(id);
  target.textContent = text;
  target.classList.toggle("ok", /^(VALID|SOLVENT)\b/.test(text));
  target.classList.toggle("fail", /^(INVALID|INSOLVENT|ERROR|OUTDATED)\b/.test(text));
}

export async function loadState<T>(load: () => Promise<T>, render: (state: { status: "loading" | "ready" | "error"; value?: T; error?: string }) => void) {
  render({ status: "loading" });
  try {
    render({ status: "ready", value: await load() });
  } catch (error) {
    render({ status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

/** Connection panel shared by every page, so the address is entered once. */
export function connectionPanel(onChange?: () => void) {
  const settings = loadSettings();
  const rpc = element<HTMLInputElement>("rpcUrl"),
    registry = element<HTMLInputElement>("registryAddress");
  rpc.value = settings.rpcUrl;
  registry.value = settings.registryAddress;
  for (const field of [rpc, registry])
    field.addEventListener("input", () => {
      saveSettings({ rpcUrl: rpc.value.trim(), registryAddress: registry.value.trim() });
      onChange?.();
    });
  return () => registryClient(rpc.value.trim(), registry.value.trim() as Address);
}

export function markNavigation() {
  const here = location.pathname.replace(/index\.html$/, "") || "/";
  for (const link of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
    const target = new URL(link.href).pathname.replace(/index\.html$/, "") || "/";
    link.classList.toggle("active", target === here);
  }
}
