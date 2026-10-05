import { beforeEach, describe, expect, it } from "vitest";
import { replayKeyboardAction } from "../../../src/client/replay/ReplayInput";
import { inputDefaults } from "../../../src/core/game/KeybindingRegistry";
import {
  KEYBINDS_KEY,
  UserSettings,
} from "../../../src/core/game/UserSettings";

describe("registered replay input context", () => {
  beforeEach(() => {
    localStorage.clear();
    new UserSettings().removeCached(KEYBINDS_KEY, false);
  });
  it("keeps arrows for camera, brackets for seeking and P for playback", () => {
    const bindings = inputDefaults("modern", false);
    const resolve = (code: string, shiftKey = false) =>
      replayKeyboardAction(
        new KeyboardEvent("keydown", { code, shiftKey }),
        "modern",
        bindings,
        false,
      );
    expect(resolve("ArrowRight")).toBe("moveRightArrow");
    expect(resolve("BracketRight")).toBe("replayStepForward");
    expect(resolve("BracketLeft", true)).toBe("replayJumpBack");
    expect(resolve("KeyP")).toBe("pauseGame");
    expect(resolve("Period")).toBe("gameSpeedUp");
    expect(resolve("Comma")).toBe("gameSpeedDown");
    expect(resolve("KeyQ")).toBeNull();
    expect(resolve("Digit8")).toBeNull();
  });
  it("uses the current saved rebind with exact modifiers and does not retain hardcoded keys", () => {
    const settings = new UserSettings();
    expect(
      settings.setInputBinding(
        "modern",
        "replayStepForward",
        "Ctrl+KeyJ",
        false,
      ),
    ).toBe(true);
    const bindings = settings.effectiveKeybinds("modern", false);
    expect(
      replayKeyboardAction(
        new KeyboardEvent("keydown", { code: "BracketRight" }),
        "modern",
        bindings,
        false,
      ),
    ).toBeNull();
    expect(
      replayKeyboardAction(
        new KeyboardEvent("keydown", { code: "KeyJ", ctrlKey: true }),
        "modern",
        bindings,
        false,
      ),
    ).toBe("replayStepForward");
    expect(
      replayKeyboardAction(
        new KeyboardEvent("keydown", { code: "KeyJ" }),
        "modern",
        bindings,
        false,
      ),
    ).toBeNull();
  });
  it("honors modal, text editing and Korean composition before playback keys", () => {
    const bindings = inputDefaults("classic", false);
    expect(
      replayKeyboardAction(
        new KeyboardEvent("keydown", { code: "KeyP", isComposing: true }),
        "classic",
        bindings,
        false,
      ),
    ).toBeNull();
    expect(
      replayKeyboardAction(
        new KeyboardEvent("keydown", { code: "KeyP" }),
        "classic",
        bindings,
        true,
      ),
    ).toBeNull();
    for (const tag of ["textarea", "input", "select", "range"]) {
      const field = document.createElement(tag === "range" ? "input" : tag);
      if (field instanceof HTMLInputElement && tag === "range")
        field.type = "range";
      document.body.append(field);
      let resolved: string | null = "unexpected";
      const listener = (event: KeyboardEvent) => {
        resolved = replayKeyboardAction(event, "classic", bindings, false);
      };
      window.addEventListener("keydown", listener);
      field.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyP", bubbles: true }),
      );
      window.removeEventListener("keydown", listener);
      field.remove();
      expect(resolved).toBeNull();
    }
  });
});
