import { GameEvent } from "../core/EventBus";
import { inputDefaults } from "../core/game/KeybindingRegistry";
import {
  INPUT_PROFILE_CHANGED_EVENT,
  INPUT_PROFILE_KEY,
  UserSettings,
} from "../core/game/UserSettings";
import { Platform } from "./Platform";

export type ModernBranch = "army" | "navy" | "air";
/** Compatibility aliases point at the one versioned input profile. */
export const MODERN_KEYBINDS_KEY = INPUT_PROFILE_KEY;
export const MODERN_KEYBINDS_CHANGED = INPUT_PROFILE_CHANGED_EVENT;
const defaults = inputDefaults("modern", false);
export const MODERN_KEY_DEFAULTS = {
  modernArmy: defaults.modernArmy,
  modernNavy: defaults.modernNavy,
  modernAir: defaults.modernAir,
};
export function modernKeybinds(
  settings: UserSettings,
  isMac: boolean,
): Record<string, string> {
  return settings.effectiveKeybinds("modern", isMac);
}
export function saveModernKeybind(
  action: keyof typeof MODERN_KEY_DEFAULTS,
  value: string,
): boolean {
  return new UserSettings().setInputBinding(
    "modern",
    action,
    value,
    Platform.isMac,
  );
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
/** Cursor preview only; never submits an Intent. Coordinates are CSS pixels. */
export class ModernPreviewEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly queue: boolean,
  ) {}
}
/** Explicit click/touch confirmation, including Shift queue semantics. */
export class ModernTargetEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly queue: boolean,
  ) {}
}
export class ModernClearSelectionEvent implements GameEvent {}
export class ModernCancelEvent implements GameEvent {}
export class ModernStopEvent implements GameEvent {}
export class ModernSelectVisibleEvent implements GameEvent {}
export class ModernCenterSelectionEvent implements GameEvent {}
export class ModernBuildBaseEvent implements GameEvent {
  constructor(public readonly kind: "armybase" | "airbase") {}
}
