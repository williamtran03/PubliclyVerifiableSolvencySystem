import { resolve, dirname } from "node:path";

/** Keep caller-supplied filenames inside the selected output directory. */
export function outputPath(directory: string, name: string): string {
  if (!name || name === "." || name === ".." || /[/\\:\x00-\x1f\x7f]/.test(name)) {
    throw new Error("Output filename must be a single safe path component.");
  }
  const base = resolve(directory);
  const file = resolve(base, name);
  if (dirname(file) !== base) throw new Error("Output filename escapes its directory.");
  return file;
}
