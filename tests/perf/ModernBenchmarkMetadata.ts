import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Harness metadata only. The simulation cannot inspect these source bytes. */
export function modernBenchmarkSourceHash(): string {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/core",
  );
  const files: string[] = [];
  const collect = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  collect(root);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(path.relative(root, file).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}
