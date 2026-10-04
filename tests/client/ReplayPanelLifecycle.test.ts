import { afterEach, describe, expect, it } from "vitest";
import {
  ReplayPanel,
  ShowReplayPanelEvent,
} from "../../src/client/hud/layers/ReplayPanel";
import { ReplaySpeedChangeEvent } from "../../src/client/InputHandler";
import { ReplaySpeedMultiplier } from "../../src/client/utilities/ReplaySpeedMultiplier";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";

function mount() {
  const panel = new ReplayPanel();
  panel.game = {
    config: () => ({ isReplay: () => false }),
  } as unknown as GameView;
  panel.eventBus = new EventBus();
  document.body.appendChild(panel);
  panel.init();
  return panel;
}

function button(panel: ReplayPanel, label: string) {
  return [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  )!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ReplayPanel reused HUD lifecycle", () => {
  it("starts the next match hidden at normal speed after a prior 2x session", async () => {
    const panel = mount();
    panel.eventBus.emit(new ShowReplayPanelEvent(true, true));
    await panel.updateComplete;
    button(panel, "×2").click();
    await panel.updateComplete;
    expect(button(panel, "×2").classList.contains("bg-malibu-blue")).toBe(true);
    panel.init();
    await panel.updateComplete;
    expect(panel.visible).toBe(false);
    expect(panel.querySelector("button")).toBeNull();
    panel.eventBus.emit(new ShowReplayPanelEvent(true, true));
    await panel.updateComplete;
    expect(button(panel, "×1").classList.contains("bg-malibu-blue")).toBe(true);
    expect(button(panel, "×2").classList.contains("bg-malibu-blue")).toBe(
      false,
    );
  });

  it("ignores old bus events after switching matches and current bus events after disposal", async () => {
    const panel = mount();
    const oldBus = panel.eventBus;
    panel.eventBus = new EventBus();
    panel.init();
    oldBus.emit(new ShowReplayPanelEvent(true, true));
    oldBus.emit(new ReplaySpeedChangeEvent(ReplaySpeedMultiplier.fast));
    await panel.updateComplete;
    expect(panel.visible).toBe(false);
    panel.eventBus.emit(new ShowReplayPanelEvent(true, true));
    await panel.updateComplete;
    expect(button(panel, "×1").classList.contains("bg-malibu-blue")).toBe(true);
    panel.dispose();
    panel.eventBus.emit(new ShowReplayPanelEvent(true, true));
    await panel.updateComplete;
    expect(panel.visible).toBe(false);
  });

  it("emits one selected speed event after repeated starts and shows an external speed change", async () => {
    const panel = mount();
    panel.init();
    panel.init();
    const speeds: number[] = [];
    panel.eventBus.on(ReplaySpeedChangeEvent, (event) =>
      speeds.push(event.replaySpeedMultiplier),
    );
    panel.eventBus.emit(new ShowReplayPanelEvent(true, true));
    await panel.updateComplete;
    button(panel, "×2").click();
    expect(speeds).toEqual([ReplaySpeedMultiplier.fast]);
    panel.eventBus.emit(new ReplaySpeedChangeEvent(ReplaySpeedMultiplier.slow));
    await panel.updateComplete;
    expect(button(panel, "×0.5").classList.contains("bg-malibu-blue")).toBe(
      true,
    );
  });
});
