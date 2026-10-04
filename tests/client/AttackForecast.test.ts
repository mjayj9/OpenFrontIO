import { describe, expect, test, vi } from "vitest";
import type { GameView, PlayerView } from "../../src/client/view";
import {
  forecastAttack,
  forecastVisibleAttack,
} from "../../src/client/view/AttackForecast";
import { UnitType } from "../../src/core/game/Game";

const base = {
  troops: 10000,
  ratio: 0.2,
  targetTroops: 1500,
  incomingTroops: 0,
  defensePosts: 0,
  defenseBonus: 5,
};
describe("read-only attack forecasts", () => {
  test("matches paid integer commitment and keeps the rest at home", () => {
    const result = forecastAttack({ ...base, troops: 10000.9, ratio: 0.333 });
    expect(result.committed).toBe(3330);
    expect(result.remaining).toBe(6670);
    expect(result.committed + result.remaining).toBe(10000);
    expect(result.percent).toBe(33);
  });
  test("visible defense protection raises rough risk without stacking overlapping posts", () => {
    expect(forecastAttack(base).risk).toBe("lower");
    const defended = forecastAttack({ ...base, defensePosts: 1 });
    expect(defended.risk).toBe("high");
    expect(forecastAttack({ ...base, defensePosts: 3 }).risk).toBe(
      defended.risk,
    );
  });
  test("low remaining reserves and inbound armies raise risk even against a weak target", () => {
    expect(forecastAttack({ ...base, targetTroops: 10, ratio: 1 }).risk).toBe(
      "high",
    );
    expect(forecastAttack({ ...base, incomingTroops: 9000 }).risk).toBe("high");
  });
  test("invalid/missing values never advertise a favorable outcome or invent troops", () => {
    const missing = forecastAttack({ ...base, troops: NaN, ratio: Infinity });
    expect(missing).toMatchObject({
      committed: 0,
      remaining: 0,
      risk: "unknown",
    });
    expect(forecastAttack({ ...base, targetTroops: NaN }).risk).toBe("unknown");
    expect(forecastAttack({ ...base, ratio: 2 })).toMatchObject({
      committed: 10000,
      remaining: 0,
      percent: 100,
    });
  });
  test("view adapter uses current home troops and one local query, excluding incomplete/friendly posts and retreating inbound stacks", () => {
    const my = {
      troops: () => 10000,
      incomingAttacks: () => [
        { troops: 7000, retreating: true },
        { troops: 500, retreating: false },
      ],
      outgoingAttacks: () => {
        throw new Error("Outgoing armies are already deducted");
      },
    } as unknown as PlayerView;
    const target = {
      id: () => "target",
      troops: () => 1500,
    } as unknown as PlayerView;
    const unit = (owner: string, building = false) => ({
      owner: () => ({ id: () => owner }),
      isActive: () => true,
      isUnderConstruction: () => building,
    });
    const nearbyUnits = vi.fn(
      (
        _tile: number,
        _range: number,
        _type: UnitType,
        predicate: (unit: unknown) => boolean,
      ) =>
        [unit("target"), unit("my"), unit("target", true)]
          .map((candidate) => ({ unit: candidate, distSquared: 1 }))
          .filter(predicate),
    );
    const game = {
      config: () => ({
        defensePostRange: () => 30,
        defensePostDefenseBonus: () => 5,
      }),
      nearbyUnits,
    } as unknown as GameView;
    const result = forecastVisibleAttack(game, my, target, 42, 0.2);
    expect(nearbyUnits).toHaveBeenCalledOnce();
    expect(nearbyUnits.mock.calls[0].slice(0, 3)).toEqual([
      42,
      30,
      UnitType.DefensePost,
    ]);
    expect(result).toMatchObject({
      committed: 2000,
      remaining: 8000,
      defensePosts: 1,
      risk: "high",
    });
  });
});
