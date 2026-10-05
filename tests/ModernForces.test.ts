// @vitest-environment node
import { describe, expect, test } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { Game, PlayerType, UnitType } from "../src/core/game/Game";
import { modernRegions } from "../src/core/game/ModernRegions";
import {
  ModernForces,
  forcePreview,
  modernLandPathMetrics,
} from "../src/core/modern/ModernForces";
import {
  DEFAULT_MODERN_FORCE_RULES,
  ModernBranch,
  ModernForceHooks,
  ModernForcesState,
} from "../src/core/modern/ModernForceTypes";
import { snapshotGame } from "../src/core/snapshot/GameSnapshot";
import { playerInfo, setup } from "./util/Setup";
import { restoreTestGame } from "./util/Snapshot";
import { TestConfig } from "./util/TestConfig";

class PersonnelLedger implements ModernForceHooks {
  balances = new Map<
    string,
    { available: number; army: number; navy: number; air: number; dead: number }
  >();
  constructor(ids: string[]) {
    for (const id of ids)
      this.balances.set(id, {
        available: 12000,
        army: 18000,
        navy: 0,
        air: 0,
        dead: 0,
      });
  }
  reserve(id: string, branch: ModernBranch, amount: number): boolean {
    const p = this.balances.get(id)!;
    if (branch === "army") return p.army >= amount;
    if (p.available < amount) return false;
    p.available -= amount;
    p[branch] += amount;
    return true;
  }
  release(id: string, branch: ModernBranch, amount: number): void {
    if (branch !== "army") {
      const p = this.balances.get(id)!;
      p[branch] -= amount;
      p.available += amount;
    }
  }
  casualties(id: string, branch: ModernBranch, amount: number): void {
    const p = this.balances.get(id)!;
    p[branch] -= amount;
    p.dead += amount;
  }
}

async function fixture(map = "plains", protectionTicks?: number) {
  const game = await setup(
    map,
    {
      instantBuild: true,
      ...(protectionTicks === undefined
        ? {}
        : {
            modernMode: {
              scenario: "modern-regions-v2",
              version: 2,
              dataHash: modernRegions.hash,
              countryId: "KOR",
              balance: "balanced",
              victory: "territory",
              targetPercent: 60,
              protectionTicks,
              capitalElimination: false,
            },
          }),
    },
    [],
    undefined,
    protectionTicks === undefined ? TestConfig : Config,
  );
  const human = game.addPlayer(playerInfo("human", PlayerType.Human));
  const ai = game.addPlayer(playerInfo("enemy", PlayerType.Nation));
  if (map === "plains") {
    for (let y = 10; y < 30; y++)
      for (let x = 10; x < 30; x++) human.conquer(game.ref(x, y));
    for (let y = 10; y < 30; y++)
      for (let x = 30; x < 50; x++) ai.conquer(game.ref(x, y));
  } else {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 8; x++) (y < 8 ? human : ai).conquer(game.ref(x, y));
  }
  human.setSpawnTile(game.ref(10 % game.width(), 10 % game.height()));
  ai.setSpawnTile(game.ref(30 % game.width(), 10 % game.height()));
  human.setTroops(180000);
  ai.setTroops(1000);
  human.addGold(10_000_000n);
  ai.addGold(10_000_000n);
  const state: ModernForcesState = {
    forces: [],
    bases: [],
    nextForceId: 1,
    seed: 123,
  };
  const ledger = new PersonnelLedger([human.id(), ai.id()]);
  const forces = new ModernForces(game, state, ledger);
  return { game, human, ai, state, ledger, forces };
}
function advance(game: Game, forces: ModernForces, count: number) {
  for (let i = 0; i < count; i++) {
    forces.tick();
    game.executeNextTick();
  }
}

function attachModernForces(game: Game, state: ModernForcesState): void {
  game.setModernSystems(
    Object.assign(state, {
      version: 2 as const,
      tick: 0,
      factions: [],
      ports: [],
      aiPlans: [],
    }),
  );
}

describe("modern military simulation", () => {
  test("initial formations transfer existing army people and pilots use the same finite pool", async () => {
    const { game, human, state, ledger, forces } = await fixture();
    forces.initializeFaction(human.id(), game.ref(12, 12));
    expect(human.troops() + forces.committedArmyRaw(human.id())).toBe(180000);
    expect(state.forces.map((f) => [f.kind, f.personnel, f.aircraft])).toEqual([
      ["army", 1000, 0],
      ["fighter", 400, 4],
      ["strike", 400, 4],
    ]);
    expect(ledger.balances.get(human.id())).toEqual({
      available: 11200,
      army: 18000,
      navy: 0,
      air: 800,
      dead: 0,
    });
  });

  test("army moves through owned ground then existing combat captures enemy ground", async () => {
    const { game, human, ai, state, forces } = await fixture();
    forces.initializeFaction(human.id(), game.ref(12, 12));
    const army = state.forces[0],
      target = game.ref(30, 12),
      original = army.tile;
    expect(
      forces.command(human.id(), [army.id], "attack", target)[0].reason,
    ).toBeNull();
    expect(army.tile).toBe(original);
    advance(game, forces, 20);
    expect(game.x(army.tile)).toBeGreaterThan(12);
    expect(game.owner(target)).toBe(ai);
    advance(game, forces, 200);
    expect(game.owner(target)).toBe(human);
    expect(human.numTilesOwned()).toBeGreaterThan(400);
  });

  test("ownership, owned-land routing, invalid terrain and queue limits are enforced", async () => {
    const { game, human, ai, state, forces } = await fixture();
    forces.initializeFaction(human.id(), game.ref(12, 12));
    const army = state.forces[0];
    expect(
      forces.command(ai.id(), [army.id], "move", game.ref(13, 12))[0].reason,
    ).toBe("not_force_owner");
    expect(
      forces.command(human.id(), [army.id], "move", game.ref(35, 12))[0].reason,
    ).toBe("friendly_or_protected_target");
    expect(
      forces.command(human.id(), [army.id], "attack", game.ref(40, 12))[0]
        .reason,
    ).toBe("no_reachable_landing");
    expect(
      forces.command(human.id(), [army.id], "move", game.ref(15, 12))[0].reason,
    ).toBeNull();
    for (let i = 0; i < 8; i++)
      expect(
        forces.command(human.id(), [army.id], "move", game.ref(16, 12), true)[0]
          .reason,
      ).toBeNull();
    expect(
      forces.command(human.id(), [army.id], "move", game.ref(16, 12), true)[0]
        .reason,
    ).toBe("command_queue_full");
    forces.command(human.id(), [army.id], "stop", army.tile);
    expect(army.queue).toHaveLength(0);
    expect(army.phase).toBe("idle");
    const x = army.tile;
    advance(game, forces, 10);
    expect(army.tile).toBe(x);
  });

  test("air sorties move, cause real damage, return, rearm and never capture ground", async () => {
    const { game, human, ai, state, forces } = await fixture();
    forces.initializeFaction(human.id(), game.ref(12, 12));
    const strike = state.forces.find((f) => f.kind === "strike")!,
      target = game.ref(35, 12),
      before = ai.numTilesOwned();
    expect(
      forces.command(human.id(), [strike.id], "strike", target)[0].reason,
    ).toBeNull();
    advance(game, forces, 2);
    expect(strike.tile).not.toBe(state.bases[0].tile);
    advance(game, forces, 5);
    expect(ai.troops()).toBe(200);
    expect(ai.numTilesOwned()).toBe(before);
    expect(game.owner(target)).toBe(ai);
    advance(game, forces, 45);
    expect(strike.phase).toBe("rearming");
    expect(strike.tile).toBe(state.bases[0].tile);
    expect(
      forces.command(human.id(), [strike.id], "strike", target)[0].reason,
    ).toBe("aircraft_rearming");
    advance(game, forces, 120);
    expect(strike.phase).toBe("idle");
    expect(strike.completedMissions).toBe(1);
  });

  test("fighter cannot ground-strike; ranged and captured-base limits give explicit reasons", async () => {
    const { game, human, ai, state, forces } = await fixture();
    forces.initializeFaction(human.id(), game.ref(12, 12));
    const fighter = state.forces.find((f) => f.kind === "fighter")!;
    expect(
      forces.command(human.id(), [fighter.id], "strike", game.ref(35, 12))[0]
        .reason,
    ).toBe("fighter_cannot_ground_strike");
    const narrow = new ModernForces(
      game,
      state,
      new PersonnelLedger([human.id(), ai.id()]),
      { ...DEFAULT_MODERN_FORCE_RULES, airRangeTiles: 5 },
    );
    expect(
      narrow.command(human.id(), [fighter.id], "intercept", game.ref(35, 12))[0]
        .reason,
    ).toBe("outside_air_range");
    ai.conquer(state.bases[0].tile);
    expect(
      forces.command(human.id(), [fighter.id], "intercept", game.ref(35, 12))[0]
        .reason,
    ).toBe("airbase_unavailable");
  });

  test("fighter interception removes aircraft and pilots, and paid replacement cannot duplicate people", async () => {
    const { game, human, ai, state, ledger } = await fixture();
    const forces = new ModernForces(game, state, ledger, {
      ...DEFAULT_MODERN_FORCE_RULES,
      fighterHitPermille: 1000,
    });
    forces.initializeFaction(human.id(), game.ref(28, 12));
    forces.initializeFaction(ai.id(), game.ref(32, 12));
    const fighter = state.forces.find(
      (f) => f.playerId === ai.id() && f.kind === "fighter",
    )!;
    const strike = state.forces.find(
      (f) => f.playerId === human.id() && f.kind === "strike",
    )!;
    forces.command(ai.id(), [fighter.id], "intercept", game.ref(30, 12));
    forces.command(human.id(), [strike.id], "strike", game.ref(32, 12));
    advance(game, forces, 15);
    expect(strike.aircraft).toBeLessThan(4);
    const p = ledger.balances.get(human.id())!;
    expect(p.dead).toBeGreaterThan(0);
    expect(p.available + p.air + p.dead).toBe(12000);
    expect(
      forces.produce(
        human.id(),
        "air",
        "strike",
        state.bases[0].id,
        undefined,
        2,
      ),
    ).toBeNull();
    expect(p.available + p.air + p.dead).toBe(12000);
    p.available = 0;
    const before = human.gold();
    expect(
      forces.produce(
        human.id(),
        "air",
        "strike",
        state.bases[0].id,
        undefined,
        2,
      ),
    ).toBe("insufficient_manpower");
    expect(human.gold()).toBe(before);
  });

  test("ground AA has a distinct paid aircraft cooldown from missile interception", async () => {
    const { game, human, ai, state, ledger } = await fixture();
    const sam = ai.buildUnit(UnitType.SAMLauncher, game.ref(31, 12), {});
    const forces = new ModernForces(game, state, ledger, {
      ...DEFAULT_MODERN_FORCE_RULES,
      samAircraftHitPermille: 1000,
    });
    forces.initializeFaction(human.id(), game.ref(28, 12));
    const strike = state.forces.find((f) => f.kind === "strike")!;
    const before = ai.gold();
    forces.command(human.id(), [strike.id], "strike", game.ref(32, 12));
    advance(game, forces, 6);
    expect(strike.aircraft).toBe(3);
    expect(ai.gold()).toBe(
      before - BigInt(DEFAULT_MODERN_FORCE_RULES.samAircraftCost),
    );
    expect(state.samAircraftReloads).toEqual([
      { unitId: sam.id(), nextTick: 30 },
    ]);
    expect(sam.missileTimerQueue()).toHaveLength(0);
  });

  test("navy uses the existing moving warship simulation and rejects land routing", async () => {
    const { game, human, state, ledger } = await fixture(
      "half_land_half_ocean",
    );
    human.buildUnit(UnitType.Port, game.ref(7, 3), {});
    const forces = new ModernForces(game, state, ledger);
    expect(
      forces.produce(
        human.id(),
        "navy",
        "warship",
        undefined,
        game.ref(8, 3),
        1,
      ),
    ).toBeNull();
    const navy = state.forces[0],
      initial = navy.tile;
    game.executeNextTick();
    expect(
      forces.command(human.id(), [navy.id], "move", game.ref(3, 3))[0].reason,
    ).toBe("navy_requires_navigable_water");
    expect(
      forces.command(human.id(), [navy.id], "escort", game.ref(12, 3))[0]
        .reason,
    ).toBeNull();
    advance(game, forces, 20);
    expect(navy.tile).not.toBe(initial);
    expect(game.isWater(navy.tile)).toBe(true);
    expect(ledger.balances.get(human.id())!.navy).toBe(100);
  });

  test("navy reaches the previewed water endpoint within its ETA, holds after arrival and stop, and never sails onto a blockaded port", async () => {
    const { game, human, ai, state, forces, ledger } = await fixture(
      "half_land_half_ocean",
    );
    human.buildUnit(UnitType.Port, game.ref(7, 3), {});
    ai.buildUnit(UnitType.Port, game.ref(7, 12), {});
    expect(
      forces.produce(
        human.id(),
        "navy",
        "warship",
        undefined,
        game.ref(8, 3),
        1,
      ),
    ).toBeNull();
    game.executeNextTick();
    const navy = state.forces[0],
      target = game.ref(14, 3),
      preview = forcePreview(game, state, navy, target, "move"),
      unit = game.unit(navy.unitId!)!;
    expect(preview.valid).toBe(true);
    expect(
      forces.command(human.id(), [navy.id], "move", target)[0].reason,
    ).toBeNull();
    advance(game, forces, 2);
    expect(navy.phase).toBe("moving");
    const restored = await restoreTestGame(
        snapshotGame(game),
        "half_land_half_ocean",
      ),
      resumedState = JSON.parse(JSON.stringify(state)) as ModernForcesState,
      resumedLedger = new PersonnelLedger([human.id(), ai.id()]);
    for (const [id, balance] of ledger.balances)
      resumedLedger.balances.set(id, { ...balance });
    const resumedForces = new ModernForces(
      restored,
      resumedState,
      resumedLedger,
    );
    advance(restored, resumedForces, preview.etaTicks + 2);
    advance(game, forces, preview.etaTicks + 2);
    expect(resumedState).toEqual(state);
    expect(restored.unit(navy.unitId!)!.tile()).toBe(unit.tile());
    expect(unit.tile()).toBe(target);
    expect(navy.phase).toBe("idle");
    advance(game, forces, 20);
    expect(unit.tile()).toBe(target);
    const port = game.ref(7, 12),
      blockade = forcePreview(game, state, navy, port, "blockade");
    expect(blockade.valid).toBe(true);
    expect(game.isWater(blockade.path[blockade.path.length - 1])).toBe(true);
    forces.command(human.id(), [navy.id], "blockade", port);
    advance(game, forces, blockade.etaTicks + 2);
    expect(navy.phase).toBe("engaging");
    expect(unit.tile()).toBe(blockade.path[blockade.path.length - 1]);
    expect(game.isWater(unit.tile())).toBe(true);
    forces.command(human.id(), [navy.id], "wait", unit.tile());
    const held = unit.tile();
    advance(game, forces, 20);
    expect(unit.tile()).toBe(held);
  });

  test("merchant hunting cannot override a modern stop or direct move, while patrol can still pursue merchants", async () => {
    const { game, human, ai, state, forces } = await fixture(
      "half_land_half_ocean",
      0,
    );
    human.buildUnit(UnitType.Port, game.ref(7, 3), {});
    const enemyPort = ai.buildUnit(UnitType.Port, game.ref(7, 12), {});
    forces.produce(human.id(), "navy", "warship", undefined, game.ref(8, 3), 1);
    attachModernForces(game, state);
    game.executeNextTick();
    const navy = state.forces[0],
      unit = game.unit(navy.unitId!)!,
      held = unit.tile(),
      merchant = ai.buildUnit(UnitType.TradeShip, game.ref(15, 12), {
        targetUnit: enemyPort,
      });
    forces.command(human.id(), [navy.id], "wait", held);
    advance(game, forces, 20);
    expect(unit.tile()).toBe(held);
    const destination = game.ref(14, 3),
      preview = forcePreview(game, state, navy, destination, "move");
    forces.command(human.id(), [navy.id], "move", destination);
    advance(game, forces, 2);
    const restored = await restoreTestGame(
        snapshotGame(game),
        "half_land_half_ocean",
        Config,
      ),
      resumedState = restored.modernSystems()!,
      resumed = new ModernForces(
        restored,
        resumedState,
        new PersonnelLedger([human.id(), ai.id()]),
      );
    advance(restored, resumed, preview.etaTicks + 2);
    advance(game, forces, preview.etaTicks + 2);
    expect(resumedState).toEqual(game.modernSystems());
    expect(restored.unit(unit.id())!.tile()).toBe(unit.tile());
    expect(unit.tile()).toBe(destination);
    expect(navy.phase).toBe("idle");
    advance(game, forces, 20);
    expect(unit.tile()).toBe(destination);
    expect(merchant.owner()).toBe(ai);
    forces.command(human.id(), [navy.id], "patrol", destination);
    advance(game, forces, 20);
    expect(merchant.owner()).toBe(human);
  });

  test("modern protection prevents fighter and aircraft-SAM fire without consuming SAM reload or ammunition", async () => {
    const { game, human, ai, state, ledger } = await fixture("plains", 1000);
    const forces = new ModernForces(game, state, ledger, {
      ...DEFAULT_MODERN_FORCE_RULES,
      samAircraftHitPermille: 1000,
    });
    forces.initializeFaction(human.id(), game.ref(12, 12));
    forces.initializeFaction(ai.id(), game.ref(35, 12));
    ai.buildUnit(UnitType.SAMLauncher, game.ref(30, 12), {});
    const humanFighter = state.forces.find(
        (f) => f.playerId === human.id() && f.kind === "fighter",
      )!,
      enemyFighter = state.forces.find(
        (f) => f.playerId === ai.id() && f.kind === "fighter",
      )!;
    expect(human.canAttackPlayer(ai)).toBe(false);
    expect(ai.canAttackPlayer(human)).toBe(false);
    forces.command(
      human.id(),
      [humanFighter.id],
      "air_superiority",
      humanFighter.tile,
    );
    forces.command(
      ai.id(),
      [enemyFighter.id],
      "air_superiority",
      enemyFighter.tile,
    );
    advance(game, forces, 1); // The ordinary aircraft upkeep is charged at tick zero.
    const gold = ai.gold();
    advance(game, forces, 20);
    expect(humanFighter.aircraft).toBe(4);
    expect(enemyFighter.aircraft).toBe(4);
    expect(state.samAircraftReloads).toEqual([]);
    expect(ai.gold()).toBe(gold);
  });

  test("native naval firing respects modern starting protection for both human and nation controllers", async () => {
    const { game, human, ai, state, forces } = await fixture(
      "half_land_half_ocean",
      1000,
    );
    for (const [owner, y] of [
      [human, 3],
      [ai, 12],
    ] as const) {
      owner.buildUnit(UnitType.Port, game.ref(7, y), {});
      expect(
        forces.produce(
          owner.id(),
          "navy",
          "warship",
          undefined,
          game.ref(8, y),
          1,
        ),
      ).toBeNull();
    }
    game.executeNextTick();
    const ships = state.forces.map((f) => game.unit(f.unitId!)!);
    expect(ai.canAttackPlayer(human)).toBe(false);
    for (let i = 0; i < 50; i++) {
      advance(game, forces, 1);
      for (const ship of ships) expect(ship.health()).toBe(ship.maxHealth());
    }
  });

  test("a selected army walks to the coast, boards a real transport and lands to capture an island", async () => {
    const game = await setup("ocean_and_land", { instantBuild: true });
    const human = game.addPlayer(playerInfo("landing", PlayerType.Human)),
      enemy = game.addPlayer(playerInfo("island", PlayerType.Nation));
    game.forEachTile((tile) => {
      if (game.isLand(tile)) (game.x(tile) < 8 ? human : enemy).conquer(tile);
    });
    human.setSpawnTile(game.ref(5, 7));
    enemy.setSpawnTile(game.ref(14, 7));
    human.setTroops(180000);
    enemy.setTroops(1000);
    human.addGold(400000n);
    const state: ModernForcesState = {
        forces: [],
        bases: [],
        nextForceId: 1,
        seed: 44,
      },
      ledger = new PersonnelLedger([human.id(), enemy.id()]),
      forces = new ModernForces(game, state, ledger);
    forces.initializeFaction(human.id(), human.spawnTile()!);
    const army = state.forces[0],
      target = game.ref(14, 7),
      preview = forcePreview(game, state, army, target, "attack");
    expect(preview.valid).toBe(true);
    expect(preview.usesTransport).toBe(true);
    expect(preview.transportPath!.some((t) => game.isWater(t))).toBe(true);
    forces.command(human.id(), [army.id], "attack", target);
    advance(
      game,
      forces,
      (preview.path.length - 1) * forces.rules.armyMoveTicks + 1,
    );
    expect(human.units(UnitType.TransportShip)).toHaveLength(1);
    expect(
      human.troops() +
        forces.committedArmyRaw(human.id()) +
        human.units(UnitType.TransportShip)[0].troops(),
    ).toBe(180000);
    const convoy = human.units(UnitType.TransportShip)[0],
      launch = convoy.tile();
    const shore = [...human.tiles()].find((tile) => game.isShoreline(tile))!;
    human.buildUnit(UnitType.Port, shore, {});
    expect(
      forces.produce(human.id(), "navy", "warship", undefined, shore, 1),
    ).toBeNull();
    const escort = state.forces.find((force) => force.branch === "navy")!;
    game.executeNextTick();
    expect(
      forces.command(human.id(), [escort.id], "escort", convoy.tile())[0]
        .reason,
    ).toBeNull();
    expect(escort.command?.escortUnitId).toBe(convoy.id());
    let followed = false;
    for (let i = 0; i < 55; i++) {
      advance(game, forces, 1);
      if (
        escort.command?.target !== launch &&
        escort.command?.escortUnitId === convoy.id()
      )
        followed = true;
    }
    expect(followed).toBe(true);
    expect(game.owner(target)).toBe(human);
    expect(human.units(UnitType.TransportShip)).toHaveLength(0);
    expect(
      human.troops() +
        forces.committedArmyRaw(human.id()) +
        human.outgoingAttacks().reduce((n, a) => n + a.troops(), 0),
    ).toBeLessThanOrEqual(180000);
  });

  test("the last lethal land-combat tick records the formation's exact losses and marks zero people destroyed", async () => {
    const { game, human, ai, state, ledger } = await fixture("plains", 0),
      forces = new ModernForces(game, state, ledger, {
        ...DEFAULT_MODERN_FORCE_RULES,
        armyPersonnelPerGroup: 1,
      });
    ai.setTroops(180000);
    ai.buildUnit(UnitType.DefensePost, game.ref(32, 12), {});
    forces.produce(
      human.id(),
      "army",
      "army",
      undefined,
      game.ref(29, 12),
      1,
      true,
    );
    attachModernForces(game, state);
    const army = state.forces[0];
    forces.command(human.id(), [army.id], "attack", game.ref(30, 12));
    advance(game, forces, 30);
    expect(army.phase).toBe("destroyed");
    expect(army.personnel).toBe(0);
    expect(army.casualties).toBe(1);
    expect(army.attackTroops).toBe(0);
    expect(
      forces.command(human.id(), [army.id], "wait", army.tile)[0].reason,
    ).toBe("no_personnel");
    expect(army.phase).toBe("destroyed");
    expect(human.troops() + forces.committedArmyRaw(human.id())).toBe(179990);
    expect(ledger.balances.get(human.id())!.dead).toBe(0);
  });

  test("a lethal landing reports its final army loss identically after an in-flight snapshot", async () => {
    const { game, human, ai, state, ledger } = await fixture(
        "half_land_half_ocean",
        0,
      ),
      rules = { ...DEFAULT_MODERN_FORCE_RULES, armyPersonnelPerGroup: 1 },
      forces = new ModernForces(game, state, ledger, rules);
    ai.setTroops(180000);
    ai.buildUnit(UnitType.DefensePost, game.ref(7, 12), {});
    forces.produce(
      human.id(),
      "army",
      "army",
      undefined,
      game.ref(7, 3),
      1,
      true,
    );
    attachModernForces(game, state);
    const army = state.forces[0];
    const preview = forcePreview(game, state, army, game.ref(7, 12), "attack");
    expect(preview.usesTransport).toBe(true);
    forces.command(human.id(), [army.id], "attack", game.ref(7, 12));
    for (
      let i = 0;
      i < 30 && human.units(UnitType.TransportShip).length === 0;
      i++
    )
      advance(game, forces, 1);
    expect(human.units(UnitType.TransportShip)).toHaveLength(1);
    const restored = await restoreTestGame(
        snapshotGame(game),
        "half_land_half_ocean",
        Config,
      ),
      restoredState = restored.modernSystems()!,
      resumed = new ModernForces(
        restored,
        restoredState,
        new PersonnelLedger([human.id(), ai.id()]),
        rules,
      );
    advance(game, forces, 50);
    advance(restored, resumed, 50);
    expect(restoredState).toEqual(game.modernSystems());
    expect(army.phase).toBe("destroyed");
    expect(army.casualties).toBe(1);
    expect(army.personnel).toBe(0);
    expect(army.unitId).toBeNull();
    expect(human.troops() + forces.committedArmyRaw(human.id())).toBe(179990);
    expect(restored.player(human.id()).troops()).toBe(human.troops());
  });

  test("cancelled transports return their actual survivors once and record the existing retreat penalty", async () => {
    const { game, human, state, forces } = await fixture(
      "half_land_half_ocean",
      0,
    );
    forces.produce(
      human.id(),
      "army",
      "army",
      undefined,
      game.ref(7, 3),
      1,
      true,
    );
    attachModernForces(game, state);
    const army = state.forces[0];
    forces.command(human.id(), [army.id], "attack", game.ref(7, 12));
    for (
      let i = 0;
      i < 30 && human.units(UnitType.TransportShip).length === 0;
      i++
    )
      advance(game, forces, 1);
    advance(game, forces, 2);
    forces.command(human.id(), [army.id], "cancel", army.tile);
    advance(game, forces, 50);
    expect(army.phase).toBe("idle");
    expect(army.personnel).toBe(750);
    expect(army.casualties).toBe(250);
    expect(army.unitId).toBeNull();
    expect(game.owner(army.tile)).toBe(human);
    expect(human.troops() + forces.committedArmyRaw(human.id())).toBe(177500);
    advance(game, forces, 20);
    expect(human.troops() + forces.committedArmyRaw(human.id())).toBe(177500);
  });

  test("opposing attacks record formation annihilation and manual attacks cannot absorb a separately commanded formation", async () => {
    const { game, human, ai, state, forces } = await fixture("plains", 0);
    ai.setTroops(180000);
    forces.produce(
      human.id(),
      "army",
      "army",
      undefined,
      game.ref(29, 12),
      1,
      true,
    );
    attachModernForces(game, state);
    const army = state.forces[0];
    forces.command(human.id(), [army.id], "attack", game.ref(30, 12));
    advance(game, forces, 5);
    const attackId = army.attackId;
    expect(attackId).not.toBeNull();
    game.addExecution(new AttackExecution(5000, human, ai.id()));
    game.executeNextTick();
    expect(
      human.outgoingAttacks().some((attack) => attack.id() === attackId),
    ).toBe(true);
    expect(human.outgoingAttacks()).toHaveLength(2);
    game.addExecution(
      new AttackExecution(30000, ai, human.id(), game.ref(40, 12)),
    );
    game.executeNextTick();
    expect(army.phase).toBe("destroyed");
    expect(army.casualties).toBe(1000);
    expect(army.personnel).toBe(0);
    expect(army.attackId).toBeNull();
  });

  test("the original build menu cannot create unaccounted naval crews and capture charges only the new controller", async () => {
    const { game, human, ai, state, ledger, forces } = await fixture(
      "half_land_half_ocean",
    );
    const ship = human.buildUnit(UnitType.Warship, game.ref(8, 3), {
      patrolTile: game.ref(8, 3),
    });
    forces.tick();
    forces.tick();
    expect(state.forces.filter((f) => f.unitId === ship.id())).toHaveLength(1);
    expect(ledger.balances.get(human.id())!.navy).toBe(100);
    ship.setOwner(ai);
    forces.tick();
    expect(ledger.balances.get(human.id())!.dead).toBe(100);
    expect(ledger.balances.get(ai.id())!.navy).toBe(100);
    expect(
      state.forces.filter(
        (f) => f.unitId === ship.id() && f.phase !== "destroyed",
      ),
    ).toHaveLength(1);
    ledger.balances.get(human.id())!.available = 0;
    const unpaid = human.buildUnit(UnitType.Warship, game.ref(9, 3), {
      patrolTile: game.ref(9, 3),
    });
    forces.tick();
    expect(unpaid.isActive()).toBe(false);
  });

  test("harsh non-adapted army movement accumulates exactly 95 percent progress instead of rounded per-step penalties", async () => {
    const { game, human, state, ledger } = await fixture();
    const forces = new ModernForces(game, state, {
      reserve: ledger.reserve.bind(ledger),
      release: ledger.release.bind(ledger),
      casualties: ledger.casualties.bind(ledger),
      climateMovementEfficiency: () => 950,
    });
    forces.initializeFaction(human.id(), game.ref(10, 12));
    const army = state.forces[0];
    forces.command(human.id(), [army.id], "move", game.ref(29, 12));
    advance(game, forces, 40);
    expect(game.x(army.tile)).toBe(19);
    expect(army.movementProgress).toBe(2000);
  });

  test("an overrun army retreats at the normal rate and surrounded people are lost without duplicating the reserve", async () => {
    const { game, human, ai, state, ledger, forces } = await fixture();
    forces.initializeFaction(human.id(), game.ref(12, 12));
    const army = state.forces[0],
      originalPool = human.troops();
    ai.conquer(army.tile);
    advance(game, forces, 3);
    expect(game.owner(army.tile)).toBe(ai);
    advance(game, forces, 1);
    expect(game.owner(army.tile)).toBe(human);
    expect(human.troops()).toBe(originalPool);
    ai.conquer(army.tile);
    for (const tile of game.neighbors(army.tile)) ai.conquer(tile);
    advance(game, forces, 1);
    expect(army.phase).toBe("destroyed");
    expect(army.personnel).toBe(0);
    expect(ledger.balances.get(human.id())!.army).toBe(17000);
    expect(ledger.balances.get(human.id())!.dead).toBe(1800); // 1000 army + 800 grounded air crew at the captured base.
    expect(human.troops()).toBe(originalPool);
  });

  test("stop sent before the attack execution initializes is applied to the eventual real attack", async () => {
    const { game, human, state, forces } = await fixture();
    forces.initializeFaction(human.id(), game.ref(29, 12));
    const army = state.forces[0];
    forces.command(human.id(), [army.id], "attack", game.ref(30, 12));
    for (let i = 0; i < 4; i++) forces.tick(i);
    expect(army.phase).toBe("attacking");
    expect(army.attackId).toBeNull();
    forces.command(human.id(), [army.id], "stop", army.tile);
    game.executeNextTick();
    forces.tick(1);
    expect(human.outgoingAttacks()).toHaveLength(1);
    expect(human.outgoingAttacks()[0].retreating()).toBe(true);
  });

  test("same build snapshot restores an in-flight mission, path, AA cooldown and outcome", async () => {
    const { game, human, ai, state, ledger, forces } = await fixture();
    forces.initializeFaction(human.id(), game.ref(12, 12));
    const strike = state.forces.find((f) => f.kind === "strike")!;
    forces.command(human.id(), [strike.id], "strike", game.ref(35, 12));
    advance(game, forces, 2);
    const core = snapshotGame(game),
      serial = JSON.stringify(state);
    const restored = await restoreTestGame(core, "plains");
    const restoredState = JSON.parse(serial) as ModernForcesState;
    const restoredLedger = new PersonnelLedger([human.id(), ai.id()]);
    restoredLedger.balances = structuredClone(ledger.balances);
    const restoredForces = new ModernForces(
      restored,
      restoredState,
      restoredLedger,
    );
    advance(game, forces, 190);
    advance(restored, restoredForces, 190);
    expect(restoredState).toEqual(state);
    expect(restored.player(ai.id()).troops()).toBe(ai.troops());
    expect(restored.player(human.id()).gold()).toBe(human.gold());
    expect(restoredLedger.balances).toEqual(ledger.balances);
  });

  test("climate preview uses the same explicit permille callback without affecting navy or air", async () => {
    const { game, human, state, ledger } = await fixture();
    const forces = new ModernForces(game, state, {
      ...ledger,
      reserve: ledger.reserve.bind(ledger),
      release: ledger.release.bind(ledger),
      casualties: ledger.casualties.bind(ledger),
      climateEfficiency: () => 1100,
    });
    forces.initializeFaction(human.id(), game.ref(12, 12));
    expect(
      forcePreview(
        game,
        state,
        state.forces[0],
        game.ref(30, 12),
        "attack",
        forces.rules,
        {
          reserve: () => true,
          release: () => {},
          casualties: () => {},
          climateEfficiency: () => 1100,
        },
      ).climateEfficiencyPermille,
    ).toBe(1100);
    expect(
      forcePreview(game, state, state.forces[1], game.ref(30, 12), "intercept")
        .climateEfficiencyPermille,
    ).toBe(1000);
  });

  test("a bounded failed owned-ground search is reused and invalidated by the owner's territory revision", async () => {
    const { game, human, state, forces } = await fixture();
    forces.initializeFaction(human.id(), game.ref(12, 12));
    const army = state.forces[0],
      target = game.ref(15, 12);
    for (let y = 10; y < 30; y++) human.relinquish(game.ref(14, y));
    const first = forcePreview(game, state, army, target, "move");
    expect(first.reason).toBe("no_owned_land_path");
    const measured = modernLandPathMetrics();
    expect(forcePreview(game, state, army, target, "move")).toEqual(first);
    expect(modernLandPathMetrics().searches).toBe(measured.searches);
    expect(modernLandPathMetrics().cacheHits).toBe(measured.cacheHits + 1);
    human.conquer(game.ref(14, 12));
    expect(forcePreview(game, state, army, target, "move").valid).toBe(true);
    expect(modernLandPathMetrics().searches).toBe(measured.searches + 1);
  });

  test("queued air orders validate future-base range and branch while preserving a live sortie and wait for rearming", async () => {
    const { game, human, state, ledger } = await fixture();
    const forces = new ModernForces(game, state, ledger, {
      ...DEFAULT_MODERN_FORCE_RULES,
      airRangeTiles: 30,
    });
    forces.initializeFaction(human.id(), game.ref(12, 12));
    const strike = state.forces.find((force) => force.kind === "strike")!;
    forces.command(human.id(), [strike.id], "strike", game.ref(35, 12));
    advance(game, forces, 2);
    const phase = strike.phase,
      position = strike.tile;
    expect(
      forcePreview(
        game,
        state,
        strike,
        game.ref(36, 12),
        "strike",
        forces.rules,
      ).reason,
    ).toBe("aircraft_already_sortied");
    const preview = forcePreview(
      game,
      state,
      strike,
      game.ref(36, 12),
      "strike",
      forces.rules,
      undefined,
      true,
    );
    expect(preview.valid).toBe(true);
    expect(preview.path[0]).toBe(state.bases[0].tile);
    expect(
      forces.command(
        human.id(),
        [strike.id],
        "strike",
        game.ref(70, 12),
        true,
      )[0].reason,
    ).toBe("outside_air_range");
    expect(
      forces.command(
        human.id(),
        [strike.id],
        "intercept",
        game.ref(36, 12),
        true,
      )[0].reason,
    ).toBe("strike_cannot_intercept");
    expect(
      forces.command(
        human.id(),
        [strike.id],
        "strike",
        game.ref(36, 12),
        true,
      )[0].reason,
    ).toBeNull();
    expect(strike.phase).toBe(phase);
    expect(strike.tile).toBe(position);
    expect(strike.queue).toHaveLength(1);
    advance(game, forces, 50);
    expect(strike.phase).toBe("rearming");
    expect(strike.queue).toHaveLength(1);
    advance(game, forces, 300);
    expect(strike.queue).toHaveLength(0);
    expect(strike.completedMissions).toBe(2);
  });

  test("grounded squadrons at a captured base lose their allocated people exactly once", async () => {
    const { game, human, ai, state, ledger, forces } = await fixture();
    forces.initializeFaction(human.id(), game.ref(12, 12));
    ai.conquer(state.bases[0].tile);
    advance(game, forces, 2);
    expect(
      state.forces
        .filter((force) => force.branch === "air")
        .every((force) => force.phase === "destroyed" && force.aircraft === 0),
    ).toBe(true);
    expect(ledger.balances.get(human.id())!.dead).toBe(800);
    expect(ledger.balances.get(human.id())!.air).toBe(0);
    advance(game, forces, 5);
    expect(ledger.balances.get(human.id())!.dead).toBe(800);
  });
});
