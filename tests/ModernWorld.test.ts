// @vitest-environment node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WinCheckExecution } from "../src/core/execution/WinCheckExecution";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameMapLoader, MapData } from "../src/core/game/GameMapLoader";
import { ErrorUpdate, GameUpdateViewData } from "../src/core/game/GameUpdates";
import {
  modernCountry,
  modernHumanCountryIds,
  modernPlayerId,
  modernPlayerInfo,
  modernProgress,
  modernWorld,
  validateModernStart,
} from "../src/core/game/ModernWorld";
import { MapManifest } from "../src/core/game/TerrainMapLoader";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
  GameRunner,
} from "../src/core/GameRunner";
import { GameConfig, GameStartInfo, StampedIntent } from "../src/core/Schemas";
import { diffSnapshots } from "./util/Snapshot";

const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../resources/maps/modernworld",
);
const CLIENT = "MODERN01";
const REQUIRED = [
  "KOR",
  "JPN",
  "USA",
  "CHN",
  "IND",
  "BRA",
  "GBR",
  "FRA",
  "RUS",
  "IDN",
  "AUS",
  "ZAF",
];
const TIMEOUT = 120_000;

/** Real generated terrain and manifest; no mock ownership or spawn rules. */
class ModernMapLoader implements GameMapLoader {
  getMapData(): MapData {
    const read = (name: string) => async () =>
      new Uint8Array(fs.readFileSync(path.join(dir, name)));
    return {
      mapBin: read("map.bin"),
      map4xBin: read("map4x.bin"),
      map16xBin: read("map16x.bin"),
      manifest: async () =>
        JSON.parse(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
        ) as MapManifest,
      webpPath: path.join(dir, "thumbnail.webp"),
      layerPng: async () => {
        throw new Error("No image layers in simulation test");
      },
    };
  }
}

function start(overrides: Partial<GameConfig> = {}): GameStartInfo {
  return {
    gameID: "MODERN01",
    lobbyCreatedAt: 0,
    players: [
      {
        clientID: CLIENT,
        username: "modern-test",
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
      maxTimerValue: 30,
      enhancedAI: {
        tribePercent: 0,
        nationPercent: 100,
        personality: "mixed",
        fairResources: true,
        seed: 2026,
      },
      modernMode: {
        scenario: "modern-world-v1",
        version: 1,
        dataHash: modernWorld.hash,
        countryId: "KOR",
        balance: "balanced",
        victory: "territory",
        targetPercent: 60,
        protectionTicks: 6000,
        capitalElimination: false,
      },
      ...overrides,
    },
  };
}

const errors = new WeakMap<GameRunner, ErrorUpdate>();
async function create(
  info: GameStartInfo,
  snapshot?: Uint8Array,
): Promise<GameRunner> {
  const callback = (update: GameUpdateViewData | ErrorUpdate) => {
    if ("errMsg" in update) errors.set(runner, update);
  };
  const runner = snapshot
    ? await createGameRunnerFromSnapshot(
        info,
        snapshot,
        CLIENT,
        new ModernMapLoader(),
        callback,
      )
    : await createGameRunner(info, CLIENT, new ModernMapLoader(), callback);
  return runner;
}
function step(runner: GameRunner, intents: StampedIntent[] = []): void {
  runner.addTurn({ turnNumber: runner.game.ticks(), intents });
  if (!runner.executeNextTick()) {
    const error = errors.get(runner);
    throw new Error(
      `Modern tick ${runner.game.ticks()} failed: ${error?.errMsg}\n${error?.stack}`,
    );
  }
}
function hash(game: Game): number {
  return (game as unknown as { hash(): number }).hash();
}

let initial: GameRunner;
let initialSnapshot: Uint8Array;
beforeAll(async () => {
  initial = await create(start());
  step(initial); // initialize pending controllers and the scenario execution
  step(initial); // assign real initial tiles, bases and spawn flags
  initialSnapshot = initial.snapshot();
}, TIMEOUT);

describe("modern world playable initialization", () => {
  test(
    "198 unique controllers, one KOR human, and the exact initial border raster",
    () => {
      const game = initial.game;
      expect(game.allPlayers()).toHaveLength(198);
      expect(game.players()).toHaveLength(198);
      expect(new Set(game.allPlayers().map((p) => p.id())).size).toBe(198);
      expect(
        game.allPlayers().filter((p) => p.type() === PlayerType.Human),
      ).toHaveLength(1);
      const human = game.playerByClientID(CLIENT)!;
      expect(human.id()).toBe(modernPlayerId(modernCountry("KOR")));
      expect(human.info().nationFlag).toBe("kr");
      expect(game.inSpawnPhase()).toBe(false);

      const expected = new Uint16Array(game.width() * game.height());
      for (const [index, first, count] of modernWorld.runs) {
        for (let t = first; t < first + count; t++) {
          if (expected[t] !== 0)
            throw new Error(`Overlapping country raster at ${t}`);
          expected[t] = game
            .player(modernPlayerId(modernWorld.countries[index - 1]))
            .smallID();
        }
      }
      const problems: string[] = [];
      let owned = 0;
      for (let tile = 0; tile < expected.length; tile++) {
        if (game.map().ownerID(tile) !== expected[tile])
          problems.push(`owner at ${tile}`);
        if (game.hasOwner(tile)) {
          owned++;
          if (!game.isLand(tile) || game.isImpassable(tile))
            problems.push(`invalid terrain at ${tile}`);
        } else if (game.isLand(tile) && !game.isImpassable(tile))
          problems.push(`unassigned passable land at ${tile}`);
        if (problems.length > 10) break;
      }
      expect(problems).toEqual([]);
      expect(owned).toBe(
        modernWorld.countries.reduce((sum, country) => sum + country.tiles, 0),
      );
      expect(game.numLandTiles()).toBe(owned);
      expect(human.numTilesOwned()).toBe(modernCountry("KOR").tiles);
    },
    TIMEOUT,
  );

  test(
    "all countries have owned capitals, economy, valid ports and matching territory/border caches",
    () => {
      const game = initial.game;
      const problems: string[] = [];
      for (const country of modernWorld.countries) {
        const player = game.player(modernPlayerId(country));
        const capital = game.ref(country.capital[0], country.capital[1]);
        if (
          game.owner(capital) !== player ||
          player.spawnTile() !== capital ||
          !player.hasSpawned()
        )
          problems.push(`${country.id}: capital/spawn`);
        if (
          player.numTilesOwned() !== country.tiles ||
          Array.from(player.tiles()).length !== country.tiles
        )
          problems.push(`${country.id}: count`);
        if (
          player.units(UnitType.City).length !== 1 ||
          player.units(UnitType.City)[0].tile() !== capital
        )
          problems.push(`${country.id}: capital city`);
        if (player.units(UnitType.Factory).length !== 1)
          problems.push(`${country.id}: factory`);
        if (
          player.gold() !== 400_000n ||
          player.troops() <= 0 ||
          player.troops() > game.config().maxTroops(player)
        )
          problems.push(`${country.id}: resources`);
        const borders = player.borderTiles();
        for (const tile of player.tiles()) {
          if (
            game.owner(tile) !== player ||
            borders.has(tile) !== game.map().isBorder(tile)
          ) {
            problems.push(`${country.id}: territory/border ${tile}`);
            break;
          }
        }
        for (const unit of player.units()) {
          if (
            game.owner(unit.tile()) !== player ||
            !game.isLand(unit.tile()) ||
            game.isImpassable(unit.tile())
          )
            problems.push(`${country.id}: facility tile`);
          if (unit.type() === UnitType.Port && !game.isShoreline(unit.tile()))
            problems.push(`${country.id}: inland port`);
        }
        const hasCoast = Array.from(player.tiles()).some((tile) =>
          game.isShoreline(tile),
        );
        if (hasCoast !== (player.units(UnitType.Port).length === 1))
          problems.push(`${country.id}: coast/port`);
      }
      expect(problems).toEqual([]);
    },
    TIMEOUT,
  );

  test.each(REQUIRED)(
    "%s can be selected without duplicate human/AI identity",
    async (id) => {
      const country = modernCountry(id);
      const info = start();
      info.config.modernMode!.countryId = id;
      const selected = modernPlayerInfo(country, info);
      expect(selected.playerType).toBe(PlayerType.Human);
      expect(selected.id).toBe(modernPlayerId(country));
      expect(selected.clientID).toBe(CLIENT);
      const runner = await create(info);
      step(runner);
      step(runner);
      const human = runner.game.playerByClientID(CLIENT)!;
      expect(human.id()).toBe(selected.id);
      expect(human.type()).toBe(PlayerType.Human);
      expect(human.numTilesOwned()).toBe(country.tiles);
      expect(
        runner.game.owner(
          runner.game.ref(country.capital[0], country.capital[1]),
        ),
      ).toBe(human);
      expect(human.units(UnitType.City)[0].tile()).toBe(human.spawnTile());
      expect(
        runner.game.allPlayers().filter((p) => p.type() === PlayerType.Human),
      ).toHaveLength(1);
      expect(runner.game.players()).toHaveLength(198);
      expect(country.tiles).toBeGreaterThan(0);
      expect(country.capitalName.length).toBeGreaterThan(0);
    },
  );

  test(
    "client spawn intents cannot move any scenario territory or capital",
    async () => {
      const runner = await create(start(), initialSnapshot);
      const human = runner.game.playerByClientID(CLIENT)!;
      const oldTiles = Array.from(human.tiles());
      const oldSpawn = human.spawnTile();
      step(runner, [
        { type: "spawn", tile: runner.game.ref(100, 100), clientID: CLIENT },
      ]);
      for (let i = 0; i < 12; i++) step(runner);
      expect(human.spawnTile()).toBe(oldSpawn);
      expect(Array.from(human.tiles())).toEqual(oldTiles);
      expect(runner.game.allPlayers()).toHaveLength(198);
    },
    TIMEOUT,
  );

  test(
    "disabled starting structures are respected",
    async () => {
      const runner = await create(
        start({
          disabledUnits: [UnitType.City, UnitType.Factory, UnitType.Port],
        }),
      );
      step(runner);
      step(runner);
      expect(runner.game.units()).toEqual([]);
      expect(runner.game.players()).toHaveLength(198);
    },
    TIMEOUT,
  );

  test("rejects a changed scenario hash before loading or assigning terrain", async () => {
    const info = start();
    info.config.modernMode!.dataHash = "0".repeat(64);
    await expect(create(info)).rejects.toThrow("version/hash");
  });
});

describe("modern world snapshots and victories", () => {
  test(
    "pending initialization and live enhanced AI restore and continue exactly",
    async () => {
      const beforeInit = await create(start());
      step(beforeInit);
      const restoredInit = await create(start(), beforeInit.snapshot());
      step(beforeInit);
      step(restoredInit);
      expect(
        diffSnapshots(restoredInit.snapshot(), beforeInit.snapshot()),
      ).toEqual([]);

      const reference = await create(start(), initialSnapshot);
      for (let i = 0; i < 40; i++) step(reference);
      let resumed = await create(start(), reference.snapshot());
      expect(diffSnapshots(resumed.snapshot(), reference.snapshot())).toEqual(
        [],
      );
      for (let i = 0; i < 100; i++) {
        step(reference);
        step(resumed);
        expect(hash(resumed.game), `tick ${reference.game.ticks()}`).toBe(
          hash(reference.game),
        );
        if (i === 49) resumed = await create(start(), resumed.snapshot());
      }
      expect(diffSnapshots(resumed.snapshot(), reference.snapshot())).toEqual(
        [],
      );
    },
    TIMEOUT,
  );

  test(
    "an actual human attack conquers a neighbor and its progress survives restoration",
    async () => {
      const info = start();
      info.config.modernMode!.protectionTicks = 0;
      const runner = await create(info);
      step(runner);
      step(runner);
      const human = runner.game.playerByClientID(CLIENT)!;
      const defender = runner.game.player(modernPlayerId(modernCountry("PRK")));
      human.setTroops(250_000);
      defender.setTroops(0);
      const oldTiles = human.numTilesOwned();
      step(runner, [
        {
          type: "attack",
          targetID: defender.id(),
          troops: 200_000,
          clientID: CLIENT,
        },
      ]);
      for (let i = 0; i < 12; i++) step(runner);
      expect(human.numTilesOwned()).toBeGreaterThan(oldTiles);
      expect(defender.numTilesOwned()).toBeLessThan(modernCountry("PRK").tiles);
      const restored = await create(info, runner.snapshot());
      expect(diffSnapshots(restored.snapshot(), runner.snapshot())).toEqual([]);
      for (let i = 0; i < 12; i++) {
        step(runner);
        step(restored);
      }
      expect(diffSnapshots(restored.snapshot(), runner.snapshot())).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "timed victory picks the territory leader at the real configured boundary",
    async () => {
      const info = start({
        maxTimerValue: 1,
        disabledUnits: [
          UnitType.Port,
          UnitType.Warship,
          UnitType.TransportShip,
          UnitType.TradeShip,
        ],
      });
      info.config.modernMode!.victory = "timed";
      const runner = await create(info);
      step(runner);
      step(runner);
      const top = runner.game
        .players()
        .slice()
        .sort(
          (a, b) =>
            b.numTilesOwned() - a.numTilesOwned() || a.smallID() - b.smallID(),
        )[0];
      while (runner.game.elapsedGameSeconds() < 60) {
        expect(runner.game.getWinner()).toBeNull();
        step(runner);
      }
      // The existing WinCheck execution checks every ten ticks.
      while (
        runner.game.getWinner() === null &&
        runner.game.elapsedGameSeconds() <= 61
      )
        step(runner);
      expect(runner.game.getWinner()).toBe(top);
      expect(runner.game.elapsedGameSeconds()).toBeLessThanOrEqual(61);
    },
    TIMEOUT,
  );

  test(
    "territory and capital victory use captured tiles and declared targets",
    async () => {
      const runner = await create(start(), initialSnapshot);
      const game = runner.game;
      const human = game.playerByClientID(CLIENT)!;
      const target = Math.ceil(game.numLandTiles() * 0.6);
      for (const country of modernWorld.countries) {
        const other = game.player(modernPlayerId(country));
        for (const tile of Array.from(other.tiles())) {
          if (human.numTilesOwned() >= target) break;
          human.conquer(tile);
        }
        if (human.numTilesOwned() >= target) break;
      }
      expect(
        modernProgress(game, human).territoryPercent,
      ).toBeGreaterThanOrEqual(60);
      const win = new WinCheckExecution();
      win.init(game, game.ticks());
      win.tick(10);
      expect(game.getWinner()).toBe(human);

      const info = start();
      info.config.modernMode!.victory = "capitals";
      const capitals = await create(info);
      step(capitals);
      step(capitals);
      const owner = capitals.game.playerByClientID(CLIENT)!;
      for (const country of modernWorld.countries.slice(
        0,
        Math.ceil(198 * 0.6),
      ))
        owner.conquer(
          capitals.game.ref(country.capital[0], country.capital[1]),
        );
      const capWin = new WinCheckExecution();
      capWin.init(capitals.game, capitals.game.ticks());
      capWin.tick(10);
      expect(capitals.game.getWinner()).toBe(owner);
    },
    TIMEOUT,
  );
});

function privateModernStart(): GameStartInfo {
  const info = start({ gameType: GameType.Private });
  info.players = [
    {
      clientID: CLIENT,
      username: "Korea",
      clanTag: null,
      isLobbyCreator: true,
      countryId: "KOR",
    },
    {
      clientID: "MODERN02",
      username: "Japan",
      clanTag: null,
      countryId: "JPN",
    },
  ];
  return info;
}
describe("modern private multiplayer controller mapping", () => {
  test("validates unique selections and maps humans by country regardless of connection order", () => {
    const info = privateModernStart();
    expect(() => validateModernStart(info)).not.toThrow();
    expect(modernHumanCountryIds(info)).toEqual(new Set(["KOR", "JPN"]));
    expect(modernPlayerInfo(modernCountry("KOR"), info).clientID).toBe(CLIENT);
    expect(modernPlayerInfo(modernCountry("JPN"), info).clientID).toBe(
      "MODERN02",
    );
    expect(modernPlayerInfo(modernCountry("USA"), info).playerType).toBe(
      PlayerType.Nation,
    );
    info.players.reverse();
    expect(modernPlayerInfo(modernCountry("KOR"), info).clientID).toBe(CLIENT);
    expect(modernPlayerInfo(modernCountry("JPN"), info).clientID).toBe(
      "MODERN02",
    );
  });
  test.each(["missing", "duplicate", "unsupported", "public"])(
    "rejects %s selection before controllers or terrain are created",
    async (kind) => {
      const info = privateModernStart();
      if (kind === "missing") delete info.players[1].countryId;
      if (kind === "duplicate") info.players[1].countryId = "KOR";
      if (kind === "unsupported") info.players[1].countryId = "ZZZ";
      if (kind === "public") info.config.gameType = GameType.Public;
      await expect(create(info)).rejects.toThrow();
    },
  );
  test(
    "two real human countries begin inside their own borders with196 AI countries",
    async () => {
      const info = privateModernStart();
      const runner = await create(info);
      step(runner);
      step(runner);
      expect(runner.game.players()).toHaveLength(198);
      expect(
        runner.game.allPlayers().filter((p) => p.type() === PlayerType.Human),
      ).toHaveLength(2);
      expect(
        runner.game.allPlayers().filter((p) => p.type() === PlayerType.Nation),
      ).toHaveLength(196);
      for (const [client, id] of [
        [CLIENT, "KOR"],
        ["MODERN02", "JPN"],
      ]) {
        const country = modernCountry(id),
          human = runner.game.playerByClientID(client)!;
        expect(human.id()).toBe(modernPlayerId(country));
        expect(human.numTilesOwned()).toBe(country.tiles);
        expect(human.hasSpawned()).toBe(true);
        expect(
          runner.game.owner(
            runner.game.ref(country.capital[0], country.capital[1]),
          ),
        ).toBe(human);
        expect(human.units(UnitType.City)).toHaveLength(1);
        expect(human.units(UnitType.Factory)).toHaveLength(1);
        expect(human.units(UnitType.Port)).toHaveLength(1);
      }
      const snapshot = runner.snapshot();
      const resumed = await create(info, snapshot);
      for (let i = 0; i < 15; i++) {
        step(runner);
        step(resumed);
      }
      expect(diffSnapshots(resumed.snapshot(), runner.snapshot())).toEqual([]);
    },
    TIMEOUT,
  );
});
