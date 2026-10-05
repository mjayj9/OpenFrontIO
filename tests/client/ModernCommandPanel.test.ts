import { describe, expect, it, vi } from "vitest";
import { ModernCommandPanel } from "../../src/client/ModernCommandPanel";
import {
  ModernPreviewEvent,
  ModernSelectionEvent,
  ModernTargetEvent,
} from "../../src/client/ModernInput";
import type { TransformHandler } from "../../src/client/TransformHandler";
import { SendModernIntentEvent } from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { type BuildableUnit, UnitType } from "../../src/core/game/Game";
import type { TileRef } from "../../src/core/game/GameMap";
import type {
  ModernCommandPreview,
  ModernForceState,
} from "../../src/core/modern/ModernForceTypes";
import type { ModernState } from "../../src/core/modern/ModernState";

function setup() {
  const panel = new ModernCommandPanel();
  const force = {
    id: "own-army",
    playerId: "human",
    branch: "army",
    kind: "army",
    tile: 10,
    personnel: 1000,
    phase: "idle",
    queue: [],
    path: [],
    pathIndex: 0,
    attackTroops: 0,
    unitId: null,
    cooldownUntil: 0,
    baseId: null,
    aircraft: 0,
    command: null,
    attackId: null,
    lastReason: null,
    completedMissions: 0,
    lastMissionTick: 0,
    casualties: 0,
    movementProgress: 0,
  } as ModernForceState;
  const state = {
    forces: [force],
    bases: [
      {
        id: "base",
        playerId: "human",
        tile: 10,
        capacity: 24,
        health: 20000,
        maxHealth: 20000,
      },
    ],
    ports: [],
    factions: [],
  } as unknown as ModernState;
  const player = {
    id: () => "human",
    smallID: () => 1,
    gold: () => 400000n,
    troops: () => 170000,
    buildables: vi.fn().mockResolvedValue([
      { type: UnitType.Port, cost: 250000n },
      { type: UnitType.Warship, cost: 12000n },
    ]),
    nameLocation: () => ({ x: 10, y: 0 }),
    units: () => [
      {
        isActive: () => true,
        isUnderConstruction: () => false,
        tile: () => 20,
      },
    ],
  };
  panel.game = {
    modernSystems: () => state,
    myPlayer: () => player,
    width: () => 100,
    height: () => 100,
    ref: (x: number, y: number) => y * 100 + x,
    ownerID: () => 1,
    config: () => ({ isUnitDisabled: () => false }),
    isLand: () => true,
    isImpassable: () => false,
    ticks: () => 0,
    isPaused: () => false,
    isValidCoord: (x: number, y: number) =>
      x >= 0 && y >= 0 && x < 100 && y < 100,
    x: (tile: number) => tile % 100,
    y: (tile: number) => Math.floor(tile / 100),
  } as unknown as GameView;
  panel.transform = {
    screenToWorldCoordinates: (x: number, y: number) => ({ x, y }),
    worldToScreenCoordinates: (cell: { x: number; y: number }) => cell,
  } as unknown as TransformHandler;
  panel.uiState = {
    attackRatio: 0.2,
    ghostStructure: null,
    rocketDirectionUp: true,
    upgradeMultiplier: 1,
  };
  panel.eventBus = new EventBus();
  const sent = vi.fn();
  panel.eventBus.on(SendModernIntentEvent, sent);
  const ui = panel as unknown as {
    stopped: boolean;
    selectedIds: string[];
    target: TileRef | null;
    preview: ModernCommandPreview | null;
    branch: "army" | "navy" | "air";
    prepare: (target: TileRef, queue: boolean) => Promise<boolean>;
    onPreview: (event: ModernPreviewEvent) => void;
    onSelect: (event: ModernSelectionEvent) => void;
    onVisible: () => void;
    onClear: () => void;
    selectFromRoster: (id: string, shift?: boolean) => void;
    effectiveProductionSource: (people: number) => "army_reserve" | "available";
    flushHover: () => Promise<void>;
    previews: Map<string, { preview: ModernCommandPreview; command: string }>;
    confirm: () => void;
    produce: (kind: "airbase" | "warship" | "navybase") => void;
    onTarget: (event: ModernTargetEvent) => void;
    clearPreview: () => void;
    control: (command: "stop" | "cancel" | "wait") => void;
    sendModern: (event: SendModernIntentEvent) => void;
    status: string;
    expanded: boolean;
    productionManpowerSource: "auto" | "army_reserve" | "available";
    productionReason: (kind: string) => string | null;
    productionCost: (kind: string) => number;
    refreshNativeCosts: () => void;
    pendingProductionTile: TileRef | null;
  };
  ui.stopped = false;
  ui.selectedIds = [force.id];
  panel.queryPreview = vi.fn().mockResolvedValue({
    valid: true,
    reason: null,
    path: [10, 11],
    etaTicks: 4,
    rangeTiles: 1,
    risk: "uncertain",
    climateEfficiencyPermille: 1000,
  });
  return { panel, ui, state, sent };
}
describe("modern military command confirmation", () => {
  const nativePort = (
    canBuild: TileRef | false,
    cost = 250000n,
  ): BuildableUnit => ({
    type: UnitType.Port,
    canBuild,
    canUpgrade: false,
    cost,
    overlappingRailroads: [],
    ghostRailPaths: [],
  });
  it("keeps naval placement pending and rejects the native facility-spacing result without dispatching", async () => {
    const { panel, ui, sent } = setup();
    ui.refreshNativeCosts();
    await vi.waitFor(() => expect(ui.productionCost("navybase")).toBe(250000));
    let resolve!: (result: BuildableUnit[]) => void;
    vi.mocked(panel.game.myPlayer()!.buildables).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    ui.produce("navybase");
    ui.onTarget(new ModernTargetEvent(12, 0, false));
    expect(ui.preview).toBeNull();
    expect(ui.pendingProductionTile).toBeNull();
    ui.confirm();
    expect(sent).not.toHaveBeenCalled();
    resolve([nativePort(false)]);
    await vi.waitFor(() =>
      expect(ui.preview?.reason).toBe("navybase_no_valid_site"),
    );
    expect(ui.preview?.valid).toBe(false);
    ui.confirm();
    expect(sent).not.toHaveBeenCalled();
    expect(panel.game.myPlayer()!.buildables).toHaveBeenLastCalledWith(12, [
      UnitType.Port,
    ]);
  });
  it("previews the native adjusted coast and revalidates that exact site before one construction intent", async () => {
    const { panel, ui, sent } = setup();
    ui.refreshNativeCosts();
    await vi.waitFor(() => expect(ui.productionCost("navybase")).toBe(250000));
    vi.mocked(panel.game.myPlayer()!.buildables).mockResolvedValue([
      nativePort(17),
    ]);
    ui.produce("navybase");
    ui.onTarget(new ModernTargetEvent(12, 0, false));
    await vi.waitFor(() => expect(ui.pendingProductionTile).toBe(17));
    expect(ui.preview?.path).toEqual([17]);
    expect(sent).not.toHaveBeenCalled();
    ui.confirm();
    ui.confirm(); // A repeated touch during revalidation cannot build twice.
    await vi.waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(panel.game.myPlayer()!.buildables).toHaveBeenLastCalledWith(17, [
      UnitType.Port,
    ]);
    expect(sent.mock.calls[0][0].intent).toMatchObject({
      type: "modern_produce",
      branch: "navy",
      kind: "navybase",
      tile: 17,
      count: 1,
    });
    expect(ui.preview).toBeNull();
  });
  it("rejects a site blocked after preview and requires a fresh confirmation when the native site or price changes", async () => {
    const { panel, ui, sent } = setup();
    ui.refreshNativeCosts();
    await vi.waitFor(() => expect(ui.productionCost("navybase")).toBe(250000));
    const query = vi.mocked(panel.game.myPlayer()!.buildables);
    query.mockResolvedValue([nativePort(17)]);
    ui.produce("navybase");
    ui.onTarget(new ModernTargetEvent(12, 0, false));
    await vi.waitFor(() => expect(ui.pendingProductionTile).toBe(17));
    query.mockResolvedValue([nativePort(false)]);
    ui.confirm();
    await vi.waitFor(() =>
      expect(ui.preview?.reason).toBe("navybase_no_valid_site"),
    );
    expect(sent).not.toHaveBeenCalled();
    query.mockResolvedValue([nativePort(18)]);
    ui.onTarget(new ModernTargetEvent(17, 0, false));
    await vi.waitFor(() => expect(ui.pendingProductionTile).toBe(18));
    query.mockResolvedValue([nativePort(19, 300000n)]);
    ui.confirm();
    await vi.waitFor(() => expect(ui.pendingProductionTile).toBe(19));
    expect(ui.preview?.path).toEqual([19]);
    expect(ui.productionCost("navybase")).toBe(300000);
    expect(sent).not.toHaveBeenCalled();
    ui.confirm();
    await vi.waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(sent.mock.calls[0][0].intent.tile).toBe(19);
  });
  it("discards earlier naval destinations and a delayed confirmation after preview cancellation", async () => {
    const { panel, ui, sent } = setup();
    ui.refreshNativeCosts();
    await vi.waitFor(() => expect(ui.productionCost("navybase")).toBe(250000));
    const resolvers: ((result: BuildableUnit[]) => void)[] = [];
    vi.mocked(panel.game.myPlayer()!.buildables).mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    ui.produce("navybase");
    ui.onTarget(new ModernTargetEvent(12, 0, false));
    ui.onTarget(new ModernTargetEvent(15, 0, false));
    resolvers[1]([nativePort(18)]);
    await vi.waitFor(() => expect(ui.pendingProductionTile).toBe(18));
    resolvers[0]([nativePort(13)]);
    await Promise.resolve();
    expect(ui.pendingProductionTile).toBe(18);
    expect(ui.preview?.path).toEqual([18]);
    ui.confirm();
    ui.onClear();
    resolvers[2]([nativePort(18)]);
    await Promise.resolve();
    expect(sent).not.toHaveBeenCalled();
    expect(ui.preview).toBeNull();
    expect(ui.pendingProductionTile).toBeNull();
  });
  it("previews a touch target and records its actual valid path before explicit confirmation", async () => {
    const { panel, ui, sent } = setup();
    panel.uiState.modernTargeting = true;
    ui.onTarget(new ModernTargetEvent(12, 0, true));
    await vi.waitFor(() => expect(ui.preview?.valid).toBe(true));
    expect(panel.uiState.modernCursorPreviewCount).toBe(1);
    expect(sent).not.toHaveBeenCalled();
    expect(ui.target).toBe(12);
    ui.confirm();
    expect(sent).toHaveBeenCalledOnce();
    expect(sent.mock.calls[0][0].intent).toMatchObject({
      type: "modern_command",
      target: 12,
      queue: true,
    });
    expect(panel.uiState.modernTargeting).toBe(false);
  });
  it("adds owned roster formations with the touch toggle and clears pointer modes on cancel", () => {
    const { panel, ui, state } = setup();
    state.forces.push({ ...state.forces[0], id: "second" });
    panel.uiState.modernAdditiveSelection = true;
    panel.uiState.modernQueueCommand = true;
    ui.selectFromRoster("second");
    expect(ui.selectedIds).toEqual(["own-army", "second"]);
    expect(panel.uiState.modernAdditionalSelections).toBe(1);
    ui.selectFromRoster("second");
    ui.selectFromRoster("foreign-or-stale");
    expect(panel.uiState.modernAdditionalSelections).toBe(1);
    expect(ui.selectedIds).toHaveLength(2);
    ui.onClear();
    expect(ui.selectedIds).toEqual([]);
    expect(panel.uiState.modernAdditiveSelection).toBe(false);
    expect(panel.uiState.modernQueueCommand).toBe(false);
  });
  it("returns the map to the compact HUD before choosing a base location", () => {
    const { ui, sent } = setup();
    ui.expanded = true;
    ui.produce("airbase");
    expect(ui.expanded).toBe(false);
    ui.onTarget(new ModernTargetEvent(12, 0, false));
    expect(ui.preview?.valid).toBe(true);
    expect(sent).not.toHaveBeenCalled();
    ui.confirm();
    expect(sent.mock.calls[0][0].intent).toMatchObject({
      type: "modern_produce",
      kind: "airbase",
      tile: 12,
    });
  });
  it("keeps previews while paused and sends nothing until the game resumes", async () => {
    const { panel, ui, sent } = setup();
    const paused = vi.spyOn(panel.game, "isPaused").mockReturnValue(true);
    await ui.prepare(11 as TileRef, false);
    expect(ui.preview?.valid).toBe(true);
    ui.confirm();
    ui.produce("warship");
    ui.control("stop");
    ui.sendModern(
      new SendModernIntentEvent({ type: "modern_train", climate: "arid" }),
    );
    ui.sendModern(
      new SendModernIntentEvent({ type: "modern_develop", portId: "port" }),
    );
    ui.sendModern(
      new SendModernIntentEvent({ type: "modern_repair", portId: "port" }),
    );
    expect(sent).not.toHaveBeenCalled();
    expect(ui.preview?.valid).toBe(true);
    expect(ui.status).toBeTruthy();
    paused.mockReturnValue(false);
    ui.confirm();
    expect(sent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        intent: expect.objectContaining({ type: "modern_command", target: 11 }),
      }),
    );
  });
  it("previews a real worker result, then sends exactly one owned queued intent", async () => {
    const { panel, ui, sent } = setup();
    await ui.prepare(11 as TileRef, true);
    expect(panel.queryPreview).toHaveBeenCalledWith(
      "own-army",
      11,
      "move",
      true,
    );
    expect(sent).not.toHaveBeenCalled();
    ui.confirm();
    expect(sent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        intent: {
          type: "modern_command",
          forceIds: ["own-army"],
          command: "move",
          target: 11,
          queue: true,
        },
      }),
    );
  });
  it("rejects an invalid worker preview and an obsolete asynchronous preview", async () => {
    const { panel, ui, sent } = setup();
    panel.queryPreview = vi.fn().mockResolvedValue({
      valid: false,
      reason: "no_land_path",
      path: [],
      etaTicks: 0,
      rangeTiles: 0,
      risk: "uncertain",
      climateEfficiencyPermille: 1000,
    });
    await ui.prepare(12 as TileRef, false);
    ui.confirm();
    expect(sent).not.toHaveBeenCalled();
    let resolve!: (preview: ModernCommandPreview) => void;
    panel.queryPreview = () =>
      new Promise((done) => {
        resolve = done;
      });
    const pending = ui.prepare(13 as TileRef, false);
    ui.clearPreview();
    resolve({
      valid: true,
      reason: null,
      path: [10, 13],
      etaTicks: 4,
      rangeTiles: 1,
      risk: "uncertain",
      climateEfficiencyPermille: 1000,
    });
    await pending;
    ui.confirm();
    expect(sent).not.toHaveBeenCalled();
    expect(ui.target).toBeNull();
  });
  it("places a new base on a chosen owned tile and prevents overlapping bases", () => {
    const { ui, sent } = setup();
    ui.produce("airbase");
    ui.onTarget(new ModernTargetEvent(10, 0, false));
    ui.confirm();
    expect(sent).not.toHaveBeenCalled();
    ui.onTarget(new ModernTargetEvent(11, 0, false));
    ui.confirm();
    expect(sent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        intent: {
          type: "modern_produce",
          branch: "air",
          kind: "airbase",
          tile: 11,
          count: 1,
        },
      }),
    );
  });
  it("produces a warship at an actual port instead of the inland name label", () => {
    const { ui, sent } = setup();
    ui.branch = "navy";
    ui.produce("warship");
    expect(sent).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          type: "modern_produce",
          branch: "navy",
          tile: 20,
        }),
      }),
    );
  });
  it("right click submits the current destination without a separate confirm button", async () => {
    const { ui, sent } = setup();
    ui.onTarget(new ModernTargetEvent(27, 3, false));
    await vi.waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(sent.mock.calls[0][0].intent.target).toBe(327);
    expect(ui.preview).toBeNull();
  });
  it("does not let cursor motion change an in-flight explicit destination", async () => {
    const { panel, ui, sent } = setup();
    let finish!: (preview: ModernCommandPreview) => void;
    panel.queryPreview = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    ui.onTarget(new ModernTargetEvent(12, 0, false));
    ui.onPreview(new ModernPreviewEvent(15, 0, false));
    finish({
      valid: true,
      reason: null,
      path: [10, 12] as TileRef[],
      etaTicks: 4,
      rangeTiles: 2,
      risk: "low",
      climateEfficiencyPermille: 1000,
    });
    await vi.waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(sent.mock.calls[0][0].intent.target).toBe(12);
  });
  it("keeps each valid selected force preview and chooses mixed air missions by aircraft kind", async () => {
    const { panel, ui, state, sent } = setup();
    ui.branch = "air";
    state.forces = [
      { ...state.forces[0], id: "fighter", branch: "air", kind: "fighter" },
      { ...state.forces[0], id: "strike", branch: "air", kind: "strike" },
    ];
    ui.selectedIds = ["fighter", "strike"];
    vi.spyOn(panel.game, "ownerID").mockReturnValue(2);
    await ui.prepare(11 as TileRef, false);
    expect(panel.queryPreview).toHaveBeenCalledWith(
      "fighter",
      11,
      "air_superiority",
      false,
    );
    expect(panel.queryPreview).toHaveBeenCalledWith(
      "strike",
      11,
      "strike",
      false,
    );
    expect([...ui.previews.keys()]).toEqual(["fighter", "strike"]);
    ui.confirm();
    expect(
      sent.mock.calls.map(([event]) => [
        event.intent.command,
        event.intent.forceIds,
      ]),
    ).toEqual([
      ["air_superiority", ["fighter"]],
      ["strike", ["strike"]],
    ]);
  });
  it("commits valid formations without pretending an unavailable formation can follow them", async () => {
    const { panel, ui, state, sent } = setup();
    state.forces.push({
      ...state.forces[0],
      id: "blocked",
      tile: 15 as TileRef,
    });
    ui.selectedIds.push("blocked");
    panel.queryPreview = vi.fn().mockImplementation((id: string) =>
      Promise.resolve({
        valid: id !== "blocked",
        reason: id === "blocked" ? "no_owned_land_path" : null,
        path: [10, 11],
        etaTicks: 4,
        rangeTiles: 1,
        risk: "low",
        climateEfficiencyPermille: 1000,
      }),
    );
    await ui.prepare(11 as TileRef, false);
    ui.confirm();
    expect(sent.mock.calls[0][0].intent.forceIds).toEqual(["own-army"]);
    expect(sent).toHaveBeenCalledOnce();
  });
  it("selects owned formations in screen space and preserves Shift additions", () => {
    const { ui, state } = setup();
    state.forces.push(
      { ...state.forces[0], id: "second", tile: 20 as TileRef },
      {
        ...state.forces[0],
        id: "enemy",
        playerId: "enemy",
        tile: 20 as TileRef,
      },
    );
    ui.onSelect(new ModernSelectionEvent(20, 0, 20, 0, true, true));
    expect(ui.selectedIds).toEqual(["own-army", "second"]);
  });
  it("keeps reserve formation available at low available manpower and reports the requested training pool", () => {
    const { ui, state } = setup();
    state.version = 3;
    state.bases[0].branch = "army";
    state.bases[0].capacity = 8000;
    state.factions = [
      {
        playerId: "human",
        population: {
          total: 1000000,
          civilian: 983000,
          available: 0,
          army: 17000,
          navy: 0,
          air: 0,
          dead: 0,
        },
      } as never,
    ];
    expect(ui.productionReason("army")).toBeNull();
    ui.productionManpowerSource = "available";
    expect(ui.productionReason("army")).toBe("insufficient_manpower");
    ui.productionManpowerSource = "army_reserve";
    expect(ui.productionReason("army")).toBeNull();
  });
  it("sends an explicit production manpower source without granting instant personnel", () => {
    const { ui, state, sent } = setup();
    state.version = 3;
    state.bases[0].branch = "army";
    ui.productionManpowerSource = "available";
    ui.produce("army" as never);
    expect(sent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          type: "modern_produce",
          kind: "army",
          source: "available",
          baseId: "base",
        }),
      }),
    );
    expect(state.forces).toHaveLength(1);
    expect(state.forces[0].personnel).toBe(1000);
  });
  it.each(["navy", "air"] as const)(
    "reuses finite army reserves for %s at the common mobilization cap",
    (branch) => {
      const { panel, ui, state, sent } = setup();
      ui.branch = branch;
      state.version = 3;
      state.bases[0].branch = branch;
      state.bases[0].capacity = 24;
      state.factions = [
        {
          playerId: "human",
          population: {
            total: 1000000,
            civilian: 886648,
            available: 13352,
            army: 99200,
            navy: 0,
            air: 800,
            dead: 0,
          },
        } as never,
      ];
      const kind = branch === "navy" ? "warship" : "fighter";
      if (branch === "navy")
        (
          ui as unknown as { nativeCosts: Map<UnitType, number> }
        ).nativeCosts.set(UnitType.Warship, 12000);
      expect(ui.effectiveProductionSource(100)).toBe("army_reserve");
      expect(ui.productionReason(kind)).toBeNull();
      ui.productionManpowerSource = "available";
      expect(ui.productionReason(kind)).toBe("mobilization_limit");
      ui.productionManpowerSource = "army_reserve";
      expect(ui.productionReason(kind)).toBeNull();
      ui.produce(kind as "warship");
      expect(sent.mock.calls[0][0].intent.source).toBe("army_reserve");
      expect(state.factions[0].population.army).toBe(99200);
      expect(state.factions[0].population.available).toBe(13352);
      vi.spyOn(panel.game.myPlayer()!, "troops").mockReturnValue(0);
      expect(ui.productionReason(kind)).toBe("insufficient_army_reserve");
    },
  );
  it("keeps and commands all visible selected forces with stable network-sized batches", async () => {
    const { panel, ui, state, sent } = setup();
    state.forces = Array.from({ length: 37 }, (_, index) => ({
      ...state.forces[0],
      id: `force-${String(index).padStart(2, "0")}`,
      tile: 10 as TileRef,
    }));
    ui.onVisible();
    expect(ui.selectedIds).toHaveLength(37);
    await ui.prepare(11 as TileRef, false);
    expect(ui.previews.size).toBe(37);
    ui.confirm();
    expect(
      sent.mock.calls.map(([event]) => event.intent.forceIds.length),
    ).toEqual([32, 5]);
    expect(sent.mock.calls.flatMap(([event]) => event.intent.forceIds)).toEqual(
      state.forces.map((force) => force.id),
    );
    sent.mockClear();
    ui.control("stop");
    expect(
      sent.mock.calls.map(([event]) => event.intent.forceIds.length),
    ).toEqual([32, 5]);
    expect(panel.uiState.modernSelectedForceIds).toHaveLength(37);
  });
  it("caches a repeated cursor destination but refreshes after a simulation update", async () => {
    const { panel, ui } = setup();
    await ui.prepare(11 as TileRef, false);
    await ui.prepare(11 as TileRef, false);
    expect(panel.queryPreview).toHaveBeenCalledTimes(1);
    vi.spyOn(panel.game, "ticks").mockReturnValue(1);
    await ui.prepare(11 as TileRef, false);
    expect(panel.queryPreview).toHaveBeenCalledTimes(2);
  });
  it("clears selection and rejects late worker previews when the game ends", async () => {
    const { panel, ui, sent } = setup();
    let resolve!: (value: ModernCommandPreview) => void;
    panel.queryPreview = () =>
      new Promise((done) => {
        resolve = done;
      });
    const pending = ui.prepare(11 as TileRef, false);
    panel.stop();
    resolve({
      valid: true,
      reason: null,
      path: [10, 11],
      etaTicks: 1,
      rangeTiles: 0,
      risk: "uncertain",
      climateEfficiencyPermille: 1000,
    });
    await pending;
    expect(ui.selectedIds).toEqual([]);
    expect(ui.target).toBeNull();
    expect(ui.previews.size).toBe(0);
    expect(panel.uiState.modernSelectedForceIds).toEqual([]);
    expect(sent).not.toHaveBeenCalled();
  });
  it("fetches native naval prices from the real Worker-facing API without core-only player methods", async () => {
    const { panel, ui } = setup();
    expect(ui.productionReason("navybase")).toBe("cost_unavailable");
    ui.refreshNativeCosts();
    ui.refreshNativeCosts();
    await vi.waitFor(() => expect(ui.productionCost("navybase")).toBe(250000));
    expect(panel.game.myPlayer()!.buildables).toHaveBeenCalledExactlyOnceWith(
      undefined,
      [UnitType.Port, UnitType.Warship],
    );
    expect(ui.productionCost("warship")).toBe(12000);
  });
  it("rejects delayed native prices after game teardown", async () => {
    const { panel, ui } = setup();
    let resolve!: (result: never) => void;
    vi.mocked(panel.game.myPlayer()!.buildables).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    ui.refreshNativeCosts();
    panel.stop();
    resolve([{ type: UnitType.Port, cost: 1n }] as never);
    await Promise.resolve();
    expect(ui.productionReason("navybase")).toBe("cost_unavailable");
  });
});
