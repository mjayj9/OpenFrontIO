// @vitest-environment node
import { describe, expect, test } from "vitest";
import { aiProfile } from "../src/core/ai/AIProfile";
import {
  newStrategicState,
  planStrategy,
} from "../src/core/ai/StrategicPlanner";
import { Config } from "../src/core/configuration/Config";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { Game, PlayerType } from "../src/core/game/Game";
import { modernWorld } from "../src/core/game/ModernWorld";
import type { GameConfig } from "../src/core/Schemas";
import { playerInfo, setup } from "./util/Setup";

const TYPES = [PlayerType.Human, PlayerType.Bot, PlayerType.Nation];
const FAIR: NonNullable<GameConfig["enhancedAI"]> = {
  tribePercent: 100,
  nationPercent: 100,
  personality: "mixed",
  fairResources: true,
  seed: 1,
};

function advance(game: Game, ticks: number) {
  for (let i = 0; i < ticks; i++) game.executeNextTick();
}

describe("shared fair and modern start protection", () => {
  test("the enhanced planner invests during protection instead of proposing invalid attacks", async () => {
    const game = await setup(
      "plains",
      {
        enhancedAI: { ...FAIR, personality: "expansionist" },
        spawnImmunityDuration: 20,
      },
      [],
      undefined,
      Config,
    );
    const attacker = game.addPlayer(playerInfo("self", PlayerType.Bot));
    const defender = game.addPlayer(playerInfo("weak", PlayerType.Human));
    attacker.conquer(game.ref(10, 10));
    defender.conquer(game.ref(11, 10));
    attacker.setSpawnTile(game.ref(10, 10));
    defender.setSpawnTile(game.ref(11, 10));
    attacker.setTroops(50000);
    defender.setTroops(1000);
    const profile = aiProfile(
      game.config().gameConfig(),
      attacker.id(),
      attacker.type(),
    )!;
    const protectedPlan = planStrategy(
      game,
      attacker,
      profile,
      newStrategicState(),
      false,
    );
    expect(protectedPlan.candidates).toHaveLength(0);
    expect(protectedPlan.state.goal).toBe("economy");
    advance(game, 20);
    const activePlan = planStrategy(
      game,
      attacker,
      profile,
      protectedPlan.state,
      false,
    );
    expect(activePlan.candidates).toHaveLength(1);
    expect(activePlan.state.goal).toBe("attack");
    expect(activePlan.state.target).toBe(defender.id());
  });

  test.each(TYPES)(
    "fair %s attack execution cannot spend troops on a protected opponent",
    async (type) => {
      const game = await setup(
        "plains",
        { enhancedAI: FAIR, spawnImmunityDuration: 20 },
        [],
        undefined,
        Config,
      );
      const attacker = game.addPlayer(playerInfo("attacker", type));
      const defender = game.addPlayer(playerInfo("defender", PlayerType.Bot));
      attacker.conquer(game.ref(10, 10));
      defender.conquer(game.ref(11, 10));
      attacker.setSpawnTile(game.ref(10, 10));
      defender.setSpawnTile(game.ref(11, 10));
      attacker.setTroops(50000);
      defender.setTroops(50000);

      expect(attacker.isImmune()).toBe(true);
      expect(defender.isImmune()).toBe(true);
      expect(attacker.canAttackPlayer(defender)).toBe(false);
      game.addExecution(new AttackExecution(10000, attacker, defender.id()));
      advance(game, 1);
      expect(attacker.troops()).toBe(50000);
      expect(attacker.outgoingAttacks()).toHaveLength(0);
      expect(defender.numTilesOwned()).toBe(1);

      advance(game, 20);
      expect(attacker.isImmune()).toBe(false);
      expect(defender.isImmune()).toBe(false);
      expect(attacker.canAttackPlayer(defender)).toBe(true);
      game.addExecution(new AttackExecution(10000, attacker, defender.id()));
      advance(game, 1);
      expect(attacker.troops()).toBe(40000);
      expect(attacker.outgoingAttacks()).toHaveLength(1);
    },
  );

  test.each([true, false])(
    "modern protection applies to every controller with fairResources=%s",
    async (fairResources) => {
      const game = await setup(
        "plains",
        {
          enhancedAI: { ...FAIR, fairResources },
          modernMode: {
            scenario: "modern-world-v1",
            version: 1,
            dataHash: modernWorld.hash,
            countryId: "KOR",
            balance: "balanced",
            victory: "territory",
            targetPercent: 60,
            protectionTicks: 20,
            capitalElimination: false,
          },
        },
        [],
        undefined,
        Config,
      );
      const players = TYPES.map((type, i) => {
        const player = game.addPlayer(playerInfo(`player${i}`, type));
        player.conquer(game.ref(10 + i, 10));
        player.setSpawnTile(game.ref(10 + i, 10));
        return player;
      });
      for (const attacker of players) {
        expect(attacker.isImmune()).toBe(true);
        for (const defender of players)
          if (attacker !== defender)
            expect(attacker.canAttackPlayer(defender)).toBe(false);
      }
      advance(game, 20);
      for (const attacker of players) {
        expect(attacker.isImmune()).toBe(false);
        for (const defender of players)
          if (attacker !== defender)
            expect(attacker.canAttackPlayer(defender)).toBe(true);
      }
    },
  );

  test("Classic preserves its human-only immunity enforcement and tribe rules", async () => {
    const game = await setup(
      "plains",
      { spawnImmunityDuration: 20 },
      [],
      undefined,
      Config,
    );
    const human = game.addPlayer(playerInfo("human", PlayerType.Human));
    const tribe = game.addPlayer(playerInfo("tribe", PlayerType.Bot));
    const nation = game.addPlayer(playerInfo("nation", PlayerType.Nation));
    expect(human.isImmune()).toBe(true);
    expect(tribe.isImmune()).toBe(false);
    expect(nation.isImmune()).toBe(true);
    expect(human.canAttackPlayer(tribe)).toBe(true);
    expect(human.canAttackPlayer(nation)).toBe(false);
    expect(tribe.canAttackPlayer(human)).toBe(true);
    expect(nation.canAttackPlayer(human)).toBe(true);
    advance(game, 20);
    expect(human.isImmune()).toBe(false);
    expect(nation.isImmune()).toBe(true);
  });
});
