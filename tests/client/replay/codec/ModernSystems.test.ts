import { StreamingEncoder } from "../../../../src/client/replay/codec/encode/StreamingEncoder";
import { ReplayGameView } from "../../../../src/client/replay/ReplayGameAdapter";
import { applyModernForcesFrame } from "../../../../src/client/view/ModernForcesFrame";
import { Config } from "../../../../src/core/configuration/Config";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";
import { UserSettings } from "../../../../src/core/game/UserSettings";
import {
  ModernState,
  ModernStateSchema,
  modernStateHash,
} from "../../../../src/core/modern/ModernState";
import { makeEmptyGu, makeGameView } from "../../../util/viewStubs";
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

test("10Hz force motion survives chunk seeks and stale economy baselines without mutating previous frames", async () => {
  const baseline = initial();
  baseline.forces[0].phase = "outbound";
  baseline.forces[0].command = {
    kind: "strike",
    target: 12 as never,
    issuedTick: 0,
  };
  baseline.forces[0].path = [2, 6, 9, 12] as never[];
  const encoder = new StreamingEncoder({
    mapWidth: 4,
    mapHeight: 4,
    terrain: new Uint8Array(16),
    gzip,
    gameStartInfo: {},
    numLandTiles: 16,
    keyframeInterval: 3,
  });
  const motion = (tick: number, tile: number, pathIndex: number) => ({
    type: GameUpdateType.ModernForcesFrame as const,
    tick,
    positions: new Uint32Array([
      0,
      tile,
      2,
      pathIndex,
      400,
      4,
      0,
      0xffffffff,
      tick,
    ]),
  });
  for (let tick = 0; tick < 7; tick++)
    encoder.pushFrame(
      frame(tick, {
        updates: {
          [GameUpdateType.ModernSystems]:
            tick === 0 || tick === 5
              ? [{ type: GameUpdateType.ModernSystems, state: baseline }]
              : [],
          [GameUpdateType.ModernForcesFrame]:
            tick === 1
              ? [motion(1, 6, 1)]
              : tick === 2
                ? [motion(2, 9, 2)]
                : tick === 4
                  ? [motion(4, 12, 3)]
                  : [],
        },
      }),
    );
  const reader = openReader(await finish(encoder));
  const previous = reader.seek(2).modernSystems!;
  expect(previous.forces[0].tile).toBe(9);
  expect(reader.seek(6).modernSystems?.forces[0].tile).toBe(12);
  expect(previous.forces[0].tile).toBe(9);
  expect(reader.seek(3).modernSystems?.forces[0].tile).toBe(9);
  expect(reader.seek(0).modernSystems?.forces[0].tile).toBe(2);
  expect(baseline.forces[0].tile).toBe(2);
});

test("live view applies actual motion, rejects stale full updates and catches new indices on the next baseline", () => {
  const view = makeGameView({ width: 4, height: 4 });
  const baseline = initial();
  const full = makeEmptyGu(0);
  full.updates[GameUpdateType.ModernSystems] = [
    { type: GameUpdateType.ModernSystems, state: baseline },
  ];
  view.update(full);
  const motion = makeEmptyGu(1);
  motion.updates[GameUpdateType.ModernForcesFrame] = [
    {
      type: GameUpdateType.ModernForcesFrame,
      tick: 1,
      positions: new Uint32Array([
        0, 6, 2, 1, 300, 3, 0, 0xffffffff, 1, 1, 12, 1, 0, 1000, 0, 0,
        0xffffffff, 0,
      ]),
    },
  ];
  view.update(motion);
  expect(view.modernSystems()?.forces[0].tile).toBe(6);
  expect(view.modernSystems()?.forces).toHaveLength(1);
  const stale = makeEmptyGu(2);
  stale.updates[GameUpdateType.ModernSystems] = [
    { type: GameUpdateType.ModernSystems, state: baseline },
  ];
  view.update(stale);
  expect(view.modernSystems()?.forces[0].tile).toBe(6);
  const next = structuredClone(baseline);
  next.tick = 10;
  next.forces[0].tile = 9 as never;
  next.forces.push({ ...next.forces[0], id: "new", tile: 12 as never });
  const caught = makeEmptyGu(10);
  caught.updates[GameUpdateType.ModernSystems] = [
    { type: GameUpdateType.ModernSystems, state: next },
  ];
  view.update(caught);
  expect(view.modernSystems()?.forces[1].tile).toBe(12);
  expect(view.modernForcesTick()).toBe(10);
  expect(baseline.forces[0].tile).toBe(2);
});

test("destruction and active battle front display derive from actual compact state", () => {
  const baseline = initial();
  baseline.forces[0].queue = [
    { kind: "strike", target: 12 as never, issuedTick: 0 },
  ];
  const attacking = applyModernForcesFrame(
    baseline,
    { tick: 1, positions: [0, 6, 6, 0, 0, 0, 10000, 9, 1] },
    0,
    16,
  )!;
  expect(attacking.forces[0].path).toEqual([6, 9]);
  expect(attacking.forces[0].attackTroops).toBe(10000);
  const destroyed = applyModernForcesFrame(
    attacking,
    { tick: 2, positions: [0, 6, 7, 0, 0, 0, 0, 0xffffffff, 1] },
    1,
    16,
  )!;
  expect(destroyed.forces[0].path).toEqual([]);
  expect(destroyed.forces[0].queue).toEqual([]);
  expect(baseline.forces[0].queue).toHaveLength(1);
  expect(
    applyModernForcesFrame(
      destroyed,
      { tick: 1, positions: [0, 2, 0, 0, 400, 4, 0, 0xffffffff, 0] },
      2,
      16,
    ),
  ).toBe(destroyed);
});

test("changed route patches show issued orders and the return route before the next full baseline", () => {
  const baseline = initial();
  const outbound = applyModernForcesFrame(
    baseline,
    {
      tick: 1,
      positions: [0, 6, 2, 1, 400, 4, 0, 0xffffffff, 0],
      routes: [
        {
          index: 0,
          command: { kind: "strike", target: 12 as never, issuedTick: 1 },
          queue: [],
          path: [2, 6, 12] as never[],
          cooldownUntil: 0,
          lastReason: null,
        },
      ],
    },
    0,
    16,
  )!;
  expect(outbound.forces[0].command?.target).toBe(12);
  expect(outbound.forces[0].path).toEqual([2, 6, 12]);
  const returning = applyModernForcesFrame(
    outbound,
    {
      tick: 2,
      positions: [0, 9, 4, 1, 400, 4, 0, 0xffffffff, 2],
      routes: [
        {
          index: 0,
          command: outbound.forces[0].command,
          queue: [],
          path: [12, 9, 2] as never[],
          cooldownUntil: 0,
          lastReason: null,
        },
      ],
    },
    1,
    16,
  )!;
  expect(returning.forces[0].phase).toBe("returning");
  expect(returning.forces[0].path).toEqual([12, 9, 2]);
  expect(outbound.forces[0].path).toEqual([2, 6, 12]);
});
