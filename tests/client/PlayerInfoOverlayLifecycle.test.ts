import { afterEach, describe, expect, it, vi } from "vitest";
import { ImmunityBarVisibleEvent } from "../../src/client/hud/layers/ImmunityTimer";
import { PlayerInfoOverlay } from "../../src/client/hud/layers/PlayerInfoOverlay";
import { SpawnBarVisibleEvent } from "../../src/client/hud/layers/SpawnTimer";
import { ContextMenuEvent, TouchEvent } from "../../src/client/InputHandler";
import type { GameView, PlayerView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { PlayerType } from "../../src/core/game/Game";

vi.mock("../../src/client/hud/PlayerIcons", () => ({
  EMOJI_ICON_KIND: "emoji",
  IMAGE_ICON_KIND: "image",
  getFirstPlacePlayer: () => null,
  getPlayerIcons: () => [],
}));

function mount() {
  const owner = {
    isPlayer: () => true,
    profile: vi.fn(async () => null),
    getTraitorRemainingTicks: () => 0,
    outgoingAttacks: () => [],
    troops: () => 100,
    gold: () => 0n,
    type: () => PlayerType.Human,
    team: () => null,
    displayName: () => "Old Player",
    cosmetics: {},
    id: () => "old",
    smallID: () => 2,
  } as unknown as PlayerView;
  const overlay = new PlayerInfoOverlay();
  overlay.eventBus = new EventBus();
  overlay.game = {
    isValidCoord: () => true,
    ref: () => 42,
    owner: () => owner,
    myPlayer: () => null,
    teamClanTag: () => undefined,
    config: () => ({ isUnitDisabled: () => true, maxTroops: () => 1000 }),
  } as unknown as GameView;
  overlay.transform = {
    screenToWorldCoordinates: () => ({ x: 5, y: 5 }),
  } as never;
  document.body.appendChild(overlay);
  overlay.init();
  return { overlay, owner };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PlayerInfoOverlay reused HUD lifecycle", () => {
  it("clears the old hover card before a paused restored game's first interaction", async () => {
    const { overlay } = mount();
    overlay.eventBus.emit(new TouchEvent(10, 10));
    await overlay.updateComplete;
    expect(overlay.textContent).toContain("Old Player");
    expect(overlay.querySelector(".opacity-100.visible")).not.toBeNull();
    overlay.init();
    await overlay.updateComplete;
    expect(overlay.textContent).not.toContain("Old Player");
    expect(overlay.querySelector(".opacity-100.visible")).toBeNull();
  });

  it("fetches a profile once per context input after repeated starts", () => {
    const { overlay, owner } = mount();
    overlay.init();
    overlay.init();
    overlay.eventBus.emit(new ContextMenuEvent(10, 10));
    expect(owner.profile).toHaveBeenCalledTimes(1);
  });

  it("detaches old and disposed buses so they cannot redisplay or offset the next game", async () => {
    const { overlay, owner } = mount();
    const oldBus = overlay.eventBus;
    overlay.eventBus = new EventBus();
    overlay.init();
    oldBus.emit(new ContextMenuEvent(10, 10));
    oldBus.emit(new SpawnBarVisibleEvent(true));
    oldBus.emit(new ImmunityBarVisibleEvent(true));
    await overlay.updateComplete;
    expect(owner.profile).not.toHaveBeenCalled();
    expect(overlay.querySelector<HTMLElement>(".fixed")?.style.marginTop).toBe(
      "0px",
    );
    overlay.dispose();
    overlay.eventBus.emit(new TouchEvent(10, 10));
    await overlay.updateComplete;
    expect(owner.profile).not.toHaveBeenCalled();
    expect(overlay.querySelector(".fixed")).toBeNull();
  });

  it("ignores a prior hover's late profile after a different player is selected", async () => {
    const { overlay, owner } = mount();
    let resolveProfile!: (value: unknown) => void;
    vi.mocked(owner.profile).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProfile = resolve;
      }) as never,
    );
    overlay.maybeShow(10, 10);
    overlay.init();
    resolveProfile({ relations: { 1: "hostile" } });
    await Promise.resolve();
    expect(
      (overlay as unknown as { playerProfile: unknown }).playerProfile,
    ).toBeNull();
    await overlay.updateComplete;
    expect(overlay.textContent).not.toContain("Old Player");
  });
});
