import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildMenu } from "../../../../src/client/hud/layers/BuildMenu";
import { SendModernIntentEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { UnitType } from "../../../../src/core/game/Game";
import type { TileRef } from "../../../../src/core/game/GameMap";

afterEach(() => {
  document.body.replaceChildren();
});
async function menu(scenario: string | null = "modern-regions-v2") {
  const build = new BuildMenu();
  const player = {
    id: () => "human",
    smallID: () => 1,
    gold: () => 400000n,
    buildables: vi.fn().mockResolvedValue([
      {
        type: UnitType.Port,
        cost: 125000n,
        canBuild: true,
        canUpgrade: false,
      },
    ]),
    totalUnitLevels: () => 1,
  };
  const game = {
    myPlayer: () => player,
    config: () => ({
      gameConfig: () => ({ modernMode: scenario ? { scenario } : undefined }),
      isUnitDisabled: () => false,
    }),
    isLand: () => true,
    isImpassable: () => false,
    ownerID: () => 1,
    isPaused: () => false,
    modernSystems: () => (scenario ? { bases: [] } : null),
  };
  build.game = game as unknown as GameView;
  build.eventBus = new EventBus();
  const sent = vi.fn();
  build.eventBus.on(SendModernIntentEvent, sent);
  document.body.append(build);
  build.init();
  build.showMenu(321 as TileRef);
  await vi.waitFor(() =>
    expect(
      build.shadowRoot?.querySelectorAll(".build-button").length,
    ).toBeGreaterThan(0),
  );
  await build.updateComplete;
  return { build, game, player, sent };
}
describe("modern bases extend the original construction menu", () => {
  it("adds army/air base buttons alongside the original port icon and sends the chosen tile", async () => {
    const { build, sent } = await menu();
    const army = build.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-modern-highlight="armybase"]',
    )!;
    const air = build.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-modern-highlight="airbase"]',
    )!;
    expect(army.disabled).toBe(false);
    expect(air.disabled).toBe(false);
    expect(
      [...build.shadowRoot!.querySelectorAll("img")].some((image) =>
        image.src.endsWith("/images/PortIcon.svg"),
      ),
    ).toBe(true);
    army.click();
    expect(sent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        intent: {
          type: "modern_produce",
          branch: "army",
          kind: "armybase",
          tile: 321,
          count: 1,
        },
      }),
    );
    expect(build.isVisible).toBe(false);
    build.dispose();
  });
  it("does not dispatch construction on enemy land or while paused", async () => {
    const { build, game, sent } = await menu();
    game.ownerID = () => 2;
    build.requestUpdate();
    await build.updateComplete;
    const button = build.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-modern-highlight="airbase"]',
    )!;
    expect(button.disabled).toBe(true);
    button.click();
    expect(sent).not.toHaveBeenCalled();
    game.ownerID = () => 1;
    game.isPaused = () => true;
    build.requestUpdate();
    await build.updateComplete;
    expect(
      build.shadowRoot!.querySelector<HTMLButtonElement>(
        '[data-modern-highlight="airbase"]',
      )!.disabled,
    ).toBe(true);
    build.dispose();
  });
  it("keeps the Classic construction menu free of military base additions", async () => {
    const { build } = await menu(null);
    expect(
      build.shadowRoot!.querySelector('[data-modern-highlight="armybase"]'),
    ).toBeNull();
    expect(
      build.shadowRoot!.querySelector('[data-modern-highlight="airbase"]'),
    ).toBeNull();
    expect(build.shadowRoot!.querySelectorAll(".build-button")).toHaveLength(1);
    build.dispose();
  });
});
