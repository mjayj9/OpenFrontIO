import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import {
  modernFactions,
  modernRegions,
} from "../../src/core/game/ModernRegions";
import { modernWorld } from "../../src/core/game/ModernWorld";
import { GameConfig, PartialGameRecord } from "../../src/core/Schemas";
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

describe("Modern regions final controller assignments", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  const create = (archive?: (record: PartialGameRecord) => Promise<void>) => {
    const first = makeClient(),
      second = makeClient();
    const game = makeGame({
      creatorPersistentID: first.persistentID,
      deps: archive ? { archive } : undefined,
      config: {
        ...modernConfig,
        modernMode: {
          ...modernConfig.modernMode!,
          scenario: "modern-regions-v2",
          version: 2,
          dataHash: modernRegions.hash,
          participantSlots: 4,
          fillEmptySlots: true,
          aiLevelWeights: { low: 0, medium: 0, high: 1 },
        },
      },
    });
    game.joinClient(first);
    game.joinClient(second);
    return { game, first, second };
  };
  it("independent regions of one country have distinct controllers; empty slots reuse world AI", async () => {
    const { game, first, second } = create(),
      regions = modernFactions.filter((f) => f.parentCountryId === "RUS");
    await mockWsOf(first).emit({
      type: "select_country",
      countryId: regions[0].id,
    });
    await mockWsOf(second).emit({
      type: "select_country",
      countryId: regions[1].id,
    });
    startGame(game);
    const a = mockWsOf(first)
        .sent()
        .find((m) => m.type === "start"),
      b = mockWsOf(second)
        .sent()
        .find((m) => m.type === "start");
    expect(a?.type).toBe("start");
    expect(b?.type).toBe("start");
    if (a?.type !== "start" || b?.type !== "start")
      throw new Error("Missing binary start");
    expect(a.gameStartInfo.modernAssignments).toEqual(
      b.gameStartInfo.modernAssignments,
    );
    const assigned = a.gameStartInfo.modernAssignments!;
    expect(assigned).toHaveLength(modernFactions.length);
    expect(new Set(assigned.map((f) => f.playerId)).size).toBe(
      modernFactions.length,
    );
    expect(assigned.filter((f) => f.aiRole === "human")).toHaveLength(2);
    expect(assigned.filter((f) => f.aiRole === "invited-slot")).toHaveLength(2);
    expect(
      assigned
        .filter((f) => f.aiLevel !== null)
        .every((f) => f.aiLevel === "high"),
    ).toBe(true);
  });
  it("simultaneous region reservation is exclusive and cannot change after start", async () => {
    const { game, first, second } = create();
    await Promise.all([
      mockWsOf(first).emit({ type: "select_country", countryId: "KOR" }),
      mockWsOf(second).emit({ type: "select_country", countryId: "KOR" }),
    ]);
    expect(first.countryId).toBe("KOR");
    expect(second.countryId).toBeUndefined();
    await mockWsOf(second).emit({ type: "select_country", countryId: "JPN" });
    startGame(game);
    await mockWsOf(second).emit({ type: "select_country", countryId: "KOR" });
    expect(second.countryId).toBe("JPN");
    game.updateGameConfig({
      modernMode: { ...modernConfig.modernMode!, dataHash: "0".repeat(64) },
    });
    expect(game.gameInfo().gameConfig?.modernMode?.dataHash).toBe(
      modernRegions.hash,
    );
  });
  it("AI auto-fill off keeps world controllers without inventing invite participants", async () => {
    const { game, first, second } = create();
    game.updateGameConfig({
      modernMode: {
        ...game.gameInfo().gameConfig!.modernMode!,
        fillEmptySlots: false,
      },
    });
    await mockWsOf(first).emit({ type: "select_country", countryId: "KOR" });
    await mockWsOf(second).emit({ type: "select_country", countryId: "JPN" });
    startGame(game);
    const message = mockWsOf(first)
      .sent()
      .find((m) => m.type === "start");
    expect(message?.type).toBe("start");
    if (message?.type !== "start") throw new Error("Missing start");
    expect(message.gameStartInfo.players).toHaveLength(2);
    expect(
      message.gameStartInfo.modernAssignments!.filter(
        (f) => f.aiRole === "invited-slot",
      ),
    ).toHaveLength(0);
  });
  it("archives the frozen region reservations and individual AI assignments for replays", async () => {
    const archive = vi.fn(async (_record: PartialGameRecord) => {});
    const { game, first, second } = create(archive);
    const regions = modernFactions.filter((f) => f.parentCountryId === "RUS");
    await mockWsOf(first).emit({
      type: "select_country",
      countryId: regions[0].id,
    });
    await mockWsOf(second).emit({
      type: "select_country",
      countryId: regions[1].id,
    });
    startGame(game);
    const started = mockWsOf(first)
      .sent()
      .find((m) => m.type === "start");
    if (started?.type !== "start") throw new Error("Missing binary start");
    await game.end();
    expect(archive).toHaveBeenCalledOnce();
    const record = archive.mock.calls[0][0];
    expect(record.info.players.map((p) => p.countryId)).toEqual([
      regions[0].id,
      regions[1].id,
    ]);
    expect(record.info.modernAssignments).toEqual(
      started.gameStartInfo.modernAssignments,
    );
    expect(record.info.modernAssignments).toHaveLength(modernFactions.length);
  });
});
