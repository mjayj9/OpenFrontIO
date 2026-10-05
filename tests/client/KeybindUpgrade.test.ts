import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DoBoatAttackEvent,
  DoGroundAttackEvent,
  DragEvent,
  InputHandler,
  ZoomEvent,
} from "../../src/client/InputHandler";
import { UIState } from "../../src/client/UIState";
import { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { KEYBINDS_KEY, UserSettings } from "../../src/core/game/UserSettings";

describe("keybind upgrade input dispatch", () => {
  let handler: InputHandler;
  let bus: EventBus;
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    new UserSettings().removeCached(KEYBINDS_KEY, false);
    bus = new EventBus();
  });
  afterEach(() => {
    handler?.destroy();
    vi.useRealTimers();
  });
  const start = (keys: Record<string, string>) => {
    new UserSettings().setKeybinds(keys);
    handler = new InputHandler(
      {
        inSpawnPhase: () => false,
        myPlayer: () => ({ isAlive: () => true }),
      } as unknown as GameView,
      {
        ghostStructure: null,
        attackRatio: 0.2,
        rocketDirectionUp: true,
        upgradeMultiplier: 1,
      } as UIState,
      document.createElement("canvas"),
      bus,
    );
    handler.initialize();
  };

  it("a saved ArrowUp boat action does not pan the camera", () => {
    start({ boatAttack: "ArrowUp" });
    const boats = vi.fn(),
      drags = vi.fn();
    bus.on(DoBoatAttackEvent, boats);
    bus.on(DragEvent, drags);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp" }));
    vi.advanceTimersByTime(120);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowUp" }));
    expect(boats).toHaveBeenCalledTimes(1);
    expect(drags).not.toHaveBeenCalled();
  });

  it("a saved Minus attack does not zoom", () => {
    start({ groundAttack: "Minus" });
    const attacks = vi.fn(),
      zooms = vi.fn();
    bus.on(DoGroundAttackEvent, attacks);
    bus.on(ZoomEvent, zooms);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Minus" }));
    vi.advanceTimersByTime(120);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Minus" }));
    expect(attacks).toHaveBeenCalledTimes(1);
    expect(zooms).not.toHaveBeenCalled();
  });

  it("matches a modifier combination without also firing the plain action", () => {
    start({ boatAttack: "Ctrl+Shift+KeyG" });
    const boats = vi.fn(),
      attacks = vi.fn();
    bus.on(DoBoatAttackEvent, boats);
    bus.on(DoGroundAttackEvent, attacks);
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        code: "KeyG",
        ctrlKey: true,
        shiftKey: true,
      }),
    );
    expect(boats).toHaveBeenCalledTimes(1);
    expect(attacks).not.toHaveBeenCalled();
  });

  it("continuous camera combinations track physical modifiers even when their modifier actions are unbound", () => {
    start({
      moveUp: "Ctrl+Alt+KeyW",
      altKey: "",
      emojiMenuModifier: "",
      buildMenuModifier: "",
    });
    const drags = vi.fn();
    bus.on(DragEvent, drags);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "ControlLeft", ctrlKey: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "AltLeft",
        ctrlKey: true,
        altKey: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyW",
        ctrlKey: true,
        altKey: true,
      }),
    );
    vi.advanceTimersByTime(120);
    expect(drags).toHaveBeenCalled();
  });

  it("explicit Shift camera combinations move without an active selection box", () => {
    start({ moveUp: "Ctrl+Shift+KeyW" });
    const drags = vi.fn();
    bus.on(DragEvent, drags);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "ControlLeft", ctrlKey: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "ShiftLeft",
        ctrlKey: true,
        shiftKey: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyW",
        ctrlKey: true,
        shiftKey: true,
      }),
    );
    vi.advanceTimersByTime(120);
    expect(drags).toHaveBeenCalled();
  });

  it("does not build from a numpad alias assigned to zoom", () => {
    start({ zoomIn: "Numpad1" });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Numpad1" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Numpad1" }));
    expect(handler.uiState.ghostStructure).toBeNull();
  });
});
