import { z } from "zod";
import { Game, Player, PlayerID, UnitType } from "../game/Game";
import { AIProfile, AI_WEIGHTS } from "./AIProfile";

export const MAX_AI_CANDIDATES = 12;
export const MAX_AI_ROUTES = 3;
const compareIDs = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const StrategicStateSchema = z.object({
  goal: z.enum(["expand", "attack", "recover", "defend", "economy", "support"]),
  target: z.string().nullable(),
  reason: z.string(),
  chosenAt: z.number().int(),
  reserve: z.number().int().nonnegative(),
  score: z.number().int(),
  candidateCount: z.number().int().nonnegative(),
  observations: z
    .array(
      z.object({
        id: z.string(),
        tiles: z.number().int(),
        troops: z.number().int(),
      }),
    )
    .max(MAX_AI_CANDIDATES),
});
export type StrategicState = z.infer<typeof StrategicStateSchema>;
export function newStrategicState(): StrategicState {
  return {
    goal: "expand",
    target: null,
    reason: "unclaimed_land",
    chosenAt: 0,
    reserve: 0,
    score: 0,
    candidateCount: 0,
    observations: [],
  };
}

/** Adds every nearby hostile army and active inbound stack; no hidden inputs. */
export function defensiveReserve(
  game: Game,
  player: Player,
  profile: AIProfile,
  ignore?: Player,
): number {
  const weights = AI_WEIGHTS[profile.personality];
  const troops = Math.floor(player.troops());
  let largest = 0;
  let total = 0;
  for (const other of player.nearby()) {
    if (
      !other.isPlayer() ||
      other === ignore ||
      player.isFriendly(other) ||
      !other.isAlive()
    )
      continue;
    const threat = Math.floor(other.troops());
    total += threat;
    largest = Math.max(largest, threat);
  }
  const incoming = player
    .incomingAttacks()
    .reduce((sum, attack) => sum + Math.ceil(attack.troops()), 0);
  const baseline = Math.min(
    Math.floor((game.config().maxTroops(player) * weights.reserve) / 100),
    Math.floor((troops * 35) / 100),
  );
  const fronts = Math.floor(
    (largest * weights.reserve) / 100 + (total - largest) / 12,
  );
  return Math.max(
    baseline,
    Math.min(
      Math.floor((troops * 80) / 100),
      fronts + Math.ceil((incoming * 55) / 100),
    ),
  );
}

export interface StrategicCandidate {
  player: Player;
  score: number;
  land: boolean;
}
export interface StrategicPlan {
  state: StrategicState;
  candidates: StrategicCandidate[];
}

/** O(players + adjacent players), at an AI's existing staggered thought tick.
 * Routes are evaluated by the existing naval behavior for only the top 3.
 * Memory is capped at 12 public observations and a single sticky objective.
 */
export function planStrategy(
  game: Game,
  player: Player,
  profile: AIProfile,
  previous: StrategicState,
  hasExpansion: boolean,
): StrategicPlan {
  const weights = AI_WEIGHTS[profile.personality];
  const reserve = defensiveReserve(game, player, profile);
  const available = Math.max(0, Math.floor(player.troops()) - reserve);
  const nearby = player.nearby();
  const pool = new Map<PlayerID, Player>();
  for (const other of nearby) {
    if (
      other.isPlayer() &&
      other !== player &&
      other.isAlive() &&
      !player.isFriendly(other) &&
      player.canAttackPlayer(other)
    )
      pool.set(other.id(), other);
  }
  // Tribes stay lightweight: no world-wide target search or ship/nuclear modules.
  if (
    profile.controller === "nation" &&
    (pool.size === 0 || profile.personality === "naval")
  ) {
    const ours = player.largestClusterBoundingBox;
    if (ours) {
      const cx = Math.floor((ours.min.x + ours.max.x) / 2);
      const cy = Math.floor((ours.min.y + ours.max.y) / 2);
      const overseas = game
        .players()
        .filter(
          (other) =>
            other !== player &&
            other.isAlive() &&
            !player.isFriendly(other) &&
            player.canAttackPlayer(other) &&
            other.largestClusterBoundingBox,
        )
        .map((other) => {
          const box = other.largestClusterBoundingBox!;
          return {
            other,
            distance:
              Math.abs(cx - Math.floor((box.min.x + box.max.x) / 2)) +
              Math.abs(cy - Math.floor((box.min.y + box.max.y) / 2)),
          };
        })
        .filter(({ distance }) => distance <= 500)
        .sort(
          (a, b) =>
            a.distance - b.distance || compareIDs(a.other.id(), b.other.id()),
        );
      for (const { other } of overseas.slice(0, 4)) pool.set(other.id(), other);
    }
  }
  const candidates = [...pool.values()]
    .sort((a, b) => compareIDs(a.id(), b.id()))
    .slice(0, MAX_AI_CANDIDATES)
    .map((other): StrategicCandidate => {
      const land = player.sharesBorderWith(other);
      const defending = Math.max(1, Math.floor(other.troops()));
      const parity = Math.min(220, Math.floor((available * 100) / defending));
      const gain = Math.min(
        90,
        Math.floor(
          (other.numTilesOwned() * 80) / Math.max(1, player.numTilesOwned()),
        ),
      );
      const old = previous.observations.find(
        (observation) => observation.id === other.id(),
      );
      const growth = old
        ? Math.min(25, Math.max(0, other.numTilesOwned() - old.tiles))
        : 0;
      const facilities = Math.min(
        80,
        other.unitCount(UnitType.City) * 15 +
          other.unitCount(UnitType.Factory) * 15 +
          other.unitCount(UnitType.Port) * 10,
      );
      const defense = Math.min(80, other.unitCount(UnitType.DefensePost) * 20);
      const commitment = player
        .outgoingAttacks()
        .filter((a) => a.target() === other)
        .reduce((sum, a) => sum + Math.floor(a.troops()), 0);
      const frontRisk = Math.min(
        60,
        Math.floor((reserve * 60) / Math.max(1, player.troops())),
      );
      const tradeLoss =
        player.relation(other) > 2 && !player.hasEmbargoAgainst(other) ? 15 : 0;
      const cost =
        Math.max(0, 100 - parity) +
        defense +
        frontRisk +
        tradeLoss +
        (land ? 0 : 50);
      const advantage = Math.floor(
        ((parity +
          gain +
          facilities +
          growth +
          Math.min(40, Math.floor((commitment * 100) / defending))) *
          weights.attack) /
          100,
      );
      const score = Math.floor(
        advantage -
          (cost * 100) / weights.risk +
          (land ? 0 : weights.naval / 4),
      );
      const stalemate =
        profile.controller === "nation" &&
        land &&
        game.ticks() - previous.chosenAt > 400 &&
        player.troops() >= game.config().maxTroops(player) * 0.85;
      return {
        player: other,
        // Nations face equal-rule armies, unlike the classic tribe's attrition
        // bonus. Opening a below-parity offensive wastes the growth advantage;
        // counterattacks and already committed fronts are evaluated separately.
        score:
          available < defending / 4 ||
          (profile.controller === "nation" &&
            commitment === 0 &&
            !stalemate &&
            player.troops() * weights.risk < defending * 110)
            ? -100
            : score + (stalemate ? 60 : 0),
        land,
      };
    })
    .sort(
      (a, b) => b.score - a.score || compareIDs(a.player.id(), b.player.id()),
    );

  const bank = Number(player.gold() / 10000n);
  const economy = Math.floor(
    (weights.economy * (50 + Math.min(70, bank))) / 100,
  );
  const expansion = hasExpansion
    ? weights.expansion + Math.min(60, Math.floor(available / 2000))
    : -100;
  const best = candidates[0];
  let goal: StrategicState["goal"] = "economy";
  let target: string | null = null;
  let reason = "productive_investment";
  let score = economy;
  if (available < Math.max(1000, player.troops() / 10)) {
    goal = player.incomingAttacks().length > 0 ? "defend" : "recover";
    reason = "aggregate_front_threat";
    score = 200;
  } else if (expansion >= score && expansion >= (best?.score ?? -100)) {
    goal = "expand";
    reason = "unclaimed_land";
    score = expansion;
  } else if (best && best.score > score) {
    goal = "attack";
    target = best.player.id();
    reason = best.land
      ? "territory_value_after_costs"
      : "safe_overseas_opportunity";
    score = best.score;
  }
  // Keep an attack for 18s unless its score deteriorates by >40 or it vanishes.
  const held = candidates.find(
    (candidate) => candidate.player.id() === previous.target,
  );
  if (
    goal !== "defend" &&
    goal !== "recover" &&
    previous.goal === "attack" &&
    game.ticks() - previous.chosenAt < 180 &&
    held &&
    held.score > 70 &&
    held.score + 40 >= score
  ) {
    goal = "attack";
    target = held.player.id();
    reason = "continue_committed_front";
    score = held.score;
  }
  return {
    state: {
      goal,
      target,
      reason,
      chosenAt:
        previous.goal === goal && previous.target === target
          ? previous.chosenAt
          : game.ticks(),
      reserve,
      score,
      candidateCount: candidates.length,
      observations: candidates.map(({ player: other }) => ({
        id: other.id(),
        tiles: other.numTilesOwned(),
        troops: Math.floor(other.troops()),
      })),
    },
    candidates,
  };
}
