import { GameType } from "../game/Game";
import { modernFactionPlayerId, modernFactions } from "../game/ModernRegions";
import { GameStartInfo } from "../Schemas";
import { simpleHash } from "../Util";
import { ModernAILevel } from "./ModernState";

export function assignModernLevel(
  seed: number,
  id: string,
  weights = { low: 1, medium: 1, high: 1 },
): ModernAILevel {
  const total = weights.low + weights.medium + weights.high;
  if (total === 0) throw new Error("AI difficulty weights cannot all be zero");
  const roll = (simpleHash(`${seed}:${id}:ai-level`) >>> 0) % total;
  return roll < weights.low
    ? "low"
    : roll < weights.low + weights.medium
      ? "medium"
      : "high";
}
/** Final reservations are materialized once by the room server and archived.
 * World controllers also fill invite slots: they never create a second faction. */
export function modernAssignmentsFor(
  start: GameStartInfo,
): NonNullable<GameStartInfo["modernAssignments"]> {
  const mode = start.config.modernMode!;
  const humans = new Map(
    start.players.map((p) => [
      p.countryId ??
        (start.config.gameType === GameType.Singleplayer ? mode.countryId : ""),
      p,
    ]),
  );
  let fill =
    start.config.gameType !== GameType.Singleplayer && mode.fillEmptySlots
      ? Math.max(
          0,
          (mode.participantSlots ?? start.players.length) -
            start.players.length,
        )
      : 0;
  return modernFactions.map((f) => {
    const human = humans.get(f.id),
      role = human ? "human" : fill > 0 ? "invited-slot" : "world";
    if (role === "invited-slot") fill--;
    return {
      factionId: f.id,
      playerId: modernFactionPlayerId(f),
      clientID: human?.clientID ?? null,
      aiRole: role,
      aiLevel: human
        ? null
        : assignModernLevel(
            start.config.enhancedAI?.seed ?? 0,
            f.id,
            mode.aiLevelWeights,
          ),
    };
  });
}
export function validateModernAssignments(start: GameStartInfo): void {
  if (!start.modernAssignments) return;
  const expected = modernAssignmentsFor(start);
  if (JSON.stringify(start.modernAssignments) !== JSON.stringify(expected)) {
    // Schema key order may differ across binary or JSON carriers.
    if (
      start.modernAssignments.length !== expected.length ||
      expected.some((a, i) => {
        const b = start.modernAssignments![i];
        return (
          !b ||
          a.factionId !== b.factionId ||
          a.playerId !== b.playerId ||
          a.clientID !== b.clientID ||
          a.aiLevel !== b.aiLevel ||
          a.aiRole !== b.aiRole
        );
      })
    )
      throw new Error(
        "Modern authoritative assignment differs from final reservations",
      );
  }
}
