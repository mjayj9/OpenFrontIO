import { AI_PERSONALITIES, AI_WEIGHTS, aiProfile } from "../ai/AIProfile";
import { AllianceRequestExecution } from "../execution/alliance/AllianceRequestExecution";
import { ConstructionExecution } from "../execution/ConstructionExecution";
import { UpgradeStructureExecution } from "../execution/UpgradeStructureExecution";
import { Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { simpleHash } from "../Util";
import { ModernForces, forcePreview } from "./ModernForces";
import { ModernForceState } from "./ModernForceTypes";
import {
  ClimateId,
  ModernAILevel,
  ModernFactionState,
  ModernState,
} from "./ModernState";

export interface ModernAIHooks {
  developPort(
    playerId: string,
    portId: string,
    action: "develop" | "repair",
  ): boolean;
  trainClimate?(playerId: string, climate: ClimateId): boolean;
  climateAt?(tile: TileRef): ClimateId;
  climateEfficiency?(playerId: string, tile: TileRef): number;
}
export const MODERN_AI_LEVELS: Record<
  ModernAILevel,
  { thinkTicks: number; operations: number; borderCandidates: number }
> = {
  low: { thinkTicks: 80, operations: 1, borderCandidates: 4 },
  medium: { thinkTicks: 40, operations: 2, borderCandidates: 8 },
  high: { thinkTicks: 20, operations: 4, borderCandidates: 12 },
};

/** The level is assigned to a faction once; it never reads global difficulty. */
export class ModernAI {
  private plans = new Map<string, ModernState["aiPlans"][number]>();
  private portOwners = new Map<string, ModernState["ports"]>();
  constructor(
    private game: Game,
    readonly state: ModernState,
    private forces: ModernForces,
    private hooks: ModernAIHooks,
  ) {
    state.aiPlans ??= [];
  }
  tick(tick = this.game.ticks()): void {
    const training = this.game.config().gameConfig().modernMode?.trainingLesson;
    if (training && training !== "air") return;
    if (this.plans.size !== this.state.aiPlans.length) {
      this.plans.clear();
      for (const plan of this.state.aiPlans)
        this.plans.set(plan.playerId, plan);
    }
    let forcesByOwner: Map<string, ModernForceState[]> | null = null;
    for (const faction of this.state.factions) {
      if (!faction.aiLevel || !this.game.hasPlayer(faction.playerId)) continue;
      const owner = this.game.player(faction.playerId);
      if (!owner.isAlive()) continue;
      const level = MODERN_AI_LEVELS[faction.aiLevel];
      let plan = this.plans.get(faction.playerId);
      if (!plan) {
        plan = {
          playerId: faction.playerId,
          nextThinkTick:
            (simpleHash(`${this.state.seed}:${faction.factionId}:thinking`) >>>
              0) %
            level.thinkTicks,
          goal: "recover",
          target: null,
          operations: 0,
        };
        this.state.aiPlans!.push(plan);
        this.plans.set(faction.playerId, plan);
      }
      if (tick < plan.nextThinkTick) continue;
      if (forcesByOwner === null) {
        forcesByOwner = new Map();
        for (const force of this.state.forces) {
          if (force.phase === "destroyed") continue;
          const list = forcesByOwner.get(force.playerId) ?? [];
          list.push(force);
          forcesByOwner.set(force.playerId, list);
        }
        this.portOwners.clear();
        for (const port of this.state.ports) {
          if (!port.ownerId) continue;
          const list = this.portOwners.get(port.ownerId) ?? [];
          list.push(port);
          this.portOwners.set(port.ownerId, list);
        }
      }
      plan.nextThinkTick = tick + level.thinkTicks;
      const personality =
        aiProfile(this.game.config().gameConfig(), owner.id(), owner.type())
          ?.personality ??
        AI_PERSONALITIES[
          (simpleHash(`${this.state.seed}:${faction.factionId}:personality`) >>>
            0) %
            AI_PERSONALITIES.length
        ];
      const weights = AI_WEIGHTS[personality];
      const own = forcesByOwner.get(faction.playerId) ?? [];
      let operations = own.filter(
        (f) => !["idle", "rearming"].includes(f.phase),
      ).length;
      plan.operations = operations;
      if (training === "air") {
        const fighter = own.find(
          (f) => f.kind === "fighter" && f.phase === "idle",
        );
        const incoming = this.state.forces.find(
          (f) =>
            f.playerId !== owner.id() &&
            f.branch === "air" &&
            ["outbound", "engaging"].includes(f.phase) &&
            !owner.isFriendly(this.game.player(f.playerId)),
        );
        if (fighter && incoming)
          this.forces.command(
            owner.id(),
            [fighter.id],
            "intercept",
            incoming.tile,
          );
        continue;
      }
      // Decisions inspect only public forces/territory/resources and pending
      // alliance requests, never another controller's private queued input.
      const incomingRaw = owner
        .incomingAttacks()
        .reduce((n, a) => n + Math.floor(a.troops()), 0);
      const reserve = Math.max(
        10000,
        Math.floor((owner.troops() * weights.reserve) / 100) + incomingRaw,
      );
      for (const request of owner.incomingAllianceRequests().slice(0, 2)) {
        const other = request.requestor();
        if (
          owner.outgoingAttacks().some((a) => a.target() === other) ||
          other.outgoingAttacks().some((a) => a.target() === owner) ||
          other.isTraitor()
        )
          request.reject();
        else if (weights.diplomacy >= 100 || incomingRaw > owner.troops() / 3)
          request.accept();
        else request.reject();
      }
      const protectedStart = owner.isImmune();
      if (!protectedStart && operations < level.operations) {
        const idle = own.find(
          (f) =>
            f.branch === "army" && f.phase === "idle" && f.personnel >= 100,
        );
        if (idle) {
          const target = this.landTarget(
            owner,
            idle,
            level.borderCandidates,
            faction,
            weights.attack,
          );
          if (
            target !== null &&
            this.forces.command(owner.id(), [idle.id], "attack", target)[0]
              .reason === null
          ) {
            plan.goal = "attack";
            plan.target = target;
            operations++;
          }
        }
        const air = own.find(
          (f) =>
            f.kind === "strike" &&
            f.phase === "idle" &&
            f.cooldownUntil <= tick,
        );
        if (air && faction.aiLevel !== "low" && operations < level.operations) {
          const target = this.airTarget(owner, air);
          if (
            target !== null &&
            this.forces.command(owner.id(), [air.id], "strike", target)[0]
              .reason === null
          ) {
            plan.goal = "air_support";
            plan.target = target;
            operations++;
          }
        }
        const fighter = own.find(
          (f) =>
            f.kind === "fighter" &&
            f.phase === "idle" &&
            f.cooldownUntil <= tick,
        );
        if (
          fighter &&
          faction.aiLevel !== "low" &&
          operations < level.operations
        ) {
          const airThreat = this.state.forces
            .filter(
              (f) =>
                f.branch === "air" &&
                f.playerId !== owner.id() &&
                ["outbound", "engaging"].includes(f.phase) &&
                !owner.isFriendly(this.game.player(f.playerId)),
            )
            .slice(0, 16)
            .find(
              (f) =>
                forcePreview(
                  this.game,
                  this.state,
                  fighter,
                  f.tile,
                  "intercept",
                  this.forces.rules,
                ).valid,
            );
          if (airThreat) {
            this.forces.command(
              owner.id(),
              [fighter.id],
              "intercept",
              airThreat.tile,
            );
            plan.goal = "air_defense";
            plan.target = airThreat.tile;
            operations++;
          }
        }
        const navy = own.find((f) => f.branch === "navy" && f.phase === "idle");
        if (
          navy &&
          faction.aiLevel === "high" &&
          operations < level.operations
        ) {
          const convoy = owner
            .units(UnitType.TransportShip)
            .filter((u) => u.isActive())
            .slice(0, 4)
            .find(
              (u) =>
                forcePreview(
                  this.game,
                  this.state,
                  navy,
                  u.tile(),
                  "escort",
                  this.forces.rules,
                ).valid,
            );
          if (convoy) {
            this.forces.command(owner.id(), [navy.id], "escort", convoy.tile());
            plan.goal = "transport_escort";
            plan.target = convoy.tile();
            operations++;
          } else {
            const target = this.state.ports
              .filter(
                (p) =>
                  p.ownerId &&
                  p.ownerId !== owner.id() &&
                  !owner.isFriendly(this.game.player(p.ownerId)),
              )
              .slice(0, 16)
              .find(
                (p) =>
                  forcePreview(
                    this.game,
                    this.state,
                    navy,
                    p.tile,
                    "blockade",
                    this.forces.rules,
                  ).valid,
              );
            if (target) {
              this.forces.command(
                owner.id(),
                [navy.id],
                "blockade",
                target.tile,
              );
              plan.goal = "blockade";
              plan.target = target.tile;
              operations++;
            }
          }
        }
      }
      if (
        operations < level.operations &&
        owner.troops() > reserve + 10000 &&
        own.filter((f) => f.branch === "army").length < level.operations + 1
      ) {
        const tile = this.operatingTile(owner);
        if (tile !== undefined)
          this.forces.produce(
            owner.id(),
            "army",
            "army",
            undefined,
            tile,
            faction.aiLevel === "high" ? 3 : 2,
          );
      }
      if (incomingRaw > owner.troops() / 2) {
        plan.goal = "defense";
        this.invest(owner, UnitType.DefensePost, this.operatingTile(owner));
      } else if (this.economy(owner, faction, weights.economy)) {
        if (operations === 0) plan.goal = "economy";
      }
      if (
        faction.aiLevel !== "low" &&
        weights.diplomacy >= 100 &&
        owner.alliances().length < 2 &&
        tick % 200 < level.thinkTicks
      ) {
        const partner = owner
          .nearby()
          .filter(
            (p): p is Player =>
              p.isPlayer() &&
              !p.isTraitor() &&
              !owner.outgoingAttacks().some((a) => a.target() === p) &&
              owner.canSendAllianceRequest(p),
          )
          .slice(0, 8)
          .sort((a, b) => (a.id() < b.id() ? -1 : 1))[0];
        if (partner)
          this.game.addExecution(
            new AllianceRequestExecution(owner, partner.id()),
          );
      }
      if (
        faction.aiLevel === "high" &&
        own.filter((f) => f.branch === "navy").length < 2 &&
        owner.gold() >
          this.game.unitInfo(UnitType.Warship).cost(this.game, owner) + 100000n
      ) {
        const port = owner
          .units(UnitType.Port)
          .find((p) => p.isActive() && !p.isUnderConstruction());
        if (port)
          this.forces.produce(
            owner.id(),
            "navy",
            "warship",
            undefined,
            port.tile(),
            1,
          );
      }
      let base = this.ownedBase(owner);
      if (!base && faction.aiLevel !== "low" && owner.gold() > 100000n) {
        const tile = this.operatingTile(owner);
        if (tile !== undefined) {
          this.forces.produce(owner.id(), "air", "airbase", undefined, tile, 1);
          base = this.ownedBase(owner);
        }
      }
      if (
        base &&
        faction.aiLevel !== "low" &&
        own
          .filter((f) => f.kind === "strike")
          .reduce((n, f) => n + f.aircraft, 0) < 4 &&
        owner.gold() > 100000n
      )
        this.forces.produce(owner.id(), "air", "strike", base.id, undefined, 2);
      if (
        faction.aiLevel === "high" &&
        tick % 600 < level.thinkTicks &&
        !protectedStart
      )
        this.nuclear(owner, faction);
      plan.operations = operations;
    }
  }

  private ownedBase(owner: Player) {
    return this.state.bases.find(
      (b) =>
        b.playerId === owner.id() &&
        b.health > 0 &&
        this.game.owner(b.tile) === owner,
    );
  }

  private operatingTile(owner: Player): TileRef | undefined {
    const base = this.ownedBase(owner);
    if (base) return base.tile;
    const valid = (tile: TileRef) =>
      this.game.owner(tile) === owner &&
      this.game.isLand(tile) &&
      !this.game.isImpassable(tile);
    for (const unit of owner
      .units(UnitType.City, UnitType.Factory, UnitType.Port)
      .slice(0, 8))
      if (unit.isActive() && valid(unit.tile())) return unit.tile();
    const spawn = owner.spawnTile();
    if (spawn !== undefined && valid(spawn)) return spawn;
    let scanned = 0;
    for (const tile of owner.borderTiles()) {
      if (scanned++ >= 64) break;
      if (valid(tile)) return tile;
    }
    return undefined;
  }

  private landTarget(
    owner: Player,
    force: ModernForceState,
    limit: number,
    faction: ModernFactionState,
    attackWeight: number,
  ): TileRef | null {
    const candidates: { tile: TileRef; score: number }[] = [];
    let scanned = 0;
    for (const border of owner.borderTiles()) {
      if (scanned++ >= 512) break;
      for (const next of this.game.neighbors(border)) {
        const other = this.game.owner(next);
        if (
          other === owner ||
          !other.isPlayer() ||
          !owner.canAttackPlayer(other) ||
          !this.game.isLand(next) ||
          this.game.isImpassable(next)
        )
          continue;
        const distance = this.game.manhattanDist(force.tile, next);
        const climate =
          faction.aiLevel === "low"
            ? 1000
            : (this.hooks.climateEfficiency?.(owner.id(), next) ?? 1000);
        const portBonus = (this.portOwners.get(other.id()) ?? []).some(
          (p) => this.game.manhattanDist(p.tile, next) < 30,
        )
          ? 400
          : 0;
        const threat = Math.floor(
          other.troops() / Math.max(1, other.numTilesOwned()),
        );
        const score =
          Math.floor((attackWeight * climate) / 100) -
          distance * 8 -
          threat +
          portBonus;
        if (!candidates.some((c) => c.tile === next))
          candidates.push({ tile: next, score });
        candidates.sort((a, b) => b.score - a.score || a.tile - b.tile);
        if (candidates.length > limit) candidates.pop();
      }
    }
    for (const candidate of candidates.slice(0, 3))
      if (
        forcePreview(
          this.game,
          this.state,
          force,
          candidate.tile,
          "attack",
          this.forces.rules,
        ).valid
      )
        return candidate.tile;
    // Islands have no adjacent enemy land. Reuse the real transport path for
    // a bounded set of public coastal economic targets instead of idling.
    if (!this.game.config().isUnitDisabled(UnitType.TransportShip)) {
      const landings = this.state.ports
        .filter(
          (port) =>
            port.ownerId &&
            port.ownerId !== owner.id() &&
            owner.canAttackPlayer(this.game.player(port.ownerId)) &&
            this.game.isShoreline(port.tile),
        )
        .map((port) => ({
          port,
          score:
            this.game.manhattanDist(force.tile, port.tile) -
            Math.floor(port.incomePerSecond / 20),
        }))
        .sort((a, b) => a.score - b.score || a.port.tile - b.port.tile)
        .slice(0, 16)
        .map(({ port, score }) => ({
          port,
          score:
            score +
            this.game
              .nearbyUnits(port.tile, 24, UnitType.Warship)
              .filter(({ unit }) => !owner.isFriendly(unit.owner()))
              .slice(0, 4).length *
              50,
        }))
        .sort((a, b) => a.score - b.score || a.port.tile - b.port.tile);
      for (const { port } of landings.slice(
        0,
        faction.aiLevel === "high" ? 2 : 1,
      )) {
        const preview = forcePreview(
          this.game,
          this.state,
          force,
          port.tile,
          "attack",
          this.forces.rules,
        );
        if (preview.valid && preview.usesTransport) return port.tile;
      }
    }
    return null;
  }
  private airTarget(owner: Player, force: ModernForceState): TileRef | null {
    const targets = this.state.ports
      .filter(
        (p) =>
          p.ownerId &&
          p.ownerId !== owner.id() &&
          owner.canAttackPlayer(this.game.player(p.ownerId)),
      )
      .map((p) => ({
        tile: p.tile,
        score:
          p.incomePerSecond +
          1000 -
          this.game.manhattanDist(force.tile, p.tile),
      }));
    for (const p of owner.nearby().slice(0, 12))
      if (
        p.isPlayer() &&
        owner.canAttackPlayer(p) &&
        p.spawnTile() !== undefined
      )
        targets.push({
          tile: p.spawnTile()!,
          score: 500 - this.game.manhattanDist(force.tile, p.spawnTile()!),
        });
    targets.sort((a, b) => b.score - a.score || a.tile - b.tile);
    for (const target of targets.slice(0, 4))
      if (
        forcePreview(
          this.game,
          this.state,
          force,
          target.tile,
          "strike",
          this.forces.rules,
        ).valid
      )
        return target.tile;
    return null;
  }
  private economy(
    owner: Player,
    faction: ModernFactionState,
    weight: number,
  ): boolean {
    const ports = (this.portOwners.get(owner.id()) ?? []).slice(0, 4);
    for (const port of ports) {
      if (
        port.damage > 0 &&
        this.hooks.developPort(owner.id(), port.portId, "repair")
      )
        return true;
      if (
        port.level < 3 &&
        !port.development &&
        owner.gold() > BigInt((100000 * weight) / 100) &&
        this.hooks.developPort(owner.id(), port.portId, "develop")
      )
        return true;
    }
    const types =
      weight >= 130
        ? [UnitType.Factory, UnitType.City]
        : [UnitType.City, UnitType.Factory];
    for (const type of types) {
      const unit = owner
        .units(type)
        .find((u) => u.isActive() && !u.isUnderConstruction() && u.level() < 3);
      if (
        unit &&
        owner.canUpgradeUnit(unit) &&
        owner.gold() > 200000n &&
        owner.gold() > this.game.unitInfo(type).cost(this.game, owner) + 50000n
      ) {
        this.game.addExecution(new UpgradeStructureExecution(owner, unit.id()));
        return true;
      }
      if (!unit && this.invest(owner, type, this.operatingTile(owner)))
        return true;
    }
    if (
      faction.aiLevel === "high" &&
      this.hooks.trainClimate &&
      this.hooks.climateAt &&
      !faction.climateTraining
    ) {
      const threatened = owner.incomingAttacks()[0]?.sourceTile();
      if (threatened !== null && threatened !== undefined) {
        const climate = this.hooks.climateAt(threatened);
        if (!faction.climateAdaptation.includes(climate))
          return this.hooks.trainClimate(owner.id(), climate);
      }
    }
    return false;
  }
  private nuclear(owner: Player, faction: ModernFactionState): void {
    // Core launch records one responsibility event even when intercepted.
    if (
      faction.nuclearStrikes.some((s) => s.expiresTick > this.game.ticks()) ||
      this.game.config().isUnitDisabled(UnitType.AtomBomb)
    )
      return;
    const cost = this.game.unitInfo(UnitType.AtomBomb).cost(this.game, owner);
    if (owner.gold() < cost + 2_000_000n) return;
    const silo = owner
      .units(UnitType.MissileSilo)
      .find(
        (u) => u.isActive() && !u.isUnderConstruction() && !u.isInCooldown(),
      );
    if (!silo) {
      this.invest(owner, UnitType.MissileSilo, this.operatingTile(owner));
      return;
    }
    const magnitude = this.game
      .config()
      .nukeMagnitudes(UnitType.AtomBomb).outer;
    const candidates = owner
      .nearby()
      .filter(
        (p): p is Player =>
          p.isPlayer() &&
          owner.canAttackPlayer(p) &&
          p.troops() > owner.troops() * 2,
      )
      .slice(0, 8);
    for (const other of candidates) {
      const target = other
        .units(UnitType.City, UnitType.Factory, UnitType.Port)
        .filter((u) => u.isActive() && !u.isUnderConstruction())
        .sort((a, b) => b.level() - a.level() || a.id() - b.id())[0];
      if (
        !target ||
        other
          .units(UnitType.MissileSilo)
          .some((u) => u.isActive() && !u.isInCooldown())
      )
        continue;
      if (
        this.game
          .nearbyUnits(
            target.tile(),
            this.game.config().samRange(1),
            UnitType.SAMLauncher,
          )
          .some(
            ({ unit }) => unit.owner() === other && !unit.isUnderConstruction(),
          )
      )
        continue;
      if (
        this.game
          .nearbyUnits(target.tile(), magnitude, [
            UnitType.City,
            UnitType.Factory,
            UnitType.Port,
          ])
          .some(({ unit }) => owner.isFriendly(unit.owner()))
      )
        continue;
      // Check the complete bounded blast disk, including own territory and
      // allied enclaves. Sampling an ally's first borders can miss either.
      let friendlyTerritory = false;
      const tx = this.game.x(target.tile()),
        ty = this.game.y(target.tile());
      for (
        let y = Math.max(0, ty - magnitude);
        y <= Math.min(this.game.height() - 1, ty + magnitude) &&
        !friendlyTerritory;
        y++
      )
        for (
          let x = Math.max(0, tx - magnitude);
          x <= Math.min(this.game.width() - 1, tx + magnitude);
          x++
        ) {
          if ((x - tx) ** 2 + (y - ty) ** 2 > magnitude * magnitude) continue;
          const tileOwner = this.game.owner(this.game.ref(x, y));
          if (tileOwner.isPlayer() && owner.isFriendly(tileOwner)) {
            friendlyTerritory = true;
            break;
          }
        }
      if (friendlyTerritory) continue;
      if (owner.canBuild(UnitType.AtomBomb, target.tile()) !== false) {
        this.game.addExecution(
          new ConstructionExecution(owner, UnitType.AtomBomb, target.tile()),
        );
        return;
      }
    }
  }

  private invest(
    owner: Player,
    type: UnitType,
    tile: TileRef | undefined,
  ): boolean {
    if (tile === undefined || this.game.config().isUnitDisabled(type))
      return false;
    const choices = [tile, ...this.game.neighbors(tile)];
    for (const choice of choices) {
      const placement = owner.canBuild(type, choice);
      if (placement !== false) {
        this.game.addExecution(
          new ConstructionExecution(owner, type, placement),
        );
        return true;
      }
    }
    return false;
  }
}
