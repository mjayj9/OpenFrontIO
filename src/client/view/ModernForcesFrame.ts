import type { ModernForceRouteUpdate } from "../../core/game/GameUpdates";
import { MODERN_FORCE_PHASES } from "../../core/modern/ModernForceTypes";
import type { ModernState } from "../../core/modern/ModernState";

/** Copy only changed forces: previous replay frames and worker baselines are
 * immutable. Unknown indices wait for the next full baseline. */
export function applyModernForcesFrame(
  state: ModernState | null,
  frame: {
    tick: number;
    positions: ArrayLike<number>;
    routes?: ModernForceRouteUpdate[];
  },
  latestTick: number,
  mapTiles = 0xffffffff,
): ModernState | null {
  if (!state || frame.tick <= latestTick) return state;
  let forces: ModernState["forces"] | null = null;
  for (const route of frame.routes ?? []) {
    const previous = state.forces[route.index];
    if (!previous) continue;
    forces ??= state.forces.slice();
    forces[route.index] = {
      ...previous,
      command: route.command,
      queue: route.queue,
      path: route.path,
      cooldownUntil: route.cooldownUntil,
      lastReason: route.lastReason,
    };
  }
  const positions = frame.positions;
  for (let offset = 0; offset + 8 < positions.length; offset += 9) {
    const index = positions[offset],
      tile = positions[offset + 1];
    const previous = (forces ?? state.forces)[index];
    const phase = MODERN_FORCE_PHASES[positions[offset + 2]];
    if (!previous || !phase || !Number.isInteger(tile) || tile >= mapTiles)
      continue;
    forces ??= state.forces.slice();
    const next = {
      ...previous,
      tile: tile as typeof previous.tile,
      phase,
      pathIndex: positions[offset + 3],
      personnel: positions[offset + 4],
      aircraft: positions[offset + 5],
      attackTroops: positions[offset + 6],
      lastMissionTick: positions[offset + 8],
    };
    if (phase === "idle" || phase === "destroyed") {
      next.command = null;
      next.path = [];
      next.pathIndex = 0;
      if (phase === "destroyed") next.queue = [];
    } else if (phase === "attacking" && positions[offset + 7] !== 0xffffffff) {
      next.path = [next.tile, positions[offset + 7] as typeof next.tile];
      next.pathIndex = 0;
    }
    forces[index] = next;
  }
  return forces ? { ...state, forces } : state;
}
