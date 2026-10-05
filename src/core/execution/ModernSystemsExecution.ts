import { z } from "zod";
import { Execution, Game, MessageType } from "../game/Game";
import { GameUpdateType } from "../game/GameUpdates";
import { modernSystemsFor } from "../modern/ModernSystems";
import { Intent, IntentSchema } from "../Schemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";

export class ModernSystemsExecution implements Execution {
  private game: Game;
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
