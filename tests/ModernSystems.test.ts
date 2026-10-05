// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { MirvExecution } from "../src/core/execution/MIRVExecution";
import { ModernPortTrainingExecution } from "../src/core/execution/ModernPortTrainingExecution";
import {
  ModernCommandExecution,
  ModernSystemsExecution,
} from "../src/core/execution/ModernSystemsExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { TradeShipExecution } from "../src/core/execution/TradeShipExecution";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
  TerrainType,
  UnitType,
} from "../src/core/game/Game";
import { GameMapLoader, MapData } from "../src/core/game/GameMapLoader";
import {
  modernFactionPlayerId,
  modernFactions,
  modernRegions,
} from "../src/core/game/ModernRegions";
import { MapManifest } from "../src/core/game/TerrainMapLoader";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
  GameRunner,
} from "../src/core/GameRunner";
import {
  climateAt,
  climateCombatEfficiency,
  climateMovementEfficiency,
} from "../src/core/modern/ModernClimate";
import { forcePreview } from "../src/core/modern/ModernForces";
import {
  ModernState,
  modernStateHash,
  ModernStateSchema,
  nuclearEffects,
} from "../src/core/modern/ModernState";
import {
  assignModernLevel,
  modernIncome,
  modernSystemsFor,
  registerModernNuclearLaunch,
} from "../src/core/modern/ModernSystems";
import {
  GameConfig,
  GameStartInfo,
  IntentSchema,
  StampedIntent,
} from "../src/core/Schemas";
import {
  snapshotGame,
  snapshotGameData,
} from "../src/core/snapshot/GameSnapshot";
import { GOLD_INDEX_TRADE } from "../src/core/StatsSchemas";
import { playerInfo, setup } from "./util/Setup";
import { restoreTestGame } from "./util/Snapshot";
import { TestConfig, UseRealAttackLogic } from "./util/TestConfig";

const mode: NonNullable<GameConfig["modernMode"]> = {
  scenario: "modern-regions-v2",
  version: 2,
  dataHash: modernRegions.hash,
  countryId: "KOR",
  balance: "balanced",
  victory: "territory",
  targetPercent: 60,
  capitalElimination: false,
  protectionTicks: 0,
  trainingLesson: "regions",
};
async function fixture(
  map = "plains",
  configClass: typeof Config = TestConfig,
  humanOpponent = false,
) {
  const game = await setup(
    map,
    { modernMode: mode, disableAlliances: true },
    [],
    undefined,
    configClass,
  );
  const human = game.addPlayer(
      new PlayerInfo("human", PlayerType.Human, "HUMAN001", "human"),
    ),
    enemy = game.addPlayer(
      humanOpponent
        ? new PlayerInfo("enemy", PlayerType.Human, "ENEMY001", "enemy")
        : playerInfo("enemy", PlayerType.Nation),
    );
  if (map === "plains")
    for (let y = 10; y < 30; y++)
      for (let x = 10; x < 50; x++)
        (x < 30 ? human : enemy).conquer(game.ref(x, y));
  else
    game.forEachTile((tile) => {
      if (game.isLand(tile)) (game.x(tile) < 8 ? human : enemy).conquer(tile);
    });
  for (const p of [human, enemy]) {
    p.setSpawnTile([...p.tiles()][0]);
    p.setTroops(180000);
    p.addGold(40_000_000n);
  }
  const state: ModernState = {
    version: 2,
    tick: 0,
    seed: 21,
    forces: [],
    bases: [],
    ports: [],
    nextForceId: 1,
    aiPlans: [],
    factions: [human, enemy].map((p) => ({
      playerId: p.id(),
      factionId: p.id(),
      parentCountryId: p.id(),
      ownedAreaUnits: 400,
      aiLevel: p === human ? null : "high",
      aiRole: p === human ? "human" : "world",
      climateAdaptation: [climateAt(p.spawnTile()!)],
      completedTraining: 0,
      populationTransferredTo: null,
      population: {
        total: 1_000_000,
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
  const systems = modernSystemsFor(game)!;
  for (const p of [human, enemy])
    systems.forces.initializeFaction(p.id(), p.spawnTile()!);
  return { game, human, enemy, state, systems };
}
function balanced(state: ModernState) {
  for (const f of state.factions) {
    const p = f.population;
    expect(p.total).toBe(p.civilian + p.available + p.army + p.navy + p.air);
  }
}
function tick(game: Game, count: number) {
  for (let i = 0; i < count; i++) game.executeNextTick();
}

describe("modern population, economy, climate and launch responsibility", () => {
  test("every branch uses one finite population pool; army groups are reservations", async () => {
    const { human, state, systems } = await fixture();
    const f = human.modernFaction()!;
    expect(f.population.total).toBe(1_000_000);
    expect(f.population.air).toBe(800);
    expect(f.population.available).toBe(11200);
    expect(human.troops() + systems.forces.committedArmyRaw(human.id())).toBe(
      180000,
    );
    systems.reconcileArmy(human);
    balanced(state);
    expect(f.population.dead).toBe(0);
    systems.casualties(human.id(), "air", 100);
    expect(f.population.total).toBe(999900);
    balanced(state);
    systems.release(human.id(), "air", 100);
    expect(f.population.total).toBe(999900);
    balanced(state);
  });
  test("army losses, donations and full annexation conserve people without regenerating N0", async () => {
    const { human, enemy, state, systems } = await fixture();
    human.removeTroops(1000);
    systems.reconcileArmy(human);
    expect(human.modernFaction()!.population.dead).toBe(100);
    balanced(state);
    const total = state.factions.reduce((n, f) => n + f.population.total, 0);
    human.donateTroops(enemy, 2000);
    systems.reconcileArmy(human);
    systems.reconcileArmy(enemy);
    balanced(state);
    expect(state.factions.reduce((n, f) => n + f.population.total, 0)).toBe(
      total,
    );
    const civilians =
      enemy.modernFaction()!.population.civilian +
      enemy.modernFaction()!.population.available;
    const before = human.modernFaction()!.population.total;
    for (const tile of Array.from(enemy.tiles())) human.conquer(tile);
    systems.annex(human, enemy);
    systems.annex(human, enemy);
    expect(human.modernFaction()!.population.total).toBe(before + civilians);
    expect(enemy.modernFaction()!.populationTransferredTo).toBe(human.id());
    balanced(state);
  });
  test("a surviving enclave keeps its population and can recover; only final capture transfers it once", async () => {
    const { game, human, enemy, state, systems } = await fixture();
    const front = game.ref(30, 10),
      enclave = game.ref(80, 80);
    for (const tile of Array.from(enemy.tiles())) {
      if (tile !== front) human.conquer(tile);
    }
    enemy.conquer(enclave);
    enemy.setTroops(0);
    game.addExecution(
      new AttackExecution(10000, human, enemy.id(), game.ref(29, 10)),
    );
    tick(game, 10);
    expect(game.owner(front)).toBe(human);
    expect(game.owner(enclave)).toBe(enemy);
    expect(enemy.numTilesOwned()).toBe(1);
    expect(enemy.modernFaction()!.populationTransferredTo).toBeNull();
    expect(enemy.modernFaction()!.population.civilian).toBeGreaterThan(0);
    systems.economy(enemy);
    expect(enemy.troops()).toBeGreaterThan(0);
    const civilians =
      enemy.modernFaction()!.population.civilian +
      enemy.modernFaction()!.population.available;
    const total = human.modernFaction()!.population.total;
    human.conquer(enclave);
    game.conquerPlayer(human, enemy);
    game.conquerPlayer(human, enemy);
    expect(human.modernFaction()!.population.total).toBe(total + civilians);
    expect(enemy.modernFaction()!.populationTransferredTo).toBe(human.id());
    enemy.conquer(enclave);
    expect(game.owner(enclave)).toBe(human);
    expect(enemy.isAlive()).toBe(false);
    balanced(state);
    const restored = await restoreTestGame(snapshotGame(game), "plains");
    tick(game, 10);
    tick(restored, 10);
    expect(modernStateHash(restored.modernSystems())).toBe(
      modernStateHash(state),
    );
  });
  test("difficulty, image size and host cheats do not change modern starting army/cap", async () => {
    const { game, human, enemy } = await fixture();
    for (const difficulty of Object.values(Difficulty)) {
      const config = new Config(
        {
          ...game.config().gameConfig(),
          difficulty,
          infiniteGold: true,
          infiniteTroops: true,
          hostCheats: { infiniteGold: true, infiniteTroops: true },
        },
        null,
        false,
      );
      expect(config.startManpower(human.info())).toBe(
        config.startManpower(enemy.info()),
      );
      expect(config.maxTroops(human)).toBe(config.maxTroops(enemy));
      expect(config.infiniteGold()).toBe(false);
      expect(config.infiniteTroops()).toBe(false);
    }
  });
  test("climate ratio is bounded, applied independently of terrain and projection", async () => {
    const { game, human, enemy } = await fixture();
    const tile = human.spawnTile()!,
      climate = climateAt(tile);
    human.modernFaction()!.climateAdaptation = [climate];
    enemy.modernFaction()!.climateAdaptation = [];
    expect(climateCombatEfficiency(human.modernFaction(), tile)).toBe(1100);
    const input = {
      terrain: TerrainType.Plains,
      attackTroops: 10000,
      attacker: { type: PlayerType.Human, numTiles: 10 },
      defender: {
        type: PlayerType.Nation,
        numTiles: 100000,
        troops: 10000,
        isTraitor: false,
        isDisconnectedTeammate: false,
      },
      defenderHasDefensePost: false,
      falloutRatio: null,
      borderSize: 5,
    };
    const config = new Config(game.config().gameConfig(), null, false),
      base = config.attackLogic(input);
    const climateResult = config.attackLogic({
      ...input,
      modernClimate: {
        attackerPermille: 1100,
        defenderPermille: 900,
        movementPermille: 950,
      },
    });
    expect(climateResult.attackerTroopLoss).toBeCloseTo(
      base.attackerTroopLoss / 1.15,
    );
    expect(climateResult.defenderTroopLoss).toBeCloseTo(
      base.defenderTroopLoss * 1.15,
    );
    expect(climateResult.tickFraction).toBeCloseTo(base.tickFraction / 0.95);
    expect(
      config.attackLogic({
        ...input,
        attacker: { ...input.attacker, numTiles: 100000 },
        defender: { ...input.defender, numTiles: 10 },
      }),
    ).toEqual(base);
  });
  test("adaptation training is paid, delayed and retained after snapshot", async () => {
    const { game, human, state, systems } = await fixture();
    game.addExecution(new ModernSystemsExecution());
    human.modernFaction()!.climateAdaptation = ["temperate", "continental"];
    const before = human.gold();
    expect(systems.train(human.id(), "arid")).toBe(true);
    expect(human.gold()).toBe(before - 50000n);
    expect(systems.train(human.id(), "polar")).toBe(false);
    tick(game, 600);
    expect(human.modernFaction()!.climateAdaptation).not.toContain("arid");
    tick(game, 1);
    expect(human.modernFaction()!.climateAdaptation).toEqual([
      "continental",
      "arid",
    ]);
    expect(human.modernFaction()!.completedTraining).toBe(1);
    balanced(state);
    const restored = await restoreTestGame(snapshotGame(game), "plains");
    expect(restored.modernSystems()).toEqual(state);
  });
  test("army preview and real combat use both armies' adaptation at the actual contested tile", async () => {
    for (const adapted of [true, false]) {
      const { game, human, enemy, state, systems } = await fixture(
        "plains",
        UseRealAttackLogic,
      );
      const source = game.ref(29, 20),
        target = game.ref(30, 20),
        climate = climateAt(target);
      human.modernFaction()!.climateAdaptation = adapted ? [climate] : [];
      enemy.modernFaction()!.climateAdaptation = [climate];
      const army = state.forces.find(
        (f) => f.playerId === human.id() && f.branch === "army",
      )!;
      army.tile = source;
      const forecast = forcePreview(
        game,
        state,
        army,
        target,
        "attack",
        undefined,
        {
          reserve: () => false,
          release: () => {},
          casualties: () => {},
          climateEfficiency: (id, tile) =>
            climateCombatEfficiency(game.player(id).modernFaction(), tile),
          climateMovementEfficiency: (id, tile) =>
            climateMovementEfficiency(game.player(id).modernFaction(), tile),
        },
      );
      expect(forecast.valid).toBe(true);
      const rule = vi.spyOn(game.config(), "attackLogic");
      expect(
        systems.forces.command(human.id(), [army.id], "attack", target)[0]
          .reason,
      ).toBeNull();
      // Exclude the command's confirmation preview; the next call is from AttackExecution.
      rule.mockClear();
      game.addExecution(new ModernSystemsExecution());
      for (let i = 0; i < 20 && rule.mock.calls.length === 0; i++)
        tick(game, 1);
      expect(rule.mock.calls.length).toBeGreaterThan(0);
      const actualInput = rule.mock.calls[0][0],
        actual = rule.mock.results[0].value;
      expect(actualInput.modernClimate).toEqual({
        attackerPermille: climateCombatEfficiency(
          human.modernFaction(),
          target,
        ),
        defenderPermille: 1100,
        movementPermille: climateMovementEfficiency(
          human.modernFaction(),
          target,
        ),
      });
      expect(forecast.armyCombat!.attackerLossRaw).toBe(
        Math.ceil(actual.attackerTroopLoss),
      );
      expect(forecast.armyCombat!.defenderLossRaw).toBe(
        Math.ceil(actual.defenderTroopLoss),
      );
      expect(game.owner(target)).toBe(human);
      rule.mockRestore();
    }
  });
  test("one actual MIRV launch has one penalty and warheads never multiply responsibility", async () => {
    const { game, human, enemy } = await fixture();
    const silo = human.buildUnit(UnitType.MissileSilo, human.spawnTile()!, {});
    game.addExecution(new MirvExecution(human, enemy.spawnTile()!));
    tick(game, 3);
    expect(human.modernFaction()!.nuclearStrikes).toHaveLength(1);
    const missile = human.units(UnitType.MIRV)[0];
    expect(missile).toBeDefined();
    registerModernNuclearLaunch(game, human, missile.id());
    expect(human.modernFaction()!.nuclearStrikes).toHaveLength(1);
    tick(game, 60);
    expect(human.modernFaction()!.nuclearStrikes).toHaveLength(1);
    silo.delete();
    expect(modernIncome(game, human, 1000n)).toBe(850n);
  });
  test("an actual trade voyage records each owner's net nuclear-adjusted revenue", async () => {
    const { game, human, enemy } = await fixture(
      "half_land_half_ocean",
      TestConfig,
      true,
    );
    const port = (owner: typeof human, y: number) => {
      const tile = game.ref(7, y);
      owner.conquer(tile);
      return owner.buildUnit(UnitType.Port, tile, {});
    };
    const source = port(human, 1),
      destination = port(enemy, 14);
    registerModernNuclearLaunch(game, human, 9000);
    const voyage = new TradeShipExecution(human, source, destination);
    game.addExecution(voyage);
    tick(game, 2);
    expect(human.units(UnitType.TradeShip)).toHaveLength(1);
    const beforeHuman = human.gold(),
      beforeEnemy = enemy.gold();
    for (let i = 0; i < 500 && voyage.isActive(); i++) tick(game, 1);
    expect(voyage.isActive()).toBe(false);
    const receivedHuman = human.gold() - beforeHuman,
      receivedEnemy = enemy.gold() - beforeEnemy;
    expect(receivedEnemy).toBeGreaterThan(0n);
    expect(receivedHuman).toBe((receivedEnemy * 850n) / 1000n);
    expect(human.tradeGold()).toBe(receivedHuman);
    expect(enemy.tradeGold()).toBe(receivedEnemy);
    expect(game.stats().getPlayerStats(human)?.gold?.[GOLD_INDEX_TRADE]).toBe(
      receivedHuman,
    );
    expect(game.stats().getPlayerStats(enemy)?.gold?.[GOLD_INDEX_TRADE]).toBe(
      receivedEnemy,
    );
  });
  test("intercepted launches keep responsibility; repeated penalties cap and expire by game tick", async () => {
    const { game, human, enemy } = await fixture();
    human.buildUnit(UnitType.MissileSilo, human.spawnTile()!, {});
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, human, enemy.spawnTile()!),
    );
    tick(game, 3);
    expect(human.modernFaction()!.nuclearStrikes).toHaveLength(1);
    human.units(UnitType.AtomBomb)[0].delete();
    for (let id = 1000; id < 1004; id++)
      registerModernNuclearLaunch(game, human, id);
    const effect = nuclearEffects(human.modernFaction(), game.ticks());
    expect(effect.incomeLossPermille).toBe(450);
    expect(effect.replenishmentLossPermille).toBe(300);
    expect(enemy.modernFaction()!.nuclearStrikes).toHaveLength(0);
    expect(
      nuclearEffects(human.modernFaction(), effect.expiresTick).launches,
    ).toBe(0);
  });
  test("a unique major port develops, changes owner, is damaged/blocked/repaired without duplicated bonus", async () => {
    const { game, human, enemy, state, systems } =
      await fixture("ocean_and_land");
    const tile = [...human.tiles()].find((t) => game.isShoreline(t))!,
      port = human.buildUnit(UnitType.Port, tile, {});
    state.ports.push({
      portId: "unique-port",
      name: "Test port",
      tile,
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
    game.addExecution(new ModernSystemsExecution());
    expect(systems.portAction(human.id(), "unique-port", "develop")).toBe(true);
    expect(systems.portAction(human.id(), "unique-port", "develop")).toBe(
      false,
    );
    tick(game, 200);
    expect(state.ports[0].incomePerSecond).toBe(0);
    tick(game, 1);
    expect(state.ports[0].level).toBe(1);
    expect(state.ports[0].incomePerSecond).toBe(200);
    enemy.conquer(tile);
    enemy.captureUnit(port);
    const old = human.gold(),
      next = enemy.gold();
    tick(game, 10);
    expect(state.ports[0].ownerId).toBe(enemy.id());
    expect(state.ports[0].level).toBe(1);
    expect(human.gold()).toBe(old);
    expect(enemy.gold()).toBe(next + 200n);
    state.ports[0].damage = 500;
    tick(game, 10);
    expect(state.ports[0].incomePerSecond).toBe(100);
    expect(systems.portAction(enemy.id(), "unique-port", "repair")).toBe(true);
    tick(game, 200);
    expect(state.ports[0].damage).toBe(500);
    tick(game, 10);
    expect(state.ports[0].damage).toBe(0);
    const water = [...Array(game.width() * game.height()).keys()].find(
      (t) => game.isWater(t) && game.manhattanDist(t, tile) < 24,
    )!;
    human.buildUnit(UnitType.Warship, water, { patrolTile: water });
    tick(game, 10);
    expect(state.ports[0].blockadedBy).toContain(human.id());
    expect(state.ports[0].incomePerSecond).toBe(50);
    registerModernNuclearLaunch(game, enemy, 9000);
    tick(game, 10);
    expect(state.ports[0].incomePerSecond).toBe(42);
    expect(systems.portAction(human.id(), "unique-port", "develop")).toBe(
      false,
    );
    expect(state.ports).toHaveLength(1);
  });
  test("pending orders, population, ports, launch responsibility and hashes survive core restore", async () => {
    const { game, human, state, systems } = await fixture();
    registerModernNuclearLaunch(game, human, 1000);
    const air = state.forces.find(
      (f) => f.playerId === human.id() && f.kind === "strike",
    )!;
    systems.forces.command(human.id(), [air.id], "strike", game.ref(35, 20));
    game.addExecution(new ModernSystemsExecution());
    game.addExecution(new PlayerExecution(human));
    tick(game, 15);
    const restored = await restoreTestGame(snapshotGame(game), "plains");
    expect(modernStateHash(restored.modernSystems())).toBe(
      modernStateHash(state),
    );
    tick(game, 100);
    tick(restored, 100);
    expect(modernStateHash(restored.modernSystems())).toBe(
      modernStateHash(state),
    );
    balanced(state);
  });
  test("port practice responds with one paid finite opponent, actual blockade and income recovery after core restore", async () => {
    const { game, human, enemy, state } = await fixture("ocean_and_land");
    for (const [i, owner] of [human, enemy].entries()) {
      const tile = [...owner.tiles()].find((t) => game.isShoreline(t))!;
      const unit = owner.buildUnit(UnitType.Port, tile, {});
      state.ports.push({
        portId: `practice-${i}`,
        name: "Practice",
        tile,
        unitId: unit.id(),
        ownerId: owner.id(),
        level: 1,
        damage: 0,
        development: null,
        repairUntilTick: null,
        blockadedBy: [],
        incomePerSecond: 200,
        lastIncomeTick: 0,
        captureCount: 1,
      });
    }
    const gold = enemy.gold(),
      available = enemy.modernFaction()!.population.available;
    game.addExecution(new ModernSystemsExecution());
    game.addExecution(new ModernPortTrainingExecution());
    tick(game, 22);
    expect(enemy.units(UnitType.Warship)).toHaveLength(1);
    expect(enemy.modernFaction()!.population.navy).toBe(100);
    expect(enemy.modernFaction()!.population.available).toBe(available - 100);
    expect(enemy.gold()).toBeLessThan(gold - 11000n);
    const restored = await restoreTestGame(
      snapshotGame(game),
      "ocean_and_land",
    );
    tick(game, 100);
    tick(restored, 100);
    expect(modernStateHash(restored.modernSystems())).toBe(
      modernStateHash(state),
    );
    expect(state.ports[0].blockadedBy).toContain(enemy.id());
    expect(state.ports[0].incomePerSecond).toBe(50);
    enemy.units(UnitType.Warship)[0].delete();
    tick(game, 20);
    expect(state.ports[0].blockadedBy).toEqual([]);
    expect(state.ports[0].incomePerSecond).toBe(200);
    expect(enemy.units(UnitType.Warship)).toHaveLength(0);
    tick(game, 100);
    expect(enemy.units(UnitType.Warship)).toHaveLength(0);
    balanced(state);
  });
  test("new schema rejects impossible population totals and malformed commands", async () => {
    const { state } = await fixture();
    state.factions[0].population.total++;
    expect(ModernStateSchema.safeParse(state).success).toBe(false);
    expect(
      IntentSchema.safeParse({
        type: "modern_produce",
        branch: "air",
        kind: "fighter",
        count: 999999,
      }).success,
    ).toBe(false);
    expect(
      IntentSchema.safeParse({
        type: "modern_command",
        forceIds: [],
        command: "strike",
        target: 1,
      }).success,
    ).toBe(false);
  });
  test("a player-bound pending modern execution restores without stealing another formation", async () => {
    const { game, human, enemy, state } = await fixture();
    const own = state.forces.find(
      (f) => f.playerId === human.id() && f.branch === "army",
    )!;
    const foreign = state.forces.find(
      (f) => f.playerId === enemy.id() && f.branch === "army",
    )!;
    game.addExecution(
      new ModernCommandExecution(human.id(), {
        type: "modern_command",
        forceIds: [own.id],
        command: "move",
        target: game.ref(20, 20),
        queue: false,
      }),
    );
    game.addExecution(
      new ModernCommandExecution(human.id(), {
        type: "modern_command",
        forceIds: [foreign.id],
        command: "move",
        target: game.ref(20, 20),
        queue: false,
      }),
    );
    game.addExecution(new ModernSystemsExecution());
    tick(game, 1);
    const restored = await restoreTestGame(snapshotGame(game), "plains");
    tick(game, 100);
    tick(restored, 100);
    expect(own.tile).toBe(game.ref(20, 20));
    expect(foreign.command).toBeNull();
    expect(modernStateHash(restored.modernSystems())).toBe(
      modernStateHash(state),
    );
  });
  test("weighted AI assignment is stable with zeros and rejects all-zero weights", () => {
    expect(assignModernLevel(100, "KOR")).toBe(assignModernLevel(100, "KOR"));
    expect(
      assignModernLevel(100, "RUS-region", { low: 0, medium: 0, high: 1 }),
    ).toBe("high");
    expect(() =>
      assignModernLevel(1, "USA", { low: 0, medium: 0, high: 0 }),
    ).toThrow();
  });
  test("old Game record migrates to null modern state without changing Classic", async () => {
    const game = await setup("plains");
    const snapshot = snapshotGameData(game);
    snapshot.game.v = 1;
    delete (snapshot.game.d as { modernSystems?: unknown }).modernSystems;
    const { encodeSnapshotValue } =
      await import("../src/core/snapshot/SnapshotCodec");
    const restored = await restoreTestGame(
      encodeSnapshotValue(snapshot),
      "plains",
    );
    expect(restored.modernSystems()).toBeNull();
  });
});

class WorldLoader implements GameMapLoader {
  getMapData(): MapData {
    const dir = path.resolve("resources/maps/modernworld"),
      read = (name: string) => async () =>
        new Uint8Array(fs.readFileSync(path.join(dir, name)));
    return {
      mapBin: read("map.bin"),
      map4xBin: read("map4x.bin"),
      map16xBin: read("map16x.bin"),
      manifest: async () =>
        JSON.parse(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
        ) as MapManifest,
      webpPath: "",
      layerPng: async () => {
        throw new Error("No rendering in core test");
      },
    };
  }
}
function info(): GameStartInfo {
  return {
    gameID: "MODERN02",
    lobbyCreatedAt: 0,
    players: [
      {
        clientID: "MODERN02",
        username: "Test",
        clanTag: null,
        isLobbyCreator: true,
        countryId: "KOR",
      },
    ],
    config: {
      gameMap: GameMapType.ModernWorld,
      gameMapSize: GameMapSize.Normal,
      gameType: GameType.Singleplayer,
      gameMode: GameMode.FFA,
      difficulty: Difficulty.Impossible,
      nations: "default",
      bots: 0,
      donateGold: true,
      donateTroops: true,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
      modernMode: { ...mode, participantSlots: 8, fillEmptySlots: true },
      enhancedAI: {
        tribePercent: 0,
        nationPercent: 100,
        personality: "mixed",
        fairResources: true,
        seed: 123,
      },
    },
  };
}
function step(runner: GameRunner, intents: StampedIntent[] = []) {
  runner.addTurn({ turnNumber: runner.game.ticks(), intents });
  expect(runner.executeNextTick()).toBe(true);
}
test("real world: every independent controller has equal N0, exact raster, bases/ports and saved fixed AI levels", async () => {
  const start = info();
  const runner = await createGameRunner(
    start,
    "MODERN02",
    new WorldLoader(),
    (update) => {
      if ("errMsg" in update) throw new Error(update.errMsg);
    },
  );
  step(runner);
  step(runner);
  const game = runner.game,
    state = game.modernSystems()!;
  expect(game.allPlayers()).toHaveLength(modernFactions.length);
  expect(game.players()).toHaveLength(modernFactions.length);
  for (const faction of modernFactions) {
    const p = game.player(modernFactionPlayerId(faction));
    expect(p.hasSpawned()).toBe(true);
    expect(p.numTilesOwned()).toBe(faction.tiles);
    expect(p.modernFaction()!.population.total).toBe(1_000_000);
    expect(p.modernFaction()!.population.army).toBe(18000);
    expect(p.gold()).toBe(4_000_000n);
  }
  expect(
    state.factions.filter((f) => f.aiRole === "invited-slot"),
  ).toHaveLength(0);
  expect(state.ports).toHaveLength(modernRegions.ports.length);
  expect(state.forces).toHaveLength(modernFactions.length * 3);
  balanced(state);
  const restored = await createGameRunnerFromSnapshot(
    start,
    runner.snapshot(),
    "MODERN02",
    new WorldLoader(),
    () => {},
  );
  expect(restored.game.modernSystems()).toEqual(state);
  for (let i = 0; i < 20; i++) {
    step(runner);
    step(restored);
  }
  expect(modernStateHash(restored.game.modernSystems())).toBe(
    modernStateHash(state),
  );
  balanced(state);
}, 120000);
