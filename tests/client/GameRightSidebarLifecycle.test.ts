import { afterEach, describe, expect, it, vi } from "vitest";
import { GameRightSidebar } from "../../src/client/hud/layers/GameRightSidebar";
import { ImmunityBarVisibleEvent } from "../../src/client/hud/layers/ImmunityTimer";
import { ShowReplayPanelEvent } from "../../src/client/hud/layers/ReplayPanel";
import { ShowSettingsModalEvent } from "../../src/client/hud/layers/SettingsModal";
import { SpawnBarVisibleEvent } from "../../src/client/hud/layers/SpawnTimer";
import { TogglePauseIntentEvent } from "../../src/client/InputHandler";
import {
  PauseGameIntentEvent,
  SendWinnerEvent,
} from "../../src/client/Transport";
import { showToast } from "../../src/client/Utils";
import { EventBus } from "../../src/core/EventBus";
import { GameType } from "../../src/core/game/Game";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
  stubConfig,
} from "../util/viewStubs";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
  showToast: vi.fn(),
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: () => false,
    gameplayStop: vi.fn(),
    gameplayStart: vi.fn(),
  },
}));

function gameAt(
  tick = 0,
  paused = false,
  gameType = GameType.Singleplayer,
  creator = false,
  maxTimerValue: number | null = null,
) {
  const game = makeGameView({
    myClientID: "local",
    config: stubConfig({
      gameConfig: () => ({ gameType, maxTimerValue }) as never,
      isReplay: () => false,
      listed: false,
      doomsdayClockConfig: () => ({ enabled: false, warnSeconds: 15 }) as never,
      overtimeConfig: () => ({ enabled: false, startMinutes: 30 }) as never,
    }),
  });
  const gu = makeEmptyGu(tick);
  gu.updates[GameUpdateType.SpawnPhaseEnd].push({
    type: GameUpdateType.SpawnPhaseEnd,
    startTick: 0,
  });
  gu.updates[GameUpdateType.GamePaused].push({
    type: GameUpdateType.GamePaused,
    paused,
  });
  gu.updates[GameUpdateType.Player].push(
    makePlayerUpdate({ clientID: "local", isLobbyCreator: creator }),
  );
  game.update(gu);
  return game;
}

function mount(game = gameAt(), eventBus = new EventBus()) {
  const sidebar = new GameRightSidebar();
  sidebar.game = game;
  sidebar.eventBus = eventBus;
  const wrapper = document.createElement("div");
  wrapper.appendChild(sidebar);
  document.body.appendChild(wrapper);
  sidebar.init();
  const pauses: boolean[] = [];
  eventBus.on(PauseGameIntentEvent, (event) => pauses.push(event.paused));
  return { sidebar, wrapper, eventBus, pauses };
}

function pauseIcon(sidebar: GameRightSidebar) {
  return sidebar.querySelector<HTMLImageElement>('img[alt="play/pause"]')!;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("GameRightSidebar reused HUD lifecycle", () => {
  it("allows a new match's one-minute notice while keeping it once per match", () => {
    const first = gameAt(650, false, GameType.Singleplayer, false, 2);
    const { sidebar } = mount(first);
    sidebar.tick();
    expect(showToast).toHaveBeenCalledTimes(1);
    sidebar.game = gameAt(650, false, GameType.Singleplayer, false, 2);
    sidebar.init();
    sidebar.tick();
    expect(showToast).toHaveBeenCalledTimes(2);
  });
  it("drops the old winner latch and derives a restarted game's timer immediately", async () => {
    const { sidebar, eventBus } = mount(gameAt(1200));
    sidebar.tick();
    eventBus.emit(new SendWinnerEvent(undefined, {}));
    sidebar.game = gameAt(10);
    sidebar.init();
    await sidebar.updateComplete;
    expect(
      sidebar.querySelector("[data-game-timer]")?.textContent?.trim(),
    ).toBe("00:01");
    sidebar.game.update(makeEmptyGu(20));
    sidebar.tick();
    await sidebar.updateComplete;
    expect(
      sidebar.querySelector("[data-game-timer]")?.textContent?.trim(),
    ).toBe("00:02");
  });

  it("preserves authoritative pause from a restored view and resumes with one click", async () => {
    const { sidebar, pauses } = mount(gameAt(455, true));
    await sidebar.updateComplete;
    expect(pauseIcon(sidebar).src).toContain("PlayIcon");
    expect(
      sidebar.querySelector("[data-game-timer]")?.textContent?.trim(),
    ).toBe("00:45");
    pauseIcon(sidebar).parentElement!.click();
    await sidebar.updateComplete;
    expect(pauses).toEqual([false]);
    expect(pauseIcon(sidebar).src).toContain("PauseIcon");
    // A queued old update is not an acknowledgment of our resume intent.
    sidebar.tick();
    await sidebar.updateComplete;
    expect(pauseIcon(sidebar).src).toContain("PauseIcon");
    const resumed = makeEmptyGu(456);
    resumed.updates[GameUpdateType.GamePaused].push({
      type: GameUpdateType.GamePaused,
      paused: false,
    });
    sidebar.game.update(resumed);
    sidebar.tick();
    expect(sidebar.game.isPaused()).toBe(false);
  });

  it("emits one pause per hotkey after repeated initialization, including rapid toggles", async () => {
    const { sidebar, eventBus, pauses } = mount();
    sidebar.init();
    sidebar.init();
    eventBus.emit(new TogglePauseIntentEvent());
    eventBus.emit(new TogglePauseIntentEvent());
    expect(pauses).toEqual([true, false]);
    await sidebar.updateComplete;
    expect(pauseIcon(sidebar).src).toContain("PauseIcon");
  });

  it("does not let the old bus mutate the next game and disposes current subscriptions", async () => {
    const { sidebar, wrapper, eventBus } = mount();
    const nextBus = new EventBus();
    const pauses: boolean[] = [];
    nextBus.on(PauseGameIntentEvent, (event) => pauses.push(event.paused));
    sidebar.game = gameAt(10);
    sidebar.eventBus = nextBus;
    sidebar.init();
    eventBus.emit(new SendWinnerEvent(undefined, {}));
    eventBus.emit(new TogglePauseIntentEvent());
    eventBus.emit(new SpawnBarVisibleEvent(true));
    eventBus.emit(new ImmunityBarVisibleEvent(true));
    sidebar.game.update(makeEmptyGu(20));
    sidebar.tick();
    await sidebar.updateComplete;
    expect(pauses).toEqual([]);
    expect(wrapper.style.marginTop).toBe("0px");
    expect(
      sidebar.querySelector("[data-game-timer]")?.textContent?.trim(),
    ).toBe("00:02");
    sidebar.dispose();
    nextBus.emit(new TogglePauseIntentEvent());
    expect(pauses).toEqual([]);
  });

  it("resets old host privileges, bars and replay UI on a new non-host match", async () => {
    const { sidebar, wrapper, eventBus } = mount(
      gameAt(0, false, GameType.Private, true),
    );
    sidebar.tick();
    eventBus.emit(new SpawnBarVisibleEvent(true));
    eventBus.emit(new ImmunityBarVisibleEvent(true));
    expect(wrapper.style.marginTop).toBe("14px");
    const replayVisibility: boolean[] = [];
    eventBus.on(ShowReplayPanelEvent, (event) =>
      replayVisibility.push(event.visible),
    );
    sidebar.game = gameAt(0, false, GameType.Private, false);
    sidebar.init();
    await sidebar.updateComplete;
    expect(wrapper.style.marginTop).toBe("0px");
    expect(pauseIcon(sidebar)).toBeNull();
    expect(replayVisibility).toEqual([false]);
  });

  it("tracks pause from other controls and passes it to the settings menu", async () => {
    const { sidebar, eventBus } = mount();
    const settings: ShowSettingsModalEvent[] = [];
    eventBus.on(ShowSettingsModalEvent, (event) => settings.push(event));
    eventBus.emit(new PauseGameIntentEvent(true));
    await sidebar.updateComplete;
    expect(pauseIcon(sidebar).src).toContain("PlayIcon");
    sidebar
      .querySelector<HTMLImageElement>('img[alt="settings"]')!
      .parentElement!.click();
    expect(settings[0].isPaused).toBe(true);
    sidebar.game = gameAt();
    sidebar.init();
    await sidebar.updateComplete;
    expect(pauseIcon(sidebar).src).toContain("PauseIcon");
  });
});
