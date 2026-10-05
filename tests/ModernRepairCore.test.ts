// @vitest-environment node
import { describe, expect, test } from "vitest";
import { Config } from "../src/core/configuration/Config";
import {
  ModernCommandExecution,
  ModernSystemsExecution,
} from "../src/core/execution/ModernSystemsExecution";
import { Game, PlayerType, UnitType } from "../src/core/game/Game";
import { GameImpl } from "../src/core/game/GameImpl";
import { GameUpdateType } from "../src/core/game/GameUpdates";
import { modernRegions } from "../src/core/game/ModernRegions";
import { ModernForces } from "../src/core/modern/ModernForces";
import {
  MODERN_RULES as R,
  modernStockpileGrowth,
} from "../src/core/modern/ModernRules";
import { ModernState, modernStateHash } from "../src/core/modern/ModernState";
import {
  ModernSystems,
  modernSystemsFor,
} from "../src/core/modern/ModernSystems";
import { IntentSchema } from "../src/core/Schemas";
import {
  snapshotGame,
  snapshotGameData,
} from "../src/core/snapshot/GameSnapshot";
import { encodeSnapshotValue } from "../src/core/snapshot/SnapshotCodec";
import { playerInfo, setup } from "./util/Setup";
import { restoreTestGame } from "./util/Snapshot";

async function fixture(map = "plains", version: 2 | 3 = 3) {
  const game = await setup(
    map,
    {
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
      instantBuild: false,
      disableAlliances: true,
    },
    [],
    undefined,
    Config,
  );
  const human = game.addPlayer(playerInfo("repair-human", PlayerType.Human));
  const enemy = game.addPlayer(playerInfo("repair-enemy", PlayerType.Human));
  game.forEachTile((tile) => {
    if (game.isLand(tile) && !game.isImpassable(tile))
      (game.y(tile) < Math.floor(game.height() / 2) ? human : enemy).conquer(
        tile,
      );
  });
  const state: ModernState = {
    version,
    tick: 0,
    seed: 999,
    forces: [],
    bases: [],
    ports: [],
    nextForceId: 1,
    aiPlans: [],
    factions: [human, enemy].map((p) => ({
      playerId: p.id(),
      factionId: p.id(),
      parentCountryId: p.id(),
      ownedAreaUnits: 1,
      aiLevel: null,
      aiRole: "human",
      climateAdaptation: ["temperate"],
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
  for (const player of [human, enemy]) {
    player.setSpawnTile(
      [...player.tiles()][Math.floor(player.numTilesOwned() / 2)],
    );
    player.setTroops(180000);
    player.addGold(400000n);
    systems.forces.initializeFaction(player.id(), player.spawnTile()!);
  }
  return { game, human, enemy, state, systems };
}
function tick(game: Game, systems: ModernSystems, count: number) {
  for (let i = 0; i < count; i++) {
    systems.forces.tick(game.ticks());
    game.executeNextTick();
  }
}
function conserved(state: ModernState) {
  for (const { population: p } of state.factions) {
    expect(p.total).toBe(p.civilian + p.available + p.army + p.navy + p.air);
    expect(p.total + p.dead).toBe(1_000_000);
  }
}

describe("repair modern state v3 facilities, production and finite stockpiling", () => {
  test("an explicit 64-roster scenario builds 35 paid squadrons within two airfields and finite N0, then accepts two 32/3 owner-checked intents and restores every route", async () => {
    const { game, human, enemy, state, systems } = await fixture();
    // Default gameplay remains at 24 rosters. This controlled scenario raises
    // only that central bound to exercise the network command's 32-ID limit.
    const expanded = new ModernForces(
      game,
      state,
      {
        reserve: (id, branch, count) => systems.reserve(id, branch, count),
        release: (id, branch, count) => systems.release(id, branch, count),
        casualties: (id, branch, count) =>
          systems.casualties(id, branch, count),
        mobilize: (id, count) => systems.mobilize(id, count),
        demobilize: (id, count) => systems.demobilize(id, count),
        reassignArmy: (id, branch, count) =>
          systems.reassignArmy(id, branch, count),
        restoreArmy: (id, branch, count) =>
          systems.restoreArmy(id, branch, count),
      },
      { ...R.forces, maxForcesPerFaction: 64 },
    );
    const tile = [...human.tiles()].find(
      (t) => !state.bases.some((base) => base.tile === t),
    )!;
    expect(
      expanded.produce(human.id(), "air", "airbase", undefined, tile, 1),
    ).toBeNull();
    tick(game, systems, R.forces.airbaseBuildTicks);
    const bases = state.bases.filter(
      (base) => base.playerId === human.id() && base.branch === "air",
    );
    expect(bases.reduce((sum, base) => sum + base.capacity, 0)).toBe(48);
    const existing = new Set(state.forces.map((force) => force.id)),
      beforeGold = human.gold();
    for (let i = 0; i < 35; i++)
      expect(
        expanded.produce(
          human.id(),
          "air",
          "fighter",
          bases[i < 16 ? 0 : 1].id,
          undefined,
          1,
        ),
      ).toBeNull();
    expect(human.gold()).toBe(beforeGold - 35n * BigInt(R.forces.fighterCost));
    expect(state.production).toHaveLength(35);
    expect(
      state.forces.filter((force) => !existing.has(force.id)),
    ).toHaveLength(0);
    tick(
      game,
      systems,
      R.forces.aircraftProductionTicks +
        R.forces.aircraftProductionTicksPerAircraft,
    );
    expect(state.production).toHaveLength(35);
    systems.forces.tick(game.ticks());
    const squadrons = state.forces.filter((force) => !existing.has(force.id));
    expect(squadrons).toHaveLength(35);
    expect(state.production).toEqual([]);
    expect(human.modernFaction()!.population.air).toBe(4300);
    expect(human.modernFaction()!.population.available).toBe(7700);
    const tiles = [...human.tiles()],
      target = tiles[tiles.length - 1];
    for (const ids of [squadrons.slice(0, 32), squadrons.slice(32)]) {
      const intent = IntentSchema.parse({
        type: "modern_command",
        forceIds: ids.map((force) => force.id),
        command: "air_superiority",
        target,
        queue: false,
      });
      if (intent.type !== "modern_command")
        throw new Error("Unexpected intent");
      game.addExecution(new ModernCommandExecution(human.id(), intent));
    }
    game.addExecution(new ModernSystemsExecution());
    game.executeNextTick();
    game.executeNextTick();
    expect(
      squadrons.every(
        (force) =>
          force.command?.target === target &&
          force.phase === "outbound" &&
          force.path.length > 1,
      ),
    ).toBe(true);
    expect(
      systems.forces.command(enemy.id(), [squadrons[0].id], "stop", target)[0]
        .reason,
    ).toBe("not_force_owner");
    const restored = await restoreTestGame(
      snapshotGame(game),
      "plains",
      Config,
    );
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
      restored.executeNextTick();
      expect(modernStateHash(restored.modernSystems())).toBe(
        modernStateHash(state),
      );
    }
    expect(restored.player(human.id()).gold()).toBe(human.gold());
    conserved(state);
  });
  test("actual army/air coordinates and stop transitions emit between one-second full snapshots", async () => {
    const { game, human, state, systems } = await fixture();
    const army = state.forces.find(
      (f) => f.playerId === human.id() && f.branch === "army",
    )!;
    const target = [...human.tiles()].find(
      (t) => game.manhattanDist(t, army.tile) === 3,
    )!;
    const air = state.forces.find(
      (f) => f.playerId === human.id() && f.kind === "fighter",
    )!;
    systems.forces.command(human.id(), [army.id], "move", target);
    systems.forces.command(human.id(), [air.id], "air_superiority", target);
    const start = army.tile;
    game.addExecution(new ModernSystemsExecution());
    game.executeNextTick(); // Initialize the real execution.
    let motionFrames = 0,
      fullFrames = 0,
      commandRouteSeen = false;
    for (let i = 0; i < 6; i++) {
      const updates = game.executeNextTick();
      motionFrames += updates[GameUpdateType.ModernForcesFrame].length;
      fullFrames += updates[GameUpdateType.ModernSystems].length;
      commandRouteSeen ||= updates[GameUpdateType.ModernForcesFrame].some(
        (frame) =>
          frame.routes?.some(
            (route) =>
              route.index === state.forces.indexOf(army) &&
              route.command?.target === target &&
              route.path.length > 1,
          ),
      );
    }
    expect(army.tile).not.toBe(start);
    expect(air.tile).toBe(target);
    expect(motionFrames).toBeGreaterThan(1);
    expect(fullFrames).toBe(0); // tick1..6: no full-state copy needed for motion.
    expect(commandRouteSeen).toBe(true);
    systems.forces.command(human.id(), [army.id], "stop", army.tile);
    const stopped = game.executeNextTick()[GameUpdateType.ModernForcesFrame];
    expect(
      stopped.some((frame) =>
        frame.positions.some(
          (_, i) =>
            i % 9 === 0 &&
            frame.positions[i] === state.forces.indexOf(army) &&
            frame.positions[i + 2] === 0,
        ),
      ),
    ).toBe(true);
    expect(
      stopped.some((frame) =>
        frame.routes?.some(
          (route) =>
            route.index === state.forces.indexOf(army) &&
            route.command === null &&
            route.path.length === 0,
        ),
      ),
    ).toBe(true);
  });
  test("Game record v2 migrates old field defaults without changing its borders, people or fixed-growth rules", async () => {
    const { game, human, state } = await fixture("plains", 2);
    const root = snapshotGameData(game);
    expect(root.game.v).toBe(3);
    const oldState = structuredClone(state);
    delete oldState.production;
    delete oldState.completedProduction;
    delete oldState.samAircraftReloads;
    for (const faction of oldState.factions) {
      delete faction.growthModel;
      delete faction.growthCarryPermille;
      delete faction.growthPeoplePerTick;
      delete faction.civilianTrainedPerTick;
      delete faction.growthReason;
    }
    for (const base of oldState.bases) {
      delete base.branch;
      delete base.completesTick;
      delete base.repairUntilTick;
      delete base.unitId;
      delete base.constructionCounted;
    }
    root.game = {
      v: 2,
      d: {
        ...(root.game.d as Record<string, unknown>),
        modernSystems: oldState,
      },
    };
    const restored = await restoreTestGame(
      encodeSnapshotValue(root),
      "plains",
      Config,
    );
    const migrated = restored.modernSystems()!;
    expect(migrated.version).toBe(2);
    expect(migrated.production).toEqual([]);
    expect(migrated.completedProduction).toEqual([]);
    expect(migrated.factions.map((f) => f.growthModel)).toEqual([
      "legacy-fixed",
      "legacy-fixed",
    ]);
    expect(
      migrated.bases.every((b) => b.branch === "air" && b.completesTick === 0),
    ).toBe(true);
    expect(migrated.factions.map((f) => f.population)).toEqual(
      oldState.factions.map((f) => f.population),
    );
    expect([...restored.player(human.id()).tiles()]).toEqual([
      ...human.tiles(),
    ]);
    expect(restored.player(human.id()).troops()).toBe(human.troops());
    expect(
      restored.config().troopIncreaseRate(restored.player(human.id())),
    ).toBe(20);
    expect(migrated.forces).toHaveLength(oldState.forces.length);
  });
  test("nuclear replenishment reductions and the combined mobilization ceiling apply to the restored stockpiling curve", async () => {
    const ordinary = await fixture(),
      penalized = await fixture();
    penalized.human
      .modernFaction()!
      .nuclearStrikes.push({ launchId: 99, expiresTick: 1800 });
    ordinary.systems.economy(ordinary.human);
    penalized.systems.economy(penalized.human);
    const normal = ordinary.human.modernFaction()!.growthPeoplePerTick!,
      reduced = penalized.human.modernFaction()!.growthPeoplePerTick!;
    expect(reduced).toBeLessThan(normal);
    expect(Math.abs(reduced - normal * 0.9)).toBeLessThan(1);
    const f = ordinary.human.modernFaction()!,
      shifted =
        100000 - f.population.army - f.population.navy - f.population.air;
    f.population.civilian -= shifted;
    f.population.army += shifted;
    ordinary.human.addTroops(shifted * 10);
    const before = ordinary.human.troops();
    ordinary.systems.economy(ordinary.human);
    expect(ordinary.human.troops()).toBe(before);
    expect(f.growthReason).toBe("mobilization_cap");
    const armybase = ordinary.state.bases.find(
      (b) => b.playerId === ordinary.human.id() && b.branch === "army",
    )!;
    expect(
      ordinary.systems.forces.produce(
        ordinary.human.id(),
        "army",
        "army",
        armybase.id,
        undefined,
        1,
      ),
    ).toBeNull();
    expect(ordinary.state.production?.[0].source).toBe("army_reserve");
    expect(
      ordinary.human.troops() +
        ordinary.systems.forces.committedArmyRaw(ordinary.human.id()),
    ).toBe(f.population.army * 10);
    const airbase = ordinary.state.bases.find(
      (b) => b.playerId === ordinary.human.id() && b.branch === "air",
    )!;
    expect(
      ordinary.systems.forces.produce(
        ordinary.human.id(),
        "air",
        "fighter",
        airbase.id,
        undefined,
        1,
        false,
        "available",
      ),
    ).toBe("insufficient_manpower");
    conserved(ordinary.state);
    conserved(penalized.state);
  });
  test("a full common mobilization budget can retrain actual reserve soldiers into paid naval/air jobs, and capture or resume cannot duplicate their source pool", async () => {
    const { game, human, enemy, state, systems } = await fixture(
      "half_land_half_ocean",
    );
    const people = human.modernFaction()!.population;
    const remaining = 100000 - people.army - people.navy - people.air;
    people.civilian -= remaining;
    people.army += remaining;
    human.addTroops(remaining * R.rawTroopsPerPerson);
    const shore = [...human.tiles()].find((tile) => game.isShoreline(tile))!;
    expect(
      systems.forces.produce(
        human.id(),
        "navy",
        "navybase",
        undefined,
        shore,
        1,
      ),
    ).toBeNull();
    tick(game, systems, R.forces.navybaseBuildTicks + 1);
    const naval = state.bases.find(
      (base) => base.playerId === human.id() && base.branch === "navy",
    )!;
    const air = state.bases.find(
      (base) => base.playerId === human.id() && base.branch === "air",
    )!;
    const originalPool = human.troops(),
      originalPeople = structuredClone(people),
      originalGold = human.gold();
    expect(
      systems.forces.produce(
        human.id(),
        "navy",
        "warship",
        naval.id,
        undefined,
        1,
        false,
        "available",
      ),
    ).toBe("insufficient_manpower");
    expect(people).toEqual(originalPeople);
    expect(human.troops()).toBe(originalPool);
    expect(human.gold()).toBe(originalGold);
    expect(
      systems.forces.produce(
        human.id(),
        "navy",
        "warship",
        naval.id,
        undefined,
        1,
      ),
    ).toBeNull();
    expect(
      systems.forces.produce(
        human.id(),
        "air",
        "fighter",
        air.id,
        undefined,
        1,
      ),
    ).toBeNull();
    expect(state.production!.map((job) => job.source)).toEqual([
      "army_reserve",
      "army_reserve",
    ]);
    expect(human.troops()).toBe(originalPool - 200 * R.rawTroopsPerPerson);
    expect(people.army).toBe(originalPeople.army - 200);
    expect(people.navy).toBe(100);
    expect(people.air).toBe(originalPeople.air + 100);
    expect(people.available).toBe(originalPeople.available);
    expect(people.army + people.navy + people.air).toBe(100000);
    expect(human.gold()).toBe(
      originalGold - BigInt(R.forces.warshipCost + R.forces.fighterCost),
    );
    const savedPeople = structuredClone(people),
      savedPool = human.troops();
    const spentGold = human.gold();
    human.removeGold(spentGold);
    expect(
      systems.forces.produce(
        human.id(),
        "air",
        "fighter",
        air.id,
        undefined,
        1,
        false,
        "army_reserve",
      ),
    ).toBe("insufficient_gold");
    expect(people).toEqual(savedPeople);
    expect(human.troops()).toBe(savedPool);
    human.addGold(spentGold);
    const restored = await restoreTestGame(
      snapshotGame(game),
      "half_land_half_ocean",
      Config,
    );
    const resumed = modernSystemsFor(restored)!;
    enemy.conquer(naval.tile);
    restored.player(enemy.id()).conquer(naval.tile);
    for (let i = 0; i < 200; i++) {
      tick(game, systems, 1);
      tick(restored, resumed, 1);
      expect(modernStateHash(restored.modernSystems())).toBe(
        modernStateHash(state),
      );
    }
    expect(state.production).toEqual([]);
    expect(human.units(UnitType.Warship)).toHaveLength(0);
    expect(people.navy).toBe(0);
    expect(people.army).toBe(originalPeople.army - 100);
    expect(people.air).toBe(originalPeople.air + 100);
    expect(people.available).toBe(originalPeople.available);
    expect(human.troops()).toBe(originalPool - 100 * R.rawTroopsPerPerson);
    expect(
      state.forces
        .filter(
          (force) => force.playerId === human.id() && force.branch === "air",
        )
        .reduce((sum, force) => sum + force.personnel, 0),
    ).toBe(people.air);
    conserved(state);
  });
  test("an army order transfers one formation into the actual attack, tracks captured tiles, and stop returns its survivors without duplicate manpower", async () => {
    const { game, human, enemy, state, systems } = await fixture();
    const force = state.forces.find(
      (f) => f.playerId === human.id() && f.branch === "army",
    )!;
    const source = force.tile;
    const target = [...enemy.tiles()]
      .filter((tile) =>
        game.neighbors(tile).some((n) => game.owner(n) === human),
      )
      .sort(
        (a, b) =>
          game.manhattanDist(source, a) - game.manhattanDist(source, b) ||
          a - b,
      )[0];
    expect(
      systems.forces.command(human.id(), [force.id], "attack", target)[0]
        .reason,
    ).toBeNull();
    game.addExecution(new ModernSystemsExecution());
    let activeAttackSeen = false,
      conqueredPositionSeen = false;
    for (let i = 0; i < 500; i++) {
      game.executeNextTick();
      systems.reconcileArmy(human);
      const outgoing = human
        .outgoingAttacks()
        .reduce((n, attack) => n + attack.troops(), 0);
      const raw =
        human.troops() +
        outgoing +
        human
          .units(UnitType.TransportShip)
          .reduce((n, ship) => n + ship.troops(), 0) +
        systems.forces.committedArmyRaw(human.id());
      expect(Math.floor(raw / R.rawTroopsPerPerson)).toBe(
        human.modernFaction()!.population.army,
      );
      activeAttackSeen ||=
        outgoing > 0 && force.phase === "attacking" && force.personnel === 0;
      if (
        force.phase === "attacking" &&
        game.owner(force.tile) === human &&
        game.y(force.tile) >= Math.floor(game.height() / 2)
      ) {
        conqueredPositionSeen = true;
        break;
      }
    }
    expect(activeAttackSeen).toBe(true);
    expect(conqueredPositionSeen).toBe(true);
    expect(force.tile).not.toBe(source);
    const location = force.tile;
    expect(
      systems.forces.command(human.id(), [force.id], "stop", location)[0]
        .reason,
    ).toBeNull();
    // Repeated X must not add another delayed execution or restart the timer.
    systems.forces.command(human.id(), [force.id], "stop", location);
    expect(
      (game as GameImpl)
        .executions()
        .filter(
          (execution) => execution.constructor.name === "RetreatExecution",
        ),
    ).toHaveLength(1);
    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
      systems.reconcileArmy(human);
    }
    const restored = await restoreTestGame(
      snapshotGame(game),
      "plains",
      Config,
    );
    const resumed = modernSystemsFor(restored)!;
    const advanceTogether = () => {
      game.executeNextTick();
      systems.reconcileArmy(human);
      restored.executeNextTick();
      resumed.reconcileArmy(restored.player(human.id()));
      expect(modernStateHash(restored.modernSystems())).toBe(
        modernStateHash(state),
      );
    };
    for (let i = 5; i < 20; i++) advanceTogether();
    expect(force.phase).toBe("attacking");
    expect(human.outgoingAttacks()[0].retreated()).toBe(false);
    advanceTogether(); // Existing RetreatExecution's exact 20-tick delay expires.
    expect(human.outgoingAttacks()[0].retreated()).toBe(true);
    advanceTogether(); // Native AttackExecution returns survivors on its next tick.
    expect(force.phase).toBe("idle");
    expect(force.tile).toBe(location);
    expect(force.personnel).toBeGreaterThan(0);
    expect(human.outgoingAttacks()).toHaveLength(0);
    const survivingRaw =
      human.troops() + systems.forces.committedArmyRaw(human.id());
    // Native combat may return fractions of a person in raw troops. The integer
    // ledger rounds only its view; that sub-person remainder stays in the pool.
    expect(Math.floor(survivingRaw / R.rawTroopsPerPerson)).toBe(
      human.modernFaction()!.population.army,
    );
    expect(survivingRaw % R.rawTroopsPerPerson).toBe(
      human.troops() % R.rawTroopsPerPerson,
    );
    conserved(state);
  });
  test("normal v2 scenario creates independent ready army/air facilities without adding people, and v2 save defaults stay fixed", async () => {
    const { game, human, state, systems } = await fixture();
    expect(game.config().gameConfig().modernMode?.version).toBe(2);
    expect(human.modernFaction()!.growthModel).toBe("stockpile-v1");
    const bases = state.bases.filter((b) => b.playerId === human.id());
    expect(bases.map((b) => b.branch)).toEqual(["air", "army"]);
    expect(bases[0].tile).not.toBe(bases[1].tile);
    expect(
      state.forces
        .filter((f) => f.playerId === human.id() && f.branch === "army")
        .map((f) => f.personnel),
    ).toEqual([500, 500]);
    expect(human.troops() + systems.forces.committedArmyRaw(human.id())).toBe(
      180000,
    );
    expect(human.modernFaction()!.population.air).toBe(800);
    expect(state.completedProduction).toEqual([]);
    conserved(state);
    const old = await fixture("plains", 2);
    expect(old.human.modernFaction()!.growthModel).toBe("legacy-fixed");
    expect(
      old.state.bases.filter((b) => b.playerId === old.human.id()),
    ).toHaveLength(1);
    expect(old.game.config().troopIncreaseRate(old.human)).toBe(20);
  });
  test("army base and training require owned land, elapsed ticks, paid gold and reserved finite recruits", async () => {
    const { game, human, enemy, state, systems } = await fixture();
    const tile = [...human.tiles()].find(
      (t) => !state.bases.some((b) => b.tile === t),
    )!;
    const before = human.gold();
    expect(
      systems.forces.produce(
        human.id(),
        "army",
        "armybase",
        undefined,
        enemy.spawnTile(),
        1,
      ),
    ).toBe("base_requires_owned_land");
    expect(
      systems.forces.produce(
        human.id(),
        "army",
        "armybase",
        undefined,
        tile,
        1,
      ),
    ).toBeNull();
    const base = state.bases.find(
      (b) => b.tile === tile && b.branch === "army",
    )!;
    expect(human.gold()).toBe(before - BigInt(R.forces.armybaseCost));
    expect(
      systems.forces.produce(
        human.id(),
        "army",
        "army",
        base.id,
        undefined,
        1,
        false,
        "available",
      ),
    ).toBe("base_under_construction");
    tick(game, systems, R.forces.armybaseBuildTicks);
    expect(
      systems.forces.produce(
        human.id(),
        "army",
        "army",
        base.id,
        undefined,
        1,
        false,
        "available",
      ),
    ).toBeNull();
    const people = human.modernFaction()!.population;
    const job = state.production![0];
    expect(job.source).toBe("available");
    expect(people.available).toBe(10200);
    expect(people.army).toBe(19000);
    expect(
      state.forces.filter(
        (f) => f.playerId === human.id() && f.branch === "army",
      ),
    ).toHaveLength(2);
    tick(game, systems, R.forces.armyTrainingTicks);
    expect(state.production).toHaveLength(1); // Deadline tick has not been executed yet.
    systems.forces.tick(game.ticks()); // Execute that exact deadline.
    expect(
      state.forces.some(
        (f) =>
          f.baseId === base.id && f.tile === base.tile && f.personnel === 1000,
      ),
    ).toBe(true);
    expect(state.production).toEqual([]);
    expect(
      state.completedProduction?.some(
        (p) => p.playerId === human.id() && p.kind === "army" && p.count === 1,
      ),
    ).toBe(true);
    expect(human.troops() + systems.forces.committedArmyRaw(human.id())).toBe(
      190000,
    );
    conserved(state);
  });
  test("pending capacity cannot be double-booked; damaged bases pause work and paid repairs preserve grounded crews", async () => {
    const { game, human, state, systems } = await fixture();
    const base = state.bases.find(
      (b) => b.playerId === human.id() && b.branch === "air",
    )!;
    expect(
      systems.forces.produce(
        human.id(),
        "air",
        "fighter",
        base.id,
        undefined,
        8,
      ),
    ).toBeNull();
    expect(
      systems.forces.produce(
        human.id(),
        "air",
        "strike",
        base.id,
        undefined,
        8,
      ),
    ).toBeNull();
    const gold = human.gold(),
      people = human.modernFaction()!.population.available;
    expect(
      systems.forces.produce(
        human.id(),
        "air",
        "fighter",
        base.id,
        undefined,
        1,
      ),
    ).toBe("base_capacity");
    expect(human.gold()).toBe(gold);
    expect(human.modernFaction()!.population.available).toBe(people);
    base.health = 500;
    expect(
      systems.forces.produce(
        human.id(),
        "air",
        "repair_base",
        base.id,
        undefined,
        1,
      ),
    ).toBeNull();
    const until = state.production![0].completesTick;
    tick(game, systems, 20);
    expect(state.production![0].completesTick).toBeGreaterThan(until);
    expect(
      state.forces.filter(
        (f) =>
          f.playerId === human.id() &&
          f.branch === "air" &&
          f.phase !== "destroyed",
      ),
    ).toHaveLength(2);
    tick(
      game,
      systems,
      R.forces.baseRepairTicks +
        R.forces.aircraftProductionTicks +
        8 * R.forces.aircraftProductionTicksPerAircraft,
    );
    expect(base.health).toBe(base.maxHealth);
    expect(state.production).toEqual([]);
    expect(
      state.forces
        .filter((f) => f.playerId === human.id() && f.branch === "air")
        .reduce((n, f) => n + f.aircraft, 0),
    ).toBe(24);
    conserved(state);
  });
  test("capture cancels unfinished recruits, keeps the paid construction deadline, and does not hand a free force to the captor", async () => {
    const { game, human, enemy, state, systems } = await fixture();
    const base = state.bases.find(
      (b) => b.playerId === human.id() && b.branch === "army",
    )!;
    const population = structuredClone(human.modernFaction()!.population);
    expect(
      systems.forces.produce(
        human.id(),
        "army",
        "army",
        base.id,
        undefined,
        1,
        false,
        "available",
      ),
    ).toBeNull();
    enemy.conquer(base.tile);
    tick(game, systems, 1);
    expect(state.production).toEqual([]);
    expect(human.modernFaction()!.population.available).toBe(
      population.available,
    );
    expect(
      state.forces.filter(
        (f) => f.playerId === enemy.id() && f.branch === "army",
      ),
    ).toHaveLength(2);
    conserved(state);
  });
  test("naval construction rejects the native structure-spacing obstruction without charging or reserving population", async () => {
    const { game, human, state, systems } = await fixture(
      "half_land_half_ocean",
    );
    const shore = [...human.tiles()].find((t) => game.isShoreline(t))!;
    human.buildUnit(UnitType.City, shore, {});
    const gold = human.gold(),
      people = structuredClone(human.modernFaction()!.population),
      before = structuredClone(state);
    // A real City covers this small owned coastline with the default native
    // 15-tile spacing rule. Land/shore ownership alone used to look valid.
    expect(game.config().structureMinDist()).toBe(15);
    expect(human.canBuild(UnitType.Port, shore)).toBe(false);
    expect(human.buildableUnits(shore, [UnitType.Port])[0].canBuild).toBe(
      false,
    );
    const intent = IntentSchema.parse({
      type: "modern_produce",
      branch: "navy",
      kind: "navybase",
      tile: shore,
      count: 1,
    });
    const execution = new ModernCommandExecution(human.id(), intent as never);
    execution.init(game);
    execution.tick();
    expect(human.gold()).toBe(gold);
    expect(human.modernFaction()!.population).toEqual(people);
    expect(human.units(UnitType.Port)).toEqual([]);
    expect(state).toEqual(before);
    expect(
      systems.forces.produce(
        human.id(),
        "navy",
        "navybase",
        undefined,
        shore,
        1,
      ),
    ).toBe("navybase_no_valid_site");
    conserved(state);
  });
  test("native Port preview and execution agree on the adjusted coast, real price and construction deadline", async () => {
    const { game, human, state, systems } = await fixture(
      "half_land_half_ocean",
    );
    const requested = [...human.tiles()].find((t) => !game.isShoreline(t))!;
    const preview = human.buildableUnits(requested, [UnitType.Port])[0];
    expect(typeof preview.canBuild).toBe("number");
    if (preview.canBuild === false)
      throw new Error("fixture needs a legal native coast");
    const spawn = preview.canBuild,
      gold = human.gold(),
      people = structuredClone(human.modernFaction()!.population),
      start = game.ticks();
    expect(spawn).not.toBe(requested);
    expect(
      systems.forces.produce(
        human.id(),
        "navy",
        "navybase",
        undefined,
        spawn,
        1,
      ),
    ).toBeNull();
    const port = human.units(UnitType.Port)[0],
      base = state.bases.find((b) => b.unitId === port.id())!;
    expect(port.tile()).toBe(spawn);
    expect(base.tile).toBe(spawn);
    expect(base.completesTick).toBe(start + R.forces.navybaseBuildTicks);
    expect(port.isUnderConstruction()).toBe(true);
    expect(human.gold()).toBe(gold - preview.cost);
    expect(human.modernFaction()!.population).toEqual(people);
    tick(game, systems, R.forces.navybaseBuildTicks);
    expect(port.isUnderConstruction()).toBe(true);
    systems.forces.tick(game.ticks());
    expect(port.isUnderConstruction()).toBe(false);
    expect(human.units(UnitType.Port)).toHaveLength(1);
    conserved(state);
  });
  test("naval base uses one original Port and warship stays under construction until its paid crew can sail", async () => {
    const { game, human, state, systems } = await fixture(
      "half_land_half_ocean",
    );
    const shore = [...human.tiles()].find((t) => game.isShoreline(t))!;
    const before = human.gold();
    expect(
      systems.forces.produce(
        human.id(),
        "navy",
        "navybase",
        undefined,
        shore,
        1,
      ),
    ).toBeNull();
    expect(human.units(UnitType.Port)).toHaveLength(1);
    const base = state.bases.find(
      (b) => b.playerId === human.id() && b.branch === "navy",
    )!;
    expect(base.unitId).toBe(human.units(UnitType.Port)[0].id());
    expect(human.gold()).toBeLessThan(before);
    tick(game, systems, R.forces.navybaseBuildTicks + 1);
    expect(
      systems.forces.produce(
        human.id(),
        "navy",
        "warship",
        base.id,
        undefined,
        1,
      ),
    ).toBeNull();
    const ship = human.units(UnitType.Warship)[0];
    expect(ship.isUnderConstruction()).toBe(true);
    expect(
      state.forces.filter(
        (f) => f.playerId === human.id() && f.branch === "navy",
      ),
    ).toHaveLength(0);
    tick(game, systems, R.forces.warshipProductionTicks);
    expect(ship.isUnderConstruction()).toBe(true);
    systems.forces.tick(game.ticks()); // Complete on the declared deadline, never earlier.
    expect(ship.isUnderConstruction()).toBe(false);
    expect(state.forces.filter((f) => f.unitId === ship.id())).toHaveLength(1);
    expect(human.modernFaction()!.population.navy).toBe(100);
    conserved(state);
  });
  test("same-build snapshot preserves training reservations, completion deadlines and fractional growth", async () => {
    const { game, human, state, systems } = await fixture();
    const base = state.bases.find(
      (b) => b.playerId === human.id() && b.branch === "army",
    )!;
    systems.forces.produce(
      human.id(),
      "army",
      "army",
      base.id,
      undefined,
      2,
      false,
      "available",
    );
    game.addExecution(new ModernSystemsExecution());
    for (let i = 0; i < 17; i++) {
      systems.economy(human);
      game.executeNextTick();
    }
    const saved = snapshotGame(game),
      restored = await restoreTestGame(saved, "plains", Config),
      resumed = modernSystemsFor(restored)!;
    for (let i = 0; i < 250; i++) {
      systems.economy(human);
      game.executeNextTick();
      resumed.economy(restored.player(human.id()));
      restored.executeNextTick();
    }
    expect(modernStateHash(restored.modernSystems())).toBe(
      modernStateHash(state),
    );
    expect(restored.player(human.id()).gold()).toBe(human.gold());
    expect(restored.player(human.id()).troops()).toBe(human.troops());
    expect(state.production).toEqual([]);
    conserved(state);
  });
  test("unrestricted stockpiling follows the original normalized curve while reserves, ceilings and penalties remain finite", async () => {
    const { game, human, state, systems } = await fixture();
    const f = human.modernFaction()!;
    const cap =
      game.config().maxTroops(human) -
      systems.forces.committedArmyRaw(human.id());
    let reference = human.troops();
    for (let i = 0; i < 100; i++) {
      reference += modernStockpileGrowth(reference, cap);
      systems.economy(human);
      game.executeNextTick();
    }
    expect(Math.abs(reference - human.troops())).toBeLessThan(100);
    expect(human.troops()).toBeGreaterThan(200000);
    expect(f.growthPeoplePerTick).toBeGreaterThan(2);
    conserved(state);
    f.population.civilian += f.population.available;
    f.population.available = 0;
    human.removeGold(human.gold());
    const stopped = human.troops();
    systems.economy(human);
    expect(human.troops()).toBe(stopped);
    expect(f.growthReason).toBe("insufficient_manpower");
    conserved(state);
  });
});
