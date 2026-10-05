// @vitest-environment jsdom
import { colord } from "colord";
import { createThemeSettings } from "../../../src/client/render/gl/RenderSettings";
import { PALETTE_SIZE } from "../../../src/client/render/gl/utils/PlayerPalette";
import { PlayerStatic, PlayerTypeEnum } from "../../../src/client/render/types";
import { buildReplayPalette } from "../../../src/client/replay/ReplayPalette";
import {
  SettingsTheme,
  themeProvider,
} from "../../../src/client/theme/ThemeProvider";
import { playerTypeFromEnum } from "../../../src/client/view/EntityState";
import { PlayerView } from "../../../src/client/view/PlayerView";
import { aiProfile } from "../../../src/core/ai/AIProfile";
import {
  ColoredTeams,
  Difficulty,
  PlayerType,
} from "../../../src/core/game/Game";
import {
  GameUpdateType,
  PlayerUpdate,
} from "../../../src/core/game/GameUpdates";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";

const player = (
  id: string,
  smallID: number,
  playerType: PlayerTypeEnum,
  team: string | null = null,
): PlayerStatic => ({
  id,
  smallID,
  playerType,
  team,
  clientID: null,
  name: id,
  displayName: id,
  clanTag: null,
  isLobbyCreator: false,
});
test.each(["default", "colorblind"] as const)(
  "enhanced replay fills match stable live allocation on %s",
  async (paletteName) => {
    const game = await setup("plains", {
      enhancedAI: {
        tribePercent: 100,
        nationPercent: 100,
        personality: "mixed",
        fairResources: true,
        seed: 3,
      },
      difficulty: Difficulty.Hard,
    });
    const config: GameConfig = game.config().gameConfig();
    const players = [
      player("zBot", 1, PlayerTypeEnum.Bot, ColoredTeams.Bot),
      player("zNation", 2, PlayerTypeEnum.Nation),
      player("aHuman", 3, PlayerTypeEnum.Human),
      player("aNation", 4, PlayerTypeEnum.Nation),
    ];
    const fresh = () => new SettingsTheme(createThemeSettings(paletteName));
    const first = buildReplayPalette(players, new Map(), fresh(), config);
    const reordered = buildReplayPalette(
      [...players].reverse(),
      new Map(),
      fresh(),
      config,
    );
    const colors = (list: PlayerStatic[]) =>
      Object.fromEntries(list.map((p) => [p.id, p.color]));
    expect(colors(first.players)).toEqual(colors(reordered.players));
    const userSettings = new UserSettings();
    const previousSettings = userSettings.graphicsOverrides();
    userSettings.setGraphicsOverrides({
      ...previousSettings,
      palette: paletteName,
    });
    try {
      themeProvider.reset();
      themeProvider.preparePlayers(
        players.map(
          (p): PlayerUpdate => ({
            type: GameUpdateType.Player,
            id: p.id,
            playerType: playerTypeFromEnum(p.playerType),
            team: p.team ?? undefined,
          }),
        ),
        config,
      );
      const live = Object.fromEntries(
        players.map((p) => [
          p.id,
          themeProvider
            .current()
            .territoryColor({
              id: () => p.id,
              team: () => p.team,
              type: () => playerTypeFromEnum(p.playerType),
              enhancedAI: () =>
                aiProfile(config, p.id, playerTypeFromEnum(p.playerType)),
            } as unknown as PlayerView)
            .toHex(),
        ]),
      );
      expect(colors(first.players)).toEqual(live);
    } finally {
      userSettings.setGraphicsOverrides(previousSettings);
      themeProvider.reset();
    }
    expect(new Set(first.players.map((p) => p.color)).size).toBe(
      players.length,
    );
    const bot = first.players.find((p) => p.id === "zBot")!;
    expect(bot.color).not.toBe(fresh().teamColor(ColoredTeams.Bot).toHex());
    const offset = PALETTE_SIZE * 4 + bot.smallID * 4;
    const border = colord({
      r: Math.round(first.palette[offset] * 255),
      g: Math.round(first.palette[offset + 1] * 255),
      b: Math.round(first.palette[offset + 2] * 255),
    }).toHex();
    expect(border).toBe(
      fresh().borderColor(fresh().teamColor(ColoredTeams.Bot)).toHex(),
    );
    // Same profile identity that PlayerView exposes; human cosmetics cannot turn
    // a human into an AI, and dictionary order does not change controller data.
    expect(aiProfile(config, "aHuman", PlayerType.Human)).toBeNull();
    themeProvider.reset();
  },
);
