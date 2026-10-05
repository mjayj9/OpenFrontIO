import { AttackExecution } from "../execution/AttackExecution";
import { MoveWarshipExecution } from "../execution/MoveWarshipExecution";
import { PortExecution } from "../execution/PortExecution";
import { RetreatExecution } from "../execution/RetreatExecution";
import { TransportShipExecution } from "../execution/TransportShipExecution";
import { WarshipExecution } from "../execution/WarshipExecution";
import { FlatBinaryHeap } from "../execution/utils/FlatBinaryHeap";
import { Attack, Game, MessageType, PlayerID, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { targetTransportTile } from "../game/TransportShipUtils";
import { PathFinding } from "../pathfinding/PathFinder";
import {
  DEFAULT_MODERN_FORCE_RULES,
  ModernBaseState,
  ModernBranch,
  ModernCommandKind,
  ModernCommandPreview,
  ModernForceHooks,
  ModernForceKind,
  ModernForceRules,
  ModernForcesState,
  ModernForceState,
  ModernProductionState,
} from "./ModernForceTypes";
import { MODERN_RULES } from "./ModernRules";

const failedLandPaths = new WeakMap<
  Game,
  Map<PlayerID, { version: number; paths: Set<string> }>
>();
const landMetrics = { queries: 0, searches: 0, visited: 0, cacheHits: 0 };
/** Diagnostic counters only. They never participate in a simulation decision. */
export function modernLandPathMetrics(): Readonly<typeof landMetrics> {
  return { ...landMetrics };
}
/** Tests/benchmarks can discard derived memo data without altering game state. */
export function clearModernLandPathCache(game: Game): void {
  failedLandPaths.delete(game);
}

/** Bounded cardinal A*. Own land can be crossed; an enemy tile is only the terminal. */
function landPath(
  game: Game,
  owner: PlayerID,
  from: TileRef,
  to: TileRef,
  budget: number,
): TileRef[] | null {
  landMetrics.queries++;
  if (from === to) return [from];
  const player = game.player(owner);
  let players = failedLandPaths.get(game);
  if (!players) {
    players = new Map();
    failedLandPaths.set(game, players);
  }
  let cached = players.get(owner);
  if (!cached || cached.version !== player.tileChangeVersion()) {
    cached = { version: player.tileChangeVersion(), paths: new Set() };
    players.set(owner, cached);
  }
  const key = `${from}:${to}:${budget}`;
  if (cached.paths.has(key)) {
    landMetrics.cacheHits++;
    return null;
  }
  landMetrics.searches++;
  const open = new FlatBinaryHeap();
  open.enqueue(from, game.manhattanDist(from, to));
  const previous = new Map<TileRef, TileRef>();
  const distance = new Map<TileRef, number>([[from, 0]]);
  const closed = new Set<TileRef>();
  previous.set(from, from);
  for (let i = 0; open.size() > 0 && i < budget; i++) {
    const at = open.dequeue();
    if (closed.has(at)) continue;
    closed.add(at);
    landMetrics.visited++;
    for (const next of game.neighbors(at)) {
      if (closed.has(next) || !game.isLand(next) || game.isImpassable(next))
        continue;
      if (next !== to && game.owner(next) !== player) continue;
      const g = distance.get(at)! + 1;
      if (g >= (distance.get(next) ?? Infinity)) continue;
      previous.set(next, at);
      distance.set(next, g);
      if (next === to) {
        const result = [to];
        for (let at = to; at !== from; ) {
          at = previous.get(at)!;
          result.push(at);
        }
        return result.reverse();
      }
      if (previous.size < budget * 4)
        open.enqueue(next, g + game.manhattanDist(next, to));
    }
  }
  if (cached.paths.size >= 128)
    cached.paths.delete(cached.paths.values().next().value!);
  cached.paths.add(key);
  return null;
}

function airPath(
  game: Game,
  from: TileRef,
  to: TileRef,
  speed: number,
): TileRef[] {
  const dx = game.x(to) - game.x(from),
    dy = game.y(to) - game.y(from);
  const count = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / speed),
  );
  const path = [from];
  for (let i = 1; i <= count; i++)
    path.push(
      game.ref(
        game.x(from) + Math.round((dx * i) / count),
        game.y(from) + Math.round((dy * i) / count),
      ),
    );
  return path;
}

/** Stateless seeded roll: save/restore and render frequency cannot affect combat. */
function roll(seed: number, tick: number, a: string, b: string): number {
  let value = (seed ^ tick) >>> 0;
  for (const c of `${a}:${b}`)
    value = Math.imul(value ^ c.charCodeAt(0), 16777619) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) % 1000;
}

export function forcePreview(
  game: Game,
  state: ModernForcesState,
  force: ModernForceState,
  target: TileRef,
  command: ModernCommandKind,
  rules: ModernForceRules = DEFAULT_MODERN_FORCE_RULES,
  hooks?: ModernForceHooks,
  queue = false,
): ModernCommandPreview {
  const result: ModernCommandPreview = {
    valid: false,
    reason: null,
    path: [],
    etaTicks: 0,
    rangeTiles: force.branch === "air" ? rules.airRangeTiles : 0,
    risk: "uncertain",
    climateEfficiencyPermille:
      force.branch === "army"
        ? (hooks?.climateEfficiency?.(force.playerId, target) ?? 1000)
        : 1000,
  };
  const fail = (reason: string) => ({ ...result, reason });
  if (!game.isValidRef(target)) return fail("invalid_target");
  if (
    force.phase === "destroyed" ||
    (force.personnel <= 0 && force.attackTroops <= 0)
  )
    return fail("no_personnel");
  if (command === "stop" || command === "cancel" || command === "wait")
    return { ...result, valid: true, risk: "low" };
  const owner = game.player(force.playerId),
    destination = game.owner(target);
  const queuedTarget = queue
    ? (force.queue[force.queue.length - 1]?.target ?? force.command?.target)
    : undefined;
  const from =
    queuedTarget !== undefined &&
    game.owner(queuedTarget) === owner &&
    force.branch === "army"
      ? queuedTarget
      : force.tile;
  if (force.branch === "army") {
    if (!game.isLand(target) || game.isImpassable(target))
      return fail("army_requires_land_transport");
    if (command !== "move" && command !== "attack")
      return fail("wrong_branch_mission");
    if (
      destination !== owner &&
      (command === "move" ||
        (destination.isPlayer() && !owner.canAttackPlayer(destination)))
    )
      return fail("friendly_or_protected_target");
    if (command === "attack" && destination !== owner) {
      const defenderClimate = destination.isPlayer()
        ? (hooks?.climateEfficiency?.(destination.id(), target) ?? 1000)
        : 1000;
      const combat = game.config().attackLogic({
        terrain: game.terrainType(target),
        attackTroops: force.personnel * 10 || force.attackTroops,
        attacker: { type: owner.type(), numTiles: owner.numTilesOwned() },
        defender: destination.isPlayer()
          ? {
              type: destination.type(),
              numTiles: destination.numTilesOwned(),
              troops: destination.troops(),
              isTraitor: destination.isTraitor(),
              isDisconnectedTeammate:
                destination.isDisconnected() && owner.isOnSameTeam(destination),
            }
          : null,
        defenderHasDefensePost:
          destination.isPlayer() &&
          game.hasUnitNearby(
            target,
            game.config().defensePostRange(),
            UnitType.DefensePost,
            destination.id(),
          ),
        falloutRatio: game.hasFallout(target)
          ? game.numTilesWithFallout() / game.numLandTiles()
          : null,
        borderSize: 1,
        modernClimate: game.modernSystems()
          ? {
              attackerPermille: result.climateEfficiencyPermille,
              defenderPermille: defenderClimate,
              movementPermille:
                hooks?.climateMovementEfficiency?.(force.playerId, target) ??
                1000,
            }
          : undefined,
      });
      result.armyCombat = {
        attackerLossRaw: Math.ceil(combat.attackerTroopLoss),
        defenderLossRaw: Math.ceil(combat.defenderTroopLoss),
        tickFractionPermille: Math.round(combat.tickFraction * 1000),
        defenderClimatePermille: defenderClimate,
        climateRatioPermille: Math.max(
          MODERN_RULES.climateRatioMinPermille,
          Math.min(
            MODERN_RULES.climateRatioMaxPermille,
            Math.floor(
              (result.climateEfficiencyPermille * 1000) / defenderClimate,
            ),
          ),
        ),
      };
    }
    const path = landPath(
      game,
      force.playerId,
      from,
      target,
      rules.landPathBudget,
    );
    if (!path) {
      if (
        command !== "attack" ||
        game.config().isUnitDisabled(UnitType.TransportShip)
      )
        return fail("no_owned_land_path");
      const landing = targetTransportTile(game, owner, target);
      if (landing === null) return fail("no_reachable_landing");
      const shore = owner.canBuild(UnitType.TransportShip, landing);
      if (shore === false) return fail("no_transport_departure");
      const ground = landPath(
        game,
        force.playerId,
        from,
        shore,
        rules.landPathBudget,
      );
      const water = PathFinding.Water(game).findPath(shore, landing);
      if (!ground || !water) return fail("no_owned_land_path");
      return {
        ...result,
        valid: true,
        path: ground,
        transportPath: water,
        usesTransport: true,
        etaTicks: (ground.length - 1) * rules.armyMoveTicks + water.length - 1,
        risk: "high",
      };
    }
    return {
      ...result,
      valid: true,
      path,
      etaTicks: Math.ceil(
        path
          .slice(1)
          .reduce(
            (total, tile) =>
              total +
              (rules.armyMoveTicks * 1000 * 1000) /
                (hooks?.climateMovementEfficiency?.(force.playerId, tile) ??
                  1000),
            0,
          ) / 1000,
      ),
      risk: destination === owner ? "low" : "uncertain",
    };
  }
  if (force.branch === "navy") {
    if (!["move", "attack", "patrol", "escort", "blockade"].includes(command))
      return fail("wrong_branch_mission");
    if (!game.isWater(target) && !game.isShoreline(target))
      return fail("navy_requires_navigable_water");
    const unit = force.unitId === null ? undefined : game.unit(force.unitId);
    if (!unit || !unit.isActive() || unit.owner() !== owner)
      return fail("warship_unavailable");
    if (
      game.getWaterComponent(target) === null ||
      !game.hasWaterComponent(unit.tile(), game.getWaterComponent(target)!)
    )
      return fail("water_component_disconnected");
    const previousQueued = force.queue[force.queue.length - 1]?.previewPath;
    const priorEndpoint = queue
      ? (previousQueued?.[previousQueued.length - 1] ??
        force.path[force.path.length - 1])
      : undefined;
    const queuedFrom =
      priorEndpoint !== undefined && game.isWater(priorEndpoint)
        ? priorEndpoint
        : queuedTarget !== undefined && game.isWater(queuedTarget)
          ? queuedTarget
          : unit.tile();
    const path = PathFinding.Water(game).findPath(queuedFrom, target);
    if (!path) return fail("no_water_path");
    // The shared shore transformer restores a land endpoint for transports.
    // A warship stops at the preceding navigable node instead of sailing ashore.
    while (path.length > 0 && !game.isWater(path[path.length - 1])) path.pop();
    if (path.length === 0) return fail("no_water_path");
    return { ...result, valid: true, path, etaTicks: path.length };
  }
  if (
    ![
      "move",
      "patrol",
      "air_superiority",
      "intercept",
      "strike",
      "attack",
    ].includes(command)
  )
    return fail("wrong_branch_mission");
  if (!queue && force.phase !== "idle" && force.phase !== "rearming")
    return fail("aircraft_already_sortied");
  if (!queue && force.cooldownUntil > game.ticks())
    return fail("aircraft_rearming");
  const base = state.bases.find(
    (b) =>
      b.id === force.baseId &&
      (b.branch ?? "air") === "air" &&
      b.playerId === force.playerId &&
      b.health > 0 &&
      (b.completesTick ?? 0) <= game.ticks() &&
      (b.repairUntilTick ?? 0) <= game.ticks() &&
      game.owner(b.tile) === owner,
  );
  if (!base) return fail("airbase_unavailable");
  if (
    game.euclideanDistSquared(base.tile, target) >
    rules.airRangeTiles * rules.airRangeTiles
  )
    return fail("outside_air_range");
  if (
    force.kind === "fighter" &&
    (command === "strike" || command === "attack")
  )
    return fail("fighter_cannot_ground_strike");
  if (
    force.kind === "strike" &&
    (command === "intercept" || command === "air_superiority")
  )
    return fail("strike_cannot_intercept");
  if (
    (command === "strike" || command === "attack") &&
    (!destination.isPlayer() || !owner.canAttackPlayer(destination))
  )
    return fail("friendly_or_protected_target");
  const path = airPath(
    game,
    queue ? base.tile : force.tile,
    target,
    rules.airMoveTilesPerTick,
  );
  const sam = game
    .nearbyUnits(target, rules.samAircraftRange, UnitType.SAMLauncher)
    .some(({ unit }) => !owner.isFriendly(unit.owner()));
  return {
    ...result,
    valid: true,
    path,
    etaTicks: path.length - 1,
    risk: sam ? "high" : "uncertain",
  };
}

/** Modern v2 owns these JSON records; Classic never constructs this controller. */
export class ModernForces {
  private airGrid = new Map<string, ModernForceState[]>();
  private navyByUnitId = new Map<number, ModernForceState>();
  private armyByUnitId = new Map<number, ModernForceState>();
  private armyByAttackId = new Map<string, ModernForceState>();
  private armiesByPlayer = new Map<PlayerID, ModernForceState[]>();
  private forceIndexRevision = "";
  private get timedProduction(): boolean {
    return this.state.version === 3;
  }
  constructor(
    private game: Game,
    readonly state: ModernForcesState,
    private hooks: ModernForceHooks,
    readonly rules: ModernForceRules = DEFAULT_MODERN_FORCE_RULES,
  ) {
    state.samAircraftReloads ??= [];
    state.production ??= [];
    state.completedProduction ??= [];
    for (const base of state.bases) {
      base.branch ??= "air";
      base.completesTick ??= 0;
      base.repairUntilTick ??= null;
      base.unitId ??= null;
      base.constructionCounted ??= true;
    }
  }

  private indexForces(): void {
    const revision = `${this.state.nextForceId}:${this.state.forces.length}`;
    if (this.forceIndexRevision !== revision) {
      this.navyByUnitId.clear();
      this.armyByUnitId.clear();
      this.armyByAttackId.clear();
      this.armiesByPlayer.clear();
      for (const force of this.state.forces) {
        if (force.branch === "navy" && force.unitId !== null)
          this.navyByUnitId.set(force.unitId, force);
        else if (force.branch === "army") {
          const armies = this.armiesByPlayer.get(force.playerId) ?? [];
          armies.push(force);
          this.armiesByPlayer.set(force.playerId, armies);
          if (force.unitId !== null) this.armyByUnitId.set(force.unitId, force);
          if (force.attackId !== null)
            this.armyByAttackId.set(force.attackId, force);
        }
      }
      this.forceIndexRevision = revision;
    }
  }

  /** Derived lookup only: the authoritative command stays in the saved force. */
  navyOrder(unitId: number): ModernForceState | undefined {
    this.indexForces();
    const force = this.navyByUnitId.get(unitId);
    return force?.phase === "destroyed" ? undefined : force;
  }

  armyAttackStarted(attack: Attack): void {
    this.indexForces();
    const source = attack.sourceTile(),
      force = this.armiesByPlayer
        .get(attack.attacker().id())
        ?.find(
          (f) =>
            f.phase === "attacking" &&
            f.attackId === null &&
            (f.command?.viaTransport ? f.path[f.path.length - 1] : f.tile) ===
              source,
        );
    if (!force) return;
    force.attackId = attack.id();
    force.attackTroops = Math.floor(attack.troops());
    this.armyByAttackId.set(attack.id(), force);
  }

  hasArmyAttack(attackId: string): boolean {
    this.indexForces();
    const force = this.armyByAttackId.get(attackId);
    return force?.phase === "attacking" && force.attackId === attackId;
  }

  /** Native execution reports the final tick as well as ordinary combat ticks. */
  armyAttackRemaining(attackId: string, raw: number, finished = false): void {
    this.indexForces();
    const force = this.armyByAttackId.get(attackId);
    if (force?.phase !== "attacking" || force.attackId !== attackId) return;
    this.observeArmyTroops(force, raw);
    if (finished) {
      this.recoverArmy(force, this.game.ticks());
      this.armyByAttackId.delete(attackId);
    }
  }
  /** Called only after native AttackExecution actually conquers this tile. */
  armyAttackProgress(attackId: string, tile: TileRef): void {
    this.indexForces();
    const force = this.armyByAttackId.get(attackId);
    if (force?.phase !== "attacking" || force.attackId !== attackId) return;
    force.tile = tile;
    const attack = this.game
      .player(force.playerId)
      .outgoingAttacks()
      .find((a) => a.id() === attackId);
    // Native combat expands a front after the clicked tile is taken. Show its
    // real adjacent frontier rather than drawing backwards to old waypoints.
    const next = attack
      ? this.game
          .neighbors(tile)
          .find(
            (t) =>
              this.game.isLand(t) &&
              !this.game.isImpassable(t) &&
              this.game.owner(t) === attack.target(),
          )
      : undefined;
    force.path = next === undefined ? [tile] : [tile, next];
    force.pathIndex = 0;
  }

  transportStarted(
    playerId: PlayerID,
    unitId: number,
    landing: TileRef,
    raw: number,
  ): void {
    this.indexForces();
    const force = this.armiesByPlayer
      .get(playerId)
      ?.find(
        (f) =>
          f.phase === "attacking" &&
          f.unitId === null &&
          f.command?.viaTransport &&
          f.path[f.path.length - 1] === landing,
      );
    if (!force) return;
    force.unitId = unitId;
    force.attackTroops = Math.floor(raw);
    this.armyByUnitId.set(unitId, force);
  }

  transportRemaining(unitId: number, raw: number, returnedTo?: TileRef): void {
    this.indexForces();
    const force = this.armyByUnitId.get(unitId);
    if (force?.phase !== "attacking" || force.unitId !== unitId) return;
    this.observeArmyTroops(force, raw);
    if (returnedTo !== undefined) {
      force.tile = returnedTo;
      force.unitId = null;
      this.recoverArmy(force, this.game.ticks());
      this.armyByUnitId.delete(unitId);
    }
  }

  private observeArmyTroops(force: ModernForceState, raw: number): void {
    const remaining = Math.max(0, Math.floor(raw));
    force.casualties += Math.max(
      0,
      Math.floor(force.attackTroops / 10) - Math.floor(remaining / 10),
    );
    force.attackTroops = remaining;
    // The population ledger reconciles actual pool, attack and transport
    // troops. Calling its casualty hook here would charge the same death twice.
  }

  private recoverArmy(force: ModernForceState, tick: number): void {
    const owner = this.game.player(force.playerId);
    force.personnel = Math.floor(
      Math.min(force.attackTroops, owner.troops()) / 10,
    );
    owner.removeTroops(force.personnel * 10);
    if (force.unitId !== null) this.armyByUnitId.delete(force.unitId);
    if (force.attackId !== null) this.armyByAttackId.delete(force.attackId);
    force.unitId = null;
    force.attackId = null;
    force.attackTroops = 0;
    this.complete(force, tick);
    if (force.personnel === 0) force.phase = "destroyed";
  }

  initializeFaction(playerId: PlayerID, capital: TileRef): void {
    this.createBase(playerId, capital, true);
    if (!this.timedProduction) {
      this.produce(playerId, "army", "army", undefined, capital, 1, true);
      const base = this.state.bases.find(
        (b) => b.playerId === playerId && (b.branch ?? "air") === "air",
      );
      if (base) {
        this.produce(playerId, "air", "fighter", base.id, undefined, 4, true);
        this.produce(playerId, "air", "strike", base.id, undefined, 4, true);
      }
      return;
    }
    const owner = this.game.player(playerId),
      candidates = [capital],
      seen = new Set(candidates);
    let armyTile = capital;
    for (let i = 0; i < candidates.length && i < 64; i++) {
      const tile = candidates[i],
        distance = this.game.manhattanDist(tile, capital);
      if (distance >= 3 && distance <= 5) {
        armyTile = tile;
        break;
      }
      if (distance > 5) continue;
      for (const next of this.game.neighbors(tile))
        if (
          !seen.has(next) &&
          this.game.owner(next) === owner &&
          this.game.isLand(next) &&
          !this.game.isImpassable(next)
        ) {
          seen.add(next);
          candidates.push(next);
          if (armyTile === capital) armyTile = next;
        }
    }
    const armyBase = this.createBase(playerId, armyTile, true, "army");
    this.produce(playerId, "army", "army", armyBase?.id, armyTile, 1, true);
    const initialArmy = this.state.forces.find(
      (f) => f.playerId === playerId && f.branch === "army",
    );
    if (initialArmy && initialArmy.personnel >= 2) {
      const personnel = Math.floor(initialArmy.personnel / 2);
      initialArmy.personnel -= personnel;
      const rally =
        this.game
          .neighbors(armyTile)
          .find(
            (t) =>
              this.game.owner(t) === owner &&
              this.game.isLand(t) &&
              !this.game.isImpassable(t),
          ) ?? armyTile;
      this.state.forces.push({
        ...structuredClone(initialArmy),
        id: this.nextId("force"),
        tile: rally,
        personnel,
      });
    }
    const base = this.state.bases.find(
      (b) => b.playerId === playerId && (b.branch ?? "air") === "air",
    );
    if (base) {
      this.produce(playerId, "air", "fighter", base.id, undefined, 4, true);
      this.produce(playerId, "air", "strike", base.id, undefined, 4, true);
    }
    for (const port of this.game.player(playerId).units(UnitType.Port))
      if (port.isActive()) this.navalBase(playerId, port.tile());
  }

  private nextId(prefix: string): string {
    return `${prefix}-${this.state.nextForceId++}`;
  }
  private createBase(
    playerId: PlayerID,
    tile: TileRef,
    free = false,
    branch: ModernBranch = "air",
  ): ModernBaseState | null {
    const owner = this.game.player(playerId);
    if (
      !this.game.isValidRef(tile) ||
      !this.game.isLand(tile) ||
      this.game.isImpassable(tile) ||
      this.game.owner(tile) !== owner
    )
      return null;
    if (
      this.state.bases.filter(
        (b) => b.playerId === playerId && (b.branch ?? "air") === branch,
      ).length >= this.rules.maxBasesPerFaction ||
      this.state.bases.some(
        (b) => b.tile === tile && (b.branch ?? "air") === branch,
      )
    )
      return null;
    const cost =
      branch === "army" ? this.rules.armybaseCost : this.rules.airbaseCost;
    if (!free && owner.gold() < BigInt(cost)) return null;
    if (!free) owner.removeGold(BigInt(cost));
    const base = {
      id: this.nextId("base"),
      playerId,
      tile,
      branch,
      completesTick:
        free || !this.timedProduction || this.game.config().instantBuild()
          ? 0
          : this.game.ticks() +
            (branch === "army"
              ? this.rules.armybaseBuildTicks
              : this.rules.airbaseBuildTicks),
      repairUntilTick: null,
      unitId: null,
      constructionCounted: free,
      capacity:
        branch === "army"
          ? this.rules.armybaseCapacity
          : this.rules.airbaseCapacity,
      health: this.rules.airbaseHealth,
      maxHealth: this.rules.airbaseHealth,
    };
    this.state.bases.push(base);
    if (!free && this.game.config().instantBuild()) {
      this.recordProduction(
        playerId,
        branch === "army" ? "armybase" : "airbase",
        1,
      );
      base.constructionCounted = true;
    }
    return base;
  }

  /** Military docks are the existing Port: one unit, one economic owner. */
  private navalBase(
    playerId: PlayerID,
    tile: TileRef,
    build = false,
  ): ModernBaseState | null {
    const owner = this.game.player(playerId);
    let port = owner
      .units(UnitType.Port)
      .find((u) => u.isActive() && u.tile() === tile);
    let createdPort = false;
    if (!port && build) {
      if (this.game.config().isUnitDisabled(UnitType.Port)) return null;
      const spawn = owner.canBuild(UnitType.Port, tile);
      if (spawn === false) return null;
      port = owner.buildUnit(UnitType.Port, spawn, {});
      createdPort = true;
      if (this.game.config().instantBuild())
        this.game.addExecution(new PortExecution(port));
      else port.setUnderConstruction(true);
    }
    if (!port) return null;
    const existing = this.state.bases.find(
      (b) => b.unitId === port!.id() && b.branch === "navy",
    );
    if (existing) return existing;
    const base: ModernBaseState = {
      id: this.nextId("base"),
      playerId,
      branch: "navy",
      tile: port.tile(),
      unitId: port.id(),
      capacity: this.rules.navybaseCapacity,
      health: this.rules.airbaseHealth,
      maxHealth: this.rules.airbaseHealth,
      completesTick:
        port.isUnderConstruction() &&
        createdPort &&
        !this.game.config().instantBuild()
          ? this.game.ticks() + this.rules.navybaseBuildTicks
          : 0,
      repairUntilTick: null,
      constructionCounted: !createdPort,
    };
    this.state.bases.push(base);
    if (createdPort && this.game.config().instantBuild()) {
      this.recordProduction(playerId, "navybase", 1);
      base.constructionCounted = true;
    }
    return base;
  }

  private operationalBase(
    base: ModernBaseState | undefined,
    playerId: PlayerID,
  ): boolean {
    if (
      !base ||
      base.playerId !== playerId ||
      base.health <= 0 ||
      (base.completesTick ?? 0) > this.game.ticks() ||
      (base.repairUntilTick ?? 0) > this.game.ticks() ||
      this.game.owner(base.tile).id() !== playerId
    )
      return false;
    if (base.branch === "navy") {
      const unit =
        typeof base.unitId !== "number"
          ? undefined
          : this.game.unit(base.unitId);
      if (
        !unit?.isActive() ||
        unit.isUnderConstruction() ||
        unit.owner().id() !== playerId
      )
        return false;
      if (
        this.game
          .modernSystems()
          ?.ports.some((p) => p.unitId === unit.id() && p.damage >= 1000)
      )
        return false;
    }
    return true;
  }

  produce(
    playerId: PlayerID,
    branch: ModernBranch,
    kind: ModernForceKind | "airbase" | "armybase" | "navybase" | "repair_base",
    baseId: string | undefined,
    tile: TileRef | undefined,
    count: number,
    free = false,
    requestedSource?: "army_reserve" | "available",
  ): string | null {
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 8 ||
      !this.game.hasPlayer(playerId)
    )
      return "invalid_count";
    const owner = this.game.player(playerId);
    if (!owner.isAlive()) return "faction_defeated";
    if (kind === "repair_base") {
      const base = this.state.bases.find((b) => b.id === baseId);
      if (
        !base ||
        base.playerId !== playerId ||
        this.game.owner(base.tile) !== owner
      )
        return "not_base_owner";
      if ((base.completesTick ?? 0) > this.game.ticks())
        return "base_under_construction";
      if (base.health >= base.maxHealth || base.repairUntilTick)
        return "base_repair_unavailable";
      if (owner.gold() < BigInt(this.rules.baseRepairCost))
        return "insufficient_gold";
      owner.removeGold(BigInt(this.rules.baseRepairCost));
      base.repairUntilTick = this.game.ticks() + this.rules.baseRepairTicks;
      return null;
    }
    if (kind === "airbase" || kind === "armybase" || kind === "navybase") {
      const requestedBranch =
        kind === "airbase" ? "air" : kind === "armybase" ? "army" : "navy";
      if (
        branch !== requestedBranch ||
        count !== 1 ||
        tile === undefined ||
        !this.game.isValidRef(tile)
      )
        return "invalid_target";
      if (
        this.game.owner(tile) !== owner ||
        !this.game.isLand(tile) ||
        this.game.isImpassable(tile)
      )
        return "base_requires_owned_land";
      if (kind === "navybase") {
        if (this.game.config().isUnitDisabled(UnitType.Port))
          return "navybase_disabled";
        const existingPort = owner
          .units(UnitType.Port)
          .some((u) => u.isActive() && u.tile() === tile);
        if (
          !existingPort &&
          owner.gold() <
            this.game.unitInfo(UnitType.Port).cost(this.game, owner)
        )
          return "insufficient_gold";
        // navalBase resolves the native Port search once, including structure
        // spacing and the adjusted coast. Never charge for a rejected site.
        return this.navalBase(playerId, tile, true)
          ? null
          : "navybase_no_valid_site";
      }
      if (
        this.state.bases.some(
          (b) => b.tile === tile && (b.branch ?? "air") === requestedBranch,
        )
      )
        return "base_already_exists";
      if (
        this.state.bases.filter(
          (b) =>
            b.playerId === playerId && (b.branch ?? "air") === requestedBranch,
        ).length >= this.rules.maxBasesPerFaction
      )
        return "base_limit";
      const cost =
        kind === "armybase" ? this.rules.armybaseCost : this.rules.airbaseCost;
      if (!free && owner.gold() < BigInt(cost)) return "insufficient_gold";
      return this.createBase(playerId, tile, free, requestedBranch)
        ? null
        : "base_requires_owned_land";
    }
    if (
      (branch === "army" && kind !== "army") ||
      (branch === "navy" && kind !== "warship") ||
      (branch === "air" && kind !== "fighter" && kind !== "strike")
    )
      return "wrong_branch_mission";
    const pending = this.state.production!;
    if (
      this.state.forces.filter(
        (f) => f.playerId === playerId && f.phase !== "destroyed",
      ).length +
        pending.filter((p) => p.playerId === playerId).length >=
      this.rules.maxForcesPerFaction
    )
      return "force_limit";
    let base = this.state.bases.find(
      (b) => b.id === baseId && (b.branch ?? "air") === branch,
    );
    if (
      !this.timedProduction &&
      branch === "army" &&
      tile !== undefined &&
      this.game.isValidRef(tile) &&
      this.game.owner(tile) === owner &&
      this.game.isLand(tile) &&
      !this.game.isImpassable(tile)
    )
      base = {
        id: "",
        playerId,
        tile,
        capacity: Number.MAX_SAFE_INTEGER,
        health: this.rules.airbaseHealth,
        maxHealth: this.rules.airbaseHealth,
        branch: "army",
      };
    if (
      !base &&
      branch === "navy" &&
      tile !== undefined &&
      this.game.isValidRef(tile)
    ) {
      const port = owner
        .units(UnitType.Port)
        .filter(
          (u) => u.isActive() && this.game.manhattanDist(u.tile(), tile!) <= 24,
        )
        .sort(
          (a, b) =>
            this.game.manhattanDist(a.tile(), tile!) -
              this.game.manhattanDist(b.tile(), tile!) || a.id() - b.id(),
        )[0];
      if (port) base = this.navalBase(playerId, port.tile()) ?? undefined;
    }
    if (!base && branch === "army" && free && tile !== undefined)
      base = this.createBase(playerId, tile, true, "army") ?? undefined;
    if (!base && branch === "army")
      base = this.state.bases.find(
        (b) =>
          b.playerId === playerId &&
          b.branch === "army" &&
          (tile === undefined || b.tile === tile),
      );
    if (
      !base ||
      base.playerId !== playerId ||
      this.game.owner(base.tile) !== owner
    )
      return branch === "air"
        ? "airbase_unavailable"
        : branch === "army"
          ? "armybase_unavailable"
          : "warship_requires_port";
    if ((base.completesTick ?? 0) > this.game.ticks())
      return "base_under_construction";
    if (
      base.branch === "navy" &&
      typeof base.unitId === "number" &&
      this.game.unit(base.unitId)?.isUnderConstruction()
    )
      return "base_under_construction";
    if (!this.operationalBase(base, playerId))
      return "base_damaged_or_repairing";
    const personnel =
      count *
      (branch === "army"
        ? this.rules.armyPersonnelPerGroup
        : branch === "navy"
          ? this.rules.navyPersonnelPerWarship
          : this.rules.personnelPerAircraft);
    const capacityUse = branch === "army" ? personnel : count;
    const assigned = this.state.forces
      .filter((f) => f.baseId === base!.id && f.phase !== "destroyed")
      .reduce(
        (n, f) =>
          n +
          (branch === "army"
            ? f.personnel + Math.floor(f.attackTroops / 10)
            : branch === "air"
              ? f.aircraft
              : 1),
        0,
      );
    const queued = pending
      .filter((p) => p.baseId === base!.id)
      .reduce((n, p) => n + (branch === "army" ? p.personnel : p.count), 0);
    if (assigned + queued + capacityUse > base.capacity) return "base_capacity";
    let spawn = base.tile;
    if (branch === "navy") {
      if (count !== 1 || this.game.config().isUnitDisabled(UnitType.Warship))
        return "warship_disabled_or_count";
      const water = this.game
        .neighbors(base.tile)
        .find((t) => this.game.isWater(t));
      if (water === undefined) return "warship_requires_port";
      const valid = owner.canBuild(UnitType.Warship, water);
      if (valid === false) return "warship_requires_port";
      spawn = valid;
    }
    const cost =
      branch === "army"
        ? this.timedProduction
          ? BigInt(count * this.rules.armyTrainingCost)
          : 0n
        : branch === "navy"
          ? this.game.unitInfo(UnitType.Warship).cost(this.game, owner)
          : BigInt(
              count *
                (kind === "fighter"
                  ? this.rules.fighterCost
                  : this.rules.strikeCost),
            );
    if (!free && owner.gold() < cost) return "insufficient_gold";
    let source: ModernProductionState["source"] = "available";
    if (
      branch === "army" &&
      (free ||
        !this.timedProduction ||
        !this.hooks.mobilize ||
        requestedSource === "army_reserve" ||
        (requestedSource === undefined && owner.troops() >= personnel * 10))
    ) {
      source = "army_reserve";
      if (
        owner.troops() < personnel * 10 ||
        !this.hooks.reserve(playerId, branch, personnel)
      )
        return "insufficient_army_reserve";
      owner.removeTroops(personnel * 10);
    } else if (branch === "army") {
      if (!this.hooks.mobilize!(playerId, personnel))
        return "insufficient_manpower";
    } else {
      const people = owner.modernFaction?.()?.population;
      const cannotMobilize =
        people &&
        (people.available < personnel ||
          people.army + people.navy + people.air + personnel >
            Math.floor(
              (people.total * MODERN_RULES.mobilizationPermille) / 1000,
            ));
      const retrain =
        requestedSource === "army_reserve" ||
        (requestedSource === undefined &&
          this.timedProduction &&
          cannotMobilize &&
          this.hooks.reassignArmy);
      if (retrain) {
        if (!this.hooks.reassignArmy?.(playerId, branch, personnel))
          return "insufficient_army_reserve";
        source = "army_reserve";
      } else if (!this.hooks.reserve(playerId, branch, personnel))
        return "insufficient_manpower";
    }
    let unitId: number | null = null;
    if (branch === "navy") {
      const unit = owner.buildUnit(UnitType.Warship, spawn, {
        patrolTile: spawn,
      });
      unitId = unit.id();
      if (!free && this.timedProduction && !this.game.config().instantBuild())
        unit.setUnderConstruction(true);
    } else if (!free) owner.removeGold(cost);
    const job: ModernProductionState = {
      id: this.nextId("production"),
      playerId,
      branch,
      kind,
      baseId: base.id,
      tile: spawn,
      count,
      personnel,
      costGold: cost.toString(),
      source,
      unitId,
      completesTick:
        this.game.ticks() +
        (branch === "army"
          ? this.rules.armyTrainingTicks * count
          : branch === "navy"
            ? this.rules.warshipProductionTicks
            : this.rules.aircraftProductionTicks +
              this.rules.aircraftProductionTicksPerAircraft * count),
    };
    if (free || !this.timedProduction || this.game.config().instantBuild())
      this.finishProduction(job, !free);
    else pending.push(job);
    return null;
  }

  private recordProduction(
    playerId: PlayerID,
    kind: ModernForceKind | "armybase" | "navybase" | "airbase",
    count: number,
  ): void {
    const existing = this.state.completedProduction!.find(
      (p) => p.playerId === playerId && p.kind === kind,
    );
    if (existing) existing.count += count;
    else this.state.completedProduction!.push({ playerId, kind, count });
  }
  private finishProduction(job: ModernProductionState, record = true): void {
    if (typeof job.unitId === "number") {
      const unit = this.game.unit(job.unitId);
      if (!unit?.isActive() || unit.owner().id() !== job.playerId) return;
      unit.setUnderConstruction(false);
      this.game.addExecution(new WarshipExecution(unit));
    }
    this.state.forces.push({
      id: this.nextId("force"),
      playerId: job.playerId,
      branch: job.branch,
      kind: job.kind,
      tile: job.tile,
      baseId: job.baseId || null,
      personnel: job.personnel,
      aircraft: job.branch === "air" ? job.count : 0,
      unitId: job.unitId ?? null,
      phase:
        !this.timedProduction && job.branch === "air" && record
          ? "rearming"
          : "idle",
      command: null,
      queue: [],
      path: [],
      pathIndex: 0,
      cooldownUntil:
        !this.timedProduction && job.branch === "air" && record
          ? this.game.ticks() + this.rules.airRearmTicks
          : 0,
      attackId: null,
      attackTroops: 0,
      lastReason: null,
      completedMissions: 0,
      lastMissionTick: 0,
      casualties: 0,
      movementProgress: 0,
    });
    if (record) this.recordProduction(job.playerId, job.kind, job.count);
  }

  private tickProduction(tick: number): void {
    for (const base of this.state.bases) {
      const owner = this.game.owner(base.tile);
      if (owner.isPlayer() && owner.id() !== base.playerId)
        base.playerId = owner.id();
      if (
        !base.constructionCounted &&
        (base.completesTick ?? 0) > 0 &&
        tick >= base.completesTick!
      ) {
        this.recordProduction(
          base.playerId,
          base.branch === "army"
            ? "armybase"
            : base.branch === "navy"
              ? "navybase"
              : "airbase",
          1,
        );
        base.constructionCounted = true;
      }
      if (base.repairUntilTick && tick >= base.repairUntilTick) {
        base.health = base.maxHealth;
        base.repairUntilTick = null;
      }
      if (
        base.branch === "navy" &&
        (base.completesTick ?? 0) > 0 &&
        tick >= base.completesTick!
      ) {
        const unit =
          typeof base.unitId !== "number"
            ? undefined
            : this.game.unit(base.unitId);
        if (unit?.isActive()) {
          unit.setUnderConstruction(false);
          this.game.addExecution(new PortExecution(unit));
        }
        base.completesTick = 0;
      }
    }
    const remaining: ModernProductionState[] = [];
    for (const job of this.state.production!) {
      const base = this.state.bases.find((b) => b.id === job.baseId);
      const owner = this.game.player(job.playerId);
      const unit =
        typeof job.unitId !== "number" ? undefined : this.game.unit(job.unitId);
      if (
        !owner.isAlive() ||
        !base ||
        base.playerId !== job.playerId ||
        this.game.owner(base.tile) !== owner ||
        (typeof job.unitId === "number" &&
          (!unit?.isActive() || unit.owner() !== owner))
      ) {
        if (unit?.isActive()) unit.delete();
        if (job.branch === "army") {
          if (job.source === "army_reserve")
            owner.addTroops(job.personnel * 10);
          else this.hooks.demobilize?.(job.playerId, job.personnel);
        } else if (job.source === "army_reserve") {
          this.hooks.restoreArmy?.(job.playerId, job.branch, job.personnel);
        } else this.hooks.release(job.playerId, job.branch, job.personnel);
        continue;
      }
      if (!this.operationalBase(base, job.playerId)) job.completesTick++;
      if (
        tick < job.completesTick ||
        !this.operationalBase(base, job.playerId)
      ) {
        remaining.push(job);
        continue;
      }
      this.finishProduction(job);
    }
    this.state.production = remaining;
  }

  command(
    playerId: PlayerID,
    forceIds: string[],
    kind: ModernCommandKind,
    target: TileRef,
    queue = false,
  ): { id: string; reason: string | null }[] {
    const results: { id: string; reason: string | null }[] = [];
    for (const id of Array.from(new Set(forceIds)).slice(0, 32)) {
      const force = this.state.forces.find((f) => f.id === id);
      if (!force || force.playerId !== playerId) {
        results.push({ id, reason: "not_force_owner" });
        continue;
      }
      if (
        force.phase === "destroyed" ||
        (force.personnel <= 0 && force.attackTroops <= 0)
      ) {
        results.push({ id, reason: "no_personnel" });
        continue;
      }
      if (queue && force.queue.length >= this.rules.queueLimit) {
        results.push({ id, reason: "command_queue_full" });
        continue;
      }
      if (kind === "stop" || kind === "cancel" || kind === "wait") {
        force.queue = [];
        this.stop(force, kind === "wait");
        results.push({ id, reason: null });
        continue;
      }
      const preview = forcePreview(
        this.game,
        this.state,
        force,
        target,
        kind,
        this.rules,
        this.hooks,
        queue,
      );
      // A queued air command is checked again after the aircraft returns/rearms.
      if (!preview.valid) {
        force.lastReason = preview.reason;
        results.push({ id, reason: preview.reason });
        continue;
      }
      const command = { kind, target, issuedTick: this.game.ticks() };
      if (queue) {
        const route = preview.usesTransport
          ? preview.path.concat(preview.transportPath?.slice(1) ?? [])
          : preview.path;
        // No client-provided route reaches the simulation; this is only the
        // bounded result of its own validation for queued-arrow display.
        if (route.length <= 8192)
          Object.assign(command, { previewPath: route });
      }
      if (preview.usesTransport) Object.assign(command, { viaTransport: true });
      if (force.branch === "navy" && kind === "escort") {
        const owner = this.game.player(playerId);
        const transport = this.game
          .nearbyUnits(target, 12, UnitType.TransportShip)
          .slice(0, 32)
          .filter(
            ({ unit }) => unit.isActive() && owner.isFriendly(unit.owner()),
          )
          .sort(
            (a, b) =>
              a.distSquared - b.distSquared || a.unit.id() - b.unit.id(),
          )[0]?.unit;
        if (transport) Object.assign(command, { escortUnitId: transport.id() });
      }
      if (
        queue &&
        (force.command !== null ||
          force.cooldownUntil > this.game.ticks() ||
          (force.branch === "air" && force.phase !== "idle"))
      )
        force.queue.push(command);
      else if (force.phase === "attacking") {
        force.queue = [command];
        this.stop(force, false);
      } else {
        this.stop(force, false);
        force.command = command;
        force.path = preview.path;
        force.pathIndex = 0;
        force.lastReason = null;
        force.phase = force.branch === "air" ? "outbound" : "moving";
        if (force.branch === "navy")
          this.game.addExecution(
            new MoveWarshipExecution(
              this.game.player(playerId),
              [force.unitId!],
              target,
            ),
          );
      }
      results.push({ id, reason: null });
    }
    return results;
  }

  private stop(force: ModernForceState, wait: boolean): void {
    if (force.branch === "army" && force.unitId !== null) {
      const transport = this.game.unit(force.unitId);
      if (transport?.type() === UnitType.TransportShip && transport.isActive())
        transport.updateTransportShipState({ isRetreating: true });
    }
    if (force.attackId) {
      const attack = this.game
        .player(force.playerId)
        .outgoingAttacks()
        .find((a) => a.id() === force.attackId);
      if (attack) this.requestArmyRetreat(attack);
    }
    if (force.phase === "attacking") {
      force.lastReason = "retreat_requested";
      return;
    }
    if (
      force.branch === "air" &&
      ["outbound", "engaging", "returning"].includes(force.phase)
    ) {
      this.returnToBase(force);
      return;
    }
    if (force.branch === "navy" && force.unitId !== null)
      this.game.addExecution(
        new MoveWarshipExecution(
          this.game.player(force.playerId),
          [force.unitId],
          force.tile,
        ),
      );
    force.command = null;
    force.path = [];
    force.pathIndex = 0;
    force.phase = "idle";
    force.lastReason = wait ? "waiting" : null;
  }

  private requestArmyRetreat(attack: Attack): void {
    if (attack.retreating() || attack.retreated()) return;
    // The original retreat is a two-step execution: freeze now, return
    // survivors after its 20-tick cancellation delay. A flag alone never ends it.
    attack.attacker().orderRetreat(attack.id());
    this.game.addExecution(
      new RetreatExecution(attack.attacker(), attack.id()),
    );
  }

  committedArmyRaw(playerId: PlayerID): number {
    return (
      this.state.forces
        .filter(
          (f) =>
            f.playerId === playerId &&
            f.branch === "army" &&
            f.phase !== "destroyed",
        )
        .reduce((sum, f) => sum + f.personnel * 10, 0) +
      (this.state.production ?? [])
        .filter((p) => p.playerId === playerId && p.branch === "army")
        .reduce((sum, p) => sum + p.personnel * 10, 0)
    );
  }

  /** The original build menu stays usable, but cannot bypass crew accounting. */
  adoptExistingWarships(): void {
    const registered = new Map(
      this.state.forces
        .filter(
          (f) =>
            f.branch === "navy" && f.phase !== "destroyed" && f.unitId !== null,
        )
        .map((f) => [f.unitId!, f]),
    );
    for (const unit of this.game.units(UnitType.Warship)) {
      if (!unit.isActive() || unit.isUnderConstruction()) continue;
      const current = registered.get(unit.id());
      if (current && current.playerId === unit.owner().id()) continue;
      if (current) this.destroy(current);
      const personnel = this.rules.navyPersonnelPerWarship,
        id = unit.owner().id();
      if (!this.hooks.reserve(id, "navy", personnel)) {
        unit.delete();
        this.game.displayMessage(
          "modern_v2.reason.insufficient_manpower",
          MessageType.ATTACK_FAILED,
          id,
        );
        continue;
      }
      this.state.forces.push({
        id: this.nextId("force"),
        playerId: id,
        branch: "navy",
        kind: "warship",
        tile: unit.tile(),
        baseId: null,
        personnel,
        aircraft: 0,
        unitId: unit.id(),
        phase: "idle",
        command: null,
        queue: [],
        path: [],
        pathIndex: 0,
        cooldownUntil: 0,
        attackId: null,
        attackTroops: 0,
        lastReason: null,
        completedMissions: 0,
        lastMissionTick: 0,
        casualties: 0,
        movementProgress: 0,
      });
    }
  }

  tick(tick = this.game.ticks()): void {
    this.tickProduction(tick);
    if (tick % 10 === 0) {
      const registered = new Set(
        this.state.bases
          .filter((b) => b.branch === "navy")
          .map((b) => b.unitId),
      );
      for (const port of this.game.units(UnitType.Port))
        if (
          port.isActive() &&
          !port.isUnderConstruction() &&
          !registered.has(port.id())
        )
          this.navalBase(port.owner().id(), port.tile());
    }
    this.adoptExistingWarships();
    if (tick % 5 === 0) {
      this.airGrid.clear();
      for (const force of this.state.forces)
        if (
          force.branch === "air" &&
          force.kind === "fighter" &&
          ["outbound", "engaging"].includes(force.phase)
        ) {
          const key = `${Math.floor(this.game.x(force.tile) / 32)}:${Math.floor(this.game.y(force.tile) / 32)}`;
          const bucket = this.airGrid.get(key) ?? [];
          bucket.push(force);
          this.airGrid.set(key, bucket);
        }
    }
    for (const force of this.state.forces) {
      if (force.phase === "destroyed") continue;
      if (!this.game.player(force.playerId).isAlive()) {
        this.destroy(force);
        continue;
      }
      if (force.branch === "army") this.tickArmy(force, tick);
      else if (force.branch === "navy") this.tickNavy(force, tick);
      else this.tickAir(force, tick);
      if (
        force.phase === "idle" &&
        force.command === null &&
        force.queue.length > 0 &&
        force.cooldownUntil <= tick
      ) {
        const next = force.queue.shift()!;
        this.command(force.playerId, [force.id], next.kind, next.target);
      }
    }
  }

  private complete(force: ModernForceState, tick: number): void {
    force.completedMissions++;
    force.lastMissionTick = tick;
    force.command = null;
    force.path = [];
    force.pathIndex = 0;
    force.phase = "idle";
  }

  private tickArmy(force: ModernForceState, tick: number): void {
    const owner = this.game.player(force.playerId);
    if (force.phase !== "attacking" && this.game.owner(force.tile) !== owner) {
      // A front can overrun a formation before its next order. Retreat one
      // adjacent land tile at the normal movement rate, or lose surrounded
      // personnel; neither outcome creates troops in the owner's pool.
      const escape = this.game
        .neighbors(force.tile)
        .find(
          (tile) =>
            this.game.owner(tile) === owner &&
            this.game.isLand(tile) &&
            !this.game.isImpassable(tile),
        );
      if (escape === undefined) {
        force.lastReason = "formation_surrounded";
        this.destroy(force);
        return;
      }
      force.movementProgress +=
        this.hooks.climateMovementEfficiency?.(force.playerId, escape) ?? 1000;
      if (force.movementProgress >= this.rules.armyMoveTicks * 1000) {
        force.tile = escape;
        force.movementProgress -= this.rules.armyMoveTicks * 1000;
        force.lastReason = "front_changed";
        this.complete(force, tick);
      }
      return;
    }
    if (force.phase === "attacking") {
      if (force.command?.viaTransport) {
        const landing = force.path[force.path.length - 1];
        const boat =
          force.unitId !== null
            ? this.game.unit(force.unitId)
            : owner
                .units(UnitType.TransportShip)
                .find(
                  (u) =>
                    u.isActive() &&
                    u.targetTile() === landing &&
                    !this.state.forces.some(
                      (other) =>
                        other !== force &&
                        other.unitId === u.id() &&
                        other.phase !== "destroyed",
                    ),
                );
        if (boat?.isActive()) {
          force.unitId = boat.id();
          force.tile = boat.tile();
          this.observeArmyTroops(force, boat.troops());
          if (force.lastReason === "retreat_requested")
            boat.updateTransportShipState({ isRetreating: true });
          return;
        }
        if (force.unitId !== null) {
          force.unitId = null;
          force.tile = landing;
        }
      }
      const attack = owner
        .outgoingAttacks()
        .find((a) =>
          force.attackId
            ? a.id() === force.attackId
            : !this.state.forces.some(
                (other) =>
                  other !== force &&
                  other.attackId === a.id() &&
                  other.phase !== "destroyed",
              ) &&
              a.sourceTile() ===
                (force.command?.viaTransport
                  ? force.path[force.path.length - 1]
                  : force.tile),
        );
      if (attack) {
        force.attackId = attack.id();
        this.observeArmyTroops(force, attack.troops());
        if (force.lastReason === "retreat_requested")
          this.requestArmyRetreat(attack);
      } else if (tick > force.lastMissionTick + 1) {
        // AttackExecution returns surviving troops to the owner's pool. Move
        // at most the last observed survivors back into this formation; this
        // only transfers existing people and cannot create reinforcements.
        this.recoverArmy(force, tick);
      }
      return;
    }
    if (force.phase !== "moving" || !force.command) return;
    const next = force.path[force.pathIndex + 1];
    if (next === undefined) {
      if (force.command.viaTransport) {
        this.embark(force, tick);
        return;
      }
      this.complete(force, tick);
      return;
    }
    force.movementProgress +=
      this.hooks.climateMovementEfficiency?.(force.playerId, next) ?? 1000;
    if (force.movementProgress < this.rules.armyMoveTicks * 1000) return;
    force.movementProgress -= this.rules.armyMoveTicks * 1000;
    if (this.game.owner(next) !== owner) {
      const target = this.game.owner(next);
      if (
        force.command.kind !== "attack" ||
        (target.isPlayer() && !owner.canAttackPlayer(target)) ||
        !this.game.isLand(next)
      ) {
        force.lastReason = "front_changed";
        this.complete(force, tick);
        return;
      }
      const raw = force.personnel * 10;
      owner.addTroops(raw);
      force.personnel = 0;
      this.game.addExecution(
        new AttackExecution(raw, owner, target.id(), force.tile),
      );
      force.phase = "attacking";
      force.attackId = null;
      force.attackTroops = raw;
      force.lastMissionTick = tick;
      return;
    }
    if (!this.game.isLand(next) || this.game.isImpassable(next)) {
      force.lastReason = "path_terrain_changed";
      this.complete(force, tick);
      return;
    }
    force.tile = next;
    force.pathIndex++;
    if (force.pathIndex >= force.path.length - 1) {
      if (force.command.viaTransport) this.embark(force, tick);
      else this.complete(force, tick);
    }
  }

  private embark(force: ModernForceState, tick: number): void {
    const owner = this.game.player(force.playerId),
      target = force.command!.target;
    const landing = targetTransportTile(this.game, owner, target);
    const departure =
      landing === null
        ? false
        : owner.canBuild(UnitType.TransportShip, landing);
    const water =
      landing === null || departure === false
        ? null
        : PathFinding.Water(this.game).findPath(departure, landing);
    if (!water || landing === null || departure === false) {
      force.lastReason = "no_transport_departure";
      this.complete(force, tick);
      return;
    }
    const raw = force.personnel * 10;
    owner.addTroops(raw);
    force.personnel = 0;
    force.path = water;
    force.pathIndex = 0;
    force.attackTroops = raw;
    force.lastMissionTick = tick;
    force.phase = "attacking";
    force.unitId = null;
    this.game.addExecution(new TransportShipExecution(owner, target, raw));
  }

  private tickNavy(force: ModernForceState, tick: number): void {
    const unit =
      force.unitId === null ? undefined : this.game.unit(force.unitId);
    if (
      !unit ||
      !unit.isActive() ||
      unit.owner().id() !== force.playerId ||
      unit.health() <= 0
    ) {
      this.destroy(force);
      return;
    }
    force.tile = unit.tile();
    while (
      force.pathIndex + 1 < force.path.length &&
      this.game.manhattanDist(force.tile, force.path[force.pathIndex + 1]) <=
        this.game.manhattanDist(force.tile, force.path[force.pathIndex])
    )
      force.pathIndex++;
    if (!force.command && unit.warshipState().state === "patrolling")
      unit.setTargetTile(unit.tile()); // Stop/wait holds position while native combat remains active.
    if (
      force.command?.kind === "escort" &&
      force.command.escortUnitId !== undefined
    ) {
      const transport = this.game.unit(force.command.escortUnitId),
        owner = this.game.player(force.playerId);
      if (!transport?.isActive() || !owner.isFriendly(transport.owner())) {
        force.lastReason = "escort_target_lost";
        this.complete(force, tick);
        return;
      }
      if (
        tick % 10 === unit.id() % 10 &&
        this.game.hasWaterComponent(
          unit.tile(),
          this.game.getWaterComponent(transport.tile())!,
        )
      ) {
        force.command.target = transport.tile();
        if (this.game.manhattanDist(force.tile, transport.tile()) > 2)
          this.game.addExecution(
            new MoveWarshipExecution(owner, [unit.id()], transport.tile()),
          );
      }
    }
    const destination =
      force.command?.kind === "escort"
        ? force.command.target
        : force.path[force.path.length - 1];
    if (
      force.command &&
      destination !== undefined &&
      unit.warshipState().state === "patrolling" &&
      !(force.command.kind === "patrol" && force.phase === "engaging")
    ) {
      // Native MoveWarshipExecution only changes a patrol centre. Pin the
      // modern order's actual water destination so its random patrol radius
      // cannot postpone arrival indefinitely. Repair and combat still use
      // the native warship controller.
      unit.setTargetTile(destination);
    }
    if (
      force.phase === "moving" &&
      force.command &&
      destination !== undefined &&
      (force.command.kind === "escort"
        ? this.game.manhattanDist(force.tile, destination) <= 2
        : force.tile === destination)
    ) {
      if (
        force.command.kind === "blockade" ||
        force.command.kind === "escort" ||
        force.command.kind === "patrol"
      )
        force.phase = "engaging";
      else this.complete(force, tick);
    }
  }

  private tickAir(force: ModernForceState, tick: number): void {
    const owner = this.game.player(force.playerId);
    const base = this.state.bases.find((b) => b.id === force.baseId);
    if (
      (!base ||
        (base.branch ?? "air") !== "air" ||
        (base.completesTick ?? 0) > tick ||
        base.health <= 0 ||
        base.playerId !== owner.id() ||
        this.game.owner(base.tile) !== owner) &&
      ["idle", "rearming", "returning"].includes(force.phase)
    ) {
      force.lastReason = "airbase_unavailable";
      if (force.phase === "returning") this.returnToBase(force);
      else this.destroy(force); // Grounded aircraft cannot depart a captured/destroyed base.
      if (force.phase === "destroyed") return;
    }
    if (tick % this.rules.airUpkeepPeriodTicks === 0 && force.aircraft > 0) {
      const upkeep = BigInt(force.aircraft * this.rules.airUpkeepPerAircraft);
      if (owner.gold() < upkeep) {
        force.lastReason = "insufficient_upkeep";
        if (force.phase === "idle")
          force.cooldownUntil = tick + this.rules.airUpkeepPeriodTicks;
        else this.returnToBase(force);
      } else owner.removeGold(upkeep);
    }
    if (force.phase === "rearming") {
      if (tick >= force.cooldownUntil) force.phase = "idle";
      return;
    }
    if (force.phase === "idle") return;
    this.intercept(force, tick);
    if (force.phase === "destroyed") return;
    if (force.phase === "outbound" || force.phase === "returning") {
      if (force.pathIndex < force.path.length - 1)
        force.tile = force.path[++force.pathIndex];
      if (force.pathIndex < force.path.length - 1) return;
      if (force.phase === "returning") {
        force.command = null;
        force.path = [];
        force.pathIndex = 0;
        force.phase = "rearming";
        force.cooldownUntil = tick + this.rules.airRearmTicks;
        return;
      }
      force.phase = "engaging";
      force.lastMissionTick = tick;
      if (force.kind === "strike") this.strike(force);
      return;
    }
    if (
      force.phase === "engaging" &&
      tick >= force.lastMissionTick + this.rules.airMissionTicks
    ) {
      force.completedMissions++;
      this.returnToBase(force);
    }
  }

  private strike(force: ModernForceState): void {
    if (!force.command || !["strike", "attack"].includes(force.command.kind))
      return;
    const tile = force.command.target,
      target = this.game.owner(tile),
      owner = this.game.player(force.playerId);
    if (!target.isPlayer() || !owner.canAttackPlayer(target)) {
      force.lastReason = "target_changed";
      return;
    }
    target.removeTroops(force.aircraft * this.rules.strikeDamageRawTroops);
    this.hooks.portStrike?.(
      tile,
      force.aircraft * this.rules.strikeStructureDamage,
      force.playerId,
    );
    for (const { unit } of this.game.nearbyUnits(tile, 5, [
      UnitType.Port,
      UnitType.Factory,
      UnitType.City,
      UnitType.SAMLauncher,
    ])) {
      if (unit.owner() !== target || !unit.isActive()) continue;
      if (unit.hasHealth())
        unit.modifyHealth(
          -force.aircraft * this.rules.strikeStructureDamage,
          owner,
        );
      // Structures without HP lose a paid level only on a sufficiently large strike.
      else if (force.aircraft >= 4 && unit.level() > 1)
        unit.decreaseLevel(owner);
    }
    for (const base of this.state.bases)
      if (
        base.playerId === target.id() &&
        this.game.manhattanDist(base.tile, tile) <= 5
      )
        base.health = Math.max(
          0,
          base.health - force.aircraft * this.rules.strikeStructureDamage,
        );
  }

  private intercept(force: ModernForceState, tick: number): void {
    const owner = this.game.player(force.playerId);
    if (tick % 5 !== 0) return;
    const enemies: ModernForceState[] = [];
    const cx = Math.floor(this.game.x(force.tile) / 32),
      cy = Math.floor(this.game.y(force.tile) / 32);
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (const f of this.airGrid.get(`${x}:${y}`) ?? [])
          if (enemies.length < 24) enemies.push(f);
    for (const enemy of enemies) {
      if (
        enemy.branch !== "air" ||
        enemy.kind !== "fighter" ||
        !["outbound", "engaging"].includes(enemy.phase) ||
        enemy.playerId === force.playerId ||
        !this.game.player(enemy.playerId).canAttackPlayer(owner) ||
        this.game.euclideanDistSquared(enemy.tile, force.tile) > 24 * 24
      )
        continue;
      if (
        roll(this.state.seed, tick, enemy.id, force.id) <
        Math.min(600, this.rules.fighterHitPermille * enemy.aircraft)
      ) {
        this.loseAircraft(force, 1);
        break;
      }
    }
    if (force.phase === "destroyed") return;
    for (const { unit } of this.game.nearbyUnits(
      force.tile,
      this.rules.samAircraftRange,
      UnitType.SAMLauncher,
    )) {
      if (
        !unit.owner().canAttackPlayer(owner) ||
        unit.isUnderConstruction() ||
        !unit.isActive() ||
        unit.owner().gold() < BigInt(this.rules.samAircraftCost)
      )
        continue;
      const reload = this.state.samAircraftReloads!.find(
        (r) => r.unitId === unit.id(),
      );
      if (reload && reload.nextTick > tick) continue;
      if (reload) reload.nextTick = tick + this.rules.samAircraftReloadTicks;
      else
        this.state.samAircraftReloads!.push({
          unitId: unit.id(),
          nextTick: tick + this.rules.samAircraftReloadTicks,
        });
      unit.owner().removeGold(BigInt(this.rules.samAircraftCost));
      if (
        roll(this.state.seed, tick, `sam${unit.id()}`, force.id) <
        this.rules.samAircraftHitPermille
      )
        this.loseAircraft(force, 1);
      break; // One AA launcher candidate per force per combat tick.
    }
  }

  private loseAircraft(force: ModernForceState, count: number): void {
    const lost = Math.min(count, force.aircraft),
      personnel = Math.min(
        force.personnel,
        lost * this.rules.personnelPerAircraft,
      );
    force.aircraft -= lost;
    force.personnel -= personnel;
    force.casualties += personnel;
    this.hooks.casualties(force.playerId, "air", personnel);
    if (force.aircraft === 0) this.destroy(force);
  }

  private returnToBase(force: ModernForceState): void {
    const bases = this.state.bases
      .filter(
        (b) =>
          b.playerId === force.playerId &&
          (b.branch ?? "air") === "air" &&
          b.health > 0 &&
          (b.completesTick ?? 0) <= this.game.ticks() &&
          (b.repairUntilTick ?? 0) <= this.game.ticks() &&
          this.game.owner(b.tile).id() === force.playerId &&
          this.state.forces
            .filter(
              (other) =>
                other !== force &&
                other.baseId === b.id &&
                other.branch === "air" &&
                other.phase !== "destroyed",
            )
            .reduce((count, other) => count + other.aircraft, 0) +
            force.aircraft <=
            b.capacity,
      )
      .sort(
        (a, b) =>
          this.game.euclideanDistSquared(force.tile, a.tile) -
            this.game.euclideanDistSquared(force.tile, b.tile) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    const base = bases[0];
    if (
      !base ||
      this.game.euclideanDistSquared(force.tile, base.tile) >
        this.rules.airRangeTiles * this.rules.airRangeTiles
    ) {
      this.destroy(force);
      return;
    }
    force.baseId = base.id;
    force.phase = "returning";
    force.path = airPath(
      this.game,
      force.tile,
      base.tile,
      this.rules.airMoveTilesPerTick,
    );
    force.pathIndex = 0;
  }

  private destroy(force: ModernForceState): void {
    if (force.personnel > 0)
      this.hooks.casualties(force.playerId, force.branch, force.personnel);
    force.casualties += force.personnel;
    force.personnel = 0;
    force.aircraft = 0;
    force.phase = "destroyed";
    force.command = null;
    force.queue = [];
    force.path = [];
  }
}
