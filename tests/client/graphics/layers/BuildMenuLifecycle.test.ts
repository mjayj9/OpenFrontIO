import { describe, expect, it, vi } from "vitest";
import "../../../../src/client/hud/layers/BuildMenu";
import type { BuildMenu } from "../../../../src/client/hud/layers/BuildMenu";
import {
  CloseViewEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "../../../../src/client/InputHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../../../src/client/Transport";
import { EventBus } from "../../../../src/core/EventBus";
import {
  BuildableUnit,
  PlayerBuildableUnitType,
  UnitType,
} from "../../../../src/core/game/Game";
import { TileRef } from "../../../../src/core/game/GameMap";

function buildable(
  type: PlayerBuildableUnitType = UnitType.City,
  cost = 125n,
): BuildableUnit {
  return {
    type,
    cost,
    canBuild: 201,
    canUpgrade: false,
    overlappingRailroads: [],
    ghostRailPaths: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeGame() {
  const player = {
    isAlive: () => true,
    buildables: vi.fn(async (_tile: TileRef): Promise<BuildableUnit[]> => []),
    totalUnitLevels: () => 0,
  };
  const game = {
    myPlayer: () => player,
    isValidCoord: (x: number, y: number) => x >= 0 && y >= 0,
    ref: (x: number, y: number) => x + y * 100,
    config: () => ({ isUnitDisabled: () => false }),
  };
  return { game, player };
}

function makeMenu(eventBus = new EventBus()) {
  const menu = document.createElement("build-menu") as BuildMenu;
  const { game, player } = makeGame();
  menu.game = game as never;
  menu.eventBus = eventBus;
  menu.uiState = { rocketDirectionUp: true } as never;
  const screenToWorldCoordinates = vi.fn((x: number, y: number) => ({ x, y }));
  menu.transformHandler = { screenToWorldCoordinates } as never;
  menu.init();
  return { menu, game, player, eventBus, screenToWorldCoordinates };
}

describe("BuildMenu match lifecycle", () => {
  it("hides and resets the reused menu and removes callbacks from the old bus", async () => {
    const { menu, eventBus: oldBus, player } = makeMenu();
    player.buildables.mockResolvedValue([buildable()]);
    oldBus.emit(new ShowBuildMenuEvent(1, 2));
    await Promise.resolve();
    expect(menu.isVisible).toBe(true);
    expect(menu.playerBuildables).toEqual([buildable()]);

    const next = makeGame();
    const newBus = new EventBus();
    menu.game = next.game as never;
    menu.eventBus = newBus;
    menu.init();
    expect(menu.isVisible).toBe(false);
    expect(menu.playerBuildables).toBeNull();
    oldBus.emit(new ShowBuildMenuEvent(8, 9));
    expect(next.player.buildables).not.toHaveBeenCalled();

    newBus.emit(new ShowBuildMenuEvent(3, 4));
    expect(next.player.buildables).toHaveBeenCalledOnce();
    oldBus.emit(new CloseViewEvent());
    expect(menu.isVisible).toBe(true);
    menu.dispose();
  });

  it("keeps one owned hide callback after repeated initialization and removes it on disposal", () => {
    const { menu, eventBus, player } = makeMenu();
    const hide = vi.spyOn(menu, "hideMenu");
    menu.init();
    menu.init();
    hide.mockClear();
    eventBus.emit(new CloseViewEvent());
    expect(hide).toHaveBeenCalledOnce();
    hide.mockClear();
    eventBus.emit(new ShowEmojiMenuEvent(0, 0));
    expect(hide).toHaveBeenCalledOnce();
    hide.mockClear();
    eventBus.emit(new MouseDownEvent(0, 0));
    expect(hide).toHaveBeenCalledOnce();

    menu.dispose();
    hide.mockClear();
    eventBus.emit(new CloseViewEvent());
    eventBus.emit(new MouseDownEvent(0, 0));
    eventBus.emit(new ShowEmojiMenuEvent(0, 0));
    eventBus.emit(new ShowBuildMenuEvent(0, 0));
    expect(hide).not.toHaveBeenCalled();
    expect(player.buildables).not.toHaveBeenCalled();
    expect(menu.isVisible).toBe(false);
  });

  it("ignores an old game's delayed result after a new game's menu has loaded", async () => {
    const { menu, player, eventBus } = makeMenu();
    const previous = deferred<BuildableUnit[]>();
    player.buildables.mockReturnValueOnce(previous.promise);
    eventBus.emit(new ShowBuildMenuEvent(1, 2));
    menu.dispose();

    const next = makeGame();
    next.player.buildables.mockResolvedValue([buildable(UnitType.Port, 33n)]);
    menu.game = next.game as never;
    menu.init();
    eventBus.emit(new ShowBuildMenuEvent(1, 2));
    await Promise.resolve();
    previous.resolve([buildable(UnitType.City, 999n)]);
    await Promise.resolve();

    expect(menu.isVisible).toBe(true);
    expect(menu.playerBuildables).toEqual([buildable(UnitType.Port, 33n)]);
    menu.dispose();
  });

  it("does not let a closed menu's response release a newer pending request", async () => {
    const { menu, player, eventBus } = makeMenu();
    const first = deferred<BuildableUnit[]>();
    const second = deferred<BuildableUnit[]>();
    player.buildables
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    eventBus.emit(new ShowBuildMenuEvent(1, 2));
    menu.tick();
    menu.tick();
    expect(player.buildables).toHaveBeenCalledOnce();
    eventBus.emit(new CloseViewEvent());
    eventBus.emit(new ShowBuildMenuEvent(1, 2));
    first.resolve([buildable(UnitType.City, 999n)]);
    await Promise.resolve();
    menu.tick();
    expect(player.buildables).toHaveBeenCalledTimes(2);
    expect(menu.playerBuildables).toBeNull();

    second.resolve([buildable(UnitType.Port, 33n)]);
    await Promise.resolve();
    expect(menu.playerBuildables).toEqual([buildable(UnitType.Port, 33n)]);
    menu.dispose();
  });

  it("keeps a disposed menu closed after a worker response and blocks stale commands", async () => {
    const { menu, player, eventBus } = makeMenu();
    const pending = deferred<BuildableUnit[]>();
    player.buildables.mockReturnValueOnce(pending.promise);
    const builds = vi.fn();
    const upgrades = vi.fn();
    eventBus.on(BuildUnitIntentEvent, builds);
    eventBus.on(SendUpgradeStructureIntentEvent, upgrades);
    eventBus.emit(new ShowBuildMenuEvent(1, 2));
    menu.dispose();
    pending.resolve([buildable()]);
    await Promise.resolve();

    menu.sendBuildOrUpgrade(buildable(), 201);
    menu.sendBuildOrUpgrade({ ...buildable(), canUpgrade: 42 }, 201);
    menu.showMenu(201);
    menu.tick();
    expect(menu.isVisible).toBe(false);
    expect(menu.playerBuildables).toBeNull();
    expect(builds).not.toHaveBeenCalled();
    expect(upgrades).not.toHaveBeenCalled();
    expect(player.buildables).toHaveBeenCalledOnce();
  });

  it("retries after a failed query and preserves normal build and upgrade commands", async () => {
    const { menu, player, eventBus } = makeMenu();
    const pending = deferred<BuildableUnit[]>();
    player.buildables.mockReturnValueOnce(pending.promise);
    const builds = vi.fn();
    const upgrades = vi.fn();
    eventBus.on(BuildUnitIntentEvent, builds);
    eventBus.on(SendUpgradeStructureIntentEvent, upgrades);
    eventBus.emit(new ShowBuildMenuEvent(1, 2));
    pending.reject(new Error("Worker not initialized"));
    await Promise.resolve();
    player.buildables.mockResolvedValue([buildable()]);
    menu.tick();
    await Promise.resolve();
    expect(player.buildables).toHaveBeenCalledTimes(2);
    menu.sendBuildOrUpgrade(buildable(), 201);
    expect(builds).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ unit: UnitType.City, tile: 201 }),
    );
    expect(menu.isVisible).toBe(false);

    eventBus.emit(new ShowBuildMenuEvent(3, 4));
    menu.sendBuildOrUpgrade({ ...buildable(), canUpgrade: 42 }, 403);
    expect(upgrades).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ unitType: UnitType.City, unitId: 42 }),
    );
    expect(menu.isVisible).toBe(false);
    menu.dispose();
  });
});
