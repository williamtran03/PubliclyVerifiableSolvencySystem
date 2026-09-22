import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function saveRecord(file: string, record: unknown) {
  const json = JSON.stringify(record, null, 2) + "\n";
  const parent = dirname(file);
  mkdirSync(parent, { recursive: true });
  // The staging file must be on the same filesystem for rename to be atomic.
  const staging = mkdtempSync(join(parent, `.${basename(file)}-`));
  try {
    const staged = join(staging, "record.json");
    writeFileSync(staged, json, { flush: true });
    renameSync(staged, file);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
