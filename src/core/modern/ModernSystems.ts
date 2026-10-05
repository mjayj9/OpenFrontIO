import { Game, Player, UnitType } from "../game/Game";
import { ModernAI } from "./ModernAI";
import {
  climateAt,
  climateCombatEfficiency,
  climateMovementEfficiency,
} from "./ModernClimate";
import { ModernForces } from "./ModernForces";
import { ModernBranch } from "./ModernForceTypes";
import { MODERN_RULES as R } from "./ModernRules";
import {
  ClimateId,
  ModernState,
  modernFactionState,
  nuclearEffects,
} from "./ModernState";

export { assignModernLevel } from "./ModernAssignments";
export function modernIncome(
  game: Game,
  player: Player,
  amount: bigint,
): bigint {
  const faction = player.modernFaction?.();
  if (!faction) return amount;
  const loss = nuclearEffects(faction, game.ticks()).incomeLossPermille;
  return (amount * BigInt(1000 - loss)) / 1000n;
}
export function registerModernNuclearLaunch(
  game: Game,
  player: Player,
  launchId: number,
): void {
  const faction = modernFactionState(game.modernSystems(), player.id());
  if (!faction || faction.nuclearStrikes.some((s) => s.launchId === launchId))
    return;
  faction.nuclearStrikes.push({
    launchId,
    expiresTick: game.ticks() + R.nuclearDurationTicks,
  });
  for (const other of game.players())
    if (other !== player) other.updateRelation(player, -R.nuclearTrustLoss);
}
export class ModernSystems {
  readonly forces: ModernForces;
  private readonly ai: ModernAI;
  constructor(
    private game: Game,
    readonly state: ModernState,
  ) {
    this.forces = new ModernForces(
      game,
      state,
      {
        reserve: (id, branch, count) => this.reserve(id, branch, count),
        release: (id, branch, count) => this.release(id, branch, count),
        casualties: (id, branch, count) => this.casualties(id, branch, count),
        climateEfficiency: (id, tile) =>
          climateCombatEfficiency(modernFactionState(state, id), tile),
        climateMovementEfficiency: (id, tile) =>
          climateMovementEfficiency(modernFactionState(state, id), tile),
        portStrike: (tile, damage) => {
          for (const port of state.ports)
            if (game.manhattanDist(tile, port.tile) <= 5)
              port.damage = Math.min(1000, port.damage + damage);
        },
      },
      R.forces,
    );
    this.ai = new ModernAI(game, state, this.forces, {
      developPort: (id, port, action) => this.portAction(id, port, action),
      trainClimate: (id, climate) => this.train(id, climate),
      climateAt,
      climateEfficiency: (id, tile) =>
        climateCombatEfficiency(modernFactionState(state, id), tile),
    });
  }
  reserve(id: string, branch: ModernBranch, count: number): boolean {
    const f = modernFactionState(this.state, id);
    if (!f || count < 0 || !Number.isInteger(count)) return false;
    if (branch === "army") return f.population.army >= count;
    if (f.population.available < count) return false;
    f.population.available -= count;
    f.population[branch] += count;
    return true;
  }
  release(id: string, branch: ModernBranch, count: number): void {
    const f = modernFactionState(this.state, id);
    if (!f || branch === "army") return;
    const released = Math.min(count, f.population[branch]);
    f.population[branch] -= released;
    f.population.available += released;
  }
  casualties(id: string, branch: ModernBranch, count: number): void {
    const f = modernFactionState(this.state, id);
    if (!f) return;
    const lost = Math.min(count, f.population[branch]);
    f.population[branch] -= lost;
    f.population.total -= lost;
    f.population.dead += lost;
  }
  /** Army people stay counted while on an attack, in transport, or in a selected group. */
  reconcileArmy(player: Player): void {
    const f = modernFactionState(this.state, player.id());
    if (!f) return;
    const raw =
      player.troops() +
      player.outgoingAttacks().reduce((n, a) => n + a.troops(), 0) +
      player.units(UnitType.TransportShip).reduce((n, u) => n + u.troops(), 0) +
      this.forces.committedArmyRaw(player.id());
    const actual = Math.max(0, Math.floor(raw / R.rawTroopsPerPerson));
    if (actual < f.population.army)
      this.casualties(player.id(), "army", f.population.army - actual);
    else if (actual > f.population.army) {
      // Donations/returned troops can transfer personnel, never create people.
      const needed = actual - f.population.army;
      const admitted = Math.min(needed, f.population.available);
      f.population.available -= admitted;
      f.population.army += admitted;
      if (admitted < needed)
        player.removeTroops((needed - admitted) * R.rawTroopsPerPerson);
    }
  }
  economy(player: Player): void {
    const f = modernFactionState(this.state, player.id());
    if (!f || f.populationTransferredTo) return;
    this.reconcileArmy(player);
    const p = f.population;
    const levels = (type: UnitType) =>
      player
        .units(type)
        .filter((u) => u.isActive() && !u.isUnderConstruction())
        .reduce((n, u) => n + u.level(), 0);
    const cities = Math.max(0, levels(UnitType.City) - 1),
      factories = Math.max(0, levels(UnitType.Factory) - 1);
    const train = Math.min(
      R.civilianTrainingCapPerTick,
      R.civilianTrainingPerTick + cities,
      p.civilian,
      Math.max(
        0,
        Math.floor((p.total * R.availableCapPermille) / 1000) - p.available,
      ),
      Math.floor(Number(player.gold()) / R.trainingGoldPerPerson),
    );
    p.civilian -= train;
    p.available += train;
    player.removeGold(BigInt(train * R.trainingGoldPerPerson));
    const loss = nuclearEffects(f, this.game.ticks()).replenishmentLossPermille;
    // Integer budget over 100 ticks preserves the exact rate, without floating point drift.
    const replenish =
      this.game.ticks() % 100 < 100 - Math.floor(loss / 10)
        ? R.replenishmentPerTick
        : 0;
    const people = Math.min(
      replenish,
      p.available,
      Math.max(
        0,
        Math.floor((p.total * R.mobilizationPermille) / 1000) -
          p.army -
          p.navy -
          p.air,
      ),
    );
    p.available -= people;
    p.army += people;
    player.addTroops(people * R.rawTroopsPerPerson);
    const industry = Math.min(
      R.industryIncomeCapPerTick,
      cities * R.cityIncomePerExtraLevel +
        factories * R.factoryIncomePerExtraLevel,
    );
    const gold = modernIncome(
      this.game,
      player,
      BigInt(R.workerGoldPerTick + industry),
    );
    f.workerIncomePerTick = Number(gold);
    player.addGold(gold);
    this.game.stats().goldWork(player, gold);
  }
  /** Population moves only once on complete annexation; partial tile captures grant no new N0. */
  annex(conqueror: Player, conquered: Player): void {
    const to = modernFactionState(this.state, conqueror.id()),
      from = modernFactionState(this.state, conquered.id());
    if (
      !to ||
      !from ||
      conquered.numTilesOwned() > 0 ||
      from.populationTransferredTo
    )
      return;
    const civilians = from.population.civilian + from.population.available;
    to.population.civilian += civilians;
    to.population.total += civilians;
    from.population.total -= civilians;
    from.population.civilian = 0;
    from.population.available = 0;
    from.populationTransferredTo = to.playerId;
    this.casualties(from.playerId, "army", from.population.army);
    conquered.setTroops(0);
  }
  train(id: string, climate: ClimateId): boolean {
    const f = modernFactionState(this.state, id),
      player = this.game.player(id);
    if (
      !f ||
      f.climateTraining ||
      f.climateAdaptation.includes(climate) ||
      player.gold() < BigInt(R.climateTrainingGold)
    )
      return false;
    player.removeGold(BigInt(R.climateTrainingGold));
    f.climateTraining = {
      climate,
      completesTick: this.game.ticks() + R.climateTrainingTicks,
    };
    return true;
  }
  portAction(
    id: string,
    portId: string,
    action: "develop" | "repair",
  ): boolean {
    const port = this.state.ports.find((p) => p.portId === portId),
      player = this.game.player(id);
    if (
      !port ||
      this.game.owner(port.tile) !== player ||
      port.unitId === null ||
      !player.isAlive()
    )
      return false;
    if (action === "repair") {
      if (
        port.damage === 0 ||
        port.repairUntilTick !== null ||
        player.gold() < BigInt(R.portRepairGold)
      )
        return false;
      player.removeGold(BigInt(R.portRepairGold));
      port.repairUntilTick = this.game.ticks() + R.portRepairTicks;
      return true;
    }
    if (
      port.level >= 3 ||
      port.development ||
      player.gold() < BigInt(R.portDevelopmentGold[port.level])
    )
      return false;
    player.removeGold(BigInt(R.portDevelopmentGold[port.level]));
    port.development = {
      targetLevel: port.level + 1,
      completesTick: this.game.ticks() + R.portDevelopmentTicks[port.level],
    };
    return true;
  }
  private tickPorts(tick: number): void {
    for (const port of this.state.ports) {
      const owner = this.game.owner(port.tile),
        ownerId = owner.isPlayer() ? owner.id() : null;
      if (ownerId !== port.ownerId) {
        port.ownerId = ownerId;
        port.captureCount++;
      }
      const units = this.game
        .nearbyUnits(port.tile, 1, UnitType.Port)
        .map((u) => u.unit)
        .filter(
          (u) =>
            u.tile() === port.tile &&
            u.isActive() &&
            !u.isUnderConstruction() &&
            u.owner().id() === ownerId,
        );
      port.unitId = units[0]?.id() ?? null;
      if (this.game.hasFallout(port.tile))
        port.damage = Math.min(1000, port.damage + 20);
      if (port.unitId === null) port.damage = 1000;
      if (port.development && tick >= port.development.completesTick) {
        port.level = port.development.targetLevel;
        port.development = null;
      }
      if (port.repairUntilTick !== null && tick >= port.repairUntilTick) {
        port.damage = 0;
        port.repairUntilTick = null;
      }
      port.blockadedBy = this.game
        .nearbyUnits(port.tile, R.portBlockadeRange, UnitType.Warship)
        .map((n) => n.unit.owner())
        .filter((p) => owner.isPlayer() && !owner.isFriendly(p))
        .map((p) => p.id())
        .filter((id, i, a) => a.indexOf(id) === i)
        .sort();
      const operation =
        port.unitId === null
          ? 0
          : Math.floor(
              ((1000 - port.damage) * (port.blockadedBy.length ? 250 : 1000)) /
                1000,
            );
      // Flat infrastructure income is independent of trade-ship payouts.
      const grossIncome = Math.floor(
        (R.portBaseIncomePerSecond *
          R.portLevelEfficiencyPermille[port.level] *
          operation) /
          1_000_000,
      );
      port.incomePerSecond = owner.isPlayer()
        ? Number(
            modernIncome(
              this.game,
              this.game.player(owner.id()),
              BigInt(grossIncome),
            ),
          )
        : 0;
      if (
        owner.isPlayer() &&
        port.incomePerSecond > 0 &&
        tick > port.lastIncomeTick
      ) {
        const p = this.game.player(owner.id());
        p.addGold(BigInt(port.incomePerSecond));
      }
      port.lastIncomeTick = tick;
    }
  }
  tick(tick: number): void {
    this.state.tick = tick;
    this.forces.tick(tick);
    for (const f of this.state.factions) {
      f.nuclearStrikes = f.nuclearStrikes.filter((s) => s.expiresTick > tick);
      if (f.climateTraining && tick >= f.climateTraining.completesTick) {
        if (f.climateAdaptation.length >= 2) f.climateAdaptation.shift();
        f.climateAdaptation.push(f.climateTraining.climate);
        delete f.climateTraining;
        f.completedTraining++;
      }
    }
    if (tick % 10 === 0) this.tickPorts(tick);
    this.ai.tick(tick);
  }
}
const cache = new WeakMap<Game, ModernSystems>();
export function modernSystemsFor(game: Game): ModernSystems | null {
  const state = game.modernSystems();
  if (!state) return null;
  let systems = cache.get(game);
  if (!systems || systems.state !== state) {
    systems = new ModernSystems(game, state);
    cache.set(game, systems);
  }
  return systems;
}
