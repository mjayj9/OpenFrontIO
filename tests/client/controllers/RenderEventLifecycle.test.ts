import { describe, expect, it, vi } from "vitest";
import { HoverHighlightController } from "../../../src/client/controllers/HoverHighlightController";
import { SoundEffectController } from "../../../src/client/controllers/SoundEffectController";
import { StructureHighlightController } from "../../../src/client/controllers/StructureHighlightController";
import { ViewModeController } from "../../../src/client/controllers/ViewModeController";
import {
  AlternateViewEvent,
  MouseMoveEvent,
  ToggleCoordinateGridEvent,
  ToggleStructureEvent,
} from "../../../src/client/InputHandler";
import { MapRenderer } from "../../../src/client/render/gl";
import { PlaySoundEffectEvent } from "../../../src/client/sound/Sounds";
import { TransformHandler } from "../../../src/client/TransformHandler";
import { SendSpawnIntentEvent } from "../../../src/client/Transport";
import { GameView } from "../../../src/client/view";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";

describe("render event lifetime across matches", () => {
  it("updates only the current view after repeated initialization and disposal", () => {
    const bus = new EventBus();
    const view = {
      setHighlightStructureTypes: vi.fn(),
      setAltView: vi.fn(),
      setGridView: vi.fn(),
    };
    const oldStructure = new StructureHighlightController(
      bus,
      view as unknown as MapRenderer,
    );
    const oldModes = new ViewModeController(
      bus,
      view as unknown as MapRenderer,
    );
    oldStructure.init();
    oldStructure.init();
    oldModes.init();
    oldModes.init();
    bus.emit(new ToggleStructureEvent([UnitType.City]));
    bus.emit(new AlternateViewEvent(true));
    bus.emit(new ToggleCoordinateGridEvent(true));
    Object.values(view).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
    oldStructure.dispose();
    oldModes.dispose();
    oldStructure.dispose();
    oldModes.dispose();
    Object.values(view).forEach((fn) => fn.mockClear());
    const currentView = {
      setHighlightStructureTypes: vi.fn(),
      setAltView: vi.fn(),
      setGridView: vi.fn(),
    };
    new StructureHighlightController(
      bus,
      currentView as unknown as MapRenderer,
    ).init();
    new ViewModeController(bus, currentView as unknown as MapRenderer).init();
    bus.emit(new ToggleStructureEvent([UnitType.Factory]));
    bus.emit(new AlternateViewEvent(false));
    bus.emit(new ToggleCoordinateGridEvent(false));
    Object.values(view).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    Object.values(currentView).forEach((fn) =>
      expect(fn).toHaveBeenCalledTimes(1),
    );
  });

  it("stops looking up the previous map on pointer movement", () => {
    const bus = new EventBus();
    const mapLookup = vi.fn(() => false);
    const view = { setMouseWorldPos: vi.fn() };
    const transforms = {
      screenToWorldCoordinatesFloat: () => ({ x: 10, y: 20 }),
      screenToWorldCoordinates: () => ({ x: 10, y: 20 }),
    };
    const hover = new HoverHighlightController(
      { isValidCoord: mapLookup } as unknown as GameView,
      bus,
      transforms as unknown as TransformHandler,
      view as unknown as MapRenderer,
    );
    hover.init();
    hover.init();
    bus.emit(new MouseMoveEvent(10, 20));
    expect(mapLookup).toHaveBeenCalledTimes(1);
    hover.dispose();
    hover.dispose();
    mapLookup.mockClear();
    view.setMouseWorldPos.mockClear();
    bus.emit(new MouseMoveEvent(30, 40));
    expect(mapLookup).not.toHaveBeenCalled();
    expect(view.setMouseWorldPos).not.toHaveBeenCalled();
  });

  it("plays one current spawn cue after the previous controller stops", () => {
    const bus = new EventBus();
    const oldPlayerLookup = vi.fn(() => ({}));
    const oldSounds = new SoundEffectController(
      { myPlayer: oldPlayerLookup } as unknown as GameView,
      bus,
    );
    oldSounds.init();
    oldSounds.init();
    oldSounds.dispose();
    oldSounds.dispose();
    const currentSounds = new SoundEffectController(
      { myPlayer: () => ({}) } as unknown as GameView,
      bus,
    );
    currentSounds.init();
    const played = vi.fn();
    bus.on(PlaySoundEffectEvent, played);
    bus.emit(new SendSpawnIntentEvent(7));
    expect(oldPlayerLookup).not.toHaveBeenCalled();
    expect(played).toHaveBeenCalledTimes(1);
    expect(played.mock.calls[0][0].effect).toBe("spawn");
  });
});
