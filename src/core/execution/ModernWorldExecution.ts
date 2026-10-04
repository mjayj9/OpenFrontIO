import { z } from "zod";
import { Execution, Game, UnitType } from "../game/Game";
import { modernPlayerId, modernWorld } from "../game/ModernWorld";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";
import { CityExecution } from "./CityExecution";
import { FactoryExecution } from "./FactoryExecution";
import { PlayerExecution } from "./PlayerExecution";
import { PortExecution } from "./PortExecution";

/** One initialization execution, before any nation behavior or human command. */
export class ModernWorldExecution implements Execution {
  private game: Game;
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
  tick(): void {
    if (!this.active) return;
    const mode = this.game.config().gameConfig().modernMode;
    if (!mode || mode.dataHash !== modernWorld.hash)
      throw new Error("Modern scenario missing or changed");
    if (
      this.game.width() !== modernWorld.width ||
      this.game.height() !== modernWorld.height
    )
      throw new Error("Modern map dimensions differ");
    const countries = modernWorld.countries;
    // Runs are sorted in raster order. conquer updates territory, borders,
    // adjacency and mini-map through the same path as all normal captures.
    for (const [index, start, count] of modernWorld.runs) {
      const owner = this.game.player(modernPlayerId(countries[index - 1]));
      for (let tile = start; tile < start + count; tile++) {
        if (
          !this.game.isLand(tile) ||
          this.game.isImpassable(tile) ||
          this.game.hasOwner(tile)
        ) {
          throw new Error(`Invalid modern territory tile: ${tile}`);
        }
        owner.conquer(tile);
      }
    }
    for (const country of countries) {
      const player = this.game.player(modernPlayerId(country));
      const capital = this.game.ref(country.capital[0], country.capital[1]);
      if (
        this.game.owner(capital) !== player ||
        player.numTilesOwned() !== country.tiles
      ) {
        throw new Error(`Invalid initial country/capital: ${country.id}`);
      }
      player.setSpawnTile(capital);
      this.game.stats().recordSpawnTile(player, capital);
      // Equal minimum economic base. Asymmetry is a labelled gameplay preset,
      // proportional to raster territory, never a claim about real armies/GDP.
      const factor =
        mode.balance === "balanced"
          ? 1
          : Math.min(4, 1 + Math.floor(country.tiles / 12000));
      player.addGold(2_000_000n);
      if (!this.game.config().isUnitDisabled(UnitType.City)) {
        const city = player.buildUnit(UnitType.City, capital, {});
        this.game.addExecution(new CityExecution(city));
      }
      if (!this.game.config().isUnitDisabled(UnitType.Factory)) {
        // The fixed base may colocate on microstates; their tiny raster must
        // still receive an economy. Subsequent builds use normal placement.
        const factoryTile =
          Array.from(player.tiles()).find(
            (t) => this.game.manhattanDist(t, capital) >= 20,
          ) ?? capital;
        const factory = player.buildUnit(UnitType.Factory, factoryTile, {});
        this.game.addExecution(new FactoryExecution(factory));
      }
      if (!this.game.config().isUnitDisabled(UnitType.Port)) {
        const shore = Array.from(player.tiles()).find((t) =>
          this.game.isShoreline(t),
        );
        if (shore !== undefined) {
          const port = player.buildUnit(UnitType.Port, shore, {});
          this.game.addExecution(new PortExecution(port));
        }
      }
      player.removeGold(player.gold());
      player.addGold(BigInt(400_000 * factor));
      player.setTroops(
        Math.min(this.game.config().maxTroops(player), 80_000 * factor),
      );
      this.game.addExecution(new PlayerExecution(player));
    }
    this.game.endSpawnPhase();
    this.active = false;
  }
  snapshot(): ExecRecord {
    return ModernWorldExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== undefined,
    });
  }
  restoreSnapshot(s: ModernState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.game = r.game;
  }
}
const ModernStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
});
type ModernState = z.infer<typeof ModernStateSchema>;
export const ModernWorldExecutionSnapshot = execSnapshotType({
  name: "ModernWorld",
  version: 1,
  schema: ModernStateSchema,
  cls: () => ModernWorldExecution,
});
