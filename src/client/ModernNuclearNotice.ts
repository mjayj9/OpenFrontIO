import { UnitType } from "../core/game/Game";
import { MODERN_RULES } from "../core/modern/ModernRules";
import { nuclearEffects } from "../core/modern/ModernState";
import { translateText } from "./Utils";
import type { GameView } from "./view";

export function modernNuclearNotice(
  game: GameView,
  type: string | null,
): string {
  if (
    !game ||
    game.config().gameConfig().modernMode?.scenario !== "modern-regions-v2" ||
    ![UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV].includes(
      type as UnitType,
    )
  )
    return "";
  const faction = game.myPlayer()?.modernFaction();
  const current = nuclearEffects(faction, game.ticks());
  return translateText("modern_v2.nuclear_launch_notice", {
    seconds: MODERN_RULES.nuclearDurationTicks / 10,
    economy:
      Math.min(
        MODERN_RULES.nuclearIncomeLossCapPermille,
        current.incomeLossPermille + MODERN_RULES.nuclearIncomeLossPermille,
      ) / 10,
    replenishment:
      Math.min(
        MODERN_RULES.nuclearReplenishmentLossCapPermille,
        current.replenishmentLossPermille +
          MODERN_RULES.nuclearReplenishmentLossPermille,
      ) / 10,
    trust: MODERN_RULES.nuclearTrustLoss,
  });
}
