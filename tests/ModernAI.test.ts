// @vitest-environment node
import { describe, expect, test } from "vitest";
import { Difficulty, Game, PlayerType, UnitType } from "../src/core/game/Game";
import { modernRegions } from "../src/core/game/ModernRegions";
import { MODERN_AI_LEVELS, ModernAI } from "../src/core/modern/ModernAI";
import { ModernForces } from "../src/core/modern/ModernForces";
import {
  ModernBranch,
  ModernForceHooks,
} from "../src/core/modern/ModernForceTypes";
import {
  ModernAILevel,
  ModernState,
  modernStateHash,
} from "../src/core/modern/ModernState";
import { snapshotGame } from "../src/core/snapshot/GameSnapshot";
import { playerInfo, setup } from "./util/Setup";
import { restoreTestGame } from "./util/Snapshot";

async function battlefield(
  level: ModernAILevel,
  seed = 7,
  difficulty = Difficulty.Medium,
) {
  const game = await setup("plains", { difficulty, disableAlliances: true });
  const human = game.addPlayer(playerInfo("human", PlayerType.Human));
  const enemy = game.addPlayer(playerInfo("enemy", PlayerType.Nation));
  for (let y = 10; y < 30; y++)
    for (let x = 10; x < 50; x++)
      (x < 30 ? human : enemy).conquer(game.ref(x, y));
  human.setSpawnTile(game.ref(20, 20));
  enemy.setSpawnTile(game.ref(35, 20));
  human.setTroops(180000);
  enemy.setTroops(180000);
  human.addGold(400000n);
  enemy.addGold(400000n);
  const state: ModernState = {
    version: 2,
    tick: 0,
    seed,
    nextForceId: 1,
    forces: [],
    bases: [],
    ports: [],
    aiPlans: [],
    factions: [human, enemy].map((p) => ({
      playerId: p.id(),
      factionId: p.id(),
      parentCountryId: p.id(),
      ownedAreaUnits: 400,
      aiLevel: p === human ? null : level,
      aiRole: p === human ? "human" : "world",
      climateAdaptation: ["temperate"],
      completedTraining: 0,
      population: {
        total: 1000000,
        civilian: 970000,
        available: 12000,
        army: 18000,
        navy: 0,
        air: 0,
        dead: 0,
      },
      nuclearStrikes: [],
      populationTransferredTo: null,
    })),
  };
  const hooks = hooksFor(game, state);
  const forces = new ModernForces(game, state, hooks);
  forces.initializeFaction(human.id(), human.spawnTile()!);
  forces.initializeFaction(enemy.id(), enemy.spawnTile()!);
  const ai = new ModernAI(game, state, forces, {
    developPort: () => false,
    climateEfficiency: () => 1000,
  });
  return { game, human, enemy, state, forces, ai };
}
function hooksFor(game: Game, state: ModernState): ModernForceHooks {
  const get = (id: string) =>
    state.factions.find((f) => f.playerId === id)!.population;
  return {
    reserve(id: string, branch: ModernBranch, n: number) {
      const p = get(id);
      if (branch === "army") return game.player(id).troops() >= n * 10;
      if (p.available < n) return false;
      p.available -= n;
      p[branch] += n;
      return true;
    },
    release(id: string, branch: ModernBranch, n: number) {
      if (branch !== "army") {
        const p = get(id);
        p.available += n;
        p[branch] -= n;
      }
    },
    casualties(id: string, branch: ModernBranch, n: number) {
      const p = get(id);
      p[branch] -= n;
      p.dead += n;
      p.total -= n;
    },
  };
}
function advance(game: Game, forces: ModernForces, ai: ModernAI, n: number) {
  for (let i = 0; i < n; i++) {
    forces.tick();
    ai.tick();
    game.executeNextTick();
  }
}

describe("individual modern AI command quality", () => {
  test("a surviving AI reorganizes its finite army on owned ground after losing its original capital and airfield", async () => {
    const { game, human, enemy, state, forces, ai } = await battlefield("low");
    const remnant = game.ref(49, 20),
      initial = new Set(state.forces.map((f) => f.id));
    for (const tile of [...enemy.tiles()])
      if (tile !== remnant) human.conquer(tile);
    advance(game, forces, ai, 100);
    const reorganized = state.forces.filter(
      (f) =>
        f.playerId === enemy.id() && f.branch === "army" && !initial.has(f.id),
    );
    expect(reorganized.length).toBeGreaterThan(0);
    expect(reorganized[0].tile).toBe(remnant);
    expect(state.bases.some((b) => b.playerId === enemy.id())).toBe(false);
    expect(state.factions[1].population.total).toBe(998200);
    expect(
      enemy.troops() +
        forces.committedArmyRaw(enemy.id()) +
        enemy.outgoingAttacks().reduce((n, a) => n + a.troops(), 0),
    ).toBeLessThanOrEqual(170000);
  });
  test("medium AI rebuilds a paid owned airfield and replaces finite crews after capital loss", async () => {
    const { game, human, enemy, state, forces, ai } =
      await battlefield("medium");
    const originalBaseId = state.bases.find(
      (b) => b.playerId === enemy.id(),
    )!.id;
    for (const tile of [...enemy.tiles()])
      if (game.x(tile) < 44) human.conquer(tile);
    advance(game, forces, ai, 80);
    const rebuilt = state.bases.find((b) => b.playerId === enemy.id());
    expect(rebuilt).toBeDefined();
    expect(rebuilt!.id).not.toBe(originalBaseId);
    expect(game.owner(rebuilt!.tile)).toBe(enemy);
    expect(enemy.gold()).toBeLessThan(400000n);
    const replacementAir = state.forces.filter(
      (f) =>
        f.playerId === enemy.id() &&
        f.branch === "air" &&
        f.phase !== "destroyed",
    );
    expect(replacementAir.length).toBeGreaterThan(0);
    const crews = replacementAir.reduce((n, f) => n + f.personnel, 0);
    expect(crews).toBeGreaterThan(0);
    expect(state.factions[1].population.air).toBe(crews);
    expect(state.factions[1].population.available).toBe(11200 - crews);
  });
  test("an island AI without a land border launches an actual sea landing toward a public enemy port", async () => {
    const game = await setup("ocean_and_land", {
      modernMode: {
        scenario: "modern-regions-v2",
        version: 2,
        dataHash: modernRegions.hash,
        countryId: "KOR",
        balance: "balanced",
        victory: "territory",
        targetPercent: 60,
        protectionTicks: 0,
        capitalElimination: false,
      },
      disableAlliances: true,
    });
    const human = game.addPlayer(playerInfo("island-human", PlayerType.Human)),
      enemy = game.addPlayer(playerInfo("island-ai", PlayerType.Nation));
    game.forEachTile((tile) => {
      if (game.isLand(tile)) (game.x(tile) < 8 ? human : enemy).conquer(tile);
    });
    human.setSpawnTile(game.ref(5, 7));
    enemy.setSpawnTile(game.ref(14, 7));
    for (const p of [human, enemy]) {
      p.setTroops(180000);
      p.addGold(400000n);
    }
    const state: ModernState = {
      version: 2,
      tick: 0,
      seed: 55,
      nextForceId: 1,
      forces: [],
      bases: [],
      ports: [],
      aiPlans: [],
      factions: [human, enemy].map((p) => ({
        playerId: p.id(),
        factionId: p.id(),
        parentCountryId: p.id(),
        ownedAreaUnits: p.numTilesOwned(),
        aiLevel: p === enemy ? "high" : null,
        aiRole: p === enemy ? "world" : "human",
        climateAdaptation: ["temperate"],
        completedTraining: 0,
        populationTransferredTo: null,
        population: {
          total: 1000000,
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
    const shore = [...human.tiles()].find((tile) => game.isShoreline(tile))!,
      port = human.buildUnit(UnitType.Port, shore, {});
    state.ports.push({
      portId: "public-island-port",
      name: "Landing target",
      tile: shore,
      unitId: port.id(),
      ownerId: human.id(),
      level: 0,
      damage: 0,
      development: null,
      repairUntilTick: null,
      blockadedBy: [],
      incomePerSecond: 0,
      lastIncomeTick: 0,
      captureCount: 0,
    });
    const forces = new ModernForces(game, state, hooksFor(game, state));
    forces.initializeFaction(enemy.id(), enemy.spawnTile()!);
    const ai = new ModernAI(game, state, forces, { developPort: () => false });
    let actualTransport = false;
    for (let i = 0; i < 200; i++) {
      advance(game, forces, ai, 1);
      if (enemy.units(UnitType.TransportShip).some((u) => u.isActive()))
        actualTransport = true;
    }
    expect(actualTransport).toBe(true);
    expect(
      state.forces.some(
        (f) =>
          f.playerId === enemy.id() &&
          f.branch === "army" &&
          (f.command?.viaTransport === true || f.completedMissions > 0),
      ),
    ).toBe(true);
  });
  test.each(["low", "medium", "high"] as const)(
    "%s starts with exactly the same gold, army and finite air crews",
    async (level) => {
      const { human, enemy, state, forces } = await battlefield(level);
      expect(human.gold()).toBe(enemy.gold());
      expect(human.troops() + forces.committedArmyRaw(human.id())).toBe(180000);
      expect(enemy.troops() + forces.committedArmyRaw(enemy.id())).toBe(180000);
      expect(state.factions[0].population).toEqual(
        state.factions[1].population,
      );
      expect(state.factions[0].population.total).toBe(1000000);
      expect(state.factions[1].population.air).toBe(800);
    },
  );
  test("low uses a bounded single operation while high launches actual joint air and army missions", async () => {
    const low = await battlefield("low"),
      high = await battlefield("high");
    advance(low.game, low.forces, low.ai, 40);
    advance(high.game, high.forces, high.ai, 40);
    expect(
      low.state.forces
        .filter((f) => f.playerId === low.enemy.id() && f.branch === "air")
        .every((f) => f.completedMissions === 0 && f.phase === "idle"),
    ).toBe(true);
    expect(
      high.state.forces
        .filter((f) => f.playerId === high.enemy.id() && f.branch === "air")
        .some((f) => f.phase !== "idle" || f.completedMissions > 0),
    ).toBe(true);
    expect(
      low.state.aiPlans![0].nextThinkTick - low.game.ticks(),
    ).toBeLessThanOrEqual(MODERN_AI_LEVELS.low.thinkTicks);
    expect(high.state.aiPlans![0].operations).toBeLessThanOrEqual(
      MODERN_AI_LEVELS.high.operations,
    );
  });
  test("fixed seed reproduces the planning schedule without consuming resources to decide", async () => {
    const first = await battlefield("high", 99),
      second = await battlefield("high", 99);
    first.ai.tick(0);
    second.ai.tick(0);
    expect(first.state.aiPlans).toEqual(second.state.aiPlans);
    expect(first.enemy.gold()).toBe(second.enemy.gold());
    advance(first.game, first.forces, first.ai, 200);
    advance(second.game, second.forces, second.ai, 200);
    expect(modernStateHash(first.state)).toBe(modernStateHash(second.state));
    expect(first.enemy.troops()).toBe(second.enemy.troops());
  });
  test("the global difficulty does not change the faction thought cadence or operation limits", async () => {
    const easy = await battlefield("medium", 321, Difficulty.Easy),
      impossible = await battlefield("medium", 321, Difficulty.Impossible);
    easy.ai.tick(0);
    impossible.ai.tick(0);
    expect(easy.state.aiPlans).toEqual(impossible.state.aiPlans);
    expect(easy.state.factions[1].population).toEqual(
      impossible.state.factions[1].population,
    );
  });
  test("full core restore keeps AI tier, fixed plan timing and in-flight commands", async () => {
    const { game, human, enemy, state, forces, ai } = await battlefield(
      "high",
      1234,
    );
    advance(game, forces, ai, 27);
    const restored = await restoreTestGame(snapshotGame(game), "plains");
    const resumedState = JSON.parse(JSON.stringify(state)) as ModernState;
    const resumedForces = new ModernForces(
      restored,
      resumedState,
      hooksFor(restored, resumedState),
    );
    const resumedAI = new ModernAI(restored, resumedState, resumedForces, {
      developPort: () => false,
      climateEfficiency: () => 1000,
    });
    advance(game, forces, ai, 180);
    advance(restored, resumedForces, resumedAI, 180);
    expect(resumedState).toEqual(state);
    expect(restored.player(enemy.id()).gold()).toBe(enemy.gold());
    expect(restored.player(human.id()).numTilesOwned()).toBe(
      human.numTilesOwned(),
    );
  });
});
