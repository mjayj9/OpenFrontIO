import { afterEach, describe, expect, it, vi } from "vitest";
import { HeadsUpMessage } from "../../src/client/hud/layers/HeadsUpMessage";
import { GameMode, GameType } from "../../src/core/game/Game";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import { makeEmptyGu, makeGameView, stubConfig } from "../util/viewStubs";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
}));

function gameAt(tick = 10, paused?: boolean, catchingUp = false) {
  const game = makeGameView({
    config: stubConfig({
      gameConfig: () =>
        ({ gameType: GameType.Singleplayer, gameMode: GameMode.FFA }) as never,
      numSpawnPhaseTurns: () => 0,
      hasExtendedSpawnImmunity: () => false,
      isReplay: () => false,
      isIntentionalSpectator: () => false,
      isRandomSpawn: () => false,
      overtimeConfig: () => ({ enabled: false, startMinutes: 30 }) as never,
    }),
  });
  const gu = makeEmptyGu(tick);
  gu.updates[GameUpdateType.SpawnPhaseEnd].push({
    type: GameUpdateType.SpawnPhaseEnd,
    startTick: 0,
  });
  if (paused !== undefined) {
    gu.updates[GameUpdateType.GamePaused].push({
      type: GameUpdateType.GamePaused,
      paused,
    });
  }
  game.update(gu);
  vi.spyOn(game, "isCatchingUp").mockReturnValue(catchingUp);
  return game;
}

function mount(game = gameAt()) {
  const banner = new HeadsUpMessage();
  banner.game = game;
  document.body.appendChild(banner);
  banner.init();
  return banner;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HeadsUpMessage reused match lifecycle", () => {
  it("removes the previous pause banner on a fresh game with no pause delta", async () => {
    const banner = mount(gameAt(870, true));
    banner.tick();
    await banner.updateComplete;
    expect(banner.textContent).toContain("singleplayer_game_paused");

    banner.game = gameAt(10);
    expect(banner.game.isPaused()).toBe(false);
    banner.init();
    banner.tick();
    await banner.updateComplete;
    expect(banner.textContent).not.toContain("singleplayer_game_paused");
    expect(banner.textContent?.trim()).toBe("");
  });

  it("shows a restored paused game's cached authoritative state immediately", async () => {
    const game = gameAt(838, true);
    game.update(makeEmptyGu(838));
    expect(game.updatesSinceLastTick()?.[GameUpdateType.GamePaused]).toEqual(
      [],
    );
    expect(game.isPaused()).toBe(true);
    const banner = mount(game);
    await banner.updateComplete;
    expect(banner.textContent).toContain("singleplayer_game_paused");
  });

  it("starts catch-up detection afresh instead of carrying the old threshold", async () => {
    const banner = mount(gameAt(100, undefined, true));
    for (let i = 0; i < 10; i++) banner.tick();
    await banner.updateComplete;
    expect(banner.textContent).toContain("catching_up");
    banner.game = gameAt(10, undefined, true);
    banner.init();
    banner.tick();
    await banner.updateComplete;
    expect(banner.textContent).not.toContain("catching_up");
  });

  it("clears an old toast and its timeout on reinit and disposal", async () => {
    vi.useFakeTimers();
    const banner = mount();
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: { message: "old match", duration: 10000, color: "red" },
      }),
    );
    await banner.updateComplete;
    expect(banner.textContent).toContain("old match");
    banner.game = gameAt();
    banner.init();
    await banner.updateComplete;
    expect(banner.textContent).not.toContain("old match");
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(
      new CustomEvent("show-message", { detail: { message: "new match" } }),
    );
    await banner.updateComplete;
    expect(banner.textContent).toContain("new match");
    banner.dispose();
    await banner.updateComplete;
    expect(banner.textContent?.trim()).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });
});
