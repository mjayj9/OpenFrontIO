/** Real production terrain and complete core. Run each mode in a fresh process:
 * npx tsx tests/perf/ModernSystemsBenchmark.ts output.json [legacy|idle|low|medium|high|mixed] [ticks=1200] [seed=2026]
 * Timing, memory and host metadata are harness-only; no AI can inspect them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import { modernRegions } from "../../src/core/game/ModernRegions";
import { modernWorld } from "../../src/core/game/ModernWorld";
import { createGameRunner } from "../../src/core/GameRunner";
import {
  clearModernLandPathCache,
  modernLandPathMetrics,
} from "../../src/core/modern/ModernForces";
import { MODERN_RULES } from "../../src/core/modern/ModernRules";
import {
  ModernAILevel,
  modernStateHash,
} from "../../src/core/modern/ModernState";
import { AStarRail } from "../../src/core/pathfinding/algorithms/AStar.Rail";
import { WaterPathMemo } from "../../src/core/pathfinding/PathFinder";
import { GameStartInfo } from "../../src/core/Schemas";
import { NodeGameMapLoader } from "./fullgame/NodeGameMapLoader";
import { modernBenchmarkSourceHash } from "./ModernBenchmarkMetadata";

const output = process.argv[2] ?? "modern-systems-perf.json";
const sourceHash = modernBenchmarkSourceHash();
const mode = process.argv[3] ?? "mixed";
const clearPathCache = process.argv[6] === "no-cache";
const ticks = Number(process.argv[4] ?? 1200),
  seed = Number(process.argv[5] ?? 2026);
if (
  !["legacy", "idle", "low", "medium", "high", "mixed"].includes(mode) ||
  !Number.isInteger(ticks) ||
  ticks < 1 ||
  ticks > 20000 ||
  !Number.isSafeInteger(seed) ||
  seed < 0
)
  throw new Error("Invalid benchmark mode/ticks/seed");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let water = 0,
  rail = 0;
const originalWater = WaterPathMemo.prototype.findPath,
  originalRail = AStarRail.prototype.findPath;
WaterPathMemo.prototype.findPath = function (from, to) {
  water++;
  return originalWater.call(this, from, to);
};
AStarRail.prototype.findPath = function (from, to) {
  rail++;
  return originalRail.call(this, from, to);
};
const oldLog = console.log;
const oldWarn = console.warn;
let warnings = 0;
const warningMessages = new Map<string, number>();
console.log = () => {};
console.debug = () => {};
console.warn = (...args: unknown[]) => {
  warnings++;
  const message = args.map(String).join(" ").slice(0, 200).replace(/\d+/g, "#");
  const key =
    warningMessages.has(message) || warningMessages.size < 64
      ? message
      : "other warnings";
  warningMessages.set(key, (warningMessages.get(key) ?? 0) + 1);
};
const info: GameStartInfo = {
  gameID: `MODPERF${seed}`,
  lobbyCreatedAt: 0,
  players: [
    {
      clientID: "PERF0001",
      username: "benchmark",
      clanTag: null,
      isLobbyCreator: true,
    },
  ],
  config: {
    gameMap: GameMapType.ModernWorld,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    difficulty: Difficulty.Hard,
    nations: "default",
    bots: 0,
    donateGold: true,
    donateTroops: true,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    enhancedAI: {
      tribePercent: 0,
      nationPercent: 100,
      personality: "mixed",
      fairResources: true,
      seed,
    },
    modernMode: {
      scenario: mode === "legacy" ? "modern-world-v1" : "modern-regions-v2",
      version: mode === "legacy" ? 1 : 2,
      dataHash: mode === "legacy" ? modernWorld.hash : modernRegions.hash,
      countryId: "KOR",
      balance: "balanced",
      victory: "territory",
      targetPercent: 99,
      protectionTicks: 300,
      capitalElimination: false,
      aiLevelWeights:
        mode === "low"
          ? { low: 1, medium: 0, high: 0 }
          : mode === "medium"
            ? { low: 0, medium: 1, high: 0 }
            : mode === "high"
              ? { low: 0, medium: 0, high: 1 }
              : { low: 1, medium: 1, high: 1 },
    },
  },
};
let fatal: string | undefined;
const start = performance.now();
const runner = await createGameRunner(
  info,
  "PERF0001",
  new NodeGameMapLoader(path.join(root, "resources/maps")),
  (update) => {
    if ("errMsg" in update) fatal = update.errMsg;
  },
);
function step() {
  if (clearPathCache) clearModernLandPathCache(runner.game);
  runner.addTurn({ turnNumber: runner.game.ticks(), intents: [] });
  if (!runner.executeNextTick() || fatal)
    throw new Error(`Tick ${runner.game.ticks()} failed: ${fatal}`);
}
while (!runner.game.allPlayers().every((p) => p.hasSpawned())) step();
const state = runner.game.modernSystems();
if (mode === "idle" && state)
  for (const faction of state.factions) faction.aiLevel = null;
const startupMs = performance.now() - start,
  waterStart = water,
  railStart = rail;
const initialPlayers = runner.game.allPlayers().length,
  landStart = modernLandPathMetrics();
const beforePopulation = state?.factions.map((f) => ({
  id: f.factionId,
  N0: f.population.total,
  available: f.population.available,
  army: f.population.army,
  air: f.population.air,
  level: f.aiLevel,
  role: f.aiRole,
}));
const times: number[] = [];
let heapPeakBytes = process.memoryUsage().heapUsed,
  rssPeakBytes = process.memoryUsage().rss;
for (let i = 0; i < ticks; i++) {
  const at = performance.now();
  step();
  times.push(performance.now() - at);
  if (i % 25 === 0) {
    const memory = process.memoryUsage();
    heapPeakBytes = Math.max(heapPeakBytes, memory.heapUsed);
    rssPeakBytes = Math.max(rssPeakBytes, memory.rss);
  }
}
const sorted = times.slice().sort((a, b) => a - b);
const percentile = (fraction: number) =>
  sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * fraction) - 1),
    )
  ];
const levels: Record<ModernAILevel, number> = { low: 0, medium: 0, high: 0 };
for (const f of state?.factions ?? []) if (f.aiLevel) levels[f.aiLevel]++;
const report = {
  kind: "modern-v2-full-world-core",
  mode,
  failedPathCache: clearPathCache
    ? "cleared each tick"
    : "bounded owner-revision cache",
  seed,
  ticks,
  node: process.version,
  platform: process.platform,
  os: os.release(),
  cpu: os.cpus()[0]?.model,
  logicalCPUs: os.cpus().length,
  scenarioHash: mode === "legacy" ? modernWorld.hash : modernRegions.hash,
  coreSourceHash: sourceHash,
  sourceUnchangedDuringMeasurement: sourceHash === modernBenchmarkSourceHash(),
  players: runner.game.players().length,
  initialPlayers,
  aiLevels: levels,
  beforePopulation,
  finalPopulationAccounting: state
    ? {
        living: state.factions.reduce((sum, f) => sum + f.population.total, 0),
        dead: state.factions.reduce((sum, f) => sum + f.population.dead, 0),
        livingPlusDead: state.factions.reduce(
          (sum, f) => sum + f.population.total + f.population.dead,
          0,
        ),
        expectedInitialPopulation:
          state.factions.length * MODERN_RULES.initialPopulation,
        invalidBranchSums: state.factions
          .filter(
            ({ population: p }) =>
              p.total !== p.civilian + p.available + p.army + p.navy + p.air,
          )
          .map((f) => f.factionId),
        aliveWithoutPopulation: state.factions
          .filter(
            (f) =>
              runner.game.hasPlayer(f.playerId) &&
              runner.game.player(f.playerId).isAlive() &&
              f.population.total === 0,
          )
          .map((f) => f.factionId),
      }
    : null,
  startupMs,
  tickTiming: {
    count: times.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted[sorted.length - 1],
    meanMs: times.reduce((n, t) => n + t, 0) / times.length,
    over100ms: times.filter((t) => t > 100).length,
  },
  heapPeakBytes,
  rssPeakBytes,
  waterPathQueries: water - waterStart,
  railPathQueries: rail - railStart,
  armyPaths: Object.fromEntries(
    Object.entries(modernLandPathMetrics()).map(([key, value]) => [
      key,
      value - landStart[key as keyof typeof landStart],
    ]),
  ),
  units: runner.game.units().length,
  formations: state?.forces.length ?? 0,
  planes: state?.forces.reduce((n, f) => n + f.aircraft, 0) ?? 0,
  alive: runner.game.players().filter((p) => p.isAlive()).length,
  stateHash: modernStateHash(state),
  coreHash: (runner.game as unknown as { hash(): number }).hash(),
  finalTick: runner.game.ticks(),
  limits: [
    "Core and update generation only; no browser/GPU rendering or network transfer.",
    "Path counts are API queries, including memo hits, not expanded nodes.",
    "Legacy has a different controller count/population model; compare idle vs mixed to isolate v2 decision overhead.",
    "Peak heap/RSS sampled every 25 ticks; not exact allocation totals.",
    "Legacy is this fork's modern-world-v1 with NationExecution and enhanced profiles, not an unmodified upstream Classic baseline.",
  ],
  commandWarnings: {
    count: warnings,
    messages: Object.fromEntries(warningMessages),
  },
};
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log = oldLog;
console.warn = oldWarn;
oldLog(
  JSON.stringify({
    output,
    mode,
    players: report.players,
    aiLevels: levels,
    timing: report.tickTiming,
    stateHash: report.stateHash,
    water: report.waterPathQueries,
    rail: report.railPathQueries,
  }),
);
