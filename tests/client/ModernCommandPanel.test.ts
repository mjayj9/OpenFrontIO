import { describe, expect, it, vi } from "vitest";
import { ModernCommandPanel } from "../../src/client/ModernCommandPanel";
import { ModernTargetEvent } from "../../src/client/ModernInput";
import type { TransformHandler } from "../../src/client/TransformHandler";
import { SendModernIntentEvent } from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
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
    isLand: () => true,
    isImpassable: () => false,
    ticks: () => 0,
    isPaused: () => false,
  } as unknown as GameView;
  panel.transform = {
    screenToWorldCoordinates: (x: number, y: number) => ({ x, y }),
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
    prepare: (target: TileRef, queue: boolean) => Promise<void>;
    confirm: () => void;
    produce: (kind: "airbase" | "warship") => void;
    onTarget: (event: ModernTargetEvent) => void;
    clearPreview: () => void;
    control: (command: "stop" | "cancel" | "wait") => void;
    sendModern: (event: SendModernIntentEvent) => void;
    status: string;
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
});
