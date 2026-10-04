import { themeProvider } from "../../../src/client/theme/ThemeProvider";
import { PlayerView } from "../../../src/client/view";
import { aiProfile } from "../../../src/core/ai/AIProfile";
import {
  ColoredTeams,
  Difficulty,
  PlayerType,
} from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { GameConfig } from "../../../src/core/Schemas";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
  stubConfig,
} from "../../util/viewStubs";

const config = {
  difficulty: Difficulty.Hard,
  enhancedAI: {
    tribePercent: 100,
    nationPercent: 100,
    personality: "mixed",
    fairResources: true,
    seed: 47,
  },
} as GameConfig;
const human = makePlayerUpdate({
  id: "middle-human",
  playerType: PlayerType.Human,
});
const nation = makePlayerUpdate({
  id: "z-nation",
  playerType: PlayerType.Nation,
});
const tribe = makePlayerUpdate({ id: "a-tribe", playerType: PlayerType.Bot });
const identities = [human, nation, tribe];
function colors(): string[] {
  return identities.map((p) =>
    themeProvider
      .current()
      .territoryColor({
        id: () => p.id,
        team: () => null,
        type: () => p.playerType!,
        enhancedAI: () => aiProfile(config, p.id, p.playerType!),
      } as unknown as PlayerView)
      .toHex(),
  );
}

test("staged live player creation and a full restored update allocate identical colors", () => {
  themeProvider.reset();
  themeProvider.preparePlayers([human, nation], config);
  themeProvider.preparePlayers([tribe], config);
  const liveColors = colors();
  themeProvider.reset();
  themeProvider.preparePlayers([tribe, nation, human], config);
  expect(colors()).toEqual(liveColors);
});

test("enhanced Bot-team identity keeps the team outline around its individual fill", () => {
  themeProvider.reset();
  const view = makeGameView({
    config: stubConfig({ gameConfig: () => config }),
  });
  const update = makeEmptyGu(1);
  update.updates[GameUpdateType.Player] = [
    makePlayerUpdate({
      id: "tribe",
      smallID: 1,
      playerType: PlayerType.Bot,
      team: ColoredTeams.Bot,
      clientID: null,
    }),
  ];
  view.update(update);
  const player = view.player("tribe"),
    theme = themeProvider.current();
  expect(player.team()).toBe(ColoredTeams.Bot);
  expect(player.territoryColor().toHex()).not.toBe(
    theme.teamColor(ColoredTeams.Bot).toHex(),
  );
  expect(player.borderColor().toHex()).toBe(
    theme.borderColor(theme.teamColor(ColoredTeams.Bot)).toHex(),
  );
});
