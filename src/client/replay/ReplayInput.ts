import { inputActionRows, InputMode } from "../../core/game/KeybindingRegistry";

/** Viewer and live map use the same versioned catalogue and complete key
 * combinations. The viewer has its own renderer, so only replay-context
 * actions are dispatched here; no military Intent can be generated. */
export function replayKeyboardAction(
  event: KeyboardEvent,
  mode: InputMode,
  bindings: Record<string, string>,
  modalOpen: boolean,
): string | null {
  if (
    modalOpen ||
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229
  )
    return null;
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    if (
      target.isContentEditable ||
      target.closest("setting-keybind") ||
      ["TEXTAREA", "SELECT"].includes(target.tagName) ||
      target instanceof HTMLInputElement
    )
      return null;
  }
  return (
    inputActionRows(mode, bindings, "replay").find((entry) => {
      if (
        ["pointer", "button", "modifier"].includes(entry.phase) ||
        !entry.binding
      )
        return false;
      const parts = entry.binding.split("+");
      const code = parts.pop();
      return (
        event.code === code &&
        (event.shiftKey === parts.includes("Shift") ||
          (entry.binding === "Equal" &&
            event.shiftKey &&
            !Object.values(bindings).includes("Shift+Equal"))) &&
        event.ctrlKey === parts.includes("Ctrl") &&
        event.altKey === parts.includes("Alt") &&
        event.metaKey === parts.includes("Meta")
      );
    })?.id ?? null
  );
}
