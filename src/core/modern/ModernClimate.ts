import { Game } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { modernRegions } from "../game/ModernRegions";
import { MODERN_RULES } from "./ModernRules";
import {
  ClimateId,
  ModernFactionState,
  modernFactionState,
} from "./ModernState";

const climates: ClimateId[] = [
  "arid",
  "tropical",
  "temperate",
  "continental",
  "polar",
];
let climateIndex: Uint8Array | undefined;
export function climateAt(tile: TileRef): ClimateId {
  if (!climateIndex) {
    climateIndex = new Uint8Array(modernRegions.width * modernRegions.height);
    for (const [index, start, count] of modernRegions.climateRuns)
      climateIndex.fill(index, start, start + count);
  }
  return climates[(climateIndex[tile] || 3) - 1] ?? "temperate";
}
export function climateCombatEfficiency(
  faction: ModernFactionState | undefined,
  tile: TileRef,
): number {
  if (!faction) return 1000;
  const climate = climateAt(tile);
  return faction.climateAdaptation.includes(climate)
    ? MODERN_RULES.climateAdaptedPermille
    : climate === "temperate"
      ? 1000
      : MODERN_RULES.climateHarshPermille;
}
export function climateMovementEfficiency(
  faction: ModernFactionState | undefined,
  tile: TileRef,
): number {
  return !faction ||
    faction.climateAdaptation.includes(climateAt(tile)) ||
    climateAt(tile) === "temperate"
    ? 1000
    : MODERN_RULES.climateMovementPermille;
}
export function climateCombatInput(
  game: Game,
  attacker: string,
  defender: string | undefined,
  tile: TileRef,
) {
  if (!game.modernSystems()) return undefined;
  const a = modernFactionState(game.modernSystems(), attacker);
  const d = defender
    ? modernFactionState(game.modernSystems(), defender)
    : undefined;
  return {
    attackerPermille: climateCombatEfficiency(a, tile),
    defenderPermille: climateCombatEfficiency(d, tile),
    movementPermille: climateMovementEfficiency(a, tile),
  };
}
