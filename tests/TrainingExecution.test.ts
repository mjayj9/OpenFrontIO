import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { TrainingExecution } from "../src/core/execution/TrainingExecution";
import { PlayerType, UnitType } from "../src/core/game/Game";
import { GameUpdateType } from "../src/core/game/GameUpdates";
import { playerInfo, setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";

async function training(disabledUnits: UnitType[] = []) {
  const game = await setup(
    "world",
    {
      training: true,
      bots: 1,
      nations: "disabled",
      disabledUnits,
      disableNavMesh: true,
    },
    [playerInfo("Trainer01", PlayerType.Human)],
    undefined,
    undefined,
    false,
  );
  game.addExecution(new TrainingExecution());
  game.executeNextTick();
  game.executeNextTick();
  return game;
}

describe("Prepared single-player training simulation", () => {
  it("starts at a real coast with a reachable weak tribe and trading partner", async () => {
    const game = await training();
    const human = game.player("Trainer01");
    const tribe = game.player("TrainBot01");
    const partner = game.player("TrainNat01");
    expect(human.hasSpawned()).toBe(true);
    expect(game.inSpawnPhase()).toBe(false);
    expect(human.numTilesOwned()).toBe(1200);
    expect(game.isShoreline(human.spawnTile()!)).toBe(true);
    expect(human.gold()).toBeGreaterThanOrEqual(10_000_000n);
    expect(human.troops()).toBe(100_000);
    expect(tribe.numTilesOwned()).toBe(120);
    expect(
      [...human.borderTiles()].some((tile) =>
        game.neighbors(tile).some((neighbor) => game.owner(neighbor) === tribe),
      ),
    ).toBe(true);
    expect(partner.units(UnitType.Port)).toHaveLength(1);
    for (const player of game.players())
      for (const tile of player.tiles()) {
        expect(game.isLand(tile)).toBe(true);
        expect(game.owner(tile)).toBe(player);
      }
  });

  it("requires a real attack for conquest and real construction to complete", async () => {
    const game = await training();
    const human = game.player("Trainer01");
    const tribe = game.player("TrainBot01");
    const before = human.numTilesOwned();
    game.addExecution(new AttackExecution(50_000, human, tribe.id()));
    let conquest = false;
    for (let tick = 0; tick < 1000 && !conquest; tick++) {
      const updates = game.executeNextTick();
      conquest ||= updates[GameUpdateType.ConquestEvent].some(
        (event) =>
          event.conquerorId === human.id() && event.conqueredId === tribe.id(),
      );
    }
    expect(conquest).toBe(true);
    expect(human.numTilesOwned()).toBeGreaterThan(before);
    expect(tribe.isAlive()).toBe(false);
    game.addExecution(
      new ConstructionExecution(human, UnitType.City, human.spawnTile()!),
    );
    game.executeNextTick();
    expect(
      human.units(UnitType.City).some((city) => !city.isUnderConstruction()),
    ).toBe(false);
    for (let tick = 0; tick < 100; tick++) game.executeNextTick();
    expect(
      human.units(UnitType.City).some((city) => !city.isUnderConstruction()),
    ).toBe(true);
  });

  it("accepts an actual diplomatic request and respects disabled features", async () => {
    const game = await training([UnitType.Port]);
    const human = game.player("Trainer01");
    const partner = game.player("TrainNat01");
    expect(partner.units(UnitType.Port)).toHaveLength(0);
    expect(human.alliances()).toHaveLength(0);
    game.addExecution(new AllianceRequestExecution(human, partner.id()));
    for (let tick = 0; tick < 50; tick++) game.executeNextTick();
    expect(human.allianceWith(partner)).not.toBeNull();
  });

  it("continues deterministically before and after training initialization", async () => {
    const game = await setup(
      "world",
      { training: true, bots: 1, nations: "disabled", disableNavMesh: true },
      [playerInfo("Trainer01", PlayerType.Human)],
      undefined,
      undefined,
      false,
    );
    game.addExecution(new TrainingExecution());
    await expectSnapshotRoundTrip(game, "world", 3);
    await expectSnapshotRoundTrip(game, "world", 40);
  }, 20_000);
});
