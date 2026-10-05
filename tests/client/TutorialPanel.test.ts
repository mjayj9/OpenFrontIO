import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestChapter } from "../../src/client/education/EducationProgressStore";
import { TutorialPanel } from "../../src/client/hud/layers/TutorialPanel";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { UnitType } from "../../src/core/game/Game";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import type { UserSettings } from "../../src/core/game/UserSettings";
import type { ModernState } from "../../src/core/modern/ModernState";

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
      effectiveKeybinds: () => effectiveKeys,
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

  it("keeps modern practice outside the lower HUD stacking context and restores Classic placement", () => {
    const hud = document.createElement("div");
    hud.style.position = "fixed";
    hud.style.zIndex = "200";
    const next = document.createElement("control-panel");
    document.body.append(hud);
    hud.append(panel, next);
    const config = panel.game.config();
    vi.spyOn(panel.game, "config").mockReturnValue({
      ...config,
      gameConfig: () => ({
        modernMode: { version: 2, scenario: "modern-regions-v2" },
      }),
    } as ReturnType<GameView["config"]>);
    panel.init();
    expect(panel.parentNode).toBe(document.body);
    expect(panel.classList.contains("z-[960]")).toBe(true);
    panel.init();
    expect(document.querySelectorAll("tutorial-panel")).toHaveLength(1);
    vi.spyOn(panel.game, "config").mockReturnValue(config);
    panel.init();
    expect(panel.parentNode).toBe(hud);
    expect(panel.nextSibling).toBe(next);
    expect(panel.classList.contains("z-[960]")).toBe(false);
    vi.spyOn(panel.game, "config").mockReturnValue({
      ...config,
      gameConfig: () => ({
        modernMode: { version: 2, scenario: "modern-regions-v2" },
      }),
    } as ReturnType<GameView["config"]>);
    panel.init();
    panel.startChapter("modern_commands");
    panel.dispose();
    expect(panel.educationSnapshot().active).toBe(false);
    expect(panel.classList.contains("hidden")).toBe(true);
    expect(panel.parentNode).toBe(hud);
    expect(panel.nextSibling).toBe(next);
  });

  it("offers the current command step's practical hint without completing practice", async () => {
    panel.startChapter("modern_commands");
    await panel.updateComplete;
    const hint = [...panel.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("education.hint"),
    );
    expect(hint).toBeDefined();
    hint!.click();
    await panel.updateComplete;
    expect(panel.textContent).toContain("education.modern_hints.modern_camera");
    expect(panel.educationSnapshot().progress.outcomes).toEqual({});
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

  it("starts the actual matching modern scenario when changing or repeating practice", () => {
    const previousConfig = panel.game.config();
    vi.spyOn(panel.game, "config").mockReturnValue({
      ...previousConfig,
      gameConfig: () => ({
        modernMode: {
          scenario: "modern-regions-v2",
          trainingLesson: "regions",
        },
      }),
    } as ReturnType<GameView["config"]>);
    const start = vi.fn();
    document.addEventListener("start-tutorial", start);
    const ui = panel as unknown as {
      chooseChapter: (
        chapter: "modern_regions" | "modern_ports",
        restart?: boolean,
      ) => void;
    };
    ui.chooseChapter("modern_ports");
    expect(start).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: { chapter: "modern_ports" } }),
    );
    ui.chooseChapter("modern_regions", true);
    expect(start).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: { chapter: "modern_regions" } }),
    );
    expect(start).toHaveBeenCalledTimes(2);
    ui.chooseChapter("modern_regions");
    expect(start).toHaveBeenCalledTimes(2);
    expect(panel.educationSnapshot().chapter).toBe("modern_regions");
    document.removeEventListener("start-tutorial", start);
  });

  it("waits for modern scenario bootstrap instead of marking practice unavailable", async () => {
    const previousConfig = panel.game.config();
    vi.spyOn(panel.game, "config").mockReturnValue({
      ...previousConfig,
      gameConfig: () => ({
        modernMode: {
          scenario: "modern-regions-v2",
          initialPopulation: 1000000,
        },
      }),
    } as ReturnType<GameView["config"]>);
    let systems: ModernState | null = null;
    panel.game.modernSystems = () => systems;
    panel.init();
    requestChapter("modern_regions");
    panel.tick();
    expect(panel.educationSnapshot().progress.outcomes).toEqual({});
    systems = {
      version: 2,
      tick: 1,
      seed: 1,
      nextForceId: 1,
      factions: [
        {
          playerId: "human-one",
          factionId: "KOR",
          parentCountryId: "KOR",
          ownedAreaUnits: 1,
          aiLevel: null,
          aiRole: "human",
          climateAdaptation: ["temperate"],
          completedTraining: 0,
          populationTransferredTo: null,
          nuclearStrikes: [],
          population: {
            total: 1000000,
            civilian: 970000,
            available: 12000,
            army: 18000,
            navy: 0,
            air: 0,
            dead: 0,
          },
        },
      ],
      ports: [],
      forces: [],
      bases: [],
      samAircraftReloads: [],
      aiPlans: [],
    };
    panel.tick();
    await panel.updateComplete;
    expect(panel.educationSnapshot().progress.outcomes.modern_regions).toBe(
      "practiced",
    );
    const options = panel.querySelector<HTMLButtonElement>("[aria-expanded]");
    options?.click();
    await panel.updateComplete;
    expect(panel.querySelector<HTMLSelectElement>("select")?.value).toBe(
      "modern_regions",
    );
    const force = {
      id: "air",
      playerId: "human-one",
      branch: "air",
      kind: "fighter",
      phase: "engaging",
      baseId: "base",
      tile: 5,
      completedMissions: 0,
      casualties: 0,
    } as ModernState["forces"][number];
    systems.forces.push(force);
    systems.bases.push({
      id: "base",
      playerId: "human-one",
      tile: 5,
      capacity: 24,
      health: 1000,
      maxHealth: 1000,
    });
    const evidence = panel as unknown as {
      buildModernEvidence: (player: unknown) => {
        airReturns: number;
        airRearms: number;
        nuclearImpacts: number;
        queuedOrders: number;
      };
    };
    evidence.buildModernEvidence(panel.game.myPlayer());
    force.phase = "rearming";
    expect(evidence.buildModernEvidence(panel.game.myPlayer()).airReturns).toBe(
      0,
    );
    force.phase = "engaging";
    evidence.buildModernEvidence(panel.game.myPlayer());
    force.completedMissions = 1;
    force.phase = "rearming";
    expect(evidence.buildModernEvidence(panel.game.myPlayer()).airReturns).toBe(
      1,
    );
    expect(evidence.buildModernEvidence(panel.game.myPlayer()).airReturns).toBe(
      1,
    );
    force.phase = "returning";
    expect(evidence.buildModernEvidence(panel.game.myPlayer()).airReturns).toBe(
      2,
    );
    expect(
      evidence.buildModernEvidence(panel.game.myPlayer()).queuedOrders,
    ).toBe(0);
    force.queue = [{ kind: "move", target: 8, issuedTick: 12 }];
    expect(
      evidence.buildModernEvidence(panel.game.myPlayer()).queuedOrders,
    ).toBe(1);
    expect(
      evidence.buildModernEvidence(panel.game.myPlayer()).queuedOrders,
    ).toBe(1);
    const acknowledged = panel.educationSnapshot();
    expect(panel.restoreEducationSnapshot(acknowledged)).toBe(true);
    expect(
      evidence.buildModernEvidence(panel.game.myPlayer()).queuedOrders,
    ).toBe(1);
    force.queue = [];
    expect(
      evidence.buildModernEvidence(panel.game.myPlayer()).queuedOrders,
    ).toBe(1);
    force.phase = "rearming";
    expect(evidence.buildModernEvidence(panel.game.myPlayer()).airReturns).toBe(
      2,
    );
    const player = panel.game.myPlayer()!;
    Object.assign(player, { smallID: () => 1 });
    vi.spyOn(player, "units").mockReturnValue([
      { id: () => 7, targetTile: () => 20 } as unknown as ReturnType<
        typeof player.units
      >[number],
    ]);
    panel.game.ownerID = () => 2;
    let impacted: number[] = [];
    let update = {
      type: GameUpdateType.Unit,
      unitType: UnitType.AtomBomb,
      id: 7,
      ownerID: 1,
      reachedTarget: false,
    };
    panel.game.recentlyNukedTiles = () => impacted;
    vi.spyOn(panel.game, "updatesSinceLastTick").mockImplementation(
      () =>
        ({ [GameUpdateType.Unit]: [update] }) as ReturnType<
          GameView["updatesSinceLastTick"]
        >,
    );
    expect(evidence.buildModernEvidence(player).nuclearImpacts).toBe(0);
    impacted = [20];
    expect(evidence.buildModernEvidence(player).nuclearImpacts).toBe(0);
    update = { ...update, ownerID: 2, reachedTarget: true };
    expect(evidence.buildModernEvidence(player).nuclearImpacts).toBe(0);
    update = { ...update, ownerID: 1 };
    expect(evidence.buildModernEvidence(player).nuclearImpacts).toBe(1);
    expect(evidence.buildModernEvidence(player).nuclearImpacts).toBe(1);
    const saved = panel.educationSnapshot();
    expect(saved.evidence.modern.nuclearImpacts).toEqual([7]);
    expect(panel.restoreEducationSnapshot(saved)).toBe(true);
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
