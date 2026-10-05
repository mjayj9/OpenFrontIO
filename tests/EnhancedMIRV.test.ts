// @vitest-environment node
import { safeMIRVWarhead } from "../src/core/ai/WeaponSafety";
import { Config } from "../src/core/configuration/Config";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationMIRVBehavior } from "../src/core/execution/nation/NationMIRVBehavior";
import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";

async function fixture(enhanced = true) {
  const game = await setup(
    "big_plains",
    {
      difficulty: Difficulty.Impossible,
      instantBuild: true,
      spawnImmunityDuration: 0,
      enhancedAI: enhanced
        ? {
            tribePercent: 0,
            nationPercent: 100,
            personality: "expansionist",
            fairResources: true,
            seed: 3,
          }
        : undefined,
    },
    [
      new PlayerInfo("self", PlayerType.Nation, "self", "self"),
      new PlayerInfo("enemy", PlayerType.Nation, "enemy", "enemy"),
    ],
    undefined,
    Config,
  );
  const self = game.player("self"),
    enemy = game.player("enemy");
  for (let y = 0; y < game.height(); y++)
    for (let x = 0; x < game.width(); x++)
      (x < 20 ? self : enemy).conquer(game.ref(x, y));
  self.setSpawnTile(game.ref(10, 20));
  enemy.setSpawnTile(game.ref(100, 100));
  self.addGold(100_000_000n);
  self.buildUnit(UnitType.MissileSilo, game.ref(10, 20), {});
  const random = new PseudoRandom(12);
  const behavior = new NationMIRVBehavior(
    random,
    game,
    self,
    new NationEmojiBehavior(random, game, self),
  );
  const attempts = () => {
    for (let i = 0; i < 30; i++) if (behavior.considerMIRV()) return true;
    return false;
  };
  return { game, self, enemy, behavior, attempts };
}

describe("enhanced MIRV spending and collateral decisions", () => {
  test("launches against a valuable enemy and preserves in-flight decisions through restore", async () => {
    const { game, self, enemy, attempts } = await fixture();
    expect(attempts()).toBe(true);
    game.executeNextTick();
    game.executeNextTick();
    expect(self.units(UnitType.MIRV)).toHaveLength(1);
    expect(game.owner(self.units(UnitType.MIRV)[0].targetTile()!)).toBe(enemy);
    await expectSnapshotRoundTrip(game, "big_plains", 80);
  });

  test("does not betray an ally even when its territory triggers victory denial", async () => {
    const { self, enemy, attempts } = await fixture();
    self.createAllianceRequest(enemy)!.accept();
    expect(attempts()).toBe(false);
    expect(self.isAlliedWith(enemy)).toBe(true);
  });

  test("preserves a replacement city budget and ignores a low-value target", async () => {
    const { game, self, enemy, attempts } = await fixture();
    self.removeGold(self.gold());
    self.addGold(game.unitInfo(UnitType.MIRV).cost(game, self));
    expect(attempts()).toBe(false);
    self.addGold(100_000_000n);
    for (const tile of [...enemy.tiles()])
      if (game.x(tile) > 75) enemy.relinquish(tile);
    // Incoming MIRV would normally trigger a retaliatory strike against even
    // a small army. This expensive strike still must pass target valuation.
    enemy.buildUnit(UnitType.MIRV, game.ref(50, 100), {
      targetTile: game.ref(10, 20),
      targetPlayer: self,
    });
    expect(attempts()).toBe(false);
  });

  test("checks the full actual blast circle including friendly enclaves", async () => {
    const { game, self } = await fixture();
    const target = game.ref(100, 100);
    expect(safeMIRVWarhead(game, self, target)).toBe(true);
    self.conquer(game.ref(105, 105));
    expect(safeMIRVWarhead(game, self, target)).toBe(false);
    const ally = game.addPlayer(
      new PlayerInfo("ally", PlayerType.Nation, null, "ally"),
    );
    ally.conquer(game.ref(105, 105));
    self.createAllianceRequest(ally)!.accept();
    expect(safeMIRVWarhead(game, self, target)).toBe(false);
  });

  test("keeps inherited classic alliance targeting policy", async () => {
    const { self, enemy, attempts } = await fixture(false);
    self.createAllianceRequest(enemy)!.accept();
    expect(attempts()).toBe(true);
  });
});
