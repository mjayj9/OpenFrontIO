import { render, TemplateResult } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HelpModal } from "../../src/client/HelpModal";
import { Platform } from "../../src/client/Platform";
import {
  inputActionRows,
  setActiveInputContext,
} from "../../src/core/game/KeybindingRegistry";
import { KEYBINDS_KEY, UserSettings } from "../../src/core/game/UserSettings";

describe("the actual help shortcut table", () => {
  beforeEach(() => {
    localStorage.clear();
    new UserSettings().removeCached(KEYBINDS_KEY, false);
    setActiveInputContext("modern", "replay");
  });
  afterEach(() => setActiveInputContext("classic", "map"));

  function tableLabels(help: HelpModal) {
    const host = document.createElement("div");
    render(
      (
        help as unknown as { renderInputTable(): TemplateResult }
      ).renderInputTable(),
      host,
    );
    const actions = inputActionRows(
      "modern",
      new UserSettings().effectiveKeybinds("modern", Platform.isMac),
      "replay",
    );
    const cells = [...host.querySelectorAll("tbody tr td:first-child")];
    return Object.fromEntries(
      actions.map((action, index) => [
        action.id,
        cells[index].textContent?.trim(),
      ]),
    );
  }

  it("shows usable bracket seeking and keypad zoom keys in the rendered replay table", () => {
    const labels = tableLabels(new HelpModal());
    expect(labels.replayStepBack).toBe("[");
    expect(labels.replayStepForward).toBe("]");
    expect(labels.replayJumpBack).toBe("Shift + [");
    expect(labels.replayJumpForward).toBe("Shift + ]");
    expect(labels.zoomOutNumpad).toBe("Num −");
    expect(labels.zoomInNumpad).toBe("Num +");
  });

  it("renders the newly effective rebind instead of the previous default key", () => {
    const help = new HelpModal();
    expect(
      new UserSettings().setInputBinding(
        "modern",
        "replayStepForward",
        "Ctrl+KeyJ",
        Platform.isMac,
      ),
    ).toBe(true);
    (help as unknown as { refreshInputs(): void }).refreshInputs();
    const labels = tableLabels(help);
    expect(labels.replayStepForward).toBe("Ctrl + J");
    expect(labels.replayStepBack).toBe("[");
  });
});
