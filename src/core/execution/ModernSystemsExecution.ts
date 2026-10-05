import { z } from "zod";
import { Execution, Game, MessageType } from "../game/Game";
import { GameUpdateType, ModernForceRouteUpdate } from "../game/GameUpdates";
import {
  MODERN_FORCE_PHASES,
  ModernForceState,
} from "../modern/ModernForceTypes";
import { modernSystemsFor } from "../modern/ModernSystems";
import { Intent, IntentSchema } from "../Schemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";

export class ModernSystemsExecution implements Execution {
  private game: Game;
  /** Derived display cache, deliberately absent from snapshots and decisions. */
  private forceFrame: number[] = [];
  private forceRoutes: {
    path: ModernForceState["path"];
    command: ModernForceState["command"];
    commandTarget: number | undefined;
    queue: ModernForceState["queue"];
    queueLength: number;
    phase: ModernForceState["phase"];
    cooldownUntil: number;
    lastReason: string | null;
  }[] = [];
  init(game: Game): void {
    this.game = game;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  isActive(): boolean {
    return true;
  }
  tick(tick: number): void {
    const systems = modernSystemsFor(this.game);
    if (!systems) return;
    systems.tick(tick);
    const positions: number[] = [];
    const routes: ModernForceRouteUpdate[] = [];
    for (let index = 0; index < systems.state.forces.length; index++) {
      const force = systems.state.forces[index],
        offset = index * 8;
      const previous = this.forceRoutes[index];
      if (
        !previous ||
        previous.path !== force.path ||
        previous.command !== force.command ||
        previous.commandTarget !== force.command?.target ||
        previous.queue !== force.queue ||
        previous.queueLength !== force.queue.length ||
        previous.phase !== force.phase ||
        previous.cooldownUntil !== force.cooldownUntil ||
        previous.lastReason !== force.lastReason
      ) {
        // Core-owned arrays are replaced on route changes. Queue push/shift is
        // detected by its length; a changed command/phase covers activation.
        routes.push(
          structuredClone({
            index,
            command: force.command,
            queue: force.queue,
            path: force.path,
            cooldownUntil: force.cooldownUntil,
            lastReason: force.lastReason,
          }),
        );
        this.forceRoutes[index] = {
          path: force.path,
          command: force.command,
          commandTarget: force.command?.target,
          queue: force.queue,
          queueLength: force.queue.length,
          phase: force.phase,
          cooldownUntil: force.cooldownUntil,
          lastReason: force.lastReason,
        };
      }
      const phase = MODERN_FORCE_PHASES.indexOf(force.phase),
        raw = Math.floor(force.attackTroops);
      const frontier =
        force.phase === "attacking"
          ? (force.path[1] ?? 0xffffffff)
          : 0xffffffff;
      if (
        this.forceFrame[offset] === force.tile &&
        this.forceFrame[offset + 1] === phase &&
        this.forceFrame[offset + 2] === force.pathIndex &&
        this.forceFrame[offset + 3] === force.personnel &&
        this.forceFrame[offset + 4] === force.aircraft &&
        this.forceFrame[offset + 5] === raw &&
        this.forceFrame[offset + 6] === frontier &&
        this.forceFrame[offset + 7] === force.lastMissionTick
      )
        continue;
      positions.push(
        index,
        force.tile,
        phase,
        force.pathIndex,
        force.personnel,
        force.aircraft,
        raw,
        frontier,
        force.lastMissionTick,
      );
      this.forceFrame[offset] = force.tile;
      this.forceFrame[offset + 1] = phase;
      this.forceFrame[offset + 2] = force.pathIndex;
      this.forceFrame[offset + 3] = force.personnel;
      this.forceFrame[offset + 4] = force.aircraft;
      this.forceFrame[offset + 5] = raw;
      this.forceFrame[offset + 6] = frontier;
      this.forceFrame[offset + 7] = force.lastMissionTick;
    }
    if (positions.length > 0 || routes.length > 0)
      this.game.addUpdate({
        type: GameUpdateType.ModernForcesFrame,
        tick,
        positions: Uint32Array.from(positions),
        routes: routes.length > 0 ? routes : undefined,
      });
    if (tick % 10 === 0)
      this.game.addUpdate({
        type: GameUpdateType.ModernSystems,
        state: structuredClone(systems.state),
      });
  }
  snapshot(): ExecRecord {
    return ModernSystemsExecutionSnapshot.write({
      initialized: this.game !== undefined,
    });
  }
  restoreSnapshot(s: { initialized: boolean }, r: SnapshotReader): void {
    this.forceFrame = [];
    this.forceRoutes = [];
    if (s.initialized) this.game = r.game;
  }
}
export const ModernSystemsExecutionSnapshot = execSnapshotType({
  name: "ModernSystems",
  version: 1,
  schema: z.object({ initialized: z.boolean() }),
  cls: () => ModernSystemsExecution,
});

type ModernIntent = Extract<
  Intent,
  {
    type:
      | "modern_command"
      | "modern_produce"
      | "modern_develop"
      | "modern_repair"
      | "modern_train";
  }
>;
export class ModernCommandExecution implements Execution {
  private game: Game;
  private active = true;
  constructor(
    private playerId: string,
    private intent: ModernIntent,
  ) {}
  init(game: Game): void {
    this.game = game;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  isActive(): boolean {
    return this.active;
  }
  tick(): void {
    this.active = false;
    const systems = modernSystemsFor(this.game);
    if (!systems) return;
    const player = this.game.player(this.playerId);
    if (!player.isAlive()) return;
    const intent = this.intent;
    let reason: string | null = null;
    switch (intent.type) {
      case "modern_command":
        reason =
          systems.forces
            .command(
              this.playerId,
              intent.forceIds,
              intent.command,
              intent.target,
              intent.queue,
            )
            .find((result) => result.reason !== null)?.reason ?? null;
        break;
      case "modern_produce":
        reason = systems.forces.produce(
          this.playerId,
          intent.branch,
          intent.kind,
          intent.baseId,
          intent.tile,
          intent.count,
          false,
          intent.source,
        );
        break;
      case "modern_develop":
        if (!systems.portAction(this.playerId, intent.portId, "develop"))
          reason = "port_unavailable";
        break;
      case "modern_repair":
        if (!systems.portAction(this.playerId, intent.portId, "repair"))
          reason = "port_unavailable";
        break;
      case "modern_train":
        if (!systems.train(this.playerId, intent.climate))
          reason = "training_unavailable";
        break;
    }
    if (reason)
      this.game.displayMessage(
        `modern_v2.reason.${reason}`,
        MessageType.ATTACK_FAILED,
        this.playerId,
      );
    this.game.addUpdate({
      type: GameUpdateType.ModernSystems,
      state: structuredClone(systems.state),
    });
  }
  snapshot(): ExecRecord {
    return ModernCommandExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== undefined,
      playerId: this.playerId,
      intent: this.intent,
    });
  }
  restoreSnapshot(s: ModernCommandState, r: SnapshotReader): void {
    this.active = s.active;
    this.playerId = s.playerId;
    this.intent = s.intent as ModernIntent;
    if (s.initialized) this.game = r.game;
  }
}
const ModernCommandSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  playerId: z.string(),
  intent: IntentSchema.refine((intent) => intent.type.startsWith("modern_")),
});
type ModernCommandState = z.infer<typeof ModernCommandSchema>;
export const ModernCommandExecutionSnapshot = execSnapshotType({
  name: "ModernCommand",
  version: 1,
  schema: ModernCommandSchema,
  cls: () => ModernCommandExecution,
});
