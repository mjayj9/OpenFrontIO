import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { HostLobbyModal } from "../../src/client/HostLobbyModal";
import { SinglePlayerModal } from "../../src/client/SinglePlayerModal";
import type { GameConfigSettings } from "../../src/client/components/GameConfigSettings";
import { GameConfig } from "../../src/core/Schemas";

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    requestMidgameAd: vi.fn(async () => {}),
  },
}));
vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));
vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: vi.fn(() => false),
    openInviteDialog: vi.fn(async () => true),
    set: vi.fn(),
    consumePendingInvite: vi.fn(async () => null),
    subscribeInvites: vi.fn(() => () => undefined),
  },
}));

const fair: NonNullable<GameConfig["enhancedAI"]> = {
  tribePercent: 25,
  nationPercent: 25,
  personality: "mixed",
  fairResources: true,
  seed: 1,
};

describe("fair settings visible and effective rules", () => {
  it("clears singleplayer infinite toggles on selection and before emitting a game config", async () => {
    const modal = new SinglePlayerModal() as any;
    modal.infiniteGold = modal.infiniteTroops = true;
    modal.handleEnhancedAIChange(
      new CustomEvent("enhanced-ai-change", { detail: fair }),
    );
    expect(modal.infiniteGold).toBe(false);
    expect(modal.infiniteTroops).toBe(false);
    for (const labelKey of [
      "game_settings.infinite_gold",
      "game_settings.infinite_troops",
    ])
      modal.handleConfigOptionToggleChanged(
        new CustomEvent("option-toggle-changed", {
          detail: { labelKey, checked: true },
        }),
      );
    expect(modal.infiniteGold).toBe(false);
    expect(modal.infiniteTroops).toBe(false);

    // A stale loaded preference must not get sent merely because it bypassed
    // the current screen's toggle handlers.
    modal.infiniteGold = modal.infiniteTroops = true;
    modal.goldMultiplier = true;
    modal.goldMultiplierValue = 3;
    modal.startingGold = true;
    modal.startingGoldValue = 0.25;
    const configs: GameConfig[] = [];
    modal.addEventListener("join-lobby", (event: Event) =>
      configs.push((event as CustomEvent).detail.gameStartInfo.config),
    );
    await modal.startGame();
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      enhancedAI: fair,
      infiniteGold: false,
      infiniteTroops: false,
      startingGold: 250000,
      goldMultiplier: 3,
    });
  });

  it("hides incompatible singleplayer controls while retaining normal controls", () => {
    const modal = new SinglePlayerModal() as any;
    modal.enhancedAI = fair;
    const container = document.createElement("div");
    render(modal.render(), container);
    const settings = container.querySelector(
      "game-config-settings",
    ) as GameConfigSettings;
    expect(settings.settings).toBeDefined();
    const toggles = settings.settings!.options.toggles;
    expect(
      toggles.find((t) => t.labelKey === "game_settings.infinite_gold")?.hidden,
    ).toBe(true);
    expect(
      toggles.find((t) => t.labelKey === "game_settings.infinite_troops")
        ?.hidden,
    ).toBe(true);
    expect(
      toggles.find((t) => t.labelKey === "game_settings.random_spawn")?.hidden,
    ).not.toBe(true);
  });

  it("clears every private host override before publishing the effective finite config", async () => {
    const modal = new HostLobbyModal() as any;
    modal.constructUrl = vi.fn(async () => "https://example.com/game/test1234");
    modal.updateLobbyHistory = vi.fn();
    Object.assign(modal, {
      enhancedAI: fair,
      infiniteGold: true,
      infiniteTroops: true,
      hostCheatsEnabled: true,
      hostCheatInfiniteGold: true,
      hostCheatInfiniteTroops: true,
      hostCheatGoldMultiplier: true,
      hostCheatGoldMultiplierValue: 99,
      hostCheatStartingGold: true,
      hostCheatStartingGoldValue: 99,
      startingGold: true,
      startingGoldValue: 0.25,
      goldMultiplier: true,
      goldMultiplierValue: 3,
    });
    const configs: Partial<GameConfig>[] = [];
    modal.addEventListener("update-game-config", (event: Event) =>
      configs.push((event as CustomEvent).detail.config),
    );
    await modal.putGameConfig();
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      enhancedAI: fair,
      infiniteGold: false,
      infiniteTroops: false,
      startingGold: 250000,
      goldMultiplier: 3,
    });
    expect(configs[0].hostCheats).toBeUndefined();
    expect(modal.hostCheatGoldMultiplierValue).toBeUndefined();
    expect(modal.hostCheatStartingGoldValue).toBeUndefined();
    expect(modal.hostCheatsEnabled).toBe(false);

    const container = document.createElement("div");
    render(modal.render(), container);
    const settings = container.querySelector(
      "game-config-settings",
    ) as GameConfigSettings;
    expect(settings.settings).toBeDefined();
    expect(settings.settings!.hostCheats?.visible).toBe(false);
    expect(
      settings.settings!.options.toggles.find(
        (t) => t.labelKey === "host_modal.host_cheats",
      )?.hidden,
    ).toBe(true);
  });

  it("keeps explicit Classic infinite and host cheat controls available when fairness is disabled", async () => {
    const modal = new HostLobbyModal() as any;
    modal.constructUrl = vi.fn(async () => "https://example.com/game/test1234");
    modal.updateLobbyHistory = vi.fn();
    Object.assign(modal, {
      enhancedAI: { ...fair, fairResources: false },
      infiniteGold: true,
      infiniteTroops: true,
      hostCheatsEnabled: true,
      hostCheatGoldMultiplier: true,
      hostCheatGoldMultiplierValue: 7,
    });
    const configs: Partial<GameConfig>[] = [];
    modal.addEventListener("update-game-config", (event: Event) =>
      configs.push((event as CustomEvent).detail.config),
    );
    await modal.putGameConfig();
    expect(configs[0]).toMatchObject({
      infiniteGold: true,
      infiniteTroops: true,
      hostCheats: { goldMultiplier: 7 },
    });
  });
});
