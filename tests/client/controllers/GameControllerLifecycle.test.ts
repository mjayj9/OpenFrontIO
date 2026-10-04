import { afterEach, describe, expect, test, vi } from "vitest";
import { AttackingTroopsController } from "../../../src/client/controllers/AttackingTroopsController";
import { BuildPreviewController } from "../../../src/client/controllers/BuildPreviewController";
import { WarshipSelectionController } from "../../../src/client/controllers/WarshipSelectionController";
import {
  AlternateViewEvent,
  ConfirmGhostStructureEvent,
  MouseUpEvent,
  UnitSelectionEvent,
} from "../../../src/client/InputHandler";
import {
  BuildUnitIntentEvent,
  MoveWarshipIntentEvent,
} from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("same-page controller disposal", () => {
  test("a selected old warship cannot move when the next game clicks", () => {
    const bus = new EventBus();
    const game = {
      isValidCoord: () => true,
      ref: () => 50,
      isWater: () => true,
      units: () => [],
    } as any;
    const camera = { screenToWorldCoordinates: () => ({ x: 5, y: 5 }) } as any;
    const oldView = { setSelectedUnits: vi.fn() };
    const old = new WarshipSelectionController(
      game,
      bus,
      camera,
      oldView as any,
    );
    old.init();
    bus.emit(new UnitSelectionEvent({ id: () => 111 } as any, true));
    old.dispose();
    const next = new WarshipSelectionController(game, bus, camera, {
      setSelectedUnits: vi.fn(),
    } as any);
    next.init();
    bus.emit(new UnitSelectionEvent({ id: () => 222 } as any, true));
    const moves: MoveWarshipIntentEvent[] = [];
    bus.on(MoveWarshipIntentEvent, (event) => moves.push(event));
    const oldCalls = oldView.setSelectedUnits.mock.calls.length;
    bus.emit(new MouseUpEvent(10, 10));
    expect(moves).toHaveLength(1);
    expect(moves[0].unitIds).toEqual([222]);
    expect(oldView.setSelectedUnits.mock.calls).toHaveLength(oldCalls);
    expect(document.querySelectorAll("#warship-drag-rect")).toHaveLength(1);
    next.dispose();
    expect(document.querySelectorAll("#warship-drag-rect")).toHaveLength(0);
  });

  test("an old construction preview drops click/confirm handlers and its animation frame", () => {
    const raf = vi.fn((_callback: FrameRequestCallback) => 71),
      cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const bus = new EventBus();
    const controller = new BuildPreviewController(
      { isValidCoord: () => true, ref: () => 43, myPlayer: () => null } as any,
      bus,
      { ghostStructure: UnitType.City } as any,
      { screenToWorldCoordinates: () => ({ x: 3, y: 4 }) } as any,
      { updateGhostPreview: vi.fn(), updateNukeTrajectory: vi.fn() } as any,
      { nukeAllianceSafetyDuration: () => 0 } as any,
    );
    controller.init();
    (controller as any).ghostUnit = {
      buildableUnit: { type: UnitType.City, canBuild: 43, canUpgrade: false },
    };
    controller.dispose();
    const builds: BuildUnitIntentEvent[] = [];
    bus.on(BuildUnitIntentEvent, (event) => builds.push(event));
    bus.emit(new MouseUpEvent(10, 10));
    bus.emit(new ConfirmGhostStructureEvent());
    expect(builds).toHaveLength(0);
    expect(cancel).toHaveBeenCalledWith(71);
    // A frame already queued before cancellation must not re-arm itself.
    (raf.mock.calls[0][0] as unknown as () => void)();
    expect(raf).toHaveBeenCalledOnce();
  });

  test("attack labels stop their RAF and alternate-view listener on disposal", () => {
    const raf = vi.fn((_callback: FrameRequestCallback) => 19),
      cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const bus = new EventBus();
    const view = { setAttackTroopLabels: vi.fn() };
    const controller = new AttackingTroopsController(
      {} as any,
      bus,
      {} as any,
      view as any,
    );
    controller.init();
    controller.dispose();
    bus.emit(new AlternateViewEvent(true));
    expect((controller as any).alternateView).toBe(false);
    expect(cancel).toHaveBeenCalledWith(19);
    (raf.mock.calls[0][0] as unknown as () => void)();
    expect(raf).toHaveBeenCalledOnce();
    expect(view.setAttackTroopLabels).not.toHaveBeenCalled();
  });
});
