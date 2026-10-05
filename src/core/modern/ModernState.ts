import { z } from "zod";
import { ModernForcesState } from "./ModernForceTypes";
import { MODERN_RULES as R } from "./ModernRules";

export const ClimateSchema = z.enum([
  "arid",
  "tropical",
  "temperate",
  "continental",
  "polar",
]);
export type ClimateId = z.infer<typeof ClimateSchema>;
export type ModernAILevel = "low" | "medium" | "high";
const uint = z.number().int().nonnegative();
const PopulationSchema = z
  .object({
    total: uint,
    civilian: uint,
    available: uint,
    army: uint,
    navy: uint,
    air: uint,
    dead: uint,
  })
  .refine(
    (p) => p.total === p.civilian + p.available + p.army + p.navy + p.air,
    "Population ledger does not balance",
  );
const FactionSchema = z.object({
  playerId: z.string(),
  factionId: z.string(),
  parentCountryId: z.string(),
  ownedAreaUnits: uint.default(0),
  aiLevel: z.enum(["low", "medium", "high"]).nullable(),
  aiRole: z.enum(["world", "invited-slot", "human"]),
  climateAdaptation: z.array(ClimateSchema).max(2),
  climateTraining: z
    .object({ climate: ClimateSchema, completesTick: uint })
    .optional(),
  completedTraining: uint,
  population: PopulationSchema,
  populationTransferredTo: z.string().nullable().default(null),
  nuclearStrikes: z.array(z.object({ launchId: uint, expiresTick: uint })),
  workerIncomePerTick: uint.optional(),
});
export type ModernFactionState = z.infer<typeof FactionSchema>;
const PortSchema = z.object({
  portId: z.string(),
  name: z.string(),
  tile: uint,
  unitId: uint.nullable(),
  ownerId: z.string().nullable(),
  level: uint.max(3),
  damage: uint.max(1000),
  development: z
    .object({ targetLevel: uint.max(3), completesTick: uint })
    .nullable(),
  repairUntilTick: uint.nullable(),
  blockadedBy: z.array(z.string()),
  incomePerSecond: uint,
  lastIncomeTick: uint,
  captureCount: uint,
});
export type ModernPortState = z.infer<typeof PortSchema>;
const CommandSchema = z.object({
  kind: z.enum([
    "move",
    "attack",
    "patrol",
    "escort",
    "blockade",
    "air_superiority",
    "intercept",
    "strike",
    "stop",
    "cancel",
    "wait",
  ]),
  target: uint,
  issuedTick: uint,
  viaTransport: z.boolean().optional(),
  escortUnitId: uint.optional(),
});
const ForceSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  branch: z.enum(["army", "navy", "air"]),
  kind: z.enum(["army", "warship", "fighter", "strike"]),
  tile: uint,
  baseId: z.string().nullable(),
  personnel: uint,
  aircraft: uint,
  unitId: uint.nullable(),
  phase: z.enum([
    "idle",
    "moving",
    "outbound",
    "engaging",
    "returning",
    "rearming",
    "attacking",
    "destroyed",
  ]),
  command: CommandSchema.nullable(),
  queue: z.array(CommandSchema).max(8),
  path: z.array(uint),
  pathIndex: uint,
  cooldownUntil: uint,
  attackId: z.string().nullable(),
  attackTroops: z.number().nonnegative(),
  lastReason: z.string().nullable(),
  movementProgress: uint.default(0),
  completedMissions: uint,
  lastMissionTick: uint,
  casualties: uint,
});
const BaseSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  tile: uint,
  capacity: uint,
  health: uint,
  maxHealth: uint,
});
export const ModernStateSchema = z.object({
  version: z.literal(2),
  tick: uint,
  seed: uint,
  factions: z.array(FactionSchema),
  ports: z.array(PortSchema),
  forces: z.array(ForceSchema),
  bases: z.array(BaseSchema),
  nextForceId: uint,
  samAircraftReloads: z
    .array(z.object({ unitId: uint, nextTick: uint }))
    .optional(),
  aiPlans: z
    .array(
      z.object({
        playerId: z.string(),
        nextThinkTick: uint,
        goal: z.string(),
        target: uint.nullable(),
        operations: uint,
      }),
    )
    .default([]),
});
export interface ModernState extends ModernForcesState {
  version: 2;
  tick: number;
  factions: ModernFactionState[];
  ports: ModernPortState[];
  aiPlans: {
    playerId: string;
    nextThinkTick: number;
    goal: string;
    target: number | null;
    operations: number;
  }[];
}
const factionCache = new WeakMap<
  ModernState,
  Map<string, ModernFactionState>
>();
export function modernFactionState(
  state: ModernState | null,
  playerId: string,
): ModernFactionState | undefined {
  if (!state) return undefined;
  let index = factionCache.get(state);
  if (!index) {
    index = new Map(state.factions.map((f) => [f.playerId, f]));
    factionCache.set(state, index);
  }
  return index.get(playerId);
}
export function nuclearEffects(
  faction: ModernFactionState | undefined,
  tick: number,
) {
  const active =
    faction?.nuclearStrikes.filter((s) => s.expiresTick > tick) ?? [];
  return {
    incomeLossPermille: Math.min(
      R.nuclearIncomeLossCapPermille,
      active.length * R.nuclearIncomeLossPermille,
    ),
    replenishmentLossPermille: Math.min(
      R.nuclearReplenishmentLossCapPermille,
      active.length * R.nuclearReplenishmentLossPermille,
    ),
    expiresTick: Math.max(tick, ...active.map((s) => s.expiresTick)),
    launches: active.length,
  };
}
/** Stable, integer-only state hash covers orders, ledgers, ports and launch responsibility. */
export function modernStateHash(state: ModernState | null): number {
  if (!state) return 0;
  // Snapshot schemas canonicalize object field order. Hashing semantic state
  // must also canonicalize keys; array order remains meaningful simulation state.
  const json = JSON.stringify(state, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
