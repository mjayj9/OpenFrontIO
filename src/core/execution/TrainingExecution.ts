import { z } from "zod";
import {
  Execution,
  Game,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";
import { CityExecution } from "./CityExecution";
import { PlayerExecution } from "./PlayerExecution";
import { PortExecution } from "./PortExecution";

const TRIBE_ID = "TrainBot01";
const PARTNER_ID = "TrainNat01";
const HUMAN_REGION_TILES = 1200;
const SEARCH_BUDGET = 6000;

/** Prepared practice opponents. Only training uses this controller: ordinary
 * tribes and nations keep their existing AI. Every successful lesson still
 * requires the user's real intent to change simulation state. */
export class TrainingExecution implements Execution {
  private game: Game;
  private prepared = false;
  private active = true;

  init(game: Game): void {
    this.game = game;
  }
  activeDuringSpawnPhase(): boolean {
    return true;
  }
  isActive(): boolean {
    return this.active;
  }

  tick(ticks: number): void {
    if (!this.prepared) this.prepare();
    if (ticks % 20 !== 0) return;
    const tribe = this.game.player(TRIBE_ID);
    if (tribe.isAlive()) tribe.setTroops(Math.min(tribe.troops(), 3000));
    const partner = this.game.player(PARTNER_ID);
    if (!partner.isAlive()) return;
    // Accept the actual request through the existing alliance object. No
    // pre-created alliance or fake UI completion is used.
    if (!this.game.config().disableAlliances()) {
      for (const request of partner.incomingAllianceRequests()) {
        if (request.requestor().type() === PlayerType.Human) request.accept();
      }
    }
  }

  private prepare(): void {
    const config = this.game.config().gameConfig();
    const humans = this.game
      .allPlayers()
      .filter((player) => player.type() === PlayerType.Human);
    if (
      !config.training ||
      config.gameType !== GameType.Singleplayer ||
      config.modernMode ||
      humans.length !== 1
    )
      throw new Error(
        "Training requires one single-player human and no modern scenario",
      );
    const human = humans[0];
    let region: TileRef[] = [];
    // Stable raster order, one bounded land BFS per eligible coast candidate.
    // The dedicated FourIslands preset has a sufficiently large coast. Bound
    // candidate attempts to avoid pathological maps doing unlimited searches.
    let attempts = 0;
    for (let tile = 0; tile < this.game.width() * this.game.height(); tile++) {
      if (
        !this.game.isLand(tile) ||
        this.game.isImpassable(tile) ||
        !this.game.isShoreline(tile)
      )
        continue;
      const candidate = this.landRegion(tile, SEARCH_BUDGET);
      if (candidate.length >= HUMAN_REGION_TILES + 600) {
        region = candidate;
        break;
      }
      if (++attempts >= 24) break;
    }
    if (region.length === 0)
      throw new Error(
        "Training map needs an accessible coast and at least 1800 connected land tiles",
      );
    const owned = region.slice(0, HUMAN_REGION_TILES);
    for (const tile of owned) human.conquer(tile);
    this.spawn(human, region[0]);
    if (human.gold() < 10_000_000n) human.addGold(10_000_000n - human.gold());
    human.setTroops(Math.min(100_000, this.game.config().maxTroops(human)));

    const tribe = this.game.addPlayer(
      new PlayerInfo("Practice Tribe", PlayerType.Bot, null, TRIBE_ID),
    );
    // BFS index 1200 has a predecessor among the human region, so at least
    // one real land frontier exists. Leave the rest as expandable wilderness.
    const tribeCenter = region[HUMAN_REGION_TILES];
    for (const tile of this.landRegion(tribeCenter, 120, true))
      tribe.conquer(tile);
    this.spawn(tribe, tribeCenter);
    tribe.setTroops(2000);
    tribe.removeGold(tribe.gold());

    const partner = this.game.addPlayer(
      new PlayerInfo("Practice Partner", PlayerType.Nation, null, PARTNER_ID),
    );
    const waterComponents = new Set(
      this.game
        .neighbors(region[0])
        .filter((tile) => this.game.isWater(tile))
        .map((tile) => this.game.getWaterComponent(tile)),
    );
    const partnerCenter = region.find(
      (tile) =>
        !this.game.hasOwner(tile) &&
        this.game.isShoreline(tile) &&
        this.game.manhattanDist(tile, region[0]) >= 40 &&
        [...waterComponents].some(
          (component) =>
            component !== null && this.game.hasWaterComponent(tile, component),
        ),
    );
    if (partnerCenter === undefined)
      throw new Error("Training coast needs a reachable trading partner");
    for (const tile of this.landRegion(partnerCenter, 350, true))
      partner.conquer(tile);
    this.spawn(partner, partnerCenter);
    partner.setTroops(20_000);
    partner.removeGold(partner.gold());
    partner.addGold(500_000n);
    const partnerCity =
      Array.from(partner.tiles()).find(
        (tile) => this.game.manhattanDist(tile, partnerCenter) >= 20,
      ) ?? partnerCenter;
    if (!this.game.config().isUnitDisabled(UnitType.City))
      this.game.addExecution(
        new CityExecution(partner.buildUnit(UnitType.City, partnerCity, {})),
      );
    if (!this.game.config().isUnitDisabled(UnitType.Port))
      this.game.addExecution(
        new PortExecution(partner.buildUnit(UnitType.Port, partnerCenter, {})),
      );
    this.game.endSpawnPhase();
    this.prepared = true;
  }

  private spawn(player: Player, center: TileRef): void {
    player.setSpawnTile(center);
    this.game.stats().recordSpawnTile(player, center);
    this.game.addExecution(new PlayerExecution(player));
  }

  private landRegion(
    center: TileRef,
    limit: number,
    unownedOnly = false,
  ): TileRef[] {
    const queue = [center];
    const seen = new Set([center]);
    const result: TileRef[] = [];
    for (
      let cursor = 0;
      cursor < queue.length && result.length < limit;
      cursor++
    ) {
      const tile = queue[cursor];
      if (
        !this.game.isLand(tile) ||
        this.game.isImpassable(tile) ||
        (unownedOnly && this.game.hasOwner(tile))
      )
        continue;
      result.push(tile);
      for (const neighbor of this.game.neighbors(tile)) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    return result;
  }

  snapshot(): ExecRecord {
    return TrainingExecutionSnapshot.write({
      prepared: this.prepared,
      active: this.active,
      initialized: this.game !== undefined,
    });
  }
  restoreSnapshot(state: TrainingState, reader: SnapshotReader): void {
    this.prepared = state.prepared;
    this.active = state.active;
    if (state.initialized) this.game = reader.game;
  }
}
const TrainingStateSchema = z.object({
  prepared: z.boolean(),
  active: z.boolean(),
  initialized: z.boolean(),
});
type TrainingState = z.infer<typeof TrainingStateSchema>;
export const TrainingExecutionSnapshot = execSnapshotType({
  name: "Training",
  version: 1,
  schema: TrainingStateSchema,
  cls: () => TrainingExecution,
});
