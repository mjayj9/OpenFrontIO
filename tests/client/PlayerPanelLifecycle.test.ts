import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayerPanel } from "../../src/client/hud/layers/PlayerPanel";
import {
  CloseViewEvent,
  MouseUpEvent,
  SwapRocketDirectionEvent,
} from "../../src/client/InputHandler";
import { PlayerReportedEvent } from "../../src/client/Transport";
import { showToast } from "../../src/client/Utils";
import type { GameView, PlayerView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { GameType } from "../../src/core/game/Game";
vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class extends EventTarget {
    requestUpdate() {}
  },
}));
vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: unknown) => clazz,
  state: () => () => {},
  property: () => () => {},
  query: () => () => {},
}));
vi.mock("../../src/client/Api", () => ({
  fetchLobbyListed: vi.fn(async () => false),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  renderDuration: () => "countdown",
  renderNumber: () => "0",
  renderTroops: () => "0",
  showToast: vi.fn(),
}));
vi.mock("../../src/client/components/ui/ActionButton", () => ({
  actionButton: (props: unknown) => props,
}));

function mount() {
  const panel = new PlayerPanel();
  panel.uiState = { rocketDirectionUp: true } as never;
  panel.g = {
    config: () => ({ gameConfig: () => ({ gameType: GameType.Singleplayer }) }),
    myPlayer: () => null,
    owner: () => null,
    ticks: () => 0,
  } as unknown as GameView;
  panel.initEventBus(new EventBus());
  vi.spyOn(console, "warn").mockImplementation(() => {});
  panel.init();
  return panel;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("PlayerPanel reused HUD lifecycle", () => {
  it("hides the prior send modal on restart and handles the suppress-once mouse-up exactly once", () => {
    const panel = mount();
    panel.initEventBus(panel.eventBus);
    panel.init();
    panel.initEventBus(panel.eventBus);
    panel.init();
    panel.openSendGoldModal({} as never, 42, {} as PlayerView);
    panel.eventBus.emit(new MouseUpEvent(0, 0));
    expect(panel.isVisible).toBe(true);
    panel.eventBus.emit(new MouseUpEvent(0, 0));
    expect(panel.isVisible).toBe(false);
    panel.openSendGoldModal({} as never, 42, {} as PlayerView);
    panel.init();
    expect(panel.isVisible).toBe(false);
  });

  it("runs one rocket synchronization and one report confirmation per input after three starts", () => {
    const panel = mount();
    panel.initEventBus(panel.eventBus);
    panel.init();
    panel.initEventBus(panel.eventBus);
    panel.init();
    const update = vi.spyOn(panel, "requestUpdate");
    panel.eventBus.emit(new SwapRocketDirectionEvent(false));
    expect(panel.uiState.rocketDirectionUp).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
    panel.eventBus.emit(new PlayerReportedEvent("client-other"));
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("does not let prior or disposed buses close the new popup or change rocket direction", () => {
    const panel = mount();
    const oldBus = panel.eventBus;
    panel.initEventBus(new EventBus());
    panel.init();
    panel.show({} as never, 42);
    oldBus.emit(new CloseViewEvent());
    oldBus.emit(new SwapRocketDirectionEvent(false));
    expect(panel.isVisible).toBe(true);
    expect(panel.uiState.rocketDirectionUp).toBe(true);
    panel.dispose();
    panel.eventBus.emit(new SwapRocketDirectionEvent(false));
    expect(panel.isVisible).toBe(false);
    expect(panel.uiState.rocketDirectionUp).toBe(true);
  });

  it("ignores a pending actions response after the same HUD is restarted", async () => {
    const panel = mount();
    let resolveActions!: (value: unknown) => void;
    panel.g.myPlayer = () =>
      ({
        isAlive: () => true,
        actions: () =>
          new Promise((resolve) => {
            resolveActions = resolve;
          }),
      }) as never;
    panel.show({} as never, 42);
    const ticking = panel.tick();
    panel.init();
    resolveActions({ interaction: { allianceInfo: { expiresAt: 1000 } } });
    await ticking;
    expect(panel.isVisible).toBe(false);
    expect((panel as unknown as { actions: unknown }).actions).toBeNull();
  });

  it("caches a string player ID and ignores its late profile after restart", async () => {
    const panel = mount();
    const profile = vi.fn(async () => ({ relations: {} }));
    panel.g.owner = () =>
      ({
        isPlayer: () => true,
        id: () => "neighbor-country",
        profile,
      }) as never;
    panel.show({} as never, 42);
    await panel.tick();
    await panel.tick();
    expect(profile).toHaveBeenCalledTimes(1);
    let resolveProfile!: (value: unknown) => void;
    profile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProfile = resolve;
        }) as never,
    );
    panel.show({} as never, 43);
    const ticking = panel.tick();
    panel.init();
    resolveProfile({ relations: { 1: "hostile" } });
    await ticking;
    expect(
      (panel as unknown as { otherProfile: unknown }).otherProfile,
    ).toBeNull();
  });
});
