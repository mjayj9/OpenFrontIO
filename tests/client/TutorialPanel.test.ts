import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestChapter } from "../../src/client/education/EducationProgressStore";
import { TutorialPanel } from "../../src/client/hud/layers/TutorialPanel";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { UnitType } from "../../src/core/game/Game";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import type { UserSettings } from "../../src/core/game/UserSettings";

vi.mock("../../src/client/Utils", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/client/Utils")>();
  return {
    ...original,
    translateText: (key: string, params?: Record<string, unknown>) =>
      `${key}${params ? JSON.stringify(params) : ""}`,
  };
});

describe("Tutorial panel uses actual game state", () => {
  let panel: TutorialPanel;
  let building: {
    isActive: () => boolean;
    isUnderConstruction: () => boolean;
  } | null;
  let effectiveKeys: Record<string, string>;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    building = null;
    effectiveKeys = {};
    const player = {
      id: () => "human-one",
      hasSpawned: () => true,
      isAlive: () => true,
      outgoingAttacks: () => [],
      numTilesOwned: () => 100,
      units: (type: UnitType) =>
        type === UnitType.City && building ? [building] : [],
      alliances: () => [],
      gold: () => 1_000_000n,
    };
    panel = new TutorialPanel();
    panel.game = {
      myPlayer: () => player,
      ticks: () => 1,
      playerViews: () => [],
      updatesSinceLastTick: () => null,
      markedPlayers: () => null,
      inSpawnPhase: () => false,
      setOwnSpawnRing: () => {},
      setMarkedPlayers: () => {},
      config: () => ({
        isReplay: () => false,
        isUnitDisabled: () => false,
        disableAlliances: () => true,
        gameConfig: () => ({ training: false }),
      }),
    } as unknown as GameView;
    panel.eventBus = new EventBus();
    panel.userSettings = {
      tutorialDismissed: () => false,
      setTutorialDismissed: () => {},
      keybinds: () => effectiveKeys,
      parsedUserKeybinds: () => ({ buildCity: { key: "obsolete" } }),
    } as unknown as UserSettings;
    panel.uiState = {
      attackRatio: 0.2,
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };
    document.body.append(panel);
    panel.startChapter("economy");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("waits for completed construction instead of accepting a construction site", () => {
    panel.tick();
    building = { isActive: () => true, isUnderConstruction: () => true };
    panel.tick();
    expect(
      panel.educationSnapshot().progress.outcomes.buy_city,
    ).toBeUndefined();
    building = { isActive: () => true, isUnderConstruction: () => false };
    panel.tick();
    expect(panel.educationSnapshot().progress.outcomes.buy_city).toBe(
      "practiced",
    );
  });

  it("latches actual conquest once per tick and clears old evidence when practice restarts", () => {
    vi.spyOn(panel.game, "ticks").mockReturnValue(2);
    vi.spyOn(panel.game, "updatesSinceLastTick").mockReturnValue({
      [GameUpdateType.ConquestEvent]: [
        {
          type: GameUpdateType.ConquestEvent,
          conquerorId: "human-one",
          conqueredId: "practice-tribe",
          gold: 0n,
        },
      ],
    } as ReturnType<GameView["updatesSinceLastTick"]>);
    panel.tick();
    panel.tick();
    expect(panel.educationSnapshot().evidence.conqueredPlayers).toBe(1);
    const saved = panel.educationSnapshot();
    panel.init();
    expect(panel.restoreEducationSnapshot(saved)).toBe(true);
    // The initial view carries the same event batch; restoration must not
    // convert the existing conquest into an additional success.
    panel.tick();
    expect(panel.educationSnapshot().evidence.conqueredPlayers).toBe(1);
    panel.startChapter("basic");
    panel.tick();
    expect(panel.educationSnapshot().evidence.conqueredPlayers).toBe(0);
  });

  it("shows unassigned keys and refreshes effective bindings during play", async () => {
    panel.tick();
    await panel.updateComplete;
    expect(panel.textContent).toContain('"key":"education.unbound"');
    expect(panel.textContent).not.toContain("obsolete");
    effectiveKeys = { buildCity: "Shift+KeyJ" };
    panel.requestUpdate();
    await panel.updateComplete;
    expect(panel.textContent).toContain('"key":"Shift + J"');
  });

  it("keeps the Classic course closed on a modern start, including switching a reused panel", async () => {
    panel.tick();
    expect(panel.educationSnapshot().chapter).toBe("economy");
    const previousConfig = panel.game.config();
    vi.spyOn(panel.game, "config").mockReturnValue({
      ...previousConfig,
      gameConfig: () => ({ modernMode: { scenario: "modern-world-v1" } }),
    } as ReturnType<GameView["config"]>);
    panel.init();
    panel.tick();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain("education.chapter");
    expect(panel.educationSnapshot().progress.outcomes).toEqual({});
    expect(panel.educationSnapshot().evidence.conqueredPlayers).toBe(0);
  });

  it("opens an explicitly requested modern practice chapter after initialization", async () => {
    const previousConfig = panel.game.config();
    vi.spyOn(panel.game, "config").mockReturnValue({
      ...previousConfig,
      gameConfig: () => ({ modernMode: { scenario: "modern-world-v1" } }),
    } as ReturnType<GameView["config"]>);
    panel.init();
    requestChapter("economy");
    panel.tick();
    await panel.updateComplete;
    expect(panel.textContent).toContain("education.chapter");
    expect(panel.educationSnapshot().chapter).toBe("economy");
  });

  it.each(["current", "legacy"] as const)(
    "keeps hidden education closed when restoring a modern save (%s)",
    async (format) => {
      const previousConfig = panel.game.config();
      vi.spyOn(panel.game, "config").mockReturnValue({
        ...previousConfig,
        gameConfig: () => ({ modernMode: { scenario: "modern-world-v1" } }),
      } as ReturnType<GameView["config"]>);
      panel.init();
      panel.tick();
      const snapshot = panel.educationSnapshot();
      expect(snapshot.active).toBe(false);
      const saved =
        format === "legacy"
          ? {
              chapter: snapshot.chapter,
              progress: snapshot.progress,
              evidence: snapshot.evidence,
            }
          : snapshot;
      panel.init();
      expect(panel.restoreEducationSnapshot(saved)).toBe(true);
      panel.tick();
      await panel.updateComplete;
      expect(panel.textContent).not.toContain("education.chapter");
      expect(panel.textContent).not.toContain("tutorial.step.spawn");
      expect(panel.educationSnapshot().active).toBe(false);
      expect(panel.classList.contains("hidden")).toBe(true);
    },
  );

  it("resumes an explicitly opened modern chapter with its guide pause state", async () => {
    const previousConfig = panel.game.config();
    vi.spyOn(panel.game, "config").mockReturnValue({
      ...previousConfig,
      gameConfig: () => ({ modernMode: { scenario: "modern-world-v1" } }),
    } as ReturnType<GameView["config"]>);
    panel.init();
    panel.startChapter("economy");
    panel.tick();
    await panel.updateComplete;
    const pause = [...panel.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("education.pause_guide"),
    );
    expect(pause).toBeDefined();
    pause!.click();
    await panel.updateComplete;
    const saved = panel.educationSnapshot();
    expect(saved.active).toBe(true);
    expect(saved.guidePaused).toBe(true);
    panel.init();
    expect(panel.restoreEducationSnapshot(saved)).toBe(true);
    panel.tick();
    await panel.updateComplete;
    expect(panel.textContent).toContain("education.chapter");
    expect(panel.textContent).toContain("education.guide_paused");
    expect(panel.educationSnapshot().chapter).toBe("economy");
  });

  it("preserves the actual hide-for-game choice through a Classic save", async () => {
    panel.tick();
    await panel.updateComplete;
    (
      panel.querySelector('[aria-label="tutorial.close"]') as HTMLButtonElement
    ).click();
    await panel.updateComplete;
    const hide = [...panel.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("tutorial.hide_for_game"),
    );
    expect(hide).toBeDefined();
    hide!.click();
    await panel.updateComplete;
    const saved = panel.educationSnapshot();
    expect(saved.active).toBe(false);
    panel.init();
    expect(panel.restoreEducationSnapshot(saved)).toBe(true);
    panel.tick();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain("education.chapter");
    expect(panel.educationSnapshot().chapter).toBe("economy");
  });

  it("does not open a lesson when saved progress is incompatible", async () => {
    const saved = panel.educationSnapshot();
    panel.init();
    expect(
      panel.restoreEducationSnapshot({
        ...saved,
        progress: { ...saved.progress, version: 999 },
      }),
    ).toBe(false);
    await panel.updateComplete;
    expect(panel.textContent).not.toContain("education.chapter");
  });

  it.each([false, true])(
    "still automatically opens the basic course for Classic/training (training=%s)",
    async (training) => {
      const previousConfig = panel.game.config();
      vi.spyOn(panel.game, "config").mockReturnValue({
        ...previousConfig,
        gameConfig: () => ({ training }),
      } as ReturnType<GameView["config"]>);
      panel.init();
      panel.tick();
      await panel.updateComplete;
      expect(panel.textContent).toContain("education.chapter");
      expect(panel.educationSnapshot().chapter).toBe("basic");
    },
  );
});
