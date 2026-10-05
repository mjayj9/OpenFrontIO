import { Difficulty, PlayerType, UnitType } from "../game/Game";
import type { GameConfig } from "../Schemas";
import { simpleHash } from "../Util";

export const AI_PERSONALITIES = [
  "expansionist",
  "defensive",
  "economic",
  "diplomatic",
  "naval",
] as const;
export type AIPersonality = (typeof AI_PERSONALITIES)[number];

export interface AIProfile {
  enhanced: true;
  controller: "tribe" | "nation";
  personality: AIPersonality;
  difficulty: Difficulty;
  fairResources: boolean;
}

/** Identity never depends on a display name, color, iteration order or clock. */
export function aiProfile(
  config: Pick<GameConfig, "enhancedAI" | "difficulty">,
  id: string,
  type: PlayerType,
): AIProfile | null {
  const settings = config.enhancedAI;
  if (settings === undefined || type === PlayerType.Human) return null;
  const controller = type === PlayerType.Bot ? "tribe" : "nation";
  const percent =
    controller === "tribe" ? settings.tribePercent : settings.nationPercent;
  if ((simpleHash(`${settings.seed}:${id}:controller`) >>> 0) % 100 >= percent)
    return null;
  const personality =
    settings.personality === "mixed"
      ? AI_PERSONALITIES[
          (simpleHash(`${settings.seed}:${id}:personality`) >>> 0) %
            AI_PERSONALITIES.length
        ]
      : settings.personality;
  return {
    enhanced: true,
    controller,
    personality,
    difficulty: config.difficulty,
    fairResources: settings.fairResources,
  };
}

/** Integer percentages; personality and reaction difficulty are independent. */
export const AI_WEIGHTS: Record<
  AIPersonality,
  {
    expansion: number;
    attack: number;
    reserve: number;
    economy: number;
    diplomacy: number;
    naval: number;
    risk: number;
    buildings: readonly UnitType[];
  }
> = {
  expansionist: {
    expansion: 150,
    attack: 135,
    reserve: 20,
    economy: 85,
    diplomacy: 70,
    naval: 85,
    risk: 135,
    buildings: [UnitType.City, UnitType.Port, UnitType.Factory],
  },
  defensive: {
    expansion: 85,
    attack: 90,
    reserve: 35,
    economy: 100,
    diplomacy: 110,
    naval: 85,
    risk: 80,
    buildings: [
      UnitType.SAMLauncher,
      UnitType.City,
      UnitType.Factory,
      UnitType.Port,
    ],
  },
  economic: {
    expansion: 100,
    attack: 105,
    reserve: 25,
    economy: 155,
    diplomacy: 115,
    naval: 100,
    risk: 95,
    buildings: [UnitType.Factory, UnitType.Port, UnitType.City],
  },
  diplomatic: {
    expansion: 100,
    attack: 100,
    reserve: 25,
    economy: 120,
    diplomacy: 155,
    naval: 100,
    risk: 90,
    buildings: [UnitType.Port, UnitType.Factory, UnitType.City],
  },
  naval: {
    expansion: 100,
    attack: 115,
    reserve: 25,
    economy: 115,
    diplomacy: 100,
    naval: 160,
    risk: 110,
    buildings: [UnitType.Port, UnitType.City, UnitType.Factory],
  },
};
