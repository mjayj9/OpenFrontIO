import { AttackExecution } from "../execution/AttackExecution";
import { MoveWarshipExecution } from "../execution/MoveWarshipExecution";
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
      force.tile,
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
        force.tile,
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
    const path = PathFinding.Water(game).findPath(unit.tile(), target);
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
      b.playerId === force.playerId &&
      b.health > 0 &&
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
  constructor(
    private game: Game,
    readonly state: ModernForcesState,
    private hooks: ModernForceHooks,
    readonly rules: ModernForceRules = DEFAULT_MODERN_FORCE_RULES,
  ) {
    state.samAircraftReloads ??= [];
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
    if (force.command && this.game.owner(force.command.target) === owner)
      force.tile = force.command.target;
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
    this.produce(playerId, "army", "army", undefined, capital, 1, true);
    const base = this.state.bases.find((b) => b.playerId === playerId);
    if (base) {
      this.produce(playerId, "air", "fighter", base.id, undefined, 4, true);
      this.produce(playerId, "air", "strike", base.id, undefined, 4, true);
    }
  }

  private nextId(prefix: string): string {
    return `${prefix}-${this.state.nextForceId++}`;
  }
  private createBase(
    playerId: PlayerID,
    tile: TileRef,
    free = false,
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
      this.state.bases.filter((b) => b.playerId === playerId).length >=
        this.rules.maxBasesPerFaction ||
      this.state.bases.some((b) => b.tile === tile)
    )
      return null;
    if (!free && owner.gold() < BigInt(this.rules.airbaseCost)) return null;
    if (!free) owner.removeGold(BigInt(this.rules.airbaseCost));
    const base = {
      id: this.nextId("base"),
      playerId,
      tile,
      capacity: this.rules.airbaseCapacity,
      health: this.rules.airbaseHealth,
      maxHealth: this.rules.airbaseHealth,
    };
    this.state.bases.push(base);
    return base;
  }

  produce(
    playerId: PlayerID,
    branch: ModernBranch,
    kind: ModernForceKind | "airbase",
    baseId: string | undefined,
    tile: TileRef | undefined,
    count: number,
    free = false,
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
    if (kind === "airbase")
      return branch !== "air" ||
        count !== 1 ||
        tile === undefined ||
        !this.createBase(playerId, tile, free)
        ? "airbase_requires_owned_land_and_gold"
        : null;
    if (
      (branch === "army" && kind !== "army") ||
      (branch === "navy" && kind !== "warship") ||
      (branch === "air" && kind !== "fighter" && kind !== "strike")
    )
      return "wrong_branch_mission";
    if (
      this.state.forces.filter(
        (f) => f.playerId === playerId && f.phase !== "destroyed",
      ).length >= this.rules.maxForcesPerFaction
    )
      return "force_limit";
    let base: ModernBaseState | undefined,
      unitId: number | null = null;
    const personnel =
      branch === "army"
        ? count * this.rules.armyPersonnelPerGroup
        : branch === "navy"
          ? count * this.rules.navyPersonnelPerWarship
          : count * this.rules.personnelPerAircraft;
    const cost =
      branch === "army"
        ? 0n
        : branch === "navy"
          ? this.game.unitInfo(UnitType.Warship).cost(this.game, owner)
          : BigInt(
              count *
                (kind === "fighter"
                  ? this.rules.fighterCost
                  : this.rules.strikeCost),
            );
    if (!free && owner.gold() < cost) return "insufficient_gold";
    if (branch === "air") {
      base = this.state.bases.find(
        (b) =>
          b.id === baseId &&
          b.playerId === playerId &&
          b.health > 0 &&
          this.game.owner(b.tile) === owner,
      );
      if (!base) return "airbase_unavailable";
      const stationed = this.state.forces
        .filter((f) => f.baseId === base!.id && f.phase !== "destroyed")
        .reduce((sum, f) => sum + f.aircraft, 0);
      if (stationed + count > base.capacity) return "airbase_capacity";
      tile = base.tile;
    } else if (tile === undefined || !this.game.isValidRef(tile))
      return "invalid_target";
    if (
      branch === "army" &&
      (this.game.owner(tile!) !== owner ||
        !this.game.isLand(tile!) ||
        this.game.isImpassable(tile!))
    )
      return "army_requires_owned_land";
    if (branch === "navy") {
      if (count !== 1 || this.game.config().isUnitDisabled(UnitType.Warship))
        return "warship_disabled_or_count";
      if (!this.game.isWater(tile!))
        tile = this.game.neighbors(tile!).find((t) => this.game.isWater(t));
      if (tile === undefined) return "warship_requires_port";
      const spawn = owner.canBuild(UnitType.Warship, tile);
      if (spawn === false) return "warship_requires_port";
      tile = spawn;
    }
    if (!this.hooks.reserve(playerId, branch, personnel))
      return "insufficient_manpower";
    if (branch === "army") {
      if (owner.troops() < personnel * 10) {
        this.hooks.release(playerId, branch, personnel);
        return "insufficient_army_reserve";
      }
      owner.removeTroops(personnel * 10);
    } else if (branch === "navy") {
      const unit = owner.buildUnit(UnitType.Warship, tile!, {
        patrolTile: tile!,
      });
      unitId = unit.id();
      this.game.addExecution(new WarshipExecution(unit));
    } else if (!free) owner.removeGold(cost);
    this.state.forces.push({
      id: this.nextId("force"),
      playerId,
      branch,
      kind,
      tile: tile!,
      baseId: base?.id ?? null,
      personnel,
      aircraft: branch === "air" ? count : 0,
      unitId,
      phase: branch === "air" && !free ? "rearming" : "idle",
      command: null,
      queue: [],
      path: [],
      pathIndex: 0,
      cooldownUntil:
        branch === "air" && !free
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
    return null;
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
    if (force.attackId)
      this.game.player(force.playerId).orderRetreat(force.attackId);
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

  committedArmyRaw(playerId: PlayerID): number {
    return this.state.forces
      .filter(
        (f) =>
          f.playerId === playerId &&
          f.branch === "army" &&
          f.phase !== "destroyed",
      )
      .reduce((sum, f) => sum + f.personnel * 10, 0);
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
    for (const base of this.state.bases) {
      const owner = this.game.owner(base.tile);
      if (owner.isPlayer() && owner.id() !== base.playerId)
        base.playerId = owner.id();
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
          owner.orderRetreat(attack.id());
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
          b.health > 0 &&
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
