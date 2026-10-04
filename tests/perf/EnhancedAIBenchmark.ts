/** Real simulation, 30 seeded pairs with swapped starting sides. Run:
 * npx tsx tests/perf/EnhancedAIBenchmark.ts [output.json] [seed-count]
 * Wall clock and memory instrumentation are harness-only, never AI inputs.
 */
import fs from "node:fs";
import { aiProfile } from "../../src/core/ai/AIProfile";
import { AttackExecution } from "../../src/core/execution/AttackExecution";
import { NationExecution } from "../../src/core/execution/NationExecution";
import { PlayerExecution } from "../../src/core/execution/PlayerExecution";
import { TribeExecution } from "../../src/core/execution/TribeExecution";
import {
  Difficulty,
  Execution,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { GameConfig } from "../../src/core/Schemas";
import { GOLD_INDEX_WAR, GOLD_INDEX_WORK } from "../../src/core/StatsSchemas";
import { setup } from "../util/Setup";
import { UseRealAttackLogic } from "../util/TestConfig";
import { TickStats } from "./fullgame/Profiler";

class MeasuredConfig extends UseRealAttackLogic {
  generated = new Map<string, number>();
  troopIncreaseRate(player: Player): number {
    const growth = super.troopIncreaseRate(player);
    this.generated.set(
      player.id(),
      (this.generated.get(player.id()) ?? 0) + growth,
    );
    return growth;
  }
}
const seeds = Number(process.argv[3] ?? 30);
const controller = process.argv[4] === "nation" ? "nation" : "tribe";
const firstSeed = Number(process.argv[5] ?? 0);
const playerType = controller === "nation" ? PlayerType.Nation : PlayerType.Bot;
const maxTicks = 6000;
const rows: unknown[] = [];
let enhancedWins = 0,
  classicWins = 0,
  draws = 0;
const average = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const aggregate = {
  enhanced: {
    survivalTicks: [] as number[],
    lostTroops: [] as number[],
    netTiles: [] as number[],
    earnedGold: [] as number[],
    conquestGold: [] as number[],
    goldAtEnd: [] as number[],
    commands: [] as number[],
    noOpCommands: [] as number[],
  },
  classic: {
    survivalTicks: [] as number[],
    lostTroops: [] as number[],
    netTiles: [] as number[],
    earnedGold: [] as number[],
    conquestGold: [] as number[],
    goldAtEnd: [] as number[],
    commands: [] as number[],
    noOpCommands: [] as number[],
  },
};
const previousLog = console.log;
console.log = () => {};
for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
  const enhancedAI: NonNullable<GameConfig["enhancedAI"]> = {
    seed,
    tribePercent: controller === "tribe" ? 50 : 0,
    nationPercent: controller === "nation" ? 50 : 0,
    personality: "mixed",
    fairResources: true,
  };
  let enhancedID = "",
    classicID = "";
  for (let i = 0; !enhancedID || !classicID; i++) {
    const id = `bot${seed}_${i}`;
    if (aiProfile({ enhancedAI, difficulty: Difficulty.Hard }, id, playerType))
      enhancedID ||= id;
    else classicID ||= id;
  }
  for (let swapped = 0; swapped < 2; swapped++) {
    const game = await setup(
      "plains",
      {
        enhancedAI,
        difficulty: Difficulty.Hard,
        disableAlliances: true,
        disabledUnits: Object.values(UnitType),
      },
      [],
      undefined,
      MeasuredConfig,
    );
    const players = [enhancedID, classicID].map((id) =>
      game.addPlayer(new PlayerInfo(id, playerType, id, id)),
    );
    const commandCounts = new Map<string, number>();
    const noOpCounts = new Map<string, number>();
    const originalAdd = game.addExecution.bind(game);
    game.addExecution = (...executions: Execution[]) => {
      for (const exec of executions) {
        if (exec instanceof AttackExecution) {
          const owner = (exec as unknown as { _owner: Player })._owner;
          commandCounts.set(
            owner.id(),
            (commandCounts.get(owner.id()) ?? 0) + 1,
          );
          const beforeTick = exec.tick.bind(exec);
          let first = true;
          exec.tick = (tick: number) => {
            beforeTick(tick);
            if (first) {
              first = false;
              if (!exec.isActive())
                noOpCounts.set(
                  owner.id(),
                  (noOpCounts.get(owner.id()) ?? 0) + 1,
                );
            }
          };
        }
      }
      originalAdd(...executions);
    };
    game
      .map()
      .forEachTile((tile) =>
        players[(game.x(tile) < 50 ? 0 : 1) ^ swapped].conquer(tile),
      );
    players.forEach((p, i) => {
      p.setSpawnTile(game.ref((i ^ swapped) === 0 ? 25 : 75, 50));
      p.setTroops(60000);
      game.addExecution(new PlayerExecution(p));
      game.addExecution(
        controller === "tribe"
          ? new TribeExecution(p)
          : new NationExecution(
              `AIseed${seed}`,
              new Nation(undefined, p.info()),
            ),
      );
    });
    const timing = new TickStats();
    let lastChange = 0,
      lastTiles = 5000;
    let tick = 0;
    for (; tick < maxTicks && players.every((p) => p.isAlive()); tick++) {
      const start = performance.now();
      game.executeNextTick();
      timing.record(tick, performance.now() - start);
      if (players[0].numTilesOwned() !== lastTiles) {
        lastTiles = players[0].numTilesOwned();
        lastChange = tick;
      }
    }
    const winner = !players[1].isAlive()
      ? "enhanced"
      : !players[0].isAlive()
        ? "classic"
        : "draw";
    if (winner === "enhanced") enhancedWins++;
    else if (winner === "classic") classicWins++;
    else draws++;
    const config = game.config() as MeasuredConfig;
    const metrics = players.map((p, i) => {
      const army =
        p.troops() +
        p.outgoingAttacks().reduce((sum, attack) => sum + attack.troops(), 0);
      const lost = Math.max(
        0,
        60000 + (config.generated.get(p.id()) ?? 0) - army,
      );
      const netTiles = p.numTilesOwned() - 5000;
      const commands = commandCounts.get(p.id()) ?? 0;
      const noOps = noOpCounts.get(p.id()) ?? 0;
      const goldStats = game.stats().getPlayerStats(p)?.gold;
      const gold = Number(goldStats?.[GOLD_INDEX_WORK] ?? 0);
      const conquestGold = Number(goldStats?.[GOLD_INDEX_WAR] ?? 0);
      const data = {
        id: p.id(),
        survivalTicks: tick,
        netTiles,
        combatAndRetreatTroopsLost: Math.round(lost),
        occupationEfficiency: netTiles > 0 ? netTiles / Math.max(1, lost) : 0,
        workerGoldEarned: gold,
        conquestGoldEarned: conquestGold,
        goldAtEnd: Number(p.gold()),
        attackCommands: commands,
        noOpAttackCommands: noOps,
      };
      const side = i === 0 ? aggregate.enhanced : aggregate.classic;
      side.survivalTicks.push(tick);
      side.lostTroops.push(lost);
      side.netTiles.push(netTiles);
      side.earnedGold.push(gold);
      side.conquestGold.push(conquestGold);
      side.goldAtEnd.push(Number(p.gold()));
      side.commands.push(commands);
      side.noOpCommands.push(noOps);
      return data;
    });
    rows.push({
      seed,
      swapped: !!swapped,
      personality: aiProfile(
        game.config().gameConfig(),
        enhancedID,
        playerType,
      )!.personality,
      winner,
      ticks: tick,
      stalledTicks: tick - lastChange,
      metrics,
      tickTiming: timing.summarize(100, 0),
    });
    previousLog(
      `AI comparison seed ${seed}, ${seed - firstSeed + 1}/${seeds} side ${swapped + 1}/2: ${winner} after ${tick} ticks`,
    );
  }
}
console.log = previousLog;
const summary = Object.fromEntries(
  Object.entries(aggregate).map(([key, values]) => [
    key,
    Object.fromEntries(
      Object.entries(values).map(([metric, samples]) => [
        metric,
        average(samples),
      ]),
    ),
  ]),
);
const output = {
  rulesVersion: "fair-2-uniform-half-loot-cheats-disabled-shared-protection",
  protectionTicks: 0,
  method: `Equal 60000 starting troops, fair economy/combat rules, two 5000-tile halves of Plains, all structures/weapons/alliances disabled, Hard reaction difficulty, 6000-tick cap; ${seeds} seeds x swapped starts, ${controller} controllers. Draws are unfinished at the cap. Losses are troop conservation (combat + retreat), not a classification of unnecessary loss. No-op means an attack execution becomes inactive on its first tick; successful immediate cancellation can also meet that definition.`,
  controller,
  node: process.version,
  seeds,
  firstSeed,
  games: seeds * 2,
  enhancedWins,
  classicWins,
  draws,
  enhancedWinRate: enhancedWins / (seeds * 2),
  summary,
  heapUsedBytesAtEnd: process.memoryUsage().heapUsed,
  rows,
};
const filename = process.argv[2];
if (filename) fs.writeFileSync(filename, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ ...output, rows: undefined }, null, 2));
