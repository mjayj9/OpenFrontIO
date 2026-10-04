import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";
import { GameType } from "../../src/core/game/Game";
import type {
  ServerMessage,
  ServerStartGameMessage,
  Turn,
} from "../../src/core/Schemas";
import { testGameConfig } from "../util/Wire";

// Keep both Transport and LocalServer real. Authentication is the external
// seam: offline setup must complete without asking for an account/play token.
vi.mock("../../src/client/Auth", () => ({
  getPlayToken: vi.fn(async () => {
    throw new Error("An offline local handshake must not request a play token");
  }),
  getAuthHeader: vi.fn(async () => ""),
  getPersistentID: vi.fn(() => "123e4567-e89b-12d3-a456-426614174000"),
}));
vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: {
    turnIntervalMs: () => 100,
    gitCommit: () => "DEV",
  },
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: async () => false,
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  homeHref: () => "/",
}));

import { getPlayToken } from "../../src/client/Auth";
import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import { LocalServer } from "../../src/client/LocalServer";
import type { SavedGame } from "../../src/client/SingleplayerSaves";
import {
  PauseGameIntentEvent,
  SendAttackIntentEvent,
  Transport,
} from "../../src/client/Transport";

const CLIENT_ID = "Human001";
function lobby(): LobbyConfig {
  return {
    gameID: "Local123",
    playerName: "Trainee",
    playerClanTag: null,
    playerRole: null,
    turnstileToken: null,
    cosmetics: {},
    gameStartInfo: {
      gameID: "Local123",
      lobbyCreatedAt: 1000,
      config: testGameConfig({
        gameType: GameType.Singleplayer,
        training: true,
      }),
      players: [{ clientID: CLIENT_ID, username: "Trainee", clanTag: null }],
    },
  };
}

describe("Transport → LocalServer offline rejoin handshake", () => {
  const transports: Transport[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(getPlayToken).mockClear();
  });
  afterEach(() => {
    for (const transport of transports.splice(0)) transport.leaveGame();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("delivers tick-zero backlog after callback handoff and advances when acknowledged", async () => {
    const bus = new EventBus();
    const transport = new Transport(lobby(), bus);
    transports.push(transport);
    const serverMessages = vi.spyOn(LocalServer.prototype, "onMessage");
    const lobbyMessages: ServerMessage[] = [];
    transport.connect(
      () => {},
      (message) => lobbyMessages.push(message),
    );
    await transport.joinGame();
    expect(lobbyMessages[0]).toMatchObject({
      type: "start",
      myClientID: CLIENT_ID,
      turns: [],
    });

    // The worker/renderer startup is async. A turn can reach the lobby handler
    // first and block further local turns until the in-game callback replays it.
    await vi.advanceTimersByTimeAsync(5);
    expect(lobbyMessages[1]).toEqual({
      type: "turn",
      turn: { turnNumber: 0, intents: [] },
    });
    const starts: ServerStartGameMessage[] = [];
    const executed: Turn[] = [];
    transport.updateCallback(
      () => {},
      (message) => {
        const turns =
          message.type === "start"
            ? message.turns
            : message.type === "turn"
              ? [message.turn]
              : [];
        if (message.type === "start")
          starts.push({ ...message, turns: message.turns.slice() });
        for (const turn of turns) {
          executed.push(turn);
          transport.turnComplete();
        }
      },
    );
    await transport.rejoinGame(0);
    expect(serverMessages).toHaveBeenCalledWith({
      type: "rejoin",
      gameID: "Local123",
      lastTurn: 0,
      token: "local",
      gitCommit: "DEV",
    });
    expect(starts).toHaveLength(1);
    expect(starts[0].myClientID).toBe(CLIENT_ID);
    expect(starts[0].turns).toEqual([{ turnNumber: 0, intents: [] }]);
    expect(executed.map((turn) => turn.turnNumber)).toEqual([0]);

    bus.emit(new SendAttackIntentEvent("opponent", 123));
    await vi.advanceTimersByTimeAsync(105);
    expect(executed[1]).toEqual({
      turnNumber: 1,
      intents: [
        {
          type: "attack",
          targetID: "opponent",
          troops: 123,
          clientID: CLIENT_ID,
        },
      ],
    });
    expect(getPlayToken).not.toHaveBeenCalled();
  });

  it("delivers restored paused backlog without replaying old turns and resumes at the saved cursor", async () => {
    const config = lobby();
    const savedTurns: Turn[] = [
      {
        turnNumber: 0,
        intents: [{ type: "spawn", tile: 123, clientID: CLIENT_ID }],
      },
      {
        turnNumber: 1,
        intents: [{ type: "toggle_pause", paused: true, clientID: CLIENT_ID }],
      },
    ];
    config.savedGame = {
      format: 1,
      id: "saved-local",
      name: "Paused training",
      createdAt: 1000,
      build: "test-build",
      tick: 2,
      gameStartInfo: config.gameStartInfo!,
      snapshot: new Uint8Array(), // LocalServer consumes the saved turn cursor.
      turns: savedTurns,
      paused: true,
    } satisfies SavedGame;
    const bus = new EventBus();
    const transport = new Transport(config, bus);
    transports.push(transport);
    const lobbyMessages: ServerMessage[] = [];
    transport.connect(
      () => {},
      (message) => lobbyMessages.push(message),
    );
    const starts: ServerStartGameMessage[] = [];
    const executed: Turn[] = [];
    let cursor = config.savedGame.tick;
    transport.updateCallback(
      () => {},
      (message) => {
        const turns =
          message.type === "start"
            ? message.turns
            : message.type === "turn"
              ? [message.turn]
              : [];
        if (message.type === "start")
          starts.push({ ...message, turns: message.turns.slice() });
        for (const turn of turns) {
          if (turn.turnNumber < cursor) continue;
          expect(turn.turnNumber).toBe(cursor);
          executed.push(turn);
          cursor++;
          transport.turnComplete();
        }
      },
    );
    await transport.rejoinGame(0);
    expect(starts).toHaveLength(1);
    expect(starts[0].turns).toEqual(savedTurns);
    expect(starts[0].myClientID).toBe(CLIENT_ID);
    expect(executed).toEqual([]);
    bus.emit(new SendAttackIntentEvent("opponent", 123));
    await vi.advanceTimersByTimeAsync(500);
    expect(executed).toEqual([]);

    bus.emit(new PauseGameIntentEvent(false));
    expect(executed).toEqual([
      {
        turnNumber: 2,
        intents: [{ type: "toggle_pause", paused: false, clientID: CLIENT_ID }],
      },
    ]);
    await vi.advanceTimersByTimeAsync(105);
    expect(executed[1]).toEqual({ turnNumber: 3, intents: [] });
    expect(getPlayToken).not.toHaveBeenCalled();
  });
});
