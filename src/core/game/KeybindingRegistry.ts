/** A single catalogue for dispatch, settings, HUD labels and education. */
export type InputMode = "classic" | "modern";
export type InputContext = "map" | "replay" | "modal" | "text" | "keybind";
export const ACTIVE_INPUT_CONTEXT_CHANGED = "active-input-context-changed";
let activeContext: { mode: InputMode; context: InputContext } = {
  mode: "classic",
  context: "map",
};
export function activeInputContext() {
  return activeContext;
}
export function setActiveInputContext(mode: InputMode, context: InputContext) {
  activeContext = { mode, context };
  globalThis.dispatchEvent(new Event(ACTIVE_INPUT_CONTEXT_CHANGED));
}
export interface InputAction {
  id: string;
  defaults: { classic: string; modern: string };
  contexts: readonly InputContext[];
  modes?: readonly InputMode[];
  phase: "press" | "release" | "hold" | "modifier" | "pointer" | "button";
  labelKey: string;
  descriptionKey: string;
}
const action = (
  id: string,
  classic: string,
  modern = classic,
  phase: InputAction["phase"] = "release",
  contexts: readonly InputContext[] = ["map"],
): InputAction => ({
  id,
  defaults: { classic, modern },
  phase,
  contexts,
  labelKey: `input_actions.${id}.label`,
  descriptionKey: `input_actions.${id}.description`,
});

export const INPUT_ACTIONS: readonly InputAction[] = [
  action("toggleView", "Space", "Space", "press", ["map", "replay"]),
  action("coordinateGrid", "KeyM", "KeyM", "press", ["map", "replay"]),
  ...[
    "City",
    "Factory",
    "Port",
    "DefensePost",
    "MissileSilo",
    "SamLauncher",
    "Warship",
    "AtomBomb",
    "HydrogenBomb",
    "MIRV",
  ].map((kind, index) => action(`build${kind}`, `Digit${(index + 1) % 10}`)),
  action("attackRatioDown", "KeyT"),
  action("attackRatioUp", "KeyY"),
  action("boatAttack", "KeyB", "Shift+KeyB"),
  action("groundAttack", "KeyG"),
  action("retaliateAttack", "Shift+KeyR"),
  action("requestAlliance", "KeyK"),
  action("breakAlliance", "KeyL"),
  action("swapDirection", "KeyU"),
  action("zoomOut", "KeyQ", "", "hold", ["map", "replay"]),
  action("zoomIn", "KeyE", "", "hold", ["map", "replay"]),
  action("centerCamera", "KeyC", "KeyC", "press", ["map", "replay"]),
  ...[
    ["moveUp", "KeyW"],
    ["moveLeft", "KeyA"],
    ["moveDown", "KeyS"],
    ["moveRight", "KeyD"],
  ].map(([id, key]) => action(id, key, "", "hold", ["map", "replay"])),
  ...[
    ["moveUpArrow", "ArrowUp"],
    ["moveDownArrow", "ArrowDown"],
    ["moveLeftArrow", "ArrowLeft"],
    ["moveRightArrow", "ArrowRight"],
    ["zoomOutMinus", "Minus"],
    ["zoomOutNumpad", "NumpadSubtract"],
    ["zoomInEqual", "Equal"],
    ["zoomInNumpad", "NumpadAdd"],
  ].map(([id, key]) => action(id, key, key, "hold", ["map", "replay"])),
  action("performanceOverlay", "Shift+KeyD", "Shift+KeyD", "release", ["map"]),
  action("buildMenuModifier", "ControlLeft", "ControlLeft", "modifier"),
  action("emojiMenuModifier", "AltLeft", "AltLeft", "modifier"),
  action("boxSelectWarships", "ShiftLeft", "ShiftLeft", "modifier"),
  action("shiftKey", "ShiftLeft", "ShiftLeft", "modifier"),
  action("resetGfx", "KeyR", "KeyR", "release", ["map", "replay"]),
  action("selectAllWarships", "KeyF", "Shift+KeyF"),
  action("pauseGame", "KeyP", "KeyP", "release", ["map", "replay"]),
  action("gameSpeedUp", "Period", "Period", "release", ["map", "replay"]),
  action("gameSpeedDown", "Comma", "Comma", "release", ["map", "replay"]),
  action("altKey", "AltLeft", "AltLeft", "modifier"),
  action("modernArmy", "", "KeyQ", "press"),
  action("modernNavy", "", "KeyW", "press"),
  action("modernAir", "", "KeyE", "press"),
  action("modernArmyAlternate", "", "", "press"),
  action("modernNavyAlternate", "", "", "press"),
  action("modernAirAlternate", "", "", "press"),
  action("modernStop", "", "KeyX", "press"),
  action("modernSelectVisible", "", "KeyF", "press"),
  action("buildMenu", "", "KeyB", "press"),
  action("help", "KeyH", "KeyH", "press", ["map", "replay"]),
  action("cancel", "Escape", "Escape", "press", ["map", "replay", "modal"]),
  action("confirmPlacement", "Enter", "Enter", "press"),
  action("replayStepBack", "BracketLeft", "BracketLeft", "press", ["replay"]),
  action("replayStepForward", "BracketRight", "BracketRight", "press", [
    "replay",
  ]),
  action("replayJumpBack", "Shift+BracketLeft", "Shift+BracketLeft", "press", [
    "replay",
  ]),
  action(
    "replayJumpForward",
    "Shift+BracketRight",
    "Shift+BracketRight",
    "press",
    ["replay"],
  ),
  action("pointerSelect", "MouseLeft", "MouseLeft", "pointer"),
  action("pointerBoxSelect", "Shift+MouseDrag", "MouseDrag", "pointer"),
  action("pointerCommand", "MouseRight", "MouseRight", "pointer"),
  action("pointerQueue", "Shift+MouseRight", "Shift+MouseRight", "pointer"),
  action("pointerAdditional", "Shift+MouseLeft", "Shift+MouseLeft", "pointer"),
  action("pointerPan", "MouseDrag", "Alt+MouseDrag", "pointer", [
    "map",
    "replay",
  ]),
  action("pointerZoom", "Wheel", "Wheel", "pointer", ["map", "replay"]),
  action("pointerRatio", "Shift+Wheel", "Shift+Wheel", "pointer"),
  action("pointerUpgrade", "MouseMiddle", "MouseMiddle", "pointer"),
  action("pointerBuildMenu", "Ctrl+MouseLeft", "Ctrl+MouseLeft", "pointer"),
  action("pointerEmojiMenu", "Alt+MouseLeft", "Alt+MouseLeft", "pointer"),
  action("touchSelect", "Tap", "Tap", "pointer"),
  action("touchPan", "TouchDrag", "TwoFingerDrag", "pointer", [
    "map",
    "replay",
  ]),
  action("touchZoom", "Pinch", "Pinch", "pointer", ["map", "replay"]),
  action("touchCommand", "LongPress", "TargetTap", "pointer"),
  ...[
    "saveGame",
    "loadGame",
    "replayGame",
    "restartGame",
    "upgradeFacility",
    "autoUpgrade",
    "embargo",
    "donateTroops",
    "donateGold",
    "markTarget",
    "quickChat",
    "deleteFacility",
    "cancelAttack",
    "cancelTransport",
    "replaySeek",
  ].map((id) =>
    action(id, "", "", "button", id === "replaySeek" ? ["replay"] : ["map"]),
  ),
  ...[
    "buildArmyBase",
    "buildNavalBase",
    "buildAirBase",
    "trainArmy",
    "produceWarship",
    "produceFighter",
    "produceStrike",
    "developPort",
    "repairPort",
    "trainClimate",
    "touchAdditionalSelection",
    "touchQueuedCommand",
  ].map((id) => ({
    ...action(id, "", "", "button"),
    modes: ["modern"] as readonly InputMode[],
  })),
];

export function inputDefaults(
  mode: InputMode,
  isMac: boolean,
): Record<string, string> {
  return Object.fromEntries(
    INPUT_ACTIONS.filter(
      (entry) =>
        entry.phase !== "pointer" &&
        entry.phase !== "button" &&
        (mode === "modern" || !entry.id.startsWith("modern")),
    ).map((entry) => [
      entry.id,
      entry.id === "buildMenuModifier" && isMac
        ? "MetaLeft"
        : entry.defaults[mode],
    ]),
  );
}

export function actionPhase(id: string): InputAction["phase"] | undefined {
  return INPUT_ACTIONS.find((entry) => entry.id === id)?.phase;
}

export function inputActionRows(
  mode: InputMode,
  bindings: Record<string, string>,
  context: InputContext = "map",
) {
  const modifier = (id: string) =>
    (bindings[id] ?? "")
      .replace(/Control(Left|Right)/g, "Ctrl")
      .replace(/(Alt|Shift|Meta)(Left|Right)/g, "$1");
  const combination = (id: string, pointer: string) =>
    modifier(id) && pointer
      ? [...new Set(`${modifier(id)}+${pointer}`.split("+"))].join("+")
      : "";
  const pointerBindings: Record<string, string> = {
    pointerBuildMenu: combination("buildMenuModifier", "MouseLeft"),
    pointerEmojiMenu: combination("emojiMenuModifier", "MouseLeft"),
    ...(mode === "classic"
      ? {
          pointerBoxSelect: combination("boxSelectWarships", "MouseDrag"),
        }
      : {}),
  };
  return INPUT_ACTIONS.filter(
    (entry) =>
      (!entry.modes || entry.modes.includes(mode)) &&
      entry.contexts.includes(context) &&
      (mode === "modern" || !entry.id.startsWith("modern")),
  ).map((entry) => ({
    ...entry,
    binding:
      entry.phase === "pointer"
        ? (pointerBindings[entry.id] ?? entry.defaults[mode])
        : entry.id === "resetGfx"
          ? combination("altKey", bindings.resetGfx ?? "")
          : (bindings[entry.id] ?? ""),
  }));
}

/** Composed shortcuts (for example the graphics modifier plus reset key)
 * must own the same gesture as ordinary shortcuts in each active context.
 * Pointer gestures and shared modifier actions do not dispatch a key action. */
export function inputKeyConflicts(
  mode: InputMode,
  bindings: Record<string, string>,
) {
  const conflicts: Array<{ action: string; other: string; binding: string }> =
    [];
  for (const context of ["map", "replay"] as const) {
    const owners = new Map<string, string>();
    for (const row of inputActionRows(mode, bindings, context)) {
      if (!row.binding || ["modifier", "pointer", "button"].includes(row.phase))
        continue;
      const parts = row.binding.split("+");
      const code = parts.pop() ?? "";
      const key = [
        ...["Ctrl", "Alt", "Shift", "Meta"].filter((part) =>
          parts.includes(part),
        ),
        code,
      ].join("+");
      const other = owners.get(key);
      if (other) conflicts.push({ action: row.id, other, binding: key });
      else owners.set(key, row.id);
    }
  }
  return conflicts;
}
