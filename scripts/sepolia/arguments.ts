import { armNames, type Arm } from "./network.ts";

export const usage = "Usage: npm run sepolia -- deploy | epoch [arms...] | exercise [arms...] | status";
export function parseArguments(args: string[]) {
  const [command, ...selected] = args;
  if (command !== "deploy" && command !== "epoch" && command !== "exercise" && command !== "status") {
    throw new Error(usage);
  }
  if ((command === "deploy" || command === "status") && selected.length) {
    throw new Error(`${command} does not accept arm arguments. ${usage}`);
  }
  for (const arm of selected) {
    if (!armNames.includes(arm as Arm)) throw new Error(`Unknown arm ${arm}. ${usage}`);
  }
  if (new Set(selected).size !== selected.length) throw new Error("Each arm may be selected only once.");
  return { command, arms: (selected.length ? selected : [...armNames]) as Arm[] };
}
