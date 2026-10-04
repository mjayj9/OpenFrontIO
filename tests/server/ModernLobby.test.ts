import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import { modernWorld } from "../../src/core/game/ModernWorld";
import { GameConfig } from "../../src/core/Schemas";
import { createGameWireContext } from "../../src/core/ZbinWire";
import {
  makeClient,
  makeGame,
  makeMockWs,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

const modernConfig: Partial<GameConfig> = {
  gameType: GameType.Private,
  gameMap: GameMapType.ModernWorld,
  gameMapSize: GameMapSize.Normal,
  gameMode: GameMode.FFA,
  bots: 0,
  nations: "default",
  modernMode: {
    scenario: "modern-world-v1",
    version: 1,
    dataHash: modernWorld.hash,
    countryId: "KOR",
    balance: "balanced",
    victory: "territory",
    targetPercent: 60,
    protectionTicks: 300,
    capitalElimination: false,
  },
};

describe("Modern private lobby — authoritative binary reservations", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  const create = () => {
    const first = makeClient(),
      second = makeClient();
    const game = makeGame({
      config: modernConfig,
      creatorPersistentID: first.persistentID,
    });
    game.joinClient(first);
    game.joinClient(second);
    return { game, first, second };
  };

  it("rejects simultaneous duplicate requests without changing either reservation or closing the room", async () => {
    const { game, first, second } = create();
    await Promise.all([
      mockWsOf(first).emit({ type: "select_country", countryId: "KOR" }),
      mockWsOf(second).emit({ type: "select_country", countryId: "KOR" }),
    ]);
    expect(first.countryId).toBe("KOR");
    expect(second.countryId).toBeUndefined();
    expect(mockWsOf(second).sent()).toContainEqual({
      type: "modern_lobby_status",
      error: "taken",
      countryId: undefined,
    });
    expect(mockWsOf(second).close).not.toHaveBeenCalled();
    expect(
      game.gameInfo().clients?.find((c) => c.clientID === first.clientID)
        ?.countryId,
    ).toBe("KOR");
  });

  it("requires a reservation for every player, then freezes country mappings in the start payload", async () => {
    const { game, first, second } = create();
    await mockWsOf(first).emit({ type: "select_country", countryId: "KOR" });
    startGame(game);
    expect(
      mockWsOf(first)
        .sent()
        .some((m) => m.type === "start"),
    ).toBe(false);
    expect(
      mockWsOf(first)
        .sent()
        .some(
          (m) => m.type === "modern_lobby_status" && m.error === "not_ready",
        ),
    ).toBe(true);
    await mockWsOf(second).emit({ type: "select_country", countryId: "JPN" });
    startGame(game);
    const message = mockWsOf(first)
      .sent()
      .find((m) => m.type === "start");
    expect(message?.type).toBe("start");
    if (message?.type !== "start") throw new Error("Missing start");
    expect(message.gameStartInfo.players.map((p) => p.countryId)).toEqual([
      "KOR",
      "JPN",
    ]);
    const context = createGameWireContext(message.gameStartInfo.players);
    mockWsOf(first).send.mockClear();
    await mockWsOf(first).emit({ type: "select_country", countryId: "USA" });
    expect(first.countryId).toBe("KOR");
    expect(mockWsOf(first).sent(context)).toContainEqual({
      type: "modern_lobby_status",
      error: "closed",
      countryId: undefined,
    });
  });

  it("revalidates a late participant after prestart and allows selecting without a dead lobby", async () => {
    const { game, first, second } = create();
    await mockWsOf(first).emit({ type: "select_country", countryId: "KOR" });
    await mockWsOf(second).emit({ type: "select_country", countryId: "JPN" });
    game.prestart();
    const late = makeClient();
    game.joinClient(late);
    game.start();
    expect(
      mockWsOf(first)
        .sent()
        .some((m) => m.type === "start"),
    ).toBe(false);
    await mockWsOf(late).emit({ type: "select_country", countryId: "USA" });
    startGame(game);
    const started = mockWsOf(first)
      .sent()
      .find((m) => m.type === "start");
    expect(
      started?.type === "start" &&
        started.gameStartInfo.players.map((p) => p.countryId),
    ).toEqual(["KOR", "JPN", "USA"]);
  });

  it("spectating releases the reservation and resuming play requires a new unclaimed selection", async () => {
    const { game, first, second } = create();
    await mockWsOf(first).emit({ type: "select_country", countryId: "KOR" });
    await mockWsOf(first).emit({ type: "spectate", spectator: true });
    expect(first.countryId).toBeUndefined();
    await mockWsOf(second).emit({ type: "select_country", countryId: "KOR" });
    await mockWsOf(first).emit({ type: "select_country", countryId: "JPN" });
    expect(first.countryId).toBeUndefined();
    await mockWsOf(first).emit({ type: "spectate", spectator: false });
    await mockWsOf(first).emit({ type: "select_country", countryId: "JPN" });
    startGame(game);
    expect(first.countryId).toBe("JPN");
    expect(second.countryId).toBe("KOR");
  });

  it("keeps a free country after an authenticated lobby reconnect and does not steal a reassigned one", async () => {
    const { game, first, second } = create();
    await mockWsOf(second).emit({ type: "select_country", countryId: "KOR" });
    await mockWsOf(second).trigger("close");
    const returned = makeClient({
      persistentID: second.persistentID,
      ws: makeMockWs(),
    });
    game.joinClient(returned);
    expect(returned.countryId).toBe("KOR");
    await mockWsOf(returned).trigger("close");
    await mockWsOf(first).emit({ type: "select_country", countryId: "KOR" });
    const again = makeClient({ persistentID: second.persistentID });
    game.joinClient(again);
    expect(again.countryId).toBeUndefined();
  });

  it("refuses unknown countries, incompatible rules and public-room modern initialization", async () => {
    const { game, first, second } = create();
    await mockWsOf(first).emit({ type: "select_country", countryId: "ZZZ" });
    expect(first.countryId).toBeUndefined();
    await mockWsOf(first).emit({ type: "select_country", countryId: "KOR" });
    await mockWsOf(second).emit({ type: "select_country", countryId: "JPN" });
    game.updateGameConfig({ gameMode: GameMode.Team });
    startGame(game);
    expect(
      mockWsOf(first)
        .sent()
        .some((m) => m.type === "start"),
    ).toBe(false);
    expect(
      mockWsOf(first)
        .sent()
        .some(
          (m) =>
            m.type === "modern_lobby_status" && m.error === "invalid_rules",
        ),
    ).toBe(true);
    const publicGame = makeGame({
        config: { ...modernConfig, gameType: GameType.Public },
      }),
      publicClient = makeClient();
    publicGame.joinClient(publicClient);
    await mockWsOf(publicClient).emit({
      type: "select_country",
      countryId: "KOR",
    });
    expect(publicClient.countryId).toBeUndefined();
    startGame(publicGame);
    expect(
      mockWsOf(publicClient)
        .sent()
        .some((m) => m.type === "start"),
    ).toBe(false);
  });

  it("leaving modern mode clears reservations and permits normal classic starts", async () => {
    const { game, first, second } = create();
    await mockWsOf(first).emit({ type: "select_country", countryId: "KOR" });
    game.updateGameConfig({
      gameMap: GameMapType.World,
      bots: 20,
      enhancedAI: {
        tribePercent: 0,
        nationPercent: 25,
        personality: "mixed",
        fairResources: true,
        seed: 1,
      },
    });
    expect(game.gameInfo().gameConfig?.modernMode).toBeUndefined();
    expect(first.countryId).toBeUndefined();
    expect(game.gameInfo().gameConfig?.enhancedAI?.nationPercent).toBe(25);
    startGame(game);
    const message = mockWsOf(second)
      .sent()
      .find((m) => m.type === "start");
    expect(
      message?.type === "start" && message.gameStartInfo.config.gameMap,
    ).toBe(GameMapType.World);
  });
});
