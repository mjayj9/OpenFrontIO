import { AI_PERSONALITIES } from "../src/core/ai/AIProfile";
import { GameConfigSchema, ServerStartGameMessage } from "../src/core/Schemas";
import { decodeServerMessage, encodeServerMessage } from "../src/core/ZbinWire";
import { testGameConfig } from "./util/Wire";

describe("enhanced AI binary settings", () => {
  test.each(["mixed", ...AI_PERSONALITIES])(
    "start message preserves %s profile and later fields",
    (personality) => {
      const config = testGameConfig({
        enhancedAI: {
          tribePercent: 25,
          nationPercent: 100,
          personality: personality as "mixed",
          fairResources: true,
          seed: 0xffffffff,
        },
        startingGold: 123456,
      });
      const start: ServerStartGameMessage = {
        type: "start",
        turns: [],
        gameStartInfo: {
          gameID: "abcd1234",
          lobbyCreatedAt: 1700000000000,
          config,
          players: [],
        },
        lobbyCreatedAt: 1700000000000,
        myClientID: "cl001234",
      };
      const decoded = decodeServerMessage(
        encodeServerMessage(start, undefined),
        undefined,
      );
      expect(decoded).toEqual(start);
    },
  );
  test("classic absent settings do not shift subsequent binary fields", () => {
    const config = testGameConfig({
      startingGold: 123456,
      disableAlliances: true,
    });
    const start: ServerStartGameMessage = {
      type: "start",
      turns: [],
      gameStartInfo: {
        gameID: "abcd1234",
        lobbyCreatedAt: 1700000000000,
        config,
        players: [],
      },
      lobbyCreatedAt: 1700000000000,
      myClientID: "cl001234",
    };
    expect(
      decodeServerMessage(encodeServerMessage(start, undefined), undefined),
    ).toEqual(start);
  });
  test.each([-1, 101, 1.5])(
    "rejects invalid percentage %s before transport",
    (tribePercent) => {
      expect(
        GameConfigSchema.safeParse(
          testGameConfig({
            enhancedAI: {
              tribePercent,
              nationPercent: 100,
              personality: "mixed",
              fairResources: true,
              seed: 1,
            },
          }),
        ).success,
      ).toBe(false);
    },
  );
});
