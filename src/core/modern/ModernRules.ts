import { GameConfig } from "../Schemas";
import { DEFAULT_MODERN_FORCE_RULES } from "./ModernForceTypes";

/** Game units, people and gold; 10 ticks = one game second. No real GDP/army estimates. */
export const MODERN_RULES = {
  version: 2,
  initialPopulation: 1_000_000,
  initialArmyPermille: 18,
  initialAvailablePermille: 12,
  initialGold: 400_000,
  mobilizationPermille: 100,
  availableCapPermille: 50,
  civilianTrainingPerTick: 4,
  replenishmentPerTick: 2,
  rawTroopsPerPerson: 10,
  workerGoldPerTick: 100,
  cityIncomePerExtraLevel: 10,
  factoryIncomePerExtraLevel: 20,
  industryIncomeCapPerTick: 200,
  civilianTrainingCapPerTick: 8,
  trainingGoldPerPerson: 2,
  climateAdaptedPermille: 1100,
  climateHarshPermille: 900,
  climateMovementPermille: 950,
  climateRatioMinPermille: 850,
  climateRatioMaxPermille: 1150,
  climateTrainingGold: 50_000,
  climateTrainingTicks: 600,
  nuclearDurationTicks: 1800,
  nuclearIncomeLossPermille: 150,
  nuclearIncomeLossCapPermille: 450,
  nuclearReplenishmentLossPermille: 100,
  nuclearReplenishmentLossCapPermille: 300,
  nuclearTrustLoss: 20,
  portBaseIncomePerSecond: 200,
  portLevelEfficiencyPermille: [0, 1000, 2000, 4000],
  portDevelopmentGold: [75_000, 150_000, 300_000],
  portDevelopmentTicks: [200, 400, 600],
  portRepairGold: 25_000,
  portRepairTicks: 200,
  portBlockadeRange: 24,
  forces: DEFAULT_MODERN_FORCE_RULES,
} as const;

export function isModernV2(config: GameConfig): boolean {
  return config.modernMode?.scenario === "modern-regions-v2";
}
