import { GameEvent } from "../core/EventBus";
import {
  getDefaultKeybinds,
  mergeKeybinds,
  UserSettings,
} from "../core/game/UserSettings";

export type ModernBranch = "army" | "navy" | "air";
export const MODERN_KEYBINDS_KEY = "settings.modernKeybinds.v1";
export const MODERN_KEYBINDS_CHANGED = "modern-keybinds-changed";
export const MODERN_KEY_DEFAULTS = {
  modernArmy: "KeyQ",
  modernNavy: "KeyW",
  modernAir: "KeyE",
};

/** Read through old bindings without modifying the Classic settings. Saved
 * Classic choices have priority over newly introduced modern defaults. */
export function modernKeybinds(
  settings: UserSettings,
  isMac: boolean,
  storage: Pick<Storage, "getItem"> = localStorage,
): Record<string, string> {
  const classicSaved = Object.fromEntries(
    Object.entries(settings.parsedUserKeybinds()).flatMap(([action, entry]) => {
      let value = entry;
      if (value && typeof value === "object" && "value" in value)
        value = value.value;
      if (Array.isArray(value)) value = value[0];
      return typeof value === "string" ? [[action, value]] : [];
    }),
  );
  let modernSaved: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(MODERN_KEYBINDS_KEY) ?? "{}",
    );
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      modernSaved = Object.fromEntries(
        Object.entries(parsed).filter(
          ([action, value]) =>
            action in MODERN_KEY_DEFAULTS && typeof value === "string",
        ),
      );
    }
  } catch {
    // An invalid optional modern settings entry never damages Classic input.
  }
  return mergeKeybinds(
    { ...MODERN_KEY_DEFAULTS, ...getDefaultKeybinds(isMac) },
    { ...classicSaved, ...modernSaved },
  );
}

export function saveModernKeybind(
  action: keyof typeof MODERN_KEY_DEFAULTS,
  value: string,
): boolean {
  try {
    const previous: unknown = JSON.parse(
      localStorage.getItem(MODERN_KEYBINDS_KEY) ?? "{}",
    );
    const saved =
      previous && typeof previous === "object" && !Array.isArray(previous)
        ? previous
        : {};
    localStorage.setItem(
      MODERN_KEYBINDS_KEY,
      JSON.stringify({ ...saved, [action]: value }),
    );
    globalThis.dispatchEvent(new Event(MODERN_KEYBINDS_CHANGED));
    return true;
  } catch {
    return false;
  }
}

export class ModernBranchEvent implements GameEvent {
  constructor(public readonly branch: ModernBranch) {}
}
export class ModernSelectionEvent implements GameEvent {
  constructor(
    public readonly startX: number,
    public readonly startY: number,
    public readonly endX: number,
    public readonly endY: number,
    public readonly additive: boolean,
    public readonly complete: boolean,
  ) {}
}
export class ModernTargetEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly queue: boolean,
  ) {}
}
export class ModernClearSelectionEvent implements GameEvent {}
