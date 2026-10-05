import { Game, PlayerID } from "../game/Game";
import { TileRef } from "../game/GameMap";

export type ModernBranch = "army" | "navy" | "air";
export type ModernForceKind = "army" | "warship" | "fighter" | "strike";
export const MODERN_FORCE_PHASES = [
  "idle",
  "moving",
  "outbound",
  "engaging",
  "returning",
  "rearming",
  "attacking",
  "destroyed",
] as const;
export const MODERN_FORCE_FRAME_STRIDE = 9;
export type ModernCommandKind =
  | "move"
  | "attack"
  | "patrol"
  | "escort"
  | "blockade"
  | "air_superiority"
  | "intercept"
  | "strike"
  | "stop"
  | "cancel"
  | "wait";
export interface ModernForceCommand {
  kind: ModernCommandKind;
  target: TileRef;
  issuedTick: number;
  viaTransport?: boolean;
  escortUnitId?: number;
  /** Core-validated route at queue time; activation always revalidates it. */
  previewPath?: TileRef[];
}
export interface ModernForceState {
  id: string;
  playerId: PlayerID;
  branch: ModernBranch;
  kind: ModernForceKind;
  tile: TileRef;
  baseId: string | null;
  personnel: number;
  aircraft: number;
  unitId: number | null;
  phase:
    | "idle"
    | "moving"
    | "outbound"
    | "engaging"
    | "returning"
    | "rearming"
    | "attacking"
    | "destroyed";
  command: ModernForceCommand | null;
  queue: ModernForceCommand[];
  path: TileRef[];
  pathIndex: number;
  cooldownUntil: number;
  attackId: string | null;
  attackTroops: number;
  lastReason: string | null;
  completedMissions: number;
  lastMissionTick: number;
  casualties: number;
  movementProgress: number;
}
export interface ModernBaseState {
  id: string;
  playerId: PlayerID;
  tile: TileRef;
  capacity: number;
  health: number;
  maxHealth: number;
  /** Older v2 bases were all airfields. Missing fields retain that meaning. */
  branch?: ModernBranch;
  completesTick?: number;
  repairUntilTick?: number | null;
  /** Naval bases are a role of the existing Port, never a second unit. */
  unitId?: number | null;
  constructionCounted?: boolean;
}
export interface ModernProductionState {
  id: string;
  playerId: PlayerID;
  branch: ModernBranch;
  kind: ModernForceKind;
  baseId: string;
  tile: TileRef;
  count: number;
  personnel: number;
  costGold: string;
  completesTick: number;
  source: "army_reserve" | "available";
  unitId?: number | null;
}
/** Plain JSON state: no transient path finder or native Unit reference. */
export interface ModernForcesState {
  version?: 2 | 3;
  forces: ModernForceState[];
  bases: ModernBaseState[];
  nextForceId: number;
  seed: number;
  samAircraftReloads?: { unitId: number; nextTick: number }[];
  production?: ModernProductionState[];
  completedProduction?: {
    playerId: PlayerID;
    kind: ModernForceKind | "armybase" | "navybase" | "airbase";
    count: number;
  }[];
}
export interface ModernForceHooks {
  reserve(playerId: PlayerID, branch: ModernBranch, personnel: number): boolean;
  release(playerId: PlayerID, branch: ModernBranch, personnel: number): void;
  casualties(playerId: PlayerID, branch: ModernBranch, personnel: number): void;
  mobilize?(playerId: PlayerID, personnel: number): boolean;
  demobilize?(playerId: PlayerID, personnel: number): void;
  reassignArmy?(
    playerId: PlayerID,
    branch: "navy" | "air",
    personnel: number,
  ): boolean;
  restoreArmy?(
    playerId: PlayerID,
    branch: "navy" | "air",
    personnel: number,
  ): void;
  climateEfficiency?(playerId: PlayerID, tile: TileRef): number;
  climateMovementEfficiency?(playerId: PlayerID, tile: TileRef): number;
  portStrike?(tile: TileRef, damage: number, attacker: PlayerID): void;
}
export interface ModernForceRules {
  personnelPerAircraft: number;
  armyPersonnelPerGroup: number;
  navyPersonnelPerWarship: number;
  maxForcesPerFaction: number;
  maxBasesPerFaction: number;
  queueLimit: number;
  landPathBudget: number;
  armyMoveTicks: number;
  airMoveTilesPerTick: number;
  airRangeTiles: number;
  airMissionTicks: number;
  airRearmTicks: number;
  airUpkeepPeriodTicks: number;
  airUpkeepPerAircraft: number;
  fighterCost: number;
  strikeCost: number;
  warshipCost: number;
  airbaseCost: number;
  airbaseCapacity: number;
  airbaseHealth: number;
  armybaseCost: number;
  armybaseCapacity: number;
  armybaseBuildTicks: number;
  airbaseBuildTicks: number;
  navybaseBuildTicks: number;
  navybaseCapacity: number;
  baseRepairCost: number;
  baseRepairTicks: number;
  armyTrainingCost: number;
  armyTrainingTicks: number;
  warshipProductionTicks: number;
  aircraftProductionTicks: number;
  aircraftProductionTicksPerAircraft: number;
  strikeDamageRawTroops: number;
  strikeStructureDamage: number;
  fighterHitPermille: number;
  samAircraftHitPermille: number;
  samAircraftRange: number;
  samAircraftCost: number;
  samAircraftReloadTicks: number;
}
/** Costs are game gold, durations are ticks (10 ticks = one game second). */
export const DEFAULT_MODERN_FORCE_RULES: ModernForceRules = {
  personnelPerAircraft: 100,
  armyPersonnelPerGroup: 1000,
  navyPersonnelPerWarship: 100,
  maxForcesPerFaction: 24,
  maxBasesPerFaction: 8,
  queueLimit: 8,
  landPathBudget: 4096,
  armyMoveTicks: 4,
  airMoveTilesPerTick: 6,
  airRangeTiles: 180,
  airMissionTicks: 30,
  airRearmTicks: 120,
  airUpkeepPeriodTicks: 100,
  airUpkeepPerAircraft: 25,
  fighterCost: 5000,
  strikeCost: 7000,
  warshipCost: 12000,
  airbaseCost: 30000,
  airbaseCapacity: 24,
  airbaseHealth: 1000,
  armybaseCost: 20000,
  armybaseCapacity: 8000,
  armybaseBuildTicks: 200,
  airbaseBuildTicks: 300,
  navybaseBuildTicks: 50,
  navybaseCapacity: 4,
  baseRepairCost: 10000,
  baseRepairTicks: 150,
  armyTrainingCost: 2500,
  armyTrainingTicks: 100,
  warshipProductionTicks: 250,
  aircraftProductionTicks: 120,
  aircraftProductionTicksPerAircraft: 30,
  strikeDamageRawTroops: 200,
  strikeStructureDamage: 30,
  fighterHitPermille: 120,
  samAircraftHitPermille: 180,
  samAircraftRange: 24,
  samAircraftCost: 100,
  samAircraftReloadTicks: 30,
};
export interface ModernCommandPreview {
  valid: boolean;
  reason: string | null;
  path: TileRef[];
  etaTicks: number;
  rangeTiles: number;
  risk: "low" | "uncertain" | "high";
  climateEfficiencyPermille: number;
  usesTransport?: boolean;
  transportPath?: TileRef[];
  /** One-tile estimate from the actual shared combat rule, not a victory promise. */
  armyCombat?: {
    attackerLossRaw: number;
    defenderLossRaw: number;
    tickFractionPermille: number;
    defenderClimatePermille: number;
    climateRatioPermille: number;
  };
}
export function modernForceOwner(game: Game, force: ModernForceState) {
  return game.player(force.playerId);
}
