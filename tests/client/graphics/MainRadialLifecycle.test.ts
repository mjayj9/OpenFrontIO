import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildMenu } from "../../../src/client/hud/layers/BuildMenu";
import { EmojiTable } from "../../../src/client/hud/layers/EmojiTable";
import { MainRadialMenu } from "../../../src/client/hud/layers/MainRadialMenu";
import { PlayerPanel } from "../../../src/client/hud/layers/PlayerPanel";
import { ContextMenuEvent } from "../../../src/client/InputHandler";
import { TransformHandler } from "../../../src/client/TransformHandler";
import { UIState } from "../../../src/client/UIState";
import { GameView } from "../../../src/client/view";
import { EventBus } from "../../../src/core/EventBus";
import { PlayerActions } from "../../../src/core/game/Game";

function menu(bus: EventBus, game: Partial<GameView>, build = {}) {
  return new MainRadialMenu(
    bus,
    game as GameView,
    {
      screenToWorldCoordinates: () => ({ x: 1, y: 2 }),
    } as unknown as TransformHandler,
    {} as EmojiTable,
    build as BuildMenu,
    {} as UIState,
    {} as PlayerPanel,
  );
}

describe("per-match radial menu lifetime", () => {
  beforeEach(() => {
    document.body.appendChild(document.createElement("chat-modal"));
  });
  afterEach(() => {
    document.querySelector("chat-modal")?.remove();
  });
  it("removes old overlays and uses only the new map after restart", () => {
    const bus = new EventBus();
    const before = document.querySelectorAll(".radial-menu-container").length;
    const oldLookup = vi.fn(() => false);
    const old = menu(bus, { isValidCoord: oldLookup });
    old.init();
    old.init();
    expect(document.querySelectorAll(".radial-menu-container").length).toBe(
      before + 1,
    );
    bus.emit(new ContextMenuEvent(10, 20));
    expect(oldLookup).toHaveBeenCalledTimes(1);
    old.dispose();
    old.dispose();
    expect(document.querySelectorAll(".radial-menu-container").length).toBe(
      before,
    );
    oldLookup.mockClear();
    const currentLookup = vi.fn(() => false);
    const current = menu(bus, { isValidCoord: currentLookup });
    current.init();
    bus.emit(new ContextMenuEvent(30, 40));
    expect(currentLookup).toHaveBeenCalledTimes(1);
    expect(oldLookup).not.toHaveBeenCalled();
    current.dispose();
  });

  it("does not overwrite the next match's build menu with a late action response", async () => {
    const bus = new EventBus();
    let resolveActions!: (value: PlayerActions) => void;
    const actions = new Promise<PlayerActions>((resolve) => {
      resolveActions = resolve;
    });
    const build = { playerBuildables: ["current-match"] };
    const old = menu(
      bus,
      {
        isValidCoord: () => true,
        ref: () => 4,
        isSpectator: () => false,
        myPlayer: () => ({ actions: () => actions }) as never,
      },
      build,
    );
    old.init();
    bus.emit(new ContextMenuEvent(10, 20));
    old.dispose();
    resolveActions({
      canAttack: false,
      buildableUnits: [],
      canSendEmojiAllPlayers: false,
    });
    await actions;
    await Promise.resolve();
    expect(build.playerBuildables).toEqual(["current-match"]);
  });
});
