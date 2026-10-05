import data from "./ModernRegionsData.json";

/** Immutable offline scenario overlay. It never changes modern-world v1 saves. */
export const modernRegions = data;
export const modernFactions = data.factions;
export type ModernFaction = (typeof modernFactions)[number];
export type ModernClimateId =
  | "arid"
  | "tropical"
  | "temperate"
  | "continental"
  | "polar";
export type ModernMajorPort = (typeof data.ports)[number];

const byId = new Map(modernFactions.map((faction) => [faction.id, faction]));
const byPlayer = new Map(
  modernFactions.map((faction) => [modernFactionPlayerId(faction), faction]),
);

export function modernFaction(id: string): ModernFaction {
  const faction = byId.get(id);
  if (!faction) throw new Error(`Unsupported modern faction: ${id}`);
  return faction;
}

export function modernFactionPlayerId(faction: ModernFaction): string {
  return `region${String(faction.index).padStart(4, "0")}`;
}

export function factionForPlayer(id: string): ModernFaction | undefined {
  return byPlayer.get(id);
}

export function factionsForCountry(parentCountryId: string): ModernFaction[] {
  return modernFactions.filter(
    (faction) => faction.parentCountryId === parentCountryId,
  );
}

export function climateIndex(id: ModernClimateId): number {
  return modernRegions.splitPolicy.climateIds.indexOf(id) + 1;
}
