import { describe, expect, it } from "vitest";
import { formatKeyForDisplay } from "../../src/client/Utils";

describe("effective key labels", () => {
  it("shows physical zoom, speed, camera and replay keys as recognizable keys", () => {
    expect(
      [
        "Equal",
        "Minus",
        "Comma",
        "Period",
        "ArrowUp",
        "BracketLeft",
        "BracketRight",
      ].map(formatKeyForDisplay),
    ).toEqual(["+", "−", ",", ".", "↑", "[", "]"]);
  });
  it("formats every modifier in a captured complete combination", () => {
    expect(formatKeyForDisplay("Ctrl+Alt+Shift+KeyA")).toBe("Ctrl+Alt+Shift+A");
    expect(formatKeyForDisplay("Meta+BracketRight")).toBe("Meta+]");
    expect(formatKeyForDisplay("Shift+Equal")).toBe("Shift++");
  });
  it("keeps keypad and physical modifier distinctions visible", () => {
    expect(formatKeyForDisplay("NumpadSubtract")).toBe("Num −");
    expect(formatKeyForDisplay("Numpad7")).toBe("Num 7");
    expect(formatKeyForDisplay("ControlLeft")).not.toBe(
      formatKeyForDisplay("ControlRight"),
    );
  });
  it("retains classic letters, digits, space, empty and unknown codes", () => {
    expect(formatKeyForDisplay("KeyQ")).toBe("Q");
    expect(formatKeyForDisplay("Digit5")).toBe("5");
    expect(formatKeyForDisplay(" ")).toBe("Space");
    expect(formatKeyForDisplay("")).toBe("");
    expect(formatKeyForDisplay("F12")).toBe("F12");
  });
});
