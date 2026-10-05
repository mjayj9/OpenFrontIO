import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContextMenuEvent,
  DragEvent,
  InputHandler,
  MouseUpEvent,
  ZoomEvent,
} from "../../src/client/InputHandler";
import {
  MODERN_KEYBINDS_KEY,
  ModernBranchEvent,
  ModernSelectionEvent,
  ModernTargetEvent,
  modernKeybinds,
  saveModernKeybind,
} from "../../src/client/ModernInput";
import { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { KEYBINDS_KEY, UserSettings } from "../../src/core/game/UserSettings";

describe("modern military input context", () => {
  let input: InputHandler;
  let bus: EventBus;
  let canvas: HTMLCanvasElement;
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    new UserSettings().removeCached(KEYBINDS_KEY, false);
    canvas = document.createElement("canvas");
    bus = new EventBus();
    input = new InputHandler(
      {
        config: () => ({
          gameConfig: () => ({ modernMode: { scenario: "modern-regions-v2" } }),
        }),
        inSpawnPhase: () => false,
        myPlayer: () => ({ isAlive: () => true }),
      } as unknown as GameView,
      {
        attackRatio: 0.2,
        ghostStructure: null,
        rocketDirectionUp: true,
        upgradeMultiplier: 1,
      },
      canvas,
      bus,
    );
    input.initialize();
  });
  afterEach(() => {
    input.destroy();
    vi.useRealTimers();
  });

  it("Q W E each select one branch without camera movement or an attack", () => {
    const branches = vi.fn(),
      zoom = vi.fn(),
      pan = vi.fn(),
      attacks = vi.fn();
    bus.on(ModernBranchEvent, branches);
    bus.on(ZoomEvent, zoom);
    bus.on(DragEvent, pan);
    bus.on(MouseUpEvent, attacks);
    for (const code of ["KeyQ", "KeyW", "KeyE"]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      vi.advanceTimersByTime(50);
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    }
    expect(branches.mock.calls.map(([event]) => event.branch)).toEqual([
      "army",
      "navy",
      "air",
    ]);
    expect(zoom).not.toHaveBeenCalled();
    expect(pan).not.toHaveBeenCalled();
    expect(attacks).not.toHaveBeenCalled();
  });

  it("preserves a saved camera W and leaves the new navy default unassigned", () => {
    new UserSettings().setKeybinds({ moveUp: "KeyW" });
    const keys = modernKeybinds(new UserSettings(), false);
    expect(keys.moveUp).toBe("KeyW");
    expect(keys.modernNavy).toBeUndefined();
    expect(new UserSettings().parsedUserKeybinds()).toEqual({ moveUp: "KeyW" });
  });

  it("supports unbinding and modified modern bindings without changing Classic storage", () => {
    expect(saveModernKeybind("modernArmy", "Ctrl+Shift+KeyJ")).toBe(true);
    expect(saveModernKeybind("modernAir", "Null")).toBe(true);
    const keys = modernKeybinds(new UserSettings(), true);
    expect(keys.modernArmy).toBe("Ctrl+Shift+KeyJ");
    expect(keys.modernAir).toBeUndefined();
    expect(localStorage.getItem(KEYBINDS_KEY)).toBeNull();
    expect(localStorage.getItem(MODERN_KEYBINDS_KEY)).toContain(
      "Ctrl+Shift+KeyJ",
    );
  });

  it("does not switch branches while writing text or composing Korean IME", () => {
    const listener = vi.fn();
    bus.on(ModernBranchEvent, listener);
    const search = document.createElement("input");
    document.body.append(search);
    search.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyQ", bubbles: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyW", isComposing: true }),
    );
    expect(listener).not.toHaveBeenCalled();
    search.remove();
  });

  it("right-click emits a queued military target without opening a Classic attack", () => {
    const target = vi.fn(),
      attack = vi.fn();
    bus.on(ModernTargetEvent, target);
    bus.on(MouseUpEvent, attack);
    canvas.dispatchEvent(
      new MouseEvent("contextmenu", {
        clientX: 123,
        clientY: 234,
        shiftKey: true,
      }),
    );
    expect(target).toHaveBeenCalledWith(
      expect.objectContaining({ x: 123, y: 234, queue: true }),
    );
    expect(attack).not.toHaveBeenCalled();
  });

  it("left drag completes a selection without panning or attacking", () => {
    const selection = vi.fn(),
      attack = vi.fn(),
      pan = vi.fn();
    bus.on(ModernSelectionEvent, selection);
    bus.on(MouseUpEvent, attack);
    bus.on(DragEvent, pan);
    // jsdom has no native PointerEvent; events carry the same public fields.
    const pointer = (type: string, x: number, y: number) =>
      Object.assign(
        new MouseEvent(type, {
          clientX: x,
          clientY: y,
          button: 0,
        }),
        { pointerId: 1, pointerType: "mouse" },
      );
    canvas.dispatchEvent(pointer("pointerdown", 50, 60));
    window.dispatchEvent(pointer("pointermove", 150, 160));
    window.dispatchEvent(pointer("pointerup", 150, 160));
    expect(selection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startX: 50,
        startY: 60,
        endX: 150,
        endY: 160,
        complete: true,
      }),
    );
    expect(attack).not.toHaveBeenCalled();
    expect(pan).not.toHaveBeenCalled();
  });
  it("keeps Ctrl/right-click diplomacy separate from military targeting", () => {
    const menu = vi.fn(),
      target = vi.fn();
    bus.on(ContextMenuEvent, menu);
    bus.on(ModernTargetEvent, target);
    canvas.dispatchEvent(
      new MouseEvent("contextmenu", {
        clientX: 20,
        clientY: 30,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(menu).toHaveBeenCalledOnce();
    expect(target).not.toHaveBeenCalled();
  });
  it("does not switch branches when a map key is released after entering an editor", () => {
    const branches = vi.fn();
    bus.on(ModernBranchEvent, branches);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    const editor = document.createElement("input");
    document.body.append(editor);
    editor.focus();
    editor.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }),
    );
    expect(branches).not.toHaveBeenCalled();
    editor.remove();
  });
  it("pinch release never selects a unit or attacks", () => {
    const selection = vi.fn(),
      attack = vi.fn();
    bus.on(ModernSelectionEvent, selection);
    bus.on(MouseUpEvent, attack);
    const pointer = (type: string, id: number, x: number) =>
      Object.assign(
        new MouseEvent(type, { clientX: x, clientY: 30, button: 0 }),
        { pointerId: id, pointerType: "touch" },
      );
    canvas.dispatchEvent(pointer("pointerdown", 1, 10));
    canvas.dispatchEvent(pointer("pointerdown", 2, 50));
    window.dispatchEvent(pointer("pointerup", 2, 60));
    window.dispatchEvent(pointer("pointerup", 1, 10));
    expect(selection).not.toHaveBeenCalled();
    expect(attack).not.toHaveBeenCalled();
  });
  it("pans with two touch points while preserving selection-only one-finger drags", () => {
    const pan = vi.fn(),
      selection = vi.fn(),
      attack = vi.fn();
    bus.on(DragEvent, pan);
    bus.on(ModernSelectionEvent, selection);
    bus.on(MouseUpEvent, attack);
    const pointer = (type: string, id: number, x: number, y: number) =>
      Object.assign(
        new MouseEvent(type, { clientX: x, clientY: y, button: 0 }),
        {
          pointerId: id,
          pointerType: "touch",
        },
      );
    canvas.dispatchEvent(pointer("pointerdown", 1, 10, 30));
    canvas.dispatchEvent(pointer("pointerdown", 2, 50, 30));
    window.dispatchEvent(pointer("pointermove", 1, 30, 40));
    window.dispatchEvent(pointer("pointermove", 2, 70, 40));
    expect(pan).toHaveBeenCalledTimes(2);
    expect(
      pan.mock.calls.map(([event]) => [event.deltaX, event.deltaY]),
    ).toEqual([
      [10, 5],
      [10, 5],
    ]);
    window.dispatchEvent(pointer("pointerup", 2, 70, 40));
    window.dispatchEvent(pointer("pointerup", 1, 30, 40));
    expect(selection).not.toHaveBeenCalled();
    expect(attack).not.toHaveBeenCalled();
  });
});
