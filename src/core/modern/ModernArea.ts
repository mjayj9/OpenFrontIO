import { modernFactions, modernRegions } from "../game/ModernRegions";
import { ModernState, modernFactionState } from "./ModernState";

let weights: Uint32Array | undefined;
/** Geodesic region area distributed over its valid raster tiles. Unit: 0.001 km².
 * This is a conserved scenario scoring weight, never a population/income factor. */
export function modernAreaWeight(tile: number): number {
  if (!weights) {
    weights = new Uint32Array(modernRegions.width * modernRegions.height);
    const remaining = modernFactions.map(
      (f) => Math.round(f.areaKm2 * 1000) % f.tiles,
    );
    const base = modernFactions.map((f) =>
      Math.floor(Math.round(f.areaKm2 * 1000) / f.tiles),
    );
    for (const [index, start, count] of modernRegions.runs) {
      const i = index - 1;
      weights.fill(base[i], start, start + count);
      const extra = Math.min(remaining[i], count);
      for (let t = start; t < start + extra; t++) weights[t]++;
      remaining[i] -= extra;
    }
  }
  return weights[tile] ?? 0;
}
export function transferModernArea(
  state: ModernState | null,
  tile: number,
  from: string | null,
  to: string | null,
): void {
  if (!state || from === to) return;
  const area = modernAreaWeight(tile);
  const source = from ? modernFactionState(state, from) : undefined,
    target = to ? modernFactionState(state, to) : undefined;
  if (source) source.ownedAreaUnits = Math.max(0, source.ownedAreaUnits - area);
  if (target) target.ownedAreaUnits += area;
}
