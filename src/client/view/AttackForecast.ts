import type { GameView, PlayerView } from ".";
import { UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";

export interface AttackForecastInput {
  troops: number;
  ratio: number;
  targetTroops: number;
  incomingTroops: number;
  defensePosts: number;
  defenseBonus: number;
}
export interface AttackForecast {
  committed: number;
  remaining: number;
  percent: number;
  defensePosts: number;
  risk: "lower" | "caution" | "high" | "unknown";
}
const finiteNonnegative = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

/** Read-only comparison of visible armies; never a battle or loss prediction. */
export function forecastAttack(input: AttackForecastInput): AttackForecast {
  const troops = finiteNonnegative(input.troops);
  const ratio = Math.min(1, finiteNonnegative(input.ratio));
  // AttackExecution clamps to the home army and removeTroops floors the paid
  // amount. Existing outgoing armies are already absent from home troops.
  const committed = Math.floor(troops * ratio);
  const remaining = Math.floor(troops - committed);
  const posts = Math.floor(finiteNonnegative(input.defensePosts));
  // Defense-post protection does not stack; use the live rule once if any
  // completed target post covers the selected front.
  const defensivePressure =
    finiteNonnegative(input.targetTroops) *
    (posts > 0 ? Math.max(1, finiteNonnegative(input.defenseBonus)) : 1);
  const incoming = finiteNonnegative(input.incomingTroops);
  const risk =
    committed === 0 ||
    ![
      input.troops,
      input.ratio,
      input.targetTroops,
      input.incomingTroops,
    ].every(Number.isFinite)
      ? "unknown"
      : remaining < incoming ||
          ratio > 0.75 ||
          committed < defensivePressure / 2
        ? "high"
        : committed < defensivePressure || remaining < committed / 2
          ? "caution"
          : "lower";
  return {
    committed,
    remaining,
    percent: Math.round(ratio * 100),
    defensePosts: posts,
    risk,
  };
}

/** Only the visible player update and one local spatial query are read. */
export function forecastVisibleAttack(
  game: GameView,
  my: PlayerView,
  target: PlayerView,
  tile: TileRef,
  ratio: number,
): AttackForecast {
  const config = game.config();
  const posts = game.nearbyUnits(
    tile,
    config.defensePostRange(),
    UnitType.DefensePost,
    ({ unit }) =>
      unit.owner().id() === target.id() &&
      unit.isActive() &&
      !unit.isUnderConstruction(),
  ).length;
  return forecastAttack({
    troops: my.troops(),
    ratio,
    targetTroops: target.troops(),
    defensePosts: posts,
    defenseBonus: config.defensePostDefenseBonus(),
    incomingTroops: my
      .incomingAttacks()
      .filter((attack) => !attack.retreating)
      .reduce((sum, attack) => sum + attack.troops, 0),
  });
}
