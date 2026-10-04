import { Config } from "../src/core/configuration/Config";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { GameConfig } from "../src/core/Schemas";
import { setup } from "./util/Setup";

const fair: NonNullable<GameConfig["enhancedAI"]> = {
  tribePercent: 100,
  nationPercent: 100,
  personality: "mixed",
  fairResources: true,
  seed: 42,
};
const types = [PlayerType.Human, PlayerType.Bot, PlayerType.Nation];

describe("fair resources with real Config", () => {
  test("land and boat senders reject protected targets before troop calculation or route searches", async () => {
    const game = await setup(
      "plains",
      { enhancedAI: fair, spawnImmunityDuration: 20 },
      [],
      undefined,
      Config,
    );
    const self = game.addPlayer(
      new PlayerInfo("self", PlayerType.Nation, "selfcl", "self"),
    );
    const target = game.addPlayer(
      new PlayerInfo("target", PlayerType.Human, "targetcl", "target"),
    );
    self.conquer(game.ref(0, 2));
    self.setSpawnTile(game.ref(0, 2));
    self.setTroops(200000);
    target.conquer(game.ref(1, 2));
    target.setSpawnTile(game.ref(1, 2));
    target.setTroops(1000);
    const random = new PseudoRandom(42);
    const behavior = new AiAttackBehavior(
      random,
      game,
      self,
      0,
      0,
      0,
      undefined,
      new NationEmojiBehavior(random, game, self),
    );
    const internal = behavior as unknown as {
      sendLandAttack(target: Player): boolean;
      sendBoatAttack(target: Player): boolean;
      calculateAttackTroops(): number | null;
      boatRoute(): unknown;
    };
    const calculation = vi.spyOn(internal, "calculateAttackTroops");
    const route = vi.spyOn(internal, "boatRoute");
    const commands = vi.spyOn(game, "addExecution");
    expect(internal.sendLandAttack(target)).toBe(false);
    expect(internal.sendBoatAttack(target)).toBe(false);
    expect(calculation).not.toHaveBeenCalled();
    expect(route).not.toHaveBeenCalled();
    expect(commands).not.toHaveBeenCalled();
    for (let tick = 0; tick < 20; tick++) game.executeNextTick();
    expect(internal.sendLandAttack(target)).toBe(true);
    expect(calculation).toHaveBeenCalledOnce();
    expect(
      commands.mock.calls.filter(
        ([execution]) => execution instanceof AttackExecution,
      ),
    ).toHaveLength(1);
  });
  test.each(Object.values(Difficulty))(
    "%s ignores infinite resources and all host overrides while retaining global finite settings",
    async (difficulty) => {
      const game = await setup(
        "plains",
        {
          difficulty,
          enhancedAI: fair,
          infiniteGold: true,
          infiniteTroops: true,
          startingGold: 12345,
          goldMultiplier: 7,
          spawnImmunityDuration: 417,
          hostCheats: {
            infiniteGold: true,
            infiniteTroops: true,
            startingGold: 99999,
            goldMultiplier: 99,
          },
        },
        [],
        undefined,
        Config,
      );
      const players = types.map((type, i) =>
        game.addPlayer(
          new PlayerInfo(`p${i}`, type, `cl${i}`, `p${i}`, i === 0),
        ),
      );
      players.forEach((p, i) => {
        for (let x = i * 10; x < i * 10 + 10; x++)
          for (let y = 0; y < 10; y++) p.conquer(game.ref(x, y));
        p.setTroops(60000);
      });
      const config = game.config();
      expect(config.infiniteGold()).toBe(false);
      expect(config.infiniteTroops()).toBe(false);
      expect(config.nationSpawnImmunityDuration()).toBe(417);
      expect(config.spawnImmunityDuration()).toBe(417);
      const humanCost = config.unitInfo(UnitType.City).cost(game, players[0]);
      expect(humanCost).toBeGreaterThan(0n);
      for (const player of players) {
        expect(config.startManpower(player.info())).toBe(25000);
        expect(config.startingGold(player.info())).toBe(12345n);
        expect(config.maxTroops(player)).toBe(config.maxTroops(players[0]));
        expect(config.troopIncreaseRate(player)).toBe(
          config.troopIncreaseRate(players[0]),
        );
        expect(config.goldAdditionRate(player)).toBe(700n);
        expect(config.unitInfo(UnitType.City).cost(game, player)).toBe(
          humanCost,
        );
      }
    },
  );

  test.each(Object.values(Difficulty))(
    "%s transfers half of odd victim gold for all defeated controller types, including an inactive human",
    async (difficulty) => {
      const game = await setup(
        "plains",
        { difficulty, enhancedAI: fair },
        [],
        undefined,
        Config,
      );
      const conqueror = game.addPlayer(
        new PlayerInfo("winner", PlayerType.Human, "winnercl", "winner"),
      );
      for (const [i, type] of types.entries()) {
        const victim = game.addPlayer(
          new PlayerInfo(`v${i}`, type, `vcl${i}`, `v${i}`),
        );
        victim.addGold(1001n);
        victim.conquer(game.ref(i + 1, 2));
        const before = conqueror.gold();
        expect(game.config().conquerGoldAmount(victim)).toBe(500n);
        // No attack is recorded: fair mode applies the same transfer rule to
        // the inactive human as to either AI type.
        game.conquerPlayer(conqueror, victim);
        expect(conqueror.gold()).toBe(before + 500n);
        expect(victim.gold()).toBe(0n);
      }
    },
  );

  test.each(types)(
    "actual land conquest of inactive %s transfers the same half-gold reward",
    async (type) => {
      const game = await setup(
        "plains",
        { enhancedAI: fair, spawnImmunityDuration: 0 },
        [],
        undefined,
        Config,
      );
      const attacker = game.addPlayer(
        new PlayerInfo("attacker", PlayerType.Human, "attackcl", "attacker"),
      );
      const victim = game.addPlayer(
        new PlayerInfo("victim", type, "victimcl", "victim"),
      );
      attacker.conquer(game.ref(0, 2));
      attacker.setSpawnTile(game.ref(0, 2));
      attacker.setTroops(100000);
      victim.conquer(game.ref(1, 2));
      victim.setSpawnTile(game.ref(1, 2));
      victim.setTroops(1000);
      victim.addGold(1001n);
      const before = attacker.gold();
      game.addExecution(new AttackExecution(60000, attacker, victim.id()));
      for (let tick = 0; tick < 200 && victim.numTilesOwned() > 0; tick++) {
        game.executeNextTick();
      }
      expect(game.owner(game.ref(1, 2))).toBe(attacker);
      expect(victim.numTilesOwned()).toBe(0);
      expect(attacker.gold()).toBe(before + 500n);
      expect(victim.gold()).toBe(0n);
    },
  );

  test.each([undefined, false])(
    "classic settings keep victim-specific capture rewards, inactive-human policy and cheats when fairness is %s",
    async (fairResources) => {
      const game = await setup(
        "plains",
        {
          enhancedAI:
            fairResources === undefined
              ? undefined
              : { ...fair, fairResources },
          infiniteGold: true,
          infiniteTroops: true,
          startingGold: 1000,
          goldMultiplier: 2,
          hostCheats: { startingGold: 5000, goldMultiplier: 7 },
        },
        [],
        undefined,
        Config,
      );
      const host = game.addPlayer(
        new PlayerInfo("host", PlayerType.Human, "hostcl", "host", true),
      );
      const victim = game.addPlayer(
        new PlayerInfo("human", PlayerType.Human, "humancl", "human"),
      );
      expect(game.config().infiniteGold()).toBe(true);
      expect(game.config().infiniteTroops()).toBe(true);
      expect(game.config().startManpower(host.info())).toBe(1000000);
      expect(game.config().startingGold(host.info())).toBe(6000n);
      expect(game.config().goldAdditionRate(host)).toBe(700n);
      expect(game.config().maxTroops(host)).toBe(1000000000);
      expect(game.config().unitInfo(UnitType.City).cost(game, host)).toBe(0n);
      victim.removeGold(victim.gold());
      victim.addGold(1001n);
      expect(game.config().conquerGoldAmount(victim)).toBe(500n);
      const before = host.gold();
      game.conquerPlayer(host, victim);
      expect(host.gold()).toBe(before);
      expect(victim.gold()).toBe(1001n);
      for (const type of [PlayerType.Bot, PlayerType.Nation]) {
        const ai = game.addPlayer(new PlayerInfo(type, type, null, type));
        ai.removeGold(ai.gold());
        ai.addGold(1001n);
        expect(game.config().conquerGoldAmount(ai)).toBe(1001n);
      }
    },
  );

  test("fair settings ignore host-only infinite overrides even with global infinite flags disabled", async () => {
    const game = await setup(
      "plains",
      {
        enhancedAI: fair,
        hostCheats: { infiniteGold: true, infiniteTroops: true },
      },
      [],
      undefined,
      Config,
    );
    const host: Player = game.addPlayer(
      new PlayerInfo("host", PlayerType.Human, "hostcl", "host", true),
    );
    expect(game.config().startManpower(host.info())).toBe(25000);
    expect(game.config().maxTroops(host)).toBe(100000);
    expect(
      game.config().unitInfo(UnitType.City).cost(game, host),
    ).toBeGreaterThan(0n);
  });
});
