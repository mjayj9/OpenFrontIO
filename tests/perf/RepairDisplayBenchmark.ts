/** Serial fresh-process wrapper around the existing production-world benchmark.
 * npx tsx tests/perf/RepairDisplayBenchmark.ts repo output.json mixed 1200 2026
 * Measures actual display-update production separately from systems.tick. It
 * never changes the seed, AI count/decisions, cadence or game result. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ModernState } from "../../src/core/modern/ModernState";

const [repoArg, outputArg, mode = "mixed", ticks = "1200", seed = "2026"] =
  process.argv.slice(2);
if (!repoArg || !outputArg) throw new Error("repo and output are required");
const repo = path.resolve(repoArg),
  output = path.resolve(outputArg);
const moduleURL = (relative: string) =>
  pathToFileURL(path.join(repo, relative)).href;
const { ModernSystems } = await import(
  moduleURL("src/core/modern/ModernSystems.ts")
);
const { ModernSystemsExecution } = await import(
  moduleURL("src/core/execution/ModernSystemsExecution.ts")
);
const originalSystemsTick = ModernSystems.prototype.tick;
const originalExecutionTick = ModernSystemsExecution.prototype.tick;
let systemsMs = 0,
  measuring = false,
  latestSystemsMs = 0;
const producerTimes: number[] = [],
  simulationTimes: number[] = [];
let initialLayout: Record<string, unknown> | undefined;
ModernSystems.prototype.tick = function (this: object, tick: number) {
  if (!initialLayout) {
    const state = (this as { state: ModernState }).state;
    initialLayout = {
      stateVersion: state.version,
      formations: state.forces.length,
      branchRosters: Object.fromEntries(
        ["army", "navy", "air"].map((branch) => [
          branch,
          state.forces.filter((force) => force.branch === branch).length,
        ]),
      ),
      branchPersonnel: Object.fromEntries(
        ["army", "navy", "air"].map((branch) => [
          branch,
          state.forces
            .filter((force) => force.branch === branch)
            .reduce((sum, force) => sum + force.personnel, 0),
        ]),
      ),
      bases: state.bases.length,
      baseBranches: Object.fromEntries(
        ["army", "navy", "air"].map((branch) => [
          branch,
          state.bases.filter((base) => (base.branch ?? "air") === branch)
            .length,
        ]),
      ),
    };
  }
  const start = performance.now();
  try {
    return originalSystemsTick.call(this, tick);
  } finally {
    latestSystemsMs = performance.now() - start;
    if (measuring) systemsMs += latestSystemsMs;
  }
};
ModernSystemsExecution.prototype.tick = function (this: object, tick: number) {
  latestSystemsMs = 0;
  const start = performance.now();
  try {
    return originalExecutionTick.call(this, tick);
  } finally {
    if (measuring) {
      producerTimes.push(
        Math.max(0, performance.now() - start - latestSystemsMs),
      );
      simulationTimes.push(latestSystemsMs);
    }
  }
};
const benchmark = path.join(repo, "tests/perf/ModernSystemsBenchmark.ts");
process.argv = [process.argv[0], benchmark, output, mode, ticks, seed];
measuring = true;
await import(pathToFileURL(benchmark).href);
measuring = false;
const summarize = (samples: number[]) => {
  const sorted = samples.slice().sort((a, b) => a - b);
  const p = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return {
    count: samples.length,
    p50Ms: p(0.5),
    p95Ms: p(0.95),
    p99Ms: p(0.99),
    totalMs: samples.reduce((sum, value) => sum + value, 0),
  };
};
const report = JSON.parse(fs.readFileSync(output, "utf8"));
report.displayProducerTiming = summarize(producerTimes);
report.initialForceLayout = initialLayout;
report.modernSystemsTiming = {
  ...summarize(simulationTimes),
  totalMs: systemsMs,
};
report.displayMeasurementIncludesStartup = true;
report.wrapperHash = createHash("sha256")
  .update(fs.readFileSync(new URL(import.meta.url)))
  .digest("hex");
report.limits.push(
  "Display timings wrap the actual ModernSystemsExecution and subtract nested systems.tick; include initialization/spawn ticks. They are CPU update-production costs, not GPU/DOM/rendering or network latency.",
);
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    displayProducerTiming: report.displayProducerTiming,
    modernSystemsTiming: report.modernSystemsTiming,
  }),
);
