/**
 * The renderer's per-player palette and player info for a replay. This is
 * what PlayerView and WebGLFrameBuilder.writePlayerCosmetics compute for
 * live players (the colours with the same resolvePlayerColors), built from
 * the replay's player dictionary instead.
 *
 * Appearance isn't stored in the file, it's resolved here with the
 * viewer's own theme, so the colour-blind palette and classic bot colours
 * work. Human players' cosmetics (colour, pattern, skin, flag, crown) come
 * from the game start info in the file. A nation's flag is in the player
 * dictionary. When game configuration is available, the shared live/replay
 * allocator uses stable controller/id order and modern initial tile neighbors.
 * The viewer rebuilds this when the graphics settings change.
 */

import { aiProfile } from "../../core/ai/AIProfile";
import { assetUrl } from "../../core/AssetUrls";
import type { GameConfig, PlayerCosmetics } from "../../core/Schemas";
import { createThemeSettings } from "../render/gl/RenderSettings";
import {
  PALETTE_SIZE,
  writePaletteEntry,
  writePatternEntry,
} from "../render/gl/utils/PlayerPalette";
import type { PlayerStatic } from "../render/types";
import {
  prepareThemePlayers,
  SettingsTheme,
  type Theme,
} from "../theme/ThemeProvider";
import type { PlayerView } from "../view";
import {
  visibleCosmetics,
  type CosmeticVisibility,
} from "../view/CosmeticVisibility";
import { playerTypeFromEnum } from "../view/EntityState";
import { resolvePlayerColors } from "../view/PlayerColors";

export interface ReplayPalette {
  palette: Float32Array;
  patternMeta: Float32Array;
  patternData: Uint8Array;
  players: PlayerStatic[];
  /** smallID → skin image URL, for MapRenderer.setPlayerSkin. */
  skins: Map<number, string>;
}

/**
 * Which of each player's cosmetics are shown with the viewer's visibility
 * settings (see PlayerView.refreshCosmetics). The viewer isn't in the game,
 * so every player counts as "other".
 */
export function visibleReplayCosmetics(
  equipped: ReadonlyMap<string, PlayerCosmetics>,
  visibility: CosmeticVisibility,
): Map<string, PlayerCosmetics> {
  return new Map(
    [...equipped].map(([clientID, c]) => [
      clientID,
      visibleCosmetics(c, visibility, "other"),
    ]),
  );
}

export function buildReplayPalette(
  players: readonly PlayerStatic[],
  /** The cosmetics the server resolved, by clientID (game start info). */
  cosmetics: ReadonlyMap<string, PlayerCosmetics> = new Map(),
  /** A fresh theme. The colours it hands out depend on what it has seen. */
  theme: Theme = new SettingsTheme(createThemeSettings("default")),
  config?: GameConfig,
): ReplayPalette {
  const palette = new Float32Array(PALETTE_SIZE * 2 * 4);
  const patternMeta = new Float32Array(PALETTE_SIZE * 4);
  const patternData = new Uint8Array(PALETTE_SIZE * 1024);
  const skins = new Map<number, string>();
  const out: PlayerStatic[] = [];
  const themedView = (p: PlayerStatic) =>
    ({
      id: () => p.id,
      type: () => playerTypeFromEnum(p.playerType),
      team: () => p.team,
      enhancedAI: () =>
        config
          ? aiProfile(config, p.id, playerTypeFromEnum(p.playerType))
          : null,
    }) as unknown as PlayerView;
  if (config)
    prepareThemePlayers(
      theme,
      players.map((p) => ({
        id: p.id,
        playerType: playerTypeFromEnum(p.playerType),
        team: p.team ?? undefined,
      })),
      config,
    );
  for (const p of players) {
    const own =
      (p.clientID === null ? undefined : cosmetics.get(p.clientID)) ?? {};
    // The theme only reads id, type and team. Nobody in a replay is the
    // local player, so no border is focused.
    const themed = theme.territoryColor(themedView(p));
    const { territory: fill, border } = resolvePlayerColors(
      theme,
      themed,
      own,
      p.team,
      false,
    );
    writePaletteEntry(palette, p.smallID, fill, border);
    writePatternEntry(patternMeta, patternData, p.smallID, own.pattern);
    if (own.skin?.url !== undefined) {
      skins.set(p.smallID, assetUrl(own.skin.url));
    }
    const flag = own.flag ?? p.flag;
    out.push({
      ...p,
      flag: flag !== undefined ? assetUrl(flag) : undefined,
      crown: own.crown !== undefined ? assetUrl(own.crown.url) : undefined,
      verified: own.verified === true,
      color: fill.toHex(),
    });
  }
  return { palette, patternMeta, patternData, players: out, skins };
}
