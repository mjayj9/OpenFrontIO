// @vitest-environment node
import { PlayerType } from "../src/core/game/Game";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
  GameRunner,
} from "../src/core/GameRunner";
import { GameStartInfoSchema } from "../src/core/Schemas";
import { diffSnapshots } from "./util/Snapshot";
import {
  TRAINING_LOADER as loader,
  TRAINING_START as start,
} from "./util/TrainingFixture";
function step(runner: GameRunner): void {
  runner.addTurn({ turnNumber: runner.game.ticks(), intents: [] });
  expect(runner.executeNextTick()).toBe(true);
}
describe("Dedicated training production map and runner integration", () => {
  it("prepares Four Islands without random spawn duplication and continues the saved match", async () => {
    expect(GameStartInfoSchema.safeParse(start).success).toBe(true);
    const errors: unknown[] = [];
    const runner = await createGameRunner(
      start,
      "Trainer1",
      loader,
      (update) => {
        if ("errMsg" in update) errors.push(update);
      },
    );
    step(runner);
    step(runner);
    const human = runner.game.playerByClientID("Trainer1")!;
    expect(human.hasSpawned()).toBe(true);
    expect(human.numTilesOwned()).toBe(1200);
    expect(runner.game.isShoreline(human.spawnTile()!)).toBe(true);
    expect(
      runner.game
        .players()
        .filter((p) => p.type() === PlayerType.Bot)
        .map((p) => p.id()),
    ).toEqual(["TrainBot01"]);
    expect(
      runner.game
        .players()
        .filter((p) => p.type() === PlayerType.Nation)
        .map((p) => p.id()),
    ).toEqual(["TrainNat01"]);
    expect(runner.game.inSpawnPhase()).toBe(false);
    const snapshot = runner.snapshot();
    const restored = await createGameRunnerFromSnapshot(
      start,
      snapshot,
      "Trainer1",
      loader,
      (update) => {
        if ("errMsg" in update) errors.push(update);
      },
    );
    for (let tick = 0; tick < 20; tick++) {
      step(runner);
      step(restored);
    }
    expect(errors).toEqual([]);
    expect(diffSnapshots(runner.snapshot(), restored.snapshot())).toEqual([]);
  }, 30_000);
});
