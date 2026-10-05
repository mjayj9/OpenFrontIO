import { z } from "zod";
import { Execution, Game, PlayerType, UnitType } from "../game/Game";
import { MODERN_RULES } from "../modern/ModernRules";
import { modernSystemsFor } from "../modern/ModernSystems";
import { PathFinding } from "../pathfinding/PathFinder";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";

/** A paid, finite opponent response in the optional port practice scenario.
 * The student must actually take/develop a port and defeat or displace the ship.
 * It never manufactures personnel, teleports ships, or changes normal games. */
export class ModernPortTrainingExecution implements Execution {
  private game: Game;
  private stage:
    | "waiting"
    | "building"
    | "approaching"
    | "blockaded"
    | "complete" = "waiting";
  private portId: string | null = null;
  private forceId: string | null = null;
  private productionUnitId: number | null = null;
  private nextThinkTick = 0;
  init(game: Game): void {
    this.game = game;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  isActive(): boolean {
    return this.stage !== "complete";
  }
  tick(tick: number): void {
    if (tick < this.nextThinkTick) return;
    this.nextThinkTick = tick + 20;
    const systems = modernSystemsFor(this.game);
    if (!systems) {
      this.stage = "complete";
      return;
    }
    const human = this.game
      .players()
      .find((p) => p.type() === PlayerType.Human);
    if (!human) {
      this.stage = "complete";
      return;
    }
    if (this.stage === "waiting") {
      const port = systems.state.ports.find(
        (p) =>
          p.ownerId === human.id() &&
          p.captureCount > 0 &&
          p.incomePerSecond > 0,
      );
      if (!port || this.game.config().isUnitDisabled(UnitType.Warship)) return;
      const candidates = systems.state.ports
        .filter(
          (p) =>
            p.ownerId &&
            p.ownerId !== human.id() &&
            p.unitId !== null &&
            p.damage < 1000,
        )
        .sort(
          (a, b) =>
            this.game.manhattanDist(a.tile, port.tile) -
              this.game.manhattanDist(b.tile, port.tile) || a.tile - b.tile,
        )
        .slice(0, 32);
      for (const source of candidates) {
        const enemy = this.game.player(source.ownerId!);
        if (
          !enemy.isAlive() ||
          enemy.isFriendly(human) ||
          enemy.gold() < BigInt(MODERN_RULES.forces.warshipCost)
        )
          continue;
        const water = this.game
          .neighbors(source.tile)
          .find((tile) => this.game.isWater(tile));
        const spawn =
          water === undefined ? false : enemy.canBuild(UnitType.Warship, water);
        if (
          spawn === false ||
          !PathFinding.Water(this.game).findPath(spawn, port.tile)
        )
          continue;
        const reason = systems.forces.produce(
          enemy.id(),
          "navy",
          "warship",
          undefined,
          source.tile,
          1,
        );
        if (reason) continue;
        const job = systems.state.production?.find(
          (p) => p.playerId === enemy.id() && p.kind === "warship",
        );
        if (job) {
          this.productionUnitId = job.unitId ?? null;
          this.portId = port.portId;
          this.stage = "building";
          return;
        }
        const force = systems.state.forces.find(
          (f) =>
            f.playerId === enemy.id() &&
            f.branch === "navy" &&
            f.phase !== "destroyed",
        );
        if (!force) continue;
        const command = systems.forces.command(
          enemy.id(),
          [force.id],
          "blockade",
          port.tile,
        )[0];
        if (command.reason) {
          // Retain the honestly paid ship; never repeatedly buy unreachable ships.
          this.forceId = force.id;
          this.portId = port.portId;
          this.stage = "complete";
          return;
        }
        this.forceId = force.id;
        this.portId = port.portId;
        this.stage = "approaching";
        return;
      }
      return;
    }
    const port = systems.state.ports.find((p) => p.portId === this.portId);
    if (this.stage === "building") {
      const ship =
        this.productionUnitId === null
          ? undefined
          : this.game.unit(this.productionUnitId);
      if (!ship?.isActive() || !port || port.ownerId !== human.id()) {
        this.stage = "complete";
        return;
      }
      const built = systems.state.forces.find(
        (f) =>
          f.unitId === this.productionUnitId &&
          f.branch === "navy" &&
          f.phase !== "destroyed",
      );
      if (!built) return;
      this.forceId = built.id;
      const command = systems.forces.command(
        built.playerId,
        [built.id],
        "blockade",
        port.tile,
      )[0];
      this.stage = command.reason ? "complete" : "approaching";
      return;
    }
    const force = systems.state.forces.find((f) => f.id === this.forceId);
    if (
      !port ||
      !force ||
      force.phase === "destroyed" ||
      port.ownerId !== human.id()
    ) {
      this.stage = "complete";
      return;
    }
    if (port.blockadedBy.includes(force.playerId)) this.stage = "blockaded";
    else if (this.stage === "blockaded") this.stage = "complete";
  }
  snapshot(): ExecRecord {
    return ModernPortTrainingExecutionSnapshot.write({
      initialized: this.game !== undefined,
      stage: this.stage,
      portId: this.portId,
      forceId: this.forceId,
      productionUnitId: this.productionUnitId,
      nextThinkTick: this.nextThinkTick,
    });
  }
  restoreSnapshot(
    state: ModernPortTrainingState,
    reader: SnapshotReader,
  ): void {
    this.stage = state.stage;
    this.portId = state.portId;
    this.forceId = state.forceId;
    this.productionUnitId = state.productionUnitId;
    this.nextThinkTick = state.nextThinkTick;
    if (state.initialized) this.game = reader.game;
  }
}
const ModernPortTrainingSchema = z.object({
  initialized: z.boolean(),
  stage: z.enum([
    "waiting",
    "building",
    "approaching",
    "blockaded",
    "complete",
  ]),
  portId: z.string().nullable(),
  forceId: z.string().nullable(),
  productionUnitId: z.number().int().nonnegative().nullable(),
  nextThinkTick: z.number().int().nonnegative(),
});
type ModernPortTrainingState = z.infer<typeof ModernPortTrainingSchema>;
export const ModernPortTrainingExecutionSnapshot = execSnapshotType({
  name: "ModernPortTraining",
  version: 2,
  migrations: { 1: (data) => ({ ...data, productionUnitId: null }) },
  schema: ModernPortTrainingSchema,
  cls: () => ModernPortTrainingExecution,
});
