// @vitest-environment node
import {
  TrainStationExecution,
  TrainStationExecutionSnapshot,
} from "../src/core/execution/TrainStationExecution";
import { Game, PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { modernWorld } from "../src/core/game/ModernWorld";
import { readVersioned } from "../src/core/snapshot/SnapshotType";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";

async function stationGame(modern: boolean): Promise<Game> {
  const game = await setup(
    "plains",
    {
      instantBuild: true,
      infiniteGold: true,
      modernMode: modern
        ? {
            scenario: "modern-world-v1",
            version: 1,
            dataHash: modernWorld.hash,
            countryId: "KOR",
            balance: "balanced",
            victory: "territory",
            targetPercent: 60,
            protectionTicks: 0,
            capitalElimination: false,
          }
        : undefined,
    },
    [new PlayerInfo("rail", PlayerType.Human, "rail", "rail")],
  );
  const player = game.player("rail");
  for (let t = 0; t < game.width() * game.height(); t++)
    if (game.isLand(t)) player.conquer(t);
  return game;
}

describe("modern initial rail station scheduling", () => {
  test("connects initial stations at stable separate unit-id ticks", async () => {
    const game = await stationGame(true);
    const player = game.player("rail");
    const units = [
      player.buildUnit(UnitType.Factory, game.ref(10, 10), {}),
      player.buildUnit(UnitType.City, game.ref(30, 10), {}),
    ];
    const connected: number[] = [];
    const network = game.railNetwork();
    const original = network.connectStation.bind(network);
    vi.spyOn(network, "connectStation").mockImplementation((station) => {
      connected.push(game.ticks());
      original(station);
    });
    game.addExecution(
      new TrainStationExecution(units[0], true),
      new TrainStationExecution(units[1]),
    );
    while (game.ticks() < 4 + units[0].id() * 2) game.executeNextTick();
    expect(connected).toEqual([]);
    game.executeNextTick();
    expect(connected).toEqual([4 + units[0].id() * 2]);
    while (game.ticks() <= 4 + units[1].id() * 2) game.executeNextTick();
    expect(connected).toEqual(units.map((unit) => 4 + unit.id() * 2));
  });

  test("waiting connections and subsequent trains survive snapshot restoration", async () => {
    const game = await stationGame(true);
    const player = game.player("rail");
    game.addExecution(
      new TrainStationExecution(
        player.buildUnit(UnitType.Factory, game.ref(10, 10), {}),
        true,
      ),
      new TrainStationExecution(
        player.buildUnit(UnitType.City, game.ref(30, 10), {}),
      ),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(game.railNetwork().stationManager().getAll().size).toBe(0);
    await expectSnapshotRoundTrip(game, "plains", 100);
    expect(game.railNetwork().stationManager().getAll().size).toBe(2);
  });

  test.each([false, true])(
    "classic or later modern construction remains immediate (modern=%s)",
    async (modern) => {
      const game = await stationGame(modern);
      if (modern) while (game.ticks() < 5) game.executeNextTick();
      const unit = game
        .player("rail")
        .buildUnit(UnitType.Factory, game.ref(10, 10), {});
      const execution = new TrainStationExecution(unit, true);
      execution.init(game, game.ticks());
      execution.tick(game.ticks());
      expect(
        game.railNetwork().stationManager().findStation(unit),
      ).not.toBeNull();
    },
  );

  test("version-one station records migrate with immediate connection", () => {
    const state = readVersioned(TrainStationExecutionSnapshot, {
      v: 1,
      d: {
        active: true,
        initialized: false,
        unit: 0,
        spawnTrains: true,
        random: null,
        station: null,
        numCars: 5,
        lastSpawnTick: 0,
        ticksCooldown: 10,
      },
    });
    expect(state.connectAtTick).toBe(0);
  });
});
