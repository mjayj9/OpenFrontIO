// @vitest-environment jsdom
import { colord } from "colord";
import { createThemeSettings } from "../../../src/client/render/gl/RenderSettings";
import { PlayerStatic, PlayerTypeEnum } from "../../../src/client/render/types";
import { buildReplayPalette } from "../../../src/client/replay/ReplayPalette";
import {
  ColorAllocator,
  ColorRegistry,
} from "../../../src/client/theme/ColorAllocator";
import {
  prepareThemePlayers,
  SettingsTheme,
} from "../../../src/client/theme/ThemeProvider";
import type { PlayerView } from "../../../src/client/view/PlayerView";
import { aiProfile } from "../../../src/core/ai/AIProfile";
import { Difficulty, PlayerType } from "../../../src/core/game/Game";
import {
  modernPlayerId,
  modernWorld,
} from "../../../src/core/game/ModernWorld";
import type { GameConfig } from "../../../src/core/Schemas";

const config = {
  difficulty: Difficulty.Hard,
  enhancedAI: {
    tribePercent: 0,
    nationPercent: 100,
    personality: "mixed",
    fairResources: true,
    seed: 2026,
  },
  modernMode: {
    scenario: "modern-world-v1",
    version: 1,
    dataHash: modernWorld.hash,
    countryId: "KOR",
    balance: "balanced",
    victory: "territory",
    targetPercent: 60,
    protectionTicks: 6000,
    capitalElimination: false,
  },
} as GameConfig;
const players: PlayerStatic[] = modernWorld.countries.map((country) => ({
  id: modernPlayerId(country),
  smallID: country.index,
  name: country.name,
  displayName: country.name,
  clanTag: null,
  clientID: country.id === "KOR" ? "KOREA001" : null,
  playerType:
    country.id === "KOR" ? PlayerTypeEnum.Human : PlayerTypeEnum.Nation,
  team: null,
  isLobbyCreator: country.id === "KOR",
}));
const controllerType = (p: PlayerStatic) =>
  p.playerType === PlayerTypeEnum.Human ? PlayerType.Human : PlayerType.Nation;
const updates = (list: PlayerStatic[]) =>
  list.map((p) => ({
    id: p.id,
    playerType: controllerType(p),
    team: undefined,
  }));
const colors = (theme: SettingsTheme, list: PlayerStatic[]) =>
  Object.fromEntries(
    list.map((p) => [
      p.id,
      theme
        .territoryColor({
          id: () => p.id,
          team: () => null,
          type: () => controllerType(p),
          enhancedAI: () => aiProfile(config, p.id, controllerType(p)),
        } as unknown as PlayerView)
        .toHex(),
    ]),
  );

test("already assigned tile neighbors take priority over distant global palette colors", () => {
  const make = () => {
    const registry = new ColorRegistry();
    registry.add(colord("#000000"), "neighbor");
    registry.add(colord("#ffffff"), "distant");
    return new ColorAllocator(
      [colord("#808080"), colord("#eeeeee")],
      [],
      registry,
    );
  };
  expect(make().assignColor("new").toHex()).toBe("#808080");
  expect(make().assignColor("new", ["neighbor"]).toHex()).toBe("#eeeeee");
  expect(make().assignColor("new", ["not-yet-assigned"]).toHex()).toBe(
    "#808080",
  );
});

test("generated country neighbors equal final four-connected ownership tile borders", () => {
  const owners = new Uint16Array(modernWorld.width * modernWorld.height);
  for (const [owner, start, length] of modernWorld.runs)
    owners.fill(owner, start, start + length);
  const neighbors = modernWorld.countries.map(() => new Set<number>());
  const connect = (a: number, b: number) => {
    if (a && b && a !== b) {
      neighbors[a - 1].add(b);
      neighbors[b - 1].add(a);
    }
  };
  for (let ref = 0; ref < owners.length; ref++) {
    if (ref % modernWorld.width < modernWorld.width - 1)
      connect(owners[ref], owners[ref + 1]);
    if (ref + modernWorld.width < owners.length)
      connect(owners[ref], owners[ref + modernWorld.width]);
  }
  for (const country of modernWorld.countries) {
    const actual = [...neighbors[country.index - 1]]
      .map((index) => modernWorld.countries[index - 1].id)
      .sort();
    expect(country.neighbors).toEqual(actual);
    expect(actual.length).toBeLessThanOrEqual(32);
  }
});

test.each(["default", "colorblind"] as const)(
  "modern adjacency palette remains unique and matches live/restore/replay on %s",
  (name) => {
    const fresh = () => new SettingsTheme(createThemeSettings(name));
    const live = fresh();
    prepareThemePlayers(live, updates(players), config);
    const liveColors = colors(live, players);
    expect(new Set(Object.values(liveColors)).size).toBe(198);
    const restored = fresh();
    prepareThemePlayers(restored, updates([...players].reverse()), config);
    expect(colors(restored, players)).toEqual(liveColors);
    const replay = buildReplayPalette(
      [...players].reverse(),
      new Map(),
      fresh(),
      config,
    );
    expect(
      Object.fromEntries(replay.players.map((p) => [p.id, p.color])),
    ).toEqual(liveColors);
    const fallback = fresh();
    prepareThemePlayers(fallback, updates(players), {
      ...config,
      modernMode: undefined,
    });
    expect(colors(fallback, players)).not.toEqual(liveColors);
  },
);

test.each(["default", "colorblind"] as const)(
  "all 198 modern facility color pairs meet normalized difference target without warnings on %s",
  (name) => {
    const theme = new SettingsTheme(createThemeSettings(name));
    prepareThemePlayers(theme, updates(players), config);
    const before = colors(theme, players);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const fill of Object.values(before)) {
        const pair = theme.structureColors(colord(fill));
        expect(pair.light.delta(pair.dark)).toBeGreaterThanOrEqual(
          createThemeSettings(name).structureContrastTarget,
        );
        expect(pair.light.alpha()).toBeCloseTo(150 / 255, 2);
        expect(pair.dark.alpha()).toBe(1);
      }
      expect(colors(theme, players)).toEqual(before);
      expect(warning).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  },
);

test("saturated facility fallback preserves original alpha and territory border color", () => {
  const theme = new SettingsTheme(createThemeSettings("default"));
  const fill = colord("#fafad2").alpha(0.75);
  const border = theme.borderColor(fill).toRgbString();
  const pair = theme.structureColors(fill);
  expect(pair.light.alpha(1).toHex()).toBe("#ffffff");
  expect(pair.dark.alpha(1).toHex()).toBe("#000000");
  expect(pair.light.alpha()).toBeCloseTo(150 / 255, 2);
  expect(pair.dark.alpha()).toBe(0.75);
  expect(theme.borderColor(fill).toRgbString()).toBe(border);
});
