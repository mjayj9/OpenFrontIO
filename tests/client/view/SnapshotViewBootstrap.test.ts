import { describe, expect, it, vi } from "vitest";
import { WebGLFrameBuilder } from "../../../src/client/WebGLFrameBuilder";
import { GameRunner } from "../../../src/core/GameRunner";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import { PlayerInfo, PlayerType, UnitType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { GameMapImpl } from "../../../src/core/game/GameMap";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { snapshotGame } from "../../../src/core/snapshot/GameSnapshot";
import { setup } from "../../util/Setup";
import { diffSnapshots, roundTrip } from "../../util/Snapshot";
import { makeGameView } from "../../util/viewStubs";

describe("Paused snapshot view bootstrap", () => {
  it("decodes real ownership, flags and changed terrain and uploads the full initial frame", async () => {
    const game = await setup("plains", { instantBuild: true });
    const alice = game.addPlayer(
      new PlayerInfo("Alice", PlayerType.Human, "client_a", "alice"),
    );
    const bob = game.addPlayer(
      new PlayerInfo("Bob", PlayerType.Human, "client_b", "bob"),
    );
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) alice.conquer(game.ref(x, y));
      for (let x = 20; x < 30; x++) bob.conquer(game.ref(x, y));
    }
    alice.setSpawnTile(game.ref(10, 10));
    bob.setSpawnTile(game.ref(25, 10));
    const city = alice.buildUnit(UnitType.City, game.ref(8, 8), {});
    const post = bob.buildUnit(UnitType.DefensePost, game.ref(22, 8), {});
    const defendedTile = game.ref(21, 8);
    (game.map() as GameMapImpl).setDefenseBonus(defendedTile, true);
    const falloutTile = game.ref(40, 40);
    const waterTile = game.ref(50, 50);
    game.setFallout(falloutTile, true);
    game.setWater(waterTile);
    game.setPaused(true);

    const { restored } = await roundTrip(game, "plains");
    const before = snapshotGame(restored);
    const runner = new GameRunner(
      restored,
      new Executor(restored, "Restore1", "client_a"),
      () => {
        throw new Error("A paused view bootstrap must not execute a turn");
      },
    );
    const initialView = runner.fullViewUpdate();
    expect(initialView.updates[GameUpdateType.GamePaused]).toEqual([
      { type: GameUpdateType.GamePaused, paused: true },
    ]);
    expect(initialView.packedTileUpdates).toHaveLength(
      restored.width() * restored.height() * 2,
    );
    const view = makeGameView({
      width: restored.width(),
      height: restored.height(),
      myClientID: "client_a",
    });
    view.update(initialView);

    for (let tile = 0; tile < restored.width() * restored.height(); tile++) {
      expect(view.ownerID(tile)).toBe(restored.ownerID(tile));
      expect(view.tileStateBuffer()[tile]).toBe(restored.map().tileState(tile));
      expect(view.terrainByte(tile)).toBe(restored.terrainByte(tile));
    }
    expect(view.owner(game.ref(8, 8)).id()).toBe("alice");
    expect(view.owner(game.ref(22, 8)).id()).toBe("bob");
    expect(view.hasFallout(falloutTile)).toBe(true);
    expect(view.isWater(waterTile)).toBe(true);
    expect(view.frameData().tileState[defendedTile] & (1 << 14)).not.toBe(0);
    expect(view.frameData().changedTiles).toBeNull();
    expect(view.inSpawnPhase()).toBe(false);
    expect(view.frameData().names.size).toBe(2);

    const calls: Record<string, ReturnType<typeof vi.fn>> = {};
    const gpu = new Proxy(
      {},
      {
        get: (_target, key) => (calls[String(key)] ??= vi.fn()),
      },
    );
    new WebGLFrameBuilder(gpu as never).update(view);
    expect(calls.uploadTileAndTrailState).toHaveBeenCalledExactlyOnceWith(
      view.frameData().tileState,
      view.frameData().trailState,
    );
    expect(calls.uploadLiveDelta).toBeUndefined();
    expect(
      calls.addPlayers.mock.calls[0][0].map((p: { id: string }) => p.id),
    ).toEqual(["alice", "bob"]);
    expect(calls.setLocalPlayerID).toHaveBeenCalledWith(alice.smallID());
    const units = calls.updateStructures.mock.calls[0][0] as Map<
      number,
      unknown
    >;
    expect(units.has(city.id())).toBe(true);
    expect(units.has(post.id())).toBe(true);
    expect(restored.isPaused()).toBe(true);
    expect(restored.ticks()).toBe(initialView.tick);
    expect(diffSnapshots(before, snapshotGame(restored))).toEqual([]);
    expect(restored).toBeInstanceOf(GameImpl);
  });
});
