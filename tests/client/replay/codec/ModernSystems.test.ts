import { StreamingEncoder } from "../../../../src/client/replay/codec/encode/StreamingEncoder";
import { ReplayGameView } from "../../../../src/client/replay/ReplayGameAdapter";
import { Config } from "../../../../src/core/configuration/Config";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";
import { UserSettings } from "../../../../src/core/game/UserSettings";
import {
  ModernState,
  ModernStateSchema,
  modernStateHash,
} from "../../../../src/core/modern/ModernState";
import { testGameConfig } from "../../../util/Wire";
import { finish, gzip, openReader } from "../util/RecordGame";
import { frame, fullPlayer } from "../util/SyntheticFrames";

const initial = (): ModernState =>
  ModernStateSchema.parse({
    version: 2,
    tick: 0,
    seed: 5,
    nextForceId: 2,
    factions: [
      {
        playerId: "p1",
        factionId: "KOR",
        parentCountryId: "KOR",
        aiLevel: "high",
        aiRole: "world",
        completedTraining: 0,
        climateAdaptation: ["continental", "temperate"],
        nuclearStrikes: [],
        population: {
          total: 1000000,
          civilian: 970000,
          available: 12000,
          army: 18000,
          navy: 0,
          air: 0,
          dead: 0,
        },
      },
    ],
    ports: [
      {
        portId: "busan",
        name: "Busan",
        tile: 3,
        unitId: null,
        ownerId: "p1",
        level: 0,
        damage: 0,
        development: null,
        repairUntilTick: null,
        blockadedBy: [],
        incomePerSecond: 0,
        lastIncomeTick: 0,
        captureCount: 0,
      },
    ],
    bases: [
      {
        id: "airbase1",
        playerId: "p1",
        tile: 2,
        capacity: 24,
        health: 1000,
        maxHealth: 1000,
      },
    ],
    forces: [
      {
        id: "force1",
        playerId: "p1",
        branch: "air",
        kind: "fighter",
        tile: 2,
        baseId: "airbase1",
        personnel: 400,
        aircraft: 4,
        unitId: null,
        phase: "idle",
        command: null,
        queue: [],
        path: [],
        pathIndex: 0,
        cooldownUntil: 0,
        attackId: null,
        attackTroops: 0,
        lastReason: null,
        completedMissions: 0,
        lastMissionTick: 0,
        casualties: 0,
      },
    ],
  }) as unknown as ModernState;

test("modern ledger, orders, ports, AI and nuclear responsibility survive binary chunks and backward seeks", async () => {
  const before = initial();
  const after = structuredClone(before);
  after.tick = 4;
  after.factions[0].nuclearStrikes = [{ launchId: 77, expiresTick: 1804 }];
  after.factions[0].population.available -= 200;
  after.factions[0].population.air += 200;
  after.ports[0].level = 1;
  after.ports[0].incomePerSecond = 200;
  after.forces[0].phase = "outbound";
  after.forces[0].command = {
    kind: "air_superiority",
    target: 12 as never,
    issuedTick: 4,
  };
  after.forces[0].path = [2, 6, 12] as never[];
  after.forces[0].queue = [
    { kind: "patrol", target: 3 as never, issuedTick: 4 },
  ];
  const encoder = new StreamingEncoder({
    mapWidth: 4,
    mapHeight: 4,
    terrain: new Uint8Array(16),
    gzip,
    gameStartInfo: {},
    numLandTiles: 16,
    keyframeInterval: 3,
  });
  for (let tick = 0; tick < 12; tick++)
    encoder.pushFrame(
      frame(tick, {
        updates: {
          [GameUpdateType.Player]: tick === 0 ? [fullPlayer(1)] : [],
          [GameUpdateType.ModernSystems]:
            tick === 0
              ? [{ type: GameUpdateType.ModernSystems, state: before }]
              : tick === 4
                ? [{ type: GameUpdateType.ModernSystems, state: after }]
                : [],
        },
      }),
    );
  const reader = openReader(await finish(encoder));
  expect(modernStateHash(reader.seek(2).modernSystems ?? null)).toBe(
    modernStateHash(before),
  );
  expect(modernStateHash(reader.seek(11).modernSystems ?? null)).toBe(
    modernStateHash(after),
  );
  expect(modernStateHash(reader.seek(3).modernSystems ?? null)).toBe(
    modernStateHash(before),
  );
  expect(modernStateHash(reader.seek(5).modernSystems ?? null)).toBe(
    modernStateHash(after),
  );
  const config = new Config(testGameConfig(), new UserSettings(), true);
  const view = new ReplayGameView(
    reader.header.players,
    config,
    4,
    4,
    16,
    new Uint8Array(16),
  );
  view.update(reader.seek(11), new Uint8Array(16), 0, false, true);
  expect(view.modernSystems()?.forces[0].queue).toEqual(after.forces[0].queue);
  expect(view.playerViews()[0].modernFaction()?.aiLevel).toBe("high");
  expect(
    view.playerViews()[0].modernFaction()?.nuclearStrikes[0].launchId,
  ).toBe(77);
});

test("old Classic replay exposes no modern state", async () => {
  const encoder = new StreamingEncoder({
    mapWidth: 2,
    mapHeight: 2,
    terrain: new Uint8Array(4),
    gzip,
    gameStartInfo: {},
    numLandTiles: 4,
    keyframeInterval: 2,
  });
  encoder.pushFrame(frame(0));
  encoder.pushFrame(frame(1));
  const reader = openReader(await finish(encoder));
  expect(reader.seek(1).modernSystems).toBeNull();
});
