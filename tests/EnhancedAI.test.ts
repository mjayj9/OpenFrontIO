import { AI_PERSONALITIES, aiProfile } from "../src/core/ai/AIProfile";
import {
  defensiveReserve,
  MAX_AI_CANDIDATES,
  newStrategicState,
  planStrategy,
} from "../src/core/ai/StrategicPlanner";
import { Config } from "../src/core/configuration/Config";
import { NationExecution } from "../src/core/execution/NationExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { TribeExecution } from "../src/core/execution/TribeExecution";
import { AiAttackBehaviorSnapshot } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Cell,
  Difficulty,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameUpdateType } from "../src/core/game/GameUpdates";
import { GameConfig } from "../src/core/Schemas";
import { readVersioned } from "../src/core/snapshot/SnapshotType";
import { playerInfo, setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { UseRealAttackLogic } from "./util/TestConfig";

const SETTINGS: NonNullable<GameConfig["enhancedAI"]> = {
  tribePercent: 100,
  nationPercent: 100,
  personality: "mixed",
  fairResources: true,
  seed: 42,
};
function run(game: Game, ticks: number) {
  for (let i = 0; i < ticks; i++) game.executeNextTick();
}
function add(game: Game, id: string, type = PlayerType.Bot): Player {
  if (game.hasPlayer(id)) return game.player(id);
  return game.addPlayer(playerInfo(id, type));
}
function region(game: Game, player: Player, from: number, to: number) {
  for (let y = 0; y < game.height(); y++)
    for (let x = from; x < to; x++) player.conquer(game.ref(x, y));
  player.setSpawnTile(game.ref(from, 20));
  player.setTroops(60000);
}

describe("enhanced deterministic AI", () => {
  test("profile identity is explicit, seeded, independent of name and reaction difficulty", () => {
    const config = { enhancedAI: SETTINGS, difficulty: Difficulty.Medium };
    expect(aiProfile(config, "human", PlayerType.Human)).toBeNull();
    expect(
      aiProfile({ difficulty: Difficulty.Hard }, "bot", PlayerType.Bot),
    ).toBeNull();
    const profile = aiProfile(config, "bot", PlayerType.Bot)!;
    expect(profile.personality).toBe(
      aiProfile(
        { ...config, difficulty: Difficulty.Impossible },
        "bot",
        PlayerType.Bot,
      )!.personality,
    );
    expect(AI_PERSONALITIES).toHaveLength(5);
    const choices = new Set(
      Array.from(
        { length: 100 },
        (_, i) => aiProfile(config, `bot${i}`, PlayerType.Bot)!.personality,
      ),
    );
    expect(choices.size).toBe(5);
    expect(
      aiProfile(
        { ...config, enhancedAI: { ...SETTINGS, tribePercent: 0 } },
        "bot",
        PlayerType.Bot,
      ),
    ).toBeNull();
  });

  test.each(Object.values(Difficulty))(
    "fair rules equal human, tribe and nation economics at %s",
    async (difficulty) => {
      const game = await setup(
        "plains",
        { difficulty, enhancedAI: SETTINGS, startingGold: 10000 },
        [],
        undefined,
        Config,
      );
      const players = [PlayerType.Human, PlayerType.Bot, PlayerType.Nation].map(
        (type, i) => add(game, `p${i}`, type),
      );
      players.forEach((player, i) => region(game, player, i * 10, i * 10 + 10));
      const config = game.config();
      for (const p of players) {
        expect(config.startManpower(p.info())).toBe(25000);
        expect(config.maxTroops(p)).toBe(config.maxTroops(players[0]));
        expect(config.troopIncreaseRate(p)).toBe(
          config.troopIncreaseRate(players[0]),
        );
        expect(config.goldAdditionRate(p)).toBe(
          config.goldAdditionRate(players[0]),
        );
        expect(config.startingGold(p.info())).toBe(10000n);
      }
      const base = {
        attackTroops: 10000,
        attacker: { type: PlayerType.Bot, numTiles: 1000 },
        defender: {
          type: PlayerType.Nation,
          troops: 60000,
          numTiles: 1000,
          isTraitor: false,
          isDisconnectedTeammate: false,
        },
        terrain: game.terrainType(game.ref(1, 1)),
        falloutRatio: null,
        defenderHasDefensePost: false,
        borderSize: 10,
      };
      expect(config.attackLogic(base)).toEqual(
        config.attackLogic({
          ...base,
          attacker: { ...base.attacker, type: PlayerType.Human },
        }),
      );
    },
  );

  test("reserve accounts for a second hostile front and allies are excluded", async () => {
    const game = await setup("plains", { enhancedAI: SETTINGS });
    const self = add(game, "self"),
      left = add(game, "left"),
      right = add(game, "right");
    region(game, left, 0, 25);
    region(game, self, 25, 75);
    region(game, right, 75, 100);
    const profile = aiProfile(
      game.config().gameConfig(),
      self.id(),
      self.type(),
    )!;
    left.setTroops(180000);
    right.setTroops(180000);
    const two = defensiveReserve(game, self, profile);
    const request = self.createAllianceRequest(right);
    request!.accept();
    expect(defensiveReserve(game, self, profile)).toBeLessThan(two);
    expect(
      planStrategy(
        game,
        self,
        profile,
        newStrategicState(),
        false,
      ).candidates.every((c) => c.player !== right),
    ).toBe(true);
  });

  test("planning uses bounded integer scores and keeps an eligible target", async () => {
    const game = await setup("plains", {
      enhancedAI: { ...SETTINGS, personality: "expansionist" },
    });
    const self = add(game, "self"),
      other = add(game, "other");
    region(game, self, 0, 50);
    region(game, other, 50, 100);
    self.setTroops(150000);
    other.setTroops(30000);
    const profile = aiProfile(
      game.config().gameConfig(),
      self.id(),
      self.type(),
    )!;
    const first = planStrategy(game, self, profile, newStrategicState(), false);
    expect(first.state.goal).toBe("attack");
    expect(first.state.candidateCount).toBeLessThanOrEqual(MAX_AI_CANDIDATES);
    expect(first.candidates.every((c) => Number.isInteger(c.score))).toBe(true);
    const next = planStrategy(game, self, profile, first.state, false);
    expect(next.state.target).toBe(first.state.target);
    expect(next.state.chosenAt).toBe(first.state.chosenAt);
  });

  test("enhanced tribe executes conquest and preserves useful captured structures", async () => {
    const game = await setup(
      "plains",
      {
        enhancedAI: { ...SETTINGS, personality: "expansionist" },
        instantBuild: true,
        disabledUnits: [
          UnitType.AtomBomb,
          UnitType.HydrogenBomb,
          UnitType.MIRV,
        ],
      },
      [],
      undefined,
      UseRealAttackLogic,
    );
    const self = add(game, "self"),
      other = add(game, "other", PlayerType.Human);
    region(game, self, 0, 50);
    region(game, other, 50, 100);
    const city = other.buildUnit(UnitType.City, game.ref(50, 50), {});
    // Capture through the normal ownership path before the controller's next
    // thought, then retain it beyond the classic deletion cooldown.
    self.conquer(city.tile());
    self.setTroops(150000);
    other.setTroops(5000);
    const execution = new TribeExecution(self);
    game.addExecution(execution);
    game.addExecution(new PlayerExecution(self));
    game.addExecution(new PlayerExecution(other));
    const before = self.numTilesOwned();
    run(game, 450);
    expect(self.numTilesOwned()).toBeGreaterThan(before);
    expect(city.isMarkedForDeletion()).toBe(false);
    expect(self.units(UnitType.City)).toContain(city);
    expect(execution.strategyStatus()).not.toBeNull();
  });

  test("classic tribes still delete structures; opt-in does not alter that design", async () => {
    const game = await setup("plains");
    const self = add(game, "classic");
    region(game, self, 0, 25);
    const city = self.buildUnit(UnitType.City, game.ref(10, 50), {});
    game.addExecution(new TribeExecution(self));
    run(game, 450);
    expect(city.isMarkedForDeletion() || !city.isActive()).toBe(true);
  });

  test("enhanced nation and tribe snapshots continue identical decisions and territory", async () => {
    const nation = new Nation(
      undefined,
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
    );
    const game = await setup(
      "plains",
      {
        enhancedAI: SETTINGS,
        instantBuild: true,
        startingGold: 400000,
        disableAlliances: true,
        disabledUnits: [
          UnitType.AtomBomb,
          UnitType.HydrogenBomb,
          UnitType.MIRV,
          UnitType.TransportShip,
        ],
      },
      [],
      undefined,
      UseRealAttackLogic,
      true,
      [nation],
    );
    const self = add(game, "tribe"),
      rival = add(game, "nation", PlayerType.Nation);
    region(game, self, 0, 50);
    region(game, rival, 50, 100);
    game.addExecution(new TribeExecution(self));
    game.addExecution(new NationExecution("AIBench1", nation));
    game.addExecution(new PlayerExecution(self));
    game.addExecution(new PlayerExecution(rival));
    run(game, 150);
    await expectSnapshotRoundTrip(game, "plains", 300);
  }, 60000);

  test("migrates existing attack behavior snapshot without changing classic memory", () => {
    const restored = readVersioned(AiAttackBehaviorSnapshot, {
      v: 2,
      d: {
        botAttackTroopsSent: 0,
        followedLandings: [],
        triggerRatio: 0.5,
        reserveRatio: 0.3,
        expandRatio: 0.2,
      },
    });
    expect(restored.strategicState).toBeNull();
  });

  test("enhanced coastal and island nations reuse naval and construction behavior with reproducible restoration", async () => {
    const nations = [
      ["United Kingdom", 925, 186],
      ["France", 958, 220],
      ["Spain", 908, 264],
      ["Algeria", 918, 342],
    ].map(
      ([name, x, y], i) =>
        new Nation(
          new Cell(Number(x), Number(y)),
          new PlayerInfo(String(name), PlayerType.Nation, null, `island_${i}`),
        ),
    );
    const game = await setup(
      "world",
      {
        enhancedAI: { ...SETTINGS, personality: "naval" },
        difficulty: Difficulty.Impossible,
        instantBuild: true,
        startingGold: 30000000,
        goldMultiplier: 20,
      },
      [],
      undefined,
      UseRealAttackLogic,
      false,
      nations,
    );
    nations.forEach((nation) =>
      game.addExecution(new NationExecution("islands1", nation)),
    );
    run(game, 15);
    game.endSpawnPhase();
    run(game, 1000);
    expect(game.unitCount(UnitType.Port)).toBeGreaterThan(0);
    expect(game.unitCount(UnitType.Warship)).toBeGreaterThan(0);
    await expectSnapshotRoundTrip(game, "world", 180);
  }, 120000);

  test("banned units and alliances remain banned; real goals reach worker updates", async () => {
    const nation = new Nation(
      undefined,
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
    );
    const game = await setup(
      "plains",
      {
        enhancedAI: SETTINGS,
        disableAlliances: true,
        startingGold: 30000000,
        disabledUnits: Object.values(UnitType),
      },
      [],
      undefined,
      UseRealAttackLogic,
      true,
      [nation],
    );
    const self = add(game, "tribe"),
      rival = add(game, "nation", PlayerType.Nation);
    region(game, self, 0, 50);
    region(game, rival, 50, 100);
    game.addExecution(new TribeExecution(self));
    game.addExecution(new NationExecution("banstest", nation));
    game.addExecution(new PlayerExecution(self));
    game.addExecution(new PlayerExecution(rival));
    const statuses = [];
    for (let tick = 0; tick < 500; tick++)
      statuses.push(...game.executeNextTick()[GameUpdateType.AIStatus]);
    expect(game.units()).toHaveLength(0);
    expect(self.alliances()).toHaveLength(0);
    expect(rival.alliances()).toHaveLength(0);
    expect(statuses.length).toBeGreaterThan(5);
    expect(
      statuses.every(
        (s) =>
          Number.isInteger(s.reserve) &&
          s.candidateCount <= MAX_AI_CANDIDATES &&
          s.buildingPriority.length === 0,
      ),
    ).toBe(true);
    expect(new Set(statuses.map((s) => s.playerID)).size).toBe(2);
  });
});
