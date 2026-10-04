import { StreamingEncoder } from "../../../../src/client/replay/codec/encode/StreamingEncoder";
import { ReplayGameView } from "../../../../src/client/replay/ReplayGameAdapter";
import { Config } from "../../../../src/core/configuration/Config";
import { PlayerType, UnitType } from "../../../../src/core/game/Game";
import {
  AIStatusUpdate,
  GameUpdateType,
} from "../../../../src/core/game/GameUpdates";
import { UserSettings } from "../../../../src/core/game/UserSettings";
import { testGameConfig } from "../../../util/Wire";
import { finish, gzip, openReader } from "../util/RecordGame";
import { frame, fullPlayer } from "../util/SyntheticFrames";

test("AI goals survive binary replay deltas, quiet ticks, chunk seeks and HUD adapter", async () => {
  const encoder = new StreamingEncoder({
    mapWidth: 4,
    mapHeight: 4,
    terrain: new Uint8Array(16),
    gzip,
    gameStartInfo: {},
    numLandTiles: 16,
    keyframeInterval: 3,
  });
  const first: AIStatusUpdate = {
    type: GameUpdateType.AIStatus,
    playerID: "p1",
    goal: "economy",
    target: null,
    reason: "productive_investment",
    reserve: 12345,
    candidateCount: 2,
    buildingPriority: [UnitType.Factory],
  };
  const second: AIStatusUpdate = {
    ...first,
    goal: "attack",
    target: "p2",
    reason: "territory_value_after_costs",
    reserve: 23456,
  };
  for (let tick = 0; tick < 9; tick++)
    encoder.pushFrame(
      frame(tick, {
        updates: {
          [GameUpdateType.Player]:
            tick === 0
              ? [fullPlayer(1, { playerType: PlayerType.Nation })]
              : [],
          [GameUpdateType.AIStatus]:
            tick === 0 ? [first] : tick === 4 ? [second] : [],
        },
      }),
    );
  const data = await finish(encoder);
  const reader = openReader(data);
  expect(reader.seek(2).aiStrategies?.get("p1")).toEqual(first);
  // A quiet keyframe at tick 6 still includes the thought from tick 4.
  expect(reader.seek(8).aiStrategies?.get("p1")).toEqual(second);
  expect(reader.seek(3).aiStrategies?.get("p1")).toEqual(first);
  expect(reader.seek(5).aiStrategies?.get("p1")).toEqual(second);
  const config = new Config(
    testGameConfig({
      enhancedAI: {
        tribePercent: 100,
        nationPercent: 100,
        personality: "economic",
        seed: 1,
        fairResources: true,
      },
    }),
    new UserSettings(),
    true,
  );
  const view = new ReplayGameView(
    reader.header.players,
    config,
    4,
    4,
    16,
    new Uint8Array(16),
  );
  view.update(reader.seek(8), new Uint8Array(16), 0, false, true);
  expect(view.playerViews()[0].aiStrategy()).toEqual(second);
  expect(view.playerViews()[0].enhancedAI()?.personality).toBe("economic");
});
