/** Controlled modern-v2 matches on real terrain, boundaries, climate and ports.
 * npx tsx tests/perf/ModernAIMatches.ts report.json [seeds=30] [ticks=3000]
 * Each seed swaps high/low controllers across both actual starting territories.
 * Outside countries are neutral terrain; this is a two-controller benchmark,
 * not a claim about full-world match win rates. Timed score uses net geodesic
 * territory gained, so unequal initial country area cannot win by itself.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Config } from "../../src/core/configuration/Config";
import { CityExecution } from "../../src/core/execution/CityExecution";
import { FactoryExecution } from "../../src/core/execution/FactoryExecution";
import { ModernSystemsExecution } from "../../src/core/execution/ModernSystemsExecution";
import { PlayerExecution } from "../../src/core/execution/PlayerExecution";
import { PortExecution } from "../../src/core/execution/PortExecution";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import {
  modernFaction,
  modernFactionPlayerId,
  modernRegions,
} from "../../src/core/game/ModernRegions";
import { loadTerrainMap } from "../../src/core/game/TerrainMapLoader";
import { MODERN_RULES as R } from "../../src/core/modern/ModernRules";
import {
  ModernState,
  modernStateHash,
} from "../../src/core/modern/ModernState";
import { modernSystemsFor } from "../../src/core/modern/ModernSystems";
import { GameConfig } from "../../src/core/Schemas";
import { NodeGameMapLoader } from "./fullgame/NodeGameMapLoader";
import { modernBenchmarkSourceHash } from "./ModernBenchmarkMetadata";

const output = process.argv[2] ?? "modern-ai-matches.json";
const sourceHash = modernBenchmarkSourceHash();
const seeds = Number(process.argv[3] ?? 30),
  ticks = Number(process.argv[4] ?? 3000);
if (
  !Number.isInteger(seeds) ||
  seeds < 1 ||
  seeds > 100 ||
  !Number.isInteger(ticks) ||
  ticks < 1 ||
  ticks > 20000
)
  throw new Error("Invalid seed/tick count");
const maps = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../resources/maps",
);
const loader = new NodeGameMapLoader(maps);
const pairs = [
  { name: "small continental/coastal", ids: ["KOR", "PRK"] },
  { name: "temperate/coastal with overseas territory", ids: ["DEU", "FRA"] },
  { name: "large arid administrative regions", ids: ["DZA-r02", "LBY-r01"] },
  { name: "high latitude/polar coastal", ids: ["NOR", "SWE"] },
];
const oldLog = console.log;
console.log = () => {};
console.debug = () => {};

async function match(
  pair: (typeof pairs)[number],
  seed: number,
  swap: boolean,
) {
  const regions = pair.ids.map(modernFaction);
  const gc: GameConfig = {
    gameMap: GameMapType.ModernWorld,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    difficulty: Difficulty.Hard,
    donateGold: true,
    donateTroops: true,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    nations: "default",
    bots: 0,
    disableAlliances: true,
    disabledUnits: [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV],
    enhancedAI: {
      tribePercent: 0,
      nationPercent: 100,
      personality: "mixed",
      fairResources: true,
      seed,
    },
    modernMode: {
      scenario: "modern-regions-v2",
      version: 2,
      dataHash: modernRegions.hash,
      countryId: regions[0].id,
      balance: "balanced",
      victory: "territory",
      targetPercent: 99,
      protectionTicks: 0,
      capitalElimination: false,
    },
  };
  const terrain = await loadTerrainMap(
    GameMapType.ModernWorld,
    GameMapSize.Normal,
    loader,
    false,
    true,
  );
  const game = createGame(
    [],
    [],
    terrain.gameMap,
    terrain.miniGameMap,
    new Config(gc, null, false, false),
  );
  const players = regions.map((r) =>
    game.addPlayer(
      new PlayerInfo(r.name, PlayerType.Nation, null, modernFactionPlayerId(r)),
    ),
  );
  const state: ModernState = {
    version: 2,
    tick: 0,
    seed,
    nextForceId: 1,
    forces: [],
    bases: [],
    ports: [],
    aiPlans: [],
    samAircraftReloads: [],
    factions: regions.map((r, i) => ({
      playerId: players[i].id(),
      factionId: r.id,
      parentCountryId: r.parentCountryId,
      ownedAreaUnits: 0,
      aiLevel: i === (swap ? 1 : 0) ? "high" : "low",
      aiRole: "world",
      climateAdaptation: [
        ...r.adaptedClimates,
      ] as ModernState["factions"][number]["climateAdaptation"],
      completedTraining: 0,
      populationTransferredTo: null,
      population: {
        total: R.initialPopulation,
        civilian: 970000,
        available: 12000,
        army: 18000,
        navy: 0,
        air: 0,
        dead: 0,
      },
      nuclearStrikes: [],
    })),
  };
  game.setModernSystems(state);
  const controllerByIndex = new Map(
    regions.map((r, i) => [r.index, players[i]]),
  );
  for (const [index, start, count] of modernRegions.runs) {
    const owner = controllerByIndex.get(index);
    if (!owner) continue;
    for (let tile = start; tile < start + count; tile++) owner.conquer(tile);
  }
  for (let i = 0; i < 2; i++) {
    const player = players[i],
      r = regions[i],
      capital = game.ref(r.capital[0], r.capital[1]);
    if (game.owner(capital) !== player || player.numTilesOwned() !== r.tiles)
      throw new Error(`Bad real region ${r.id}`);
    player.setSpawnTile(capital);
    player.addGold(10000000n);
    game.addExecution(
      new CityExecution(player.buildUnit(UnitType.City, capital, {})),
    );
    const factoryTile =
      Array.from(player.tiles()).find(
        (t) => game.manhattanDist(t, capital) >= 20,
      ) ?? capital;
    game.addExecution(
      new FactoryExecution(player.buildUnit(UnitType.Factory, factoryTile, {})),
    );
    player.setTroops(180000);
  }
  for (const point of modernRegions.ports) {
    const tile = game.ref(point.tile[0], point.tile[1]),
      owner = game.owner(tile);
    if (!owner.isPlayer()) continue;
    const unit = owner.buildUnit(UnitType.Port, tile, {});
    game.addExecution(new PortExecution(unit));
    state.ports.push({
      portId: point.portId,
      name: point.name,
      tile,
      unitId: unit.id(),
      ownerId: owner.id(),
      level: 0,
      damage: 0,
      development: null,
      repairUntilTick: null,
      blockadedBy: [],
      incomePerSecond: 0,
      lastIncomeTick: 0,
      captureCount: 0,
    });
  }
  const systems = modernSystemsFor(game)!;
  for (const player of players) {
    systems.forces.initializeFaction(player.id(), player.spawnTile()!);
    player.removeGold(player.gold());
    player.addGold(BigInt(R.initialGold));
    game.addExecution(new PlayerExecution(player));
  }
  game.addExecution(new ModernSystemsExecution());
  game.endSpawnPhase();
  const before = state.factions.map((f, i) => ({
    id: f.factionId,
    level: f.aiLevel,
    N0: f.population.total,
    gold: Number(players[i].gold()),
    army: f.population.army,
    air: f.population.air,
    area: f.ownedAreaUnits,
    tiles: players[i].numTilesOwned(),
    climates: f.climateAdaptation,
    ports: state.ports.filter((p) => p.ownerId === f.playerId).length,
  }));
  let lastTerritoryTick = 0,
    oldCounts = players.map((p) => p.numTilesOwned());
  const timings: number[] = [];
  for (
    let tick = 0;
    tick < ticks && players.every((p) => p.isAlive());
    tick++
  ) {
    const at = performance.now();
    game.executeNextTick();
    timings.push(performance.now() - at);
    const counts = players.map((p) => p.numTilesOwned());
    if (counts.some((c, i) => c !== oldCounts[i]))
      lastTerritoryTick = game.ticks();
    oldCounts = counts;
  }
  const results = state.factions.map((f, i) => ({
    id: f.factionId,
    level: f.aiLevel,
    alive: players[i].isAlive(),
    gold: Number(players[i].gold()),
    rawArmy:
      players[i].troops() +
      systems.forces.committedArmyRaw(f.playerId) +
      players[i].outgoingAttacks().reduce((n, a) => n + a.troops(), 0) +
      players[i]
        .units(UnitType.TransportShip)
        .reduce((n, u) => n + u.troops(), 0),
    dead: f.population.dead,
    population: f.population.total,
    area: f.ownedAreaUnits,
    areaGained: f.ownedAreaUnits - before[i].area,
    tiles: players[i].numTilesOwned(),
    planes: state.forces
      .filter(
        (force) => force.playerId === f.playerId && force.phase !== "destroyed",
      )
      .reduce((n, force) => n + force.aircraft, 0),
    completedMissions: state.forces
      .filter((force) => force.playerId === f.playerId)
      .reduce((n, force) => n + force.completedMissions, 0),
    portIncome: state.ports
      .filter((p) => p.ownerId === f.playerId)
      .reduce((n, p) => n + p.incomePerSecond, 0),
  }));
  const high = results.find((r) => r.level === "high")!,
    low = results.find((r) => r.level === "low")!;
  const winner = !high.alive
    ? "low"
    : !low.alive
      ? "high"
      : high.areaGained === low.areaGained
        ? "tie"
        : high.areaGained > low.areaGained
          ? "high"
          : "low";
  const sorted = timings.slice().sort((a, b) => a - b);
  return {
    pair: pair.name,
    seed,
    swap,
    before,
    results,
    winner,
    scoreRule: "elimination, otherwise net geodesic area gained at time limit",
    ticks: game.ticks(),
    survivalTicks: game.ticks(),
    lastTerritoryTick,
    stallTicks: game.ticks() - lastTerritoryTick,
    stateHash: modernStateHash(state),
    p95TickMs:
      sorted[
        Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
      ] ?? 0,
  };
}
const matches: Awaited<ReturnType<typeof match>>[] = [];
for (const pair of pairs)
  for (let seed = 0; seed < seeds; seed++)
    for (const swap of [false, true]) {
      matches.push(await match(pair, seed, swap));
      if (matches.length % 10 === 0)
        oldLog(
          JSON.stringify({
            completed: matches.length,
            total: pairs.length * seeds * 2,
            last: matches[matches.length - 1].winner,
          }),
        );
    }
const summaries = pairs.map((pair) => {
  const rows = matches.filter((m) => m.pair === pair.name),
    highWins = rows.filter((m) => m.winner === "high").length,
    lowWins = rows.filter((m) => m.winner === "low").length;
  const average = (get: (m: (typeof rows)[number]) => number) =>
    rows.reduce((n, m) => n + get(m), 0) / rows.length;
  return {
    pair: pair.name,
    matches: rows.length,
    highWins,
    lowWins,
    ties: rows.length - highWins - lowWins,
    highWinPercent: (100 * highWins) / rows.length,
    averageHighAreaGain: average(
      (m) => m.results.find((r) => r.level === "high")!.areaGained,
    ),
    averageLowAreaGain: average(
      (m) => m.results.find((r) => r.level === "low")!.areaGained,
    ),
    averageHighDeaths: average(
      (m) => m.results.find((r) => r.level === "high")!.dead,
    ),
    averageLowDeaths: average(
      (m) => m.results.find((r) => r.level === "low")!.dead,
    ),
    averageStallTicks: average((m) => m.stallTicks),
  };
});
const highWins = matches.filter((m) => m.winner === "high").length,
  lowWins = matches.filter((m) => m.winner === "low").length;
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      kind: "actual-region-modern-high-vs-low",
      scenarioHash: modernRegions.hash,
      coreSourceHash: sourceHash,
      sourceUnchangedDuringMeasurement:
        sourceHash === modernBenchmarkSourceHash(),
      seeds,
      ticks,
      matches: matches.length,
      highWins,
      lowWins,
      ties: matches.length - highWins - lowWins,
      highWinPercent: (100 * highWins) / matches.length,
      summaries,
      rows: matches,
      limits: [
        "Two active controllers; other world territory neutral. This is not a full-world win-rate study.",
        "Both controllers have equal N0, gold, army and pilots; geography and personality vary and starting positions are swapped.",
        "Timed result uses net geodesic area gained, not the production victory screen.",
        "Alliances and nuclear weapons disabled for controlled military comparison; other modern economy/climate/air/navy rules enabled.",
        "p95 includes core execution only, without rendering or GameRunner updates.",
      ],
    },
    null,
    2,
  ),
);
console.log = oldLog;
oldLog(
  JSON.stringify({
    output,
    matches: matches.length,
    highWins,
    lowWins,
    highWinPercent: (100 * highWins) / matches.length,
    summaries,
  }),
);
