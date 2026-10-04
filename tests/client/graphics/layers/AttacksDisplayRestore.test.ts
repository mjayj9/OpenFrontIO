import { afterEach, describe, expect, it } from "vitest";
import { AttacksDisplay } from "../../../../src/client/hud/layers/AttacksDisplay";
import { EventBus } from "../../../../src/core/EventBus";
import { PlayerType } from "../../../../src/core/game/Game";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
} from "../../../util/viewStubs";

function restoredView(hasIncomingAttack: boolean) {
  const game = makeGameView({ myClientID: "human001" });
  const update = makeEmptyGu(678);
  update.updates[GameUpdateType.SpawnPhaseEnd] = [
    { type: GameUpdateType.SpawnPhaseEnd, startTick: 0 },
  ];
  update.updates[GameUpdateType.Player] = [
    makePlayerUpdate({
      id: "KOR",
      name: "South Korea",
      clientID: "human001",
      smallID: 1,
      incomingAttacks: hasIncomingAttack
        ? [
            {
              id: "saved-japan-attack",
              attackerID: 2,
              targetID: 1,
              troops: 14200,
              retreating: false,
            },
          ]
        : [],
    }),
    makePlayerUpdate({
      id: "JPN",
      name: "Japan",
      displayName: "Japan",
      smallID: 2,
      clientID: null,
      playerType: PlayerType.Nation,
    }),
  ];
  game.update(update);
  return game;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Restored incoming attack rows", () => {
  it("shows a saved real attack and drops the row when the new game has none", async () => {
    const panel = new AttacksDisplay();
    panel.eventBus = new EventBus();
    panel.uiState = {
      attackRatio: 0.2,
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };
    panel.game = restoredView(true);
    document.body.append(panel);
    panel.init();
    panel.tick();
    await panel.updateComplete;
    expect(panel.textContent).toContain("Japan");

    panel.game = restoredView(false);
    panel.init();
    panel.tick();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain("Japan");

    panel.game = restoredView(true);
    panel.init();
    panel.tick();
    await panel.updateComplete;
    expect(panel.textContent).toContain("Japan");
  });
});
