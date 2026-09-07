import { readFileSync } from "node:fs";
import type { Entry } from "./merkleSumTree.ts";

/** Reads the custodian's private customer list: `username,balance` in wei. */
export function readCustomersCsv(path: string): Entry[] {
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row.length > 0);

  const header = rows.shift();
  if (header !== "username,balance") {
    throw new Error(`${path}: expected header "username,balance", got "${header}"`);
  }

  return rows.map((row, i) => {
    const [username, balance] = row.split(",");
    if (username === undefined || balance === undefined) {
      throw new Error(`${path}:${i + 2}: expected "username,balance"`);
    }
    return { username: username.trim(), balance: BigInt(balance.trim()) };
  });
}
