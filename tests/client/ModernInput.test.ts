import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OModal } from "../../src/client/components/baseComponents/Modal";
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
  ModernCancelEvent,
  ModernPreviewEvent,
  ModernSelectVisibleEvent,
  ModernSelectionEvent,
  ModernStopEvent,
  ModernTargetEvent,
  modernKeybinds,
  saveModernKeybind,
} from "../../src/client/ModernInput";
import { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import {
  INPUT_PROFILE_KEY,
  KEYBINDS_KEY,
  UserSettings,
} from "../../src/core/game/UserSettings";

describe("modern military input context", () => {
  let input: InputHandler;
  let bus: EventBus;
  let canvas: HTMLCanvasElement;
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    new UserSettings().removeCached(KEYBINDS_KEY, false);
    canvas = document.createElement("canvas");
    document.body.append(canvas);
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
    canvas.remove();
    OModal.openCount = 0;
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

  it("migrates old camera W to arrows while keeping W available for navy", () => {
    new UserSettings().setKeybinds({ moveUp: "KeyW" });
    localStorage.removeItem(INPUT_PROFILE_KEY);
    const keys = modernKeybinds(new UserSettings(), false);
    expect(keys.moveUp).toBeUndefined();
    expect(keys.moveUpArrow).toBe("ArrowUp");
    expect(keys.modernNavy).toBe("KeyW");
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
  it("does not dispatch a second action when a pressed map key is released after entering an editor", () => {
    const branches = vi.fn();
    bus.on(ModernBranchEvent, branches);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    const editor = document.createElement("input");
    document.body.append(editor);
    editor.focus();
    editor.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }),
    );
    expect(branches).toHaveBeenCalledOnce();
    editor.remove();
  });
  it("coalesces cursor moves into the newest preview and drops a pending preview on confirmation", () => {
    const previews = vi.fn(),
      targets = vi.fn();
    bus.on(ModernPreviewEvent, previews);
    bus.on(ModernTargetEvent, targets);
    for (const x of [10, 30, 70])
      canvas.dispatchEvent(
        new MouseEvent("pointermove", {
          clientX: x,
          clientY: 25,
          bubbles: true,
        }),
      );
    vi.advanceTimersByTime(20);
    expect(previews).toHaveBeenCalledOnce();
    expect(previews).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 70, y: 25 }),
    );
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 80, bubbles: true }),
    );
    canvas.dispatchEvent(
      new MouseEvent("contextmenu", { clientX: 100, clientY: 50 }),
    );
    vi.advanceTimersByTime(20);
    expect(previews).toHaveBeenCalledOnce();
    expect(targets).toHaveBeenCalledWith(
      expect.objectContaining({ x: 100, y: 50 }),
    );
  });
  it("X, F and Esc have distinct stop, visible selection and cancellation events", () => {
    const stop = vi.fn(),
      visible = vi.fn(),
      cancel = vi.fn();
    bus.on(ModernStopEvent, stop);
    bus.on(ModernSelectVisibleEvent, visible);
    bus.on(ModernCancelEvent, cancel);
    for (const code of ["KeyX", "KeyF", "Escape"]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    }
    expect(stop).toHaveBeenCalledOnce();
    expect(visible).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    input.uiState.ghostStructure =
      "City" as typeof input.uiState.ghostStructure;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(input.uiState.ghostStructure).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("modal buttons, repeat and blur do not duplicate or leak a military key", () => {
    const branches = vi.fn();
    bus.on(ModernBranchEvent, branches);
    OModal.openCount = 1;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
    OModal.openCount = 0;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyQ", repeat: true }),
    );
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
    expect(branches).toHaveBeenCalledTimes(2);
  });
  it("does not swallow browser or OS combinations of default game keys", () => {
    for (const code of ["KeyP", "KeyR", "KeyW", "Space"]) {
      const event = new KeyboardEvent("keydown", {
        code,
        ctrlKey: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      window.dispatchEvent(new KeyboardEvent("keyup", { code, ctrlKey: true }));
    }
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
  it("adds touch selections only when the screen toggle is enabled and counts successful selection growth", () => {
    input.uiState.modernSelectedForceIds = ["first"];
    input.uiState.modernAdditiveSelection = true;
    const events: ModernSelectionEvent[] = [];
    bus.on(ModernSelectionEvent, (event) => {
      events.push(event);
      if (event.complete && event.endX === 45)
        input.uiState.modernSelectedForceIds = ["first", "second"];
    });
    const pointer = (type: string, x: number) =>
      Object.assign(
        new MouseEvent(type, { clientX: x, clientY: 30, button: 0 }),
        { pointerId: 1, pointerType: "touch" },
      );
    canvas.dispatchEvent(pointer("pointerdown", 10));
    window.dispatchEvent(pointer("pointermove", 45));
    window.dispatchEvent(pointer("pointerup", 45));
    expect(events.every((event) => event.additive)).toBe(true);
    expect(input.uiState.modernAdditionalSelections).toBe(1);
    expect(input.uiState.modernBoxSelections).toBe(1);
    // Tapping an already-selected unit must not pretend a second addition.
    canvas.dispatchEvent(pointer("pointerdown", 45));
    window.dispatchEvent(pointer("pointerup", 45));
    expect(input.uiState.modernAdditionalSelections).toBe(1);
    input.uiState.modernAdditiveSelection = false;
    canvas.dispatchEvent(pointer("pointerdown", 50));
    window.dispatchEvent(pointer("pointerup", 50));
    expect(events[events.length - 1]?.additive).toBe(false);
    window.dispatchEvent(new Event("blur"));
    expect(input.uiState.modernAdditiveSelection).toBe(false);
  });
  it("uses the same queue flag for touch targets, pointer previews and right-click confirmation", () => {
    const targets = vi.fn(),
      previews = vi.fn();
    bus.on(ModernTargetEvent, targets);
    bus.on(ModernPreviewEvent, previews);
    input.uiState.modernTargeting = true;
    input.uiState.modernQueueCommand = true;
    const pointer = (type: string, pointerType = "touch") =>
      Object.assign(
        new MouseEvent(type, {
          clientX: 50,
          clientY: 30,
          button: 0,
          bubbles: true,
        }),
        { pointerId: 1, pointerType },
      );
    canvas.dispatchEvent(pointer("pointerdown"));
    window.dispatchEvent(pointer("pointerup"));
    expect(targets.mock.calls[0][0].queue).toBe(true);
    canvas.dispatchEvent(pointer("pointermove", "mouse"));
    vi.advanceTimersByTime(20);
    expect(previews.mock.calls[previews.mock.calls.length - 1]?.[0].queue).toBe(
      true,
    );
    canvas.dispatchEvent(
      new MouseEvent("contextmenu", { clientX: 60, clientY: 35, button: 2 }),
    );
    expect(targets.mock.calls[targets.mock.calls.length - 1]?.[0].queue).toBe(
      true,
    );
    window.dispatchEvent(new Event("blur"));
    expect(input.uiState.modernQueueCommand).toBe(false);
  });
  it("previews a touch destination while held without reselecting and confirms once on release", () => {
    const selection = vi.fn(),
      targets = vi.fn(),
      previews = vi.fn();
    bus.on(ModernSelectionEvent, selection);
    bus.on(ModernTargetEvent, targets);
    bus.on(ModernPreviewEvent, previews);
    input.uiState.modernTargeting = true;
    const pointer = (type: string, x: number) =>
      Object.assign(
        new MouseEvent(type, {
          clientX: x,
          clientY: 50,
          button: 0,
          bubbles: true,
        }),
        { pointerId: 1, pointerType: "touch" },
      );
    canvas.dispatchEvent(pointer("pointerdown", 10));
    canvas.dispatchEvent(pointer("pointermove", 30));
    canvas.dispatchEvent(pointer("pointermove", 70));
    vi.advanceTimersByTime(20);
    expect(previews).toHaveBeenCalledOnce();
    expect(previews.mock.calls[0][0].x).toBe(70);
    expect(selection).not.toHaveBeenCalled();
    expect(targets).not.toHaveBeenCalled();
    canvas.dispatchEvent(pointer("pointermove", 80));
    window.dispatchEvent(pointer("pointerup", 80));
    vi.advanceTimersByTime(20);
    expect(previews).toHaveBeenCalledOnce();
    expect(targets).toHaveBeenCalledOnce();
    expect(targets.mock.calls[0][0].x).toBe(80);
    expect(selection).not.toHaveBeenCalled();
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
