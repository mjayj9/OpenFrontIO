import { ModernFaction } from "../core/game/ModernRegions";
import { translateText } from "./Utils";

/** Human-readable explanations; the original area report remains available. */
export function modernAreaException(faction: ModernFaction): string {
  const exception = faction.areaException;
  if (!exception) return "";
  const messages: Record<string, string> = {
    "parent-area-arithmetic": translateText(
      "modern_v2.area_exception_reason.parent_area",
    ),
    "isolated-component": translateText(
      "modern_v2.area_exception_reason.isolated",
    ),
    "component-area-arithmetic": translateText(
      "modern_v2.area_exception_reason.component_area",
    ),
    "administrative-packing": translateText(
      "modern_v2.area_exception_reason.administrative",
    ),
  };
  return messages[exception.category] ?? exception.reason;
}
