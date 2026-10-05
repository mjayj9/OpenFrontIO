import { GameConfig, GameStartInfo } from "../Schemas";
import { validateModernAssignments } from "../modern/ModernAssignments";
import { isModernV2 } from "../modern/ModernRules";
import {
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
} from "./Game";
import {
  modernFaction,
  modernFactionPlayerId,
  modernFactions,
  modernRegions,
} from "./ModernRegions";
import data from "./ModernWorldData.json";

export const modernWorld = data;
export type ModernCountry = (typeof data.countries)[number];
export type ModernPlayable = ModernCountry | (typeof modernFactions)[number];
export function modernEntries(config: GameConfig): ModernPlayable[] {
  return isModernV2(config) ? modernFactions : modernWorld.countries;
}
export function modernEntryPlayerId(entry: ModernPlayable): string {
  return "factionId" in entry
    ? modernFactionPlayerId(entry)
    : modernPlayerId(entry);
}
export const modernPlayerId = (country: ModernCountry): string =>
  `world${String(country.index).padStart(3, "0")}`;
export function countryForPlayer(id: string): ModernCountry | undefined {
  return modernWorld.countries.find(
    (country) => modernPlayerId(country) === id,
  );
}
export function modernCountry(id: string): ModernCountry {
  const country = modernWorld.countries.find((c) => c.id === id);
  if (!country) throw new Error(`Unsupported country: ${id}`);
  return country;
}
/** Stable country order, rather than connection order, fixes controller ids. */
export function modernHumanCountryIds(start: GameStartInfo): Set<string> {
  return new Set(
    start.players
      .map((p) =>
        start.config.gameType === GameType.Singleplayer
          ? (p.countryId ?? start.config.modernMode!.countryId)
          : p.countryId,
      )
      .filter((id): id is string => id !== undefined),
  );
}
/** Validate before creating any player or assigning a tile. */
export function validateModernStart(start: GameStartInfo): void {
  const mode = start.config.modernMode;
  if (!mode) return;
  if (isModernV2(start.config)) {
    validateModernAssignments(start);
    if (mode.balance !== "balanced")
      throw new Error(
        "Modern regions require equal population and common starting budgets",
      );
    const weights = mode.aiLevelWeights ?? { low: 1, medium: 1, high: 1 };
    if (weights.low + weights.medium + weights.high === 0)
      throw new Error("Modern AI weights cannot all be zero");
    if (
      mode.participantSlots !== undefined &&
      start.players.length > mode.participantSlots
    )
      throw new Error("Human participants exceed reserved slots");
    if (mode.factionId !== undefined && mode.factionId !== mode.countryId)
      throw new Error("Modern selected faction fields differ");
  }
  if (
    mode.dataHash !==
      (isModernV2(start.config) ? modernRegions.hash : modernWorld.hash) ||
    mode.version !== (isModernV2(start.config) ? 2 : 1)
  ) {
    throw new Error("Modern scenario version/hash differs from this build");
  }
  const singleplayer = start.config.gameType === GameType.Singleplayer;
  const privateRoom = start.config.gameType === GameType.Private;
  if (
    (!singleplayer && !privateRoom) ||
    start.players.length < 1 ||
    (singleplayer && start.players.length !== 1)
  ) {
    throw new Error(
      "Modern world requires singleplayer or a private country selection room",
    );
  }
  const selected = new Set<string>();
  for (const player of start.players) {
    const countryId =
      player.countryId ?? (singleplayer ? mode.countryId : undefined);
    if (!countryId)
      throw new Error("Every modern room player must select a country");
    if (isModernV2(start.config)) modernFaction(countryId);
    else modernCountry(countryId);
    if (selected.has(countryId))
      throw new Error("Modern country selected by multiple players");
    selected.add(countryId);
  }
  if (
    start.config.gameMode !== GameMode.FFA ||
    start.config.gameMap !== GameMapType.ModernWorld ||
    start.config.gameMapSize !== GameMapSize.Normal ||
    start.config.bots !== 0 ||
    start.config.nations === "disabled"
  ) {
    throw new Error(
      "Modern world requires normal Modern World map, FFA, nations enabled and no tribes",
    );
  }
}
export function modernPlayerInfo(
  country: ModernPlayable,
  start: GameStartInfo,
): PlayerInfo {
  const human = start.players.find(
    (p) =>
      (p.countryId ??
        (start.config.gameType === GameType.Singleplayer
          ? start.config.modernMode?.countryId
          : undefined)) === country.id,
  );
  return new PlayerInfo(
    "gameName" in country ? country.gameName : country.name,
    human ? PlayerType.Human : PlayerType.Nation,
    human?.clientID ?? null,
    modernEntryPlayerId(country),
    human
      ? (human.isLobbyCreator ??
          start.config.gameType === GameType.Singleplayer)
      : false,
    human?.clanTag ?? null,
    human?.friends ?? [],
    null,
    country.flag || null,
  );
}
export function modernProgress(
  game: Game,
  player: Player,
): { ownedCapitals: number; totalCapitals: number; territoryPercent: number } {
  let ownedCapitals = 0;
  const entries = modernEntries(game.config().gameConfig());
  for (const c of entries) {
    const tile = game.ref(c.capital[0], c.capital[1]);
    if (game.owner(tile) === player) ownedCapitals++;
  }
  return {
    ownedCapitals,
    totalCapitals: entries.length,
    territoryPercent: game.modernSystems()
      ? Math.floor(
          ((game
            .modernSystems()!
            .factions.find((f) => f.playerId === player.id())?.ownedAreaUnits ??
            0) *
            100) /
            Math.max(
              1,
              game
                .modernSystems()!
                .factions.reduce((n, f) => n + f.ownedAreaUnits, 0),
            ),
        )
      : Math.floor(
          (player.numTilesOwned() * 100) /
            Math.max(1, game.numLandTiles() - game.numTilesWithFallout()),
        ),
  };
}
