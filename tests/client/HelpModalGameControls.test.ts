import { html, TemplateResult } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/HelpModal";
import { HelpModal } from "../../src/client/HelpModal";
import { OModal } from "../../src/client/components/baseComponents/Modal";
import { setActiveInputContext } from "../../src/core/game/KeybindingRegistry";

describe("controls opened from a running game", () => {
  let inline: HelpModal;
  beforeEach(async () => {
    // This regression checks the real shell/navigation lifecycle. The full
    // reference catalogue is checked separately and played in the browser.
    vi.spyOn(
      HelpModal.prototype as unknown as { renderBody(): TemplateResult },
      "renderBody",
    ).mockReturnValue(html`<p>Controls</p>`);
    history.replaceState(null, "", "/?gameID=example");
    document.body.classList.add("in-game");
    setActiveInputContext("modern", "map");
    const hiddenMenu = document.createElement("div");
    hiddenMenu.className = "hidden";
    inline = document.createElement("help-modal") as HelpModal;
    inline.inline = true;
    inline.id = "page-help";
    hiddenMenu.append(inline);
    document.body.append(hiddenMenu);
    await inline.updateComplete;
  });
  afterEach(() => {
    document.body.replaceChildren();
    document.body.classList.remove("in-game");
    setActiveInputContext("classic", "map");
    vi.restoreAllMocks();
  });

  it("opens the original modal above the game without navigating the hidden menu", async () => {
    inline.openControls();
    const overlay = document.querySelector<HelpModal>("#game-help-modal")!;
    await overlay.updateComplete;
    await Promise.resolve();
    await overlay.updateComplete;
    const shell = overlay.querySelector<OModal>("o-modal")!;
    await shell.updateComplete;
    expect(overlay.parentElement).toBe(document.body);
    expect(overlay.inline).toBe(false);
    expect(shell.isModalOpen).toBe(true);
    expect(OModal.openCount).toBe(1);
    expect(location.hash).toBe("");
    expect(inline.isOpen()).toBe(false);
    inline.openControls();
    await Promise.resolve();
    expect(document.querySelectorAll("#game-help-modal")).toHaveLength(1);
    expect(OModal.openCount).toBe(1);
    overlay.close();
    await Promise.resolve();
    expect(document.querySelector("#game-help-modal")).toBeNull();
    expect(OModal.openCount).toBe(0);
    expect(location.search).toBe("?gameID=example");
  });

  it("also opens controls above replay when the menu remains hidden", async () => {
    document.body.classList.remove("in-game");
    setActiveInputContext("classic", "replay");
    inline.openControls();
    const overlay = document.querySelector<HelpModal>("#game-help-modal")!;
    await overlay.updateComplete;
    await Promise.resolve();
    await overlay.updateComplete;
    expect(overlay.isOpen()).toBe(true);
    expect(location.hash).toBe("");
    overlay.close();
    await Promise.resolve();
  });
});
