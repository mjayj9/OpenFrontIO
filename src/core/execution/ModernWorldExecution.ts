import { z } from "zod";
import { GameStartInfo, GameStartInfoSchema } from "../Schemas";
import { Execution, Game, GameType, PlayerType, UnitType } from "../game/Game";
import {
  modernFactionPlayerId,
  modernFactions,
  modernRegions,
} from "../game/ModernRegions";
import { modernPlayerId, modernWorld } from "../game/ModernWorld";
import { MODERN_RULES as R, isModernV2 } from "../modern/ModernRules";
import { ModernState as SystemsState } from "../modern/ModernState";
import { assignModernLevel, modernSystemsFor } from "../modern/ModernSystems";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";
import { CityExecution } from "./CityExecution";
import { FactoryExecution } from "./FactoryExecution";
import { MissileSiloExecution } from "./MissileSiloExecution";
import { ModernPortTrainingExecution } from "./ModernPortTrainingExecution";
import { ModernSystemsExecution } from "./ModernSystemsExecution";
import { PlayerExecution } from "./PlayerExecution";
import { PortExecution } from "./PortExecution";
import { SAMLauncherExecution } from "./SAMLauncherExecution";

/** One initialization execution, before any nation behavior or human command. */
export class ModernWorldExecution implements Execution {
  constructor(
    private assignments: GameStartInfo["modernAssignments"] | null = null,
  ) {}
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
    if (isModernV2(this.game.config().gameConfig())) {
      this.initializeRegions();
      this.active = false;
      return;
    }
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
  private initializeRegions(): void {
    const game = this.game,
      config = game.config().gameConfig(),
      mode = config.modernMode!;
    if (
      mode.version !== 2 ||
      mode.dataHash !== modernRegions.hash ||
      game.width() !== modernRegions.width ||
      game.height() !== modernRegions.height
    )
      throw new Error("Modern regions data/version/dimensions mismatch");
    const population = mode.initialPopulation ?? R.initialPopulation;
    const seed = config.enhancedAI?.seed ?? 0;
    const humanCount = game
      .allPlayers()
      .filter((p) => p.type() === PlayerType.Human).length;
    let invited =
      config.gameType !== GameType.Singleplayer && mode.fillEmptySlots
        ? Math.max(0, (mode.participantSlots ?? humanCount) - humanCount)
        : 0;
    const state: SystemsState = {
      version: 3,
      tick: game.ticks(),
      seed,
      factions: [],
      ports: [],
      forces: [],
      bases: [],
      nextForceId: 1,
      samAircraftReloads: [],
      aiPlans: [],
    };
    for (const faction of modernFactions) {
      const player = game.player(modernFactionPlayerId(faction));
      const human = player.type() === PlayerType.Human;
      const army = Math.floor((population * R.initialArmyPermille) / 1000),
        available = Math.floor(
          (population * R.initialAvailablePermille) / 1000,
        );
      const aiRole = human ? "human" : invited > 0 ? "invited-slot" : "world";
      if (aiRole === "invited-slot") invited--;
      const assigned = this.assignments?.find(
        (a) => a.factionId === faction.id,
      );
      state.factions.push({
        playerId: player.id(),
        factionId: faction.id,
        parentCountryId: faction.parentCountryId,
        ownedAreaUnits: 0,
        aiLevel: assigned
          ? assigned.aiLevel
          : human
            ? null
            : assignModernLevel(seed, faction.id, mode.aiLevelWeights),
        aiRole: assigned?.aiRole ?? aiRole,
        climateAdaptation: [
          ...faction.adaptedClimates,
        ] as SystemsState["factions"][number]["climateAdaptation"],
        completedTraining: 0,
        populationTransferredTo: null,
        growthModel: "stockpile-v1",
        growthCarryPermille: 0,
        population: {
          total: population,
          civilian: population - army - available,
          available,
          army,
          navy: 0,
          air: 0,
          dead: 0,
        },
        nuclearStrikes: [],
      });
    }
    game.setModernSystems(state);
    for (const [index, start, count] of modernRegions.runs) {
      const player = game.player(
        modernFactionPlayerId(modernFactions[index - 1]),
      );
      for (let tile = start; tile < start + count; tile++) {
        if (
          !game.isLand(tile) ||
          game.isImpassable(tile) ||
          game.hasOwner(tile)
        )
          throw new Error(`Invalid region tile ${tile}`);
        player.conquer(tile);
      }
    }
    for (const faction of modernFactions) {
      const player = game.player(modernFactionPlayerId(faction)),
        capital = game.ref(faction.capital[0], faction.capital[1]);
      if (
        game.owner(capital) !== player ||
        player.numTilesOwned() !== faction.tiles
      )
        throw new Error(`Region ownership mismatch ${faction.id}`);
      player.setSpawnTile(capital);
      game.stats().recordSpawnTile(player, capital);
      player.addGold(10_000_000n);
      if (!game.config().isUnitDisabled(UnitType.City)) {
        const city = player.buildUnit(UnitType.City, capital, {});
        game.addExecution(new CityExecution(city));
      }
      if (!game.config().isUnitDisabled(UnitType.Factory)) {
        const tile =
          Array.from(player.tiles()).find(
            (t) => game.manhattanDist(t, capital) >= 20,
          ) ?? capital;
        const factory = player.buildUnit(UnitType.Factory, tile, {});
        game.addExecution(new FactoryExecution(factory));
      }
      player.setTroops(
        state.factions.find((f) => f.playerId === player.id())!.population
          .army * R.rawTroopsPerPerson,
      );
    }
    for (const point of modernRegions.ports) {
      const tile = game.ref(point.tile[0], point.tile[1]),
        owner = game.owner(tile);
      if (!owner.isPlayer() || !game.isShoreline(tile))
        throw new Error(`Invalid major port ${point.portId}`);
      const player = game.player(owner.id());
      let unitId: number | null = null;
      if (!game.config().isUnitDisabled(UnitType.Port)) {
        const port = player.buildUnit(UnitType.Port, tile, {});
        unitId = port.id();
        game.addExecution(new PortExecution(port));
      }
      state.ports.push({
        portId: point.portId,
        name: point.name,
        tile,
        unitId,
        ownerId: player.id(),
        level: 0,
        damage: 0,
        development: null,
        repairUntilTick: null,
        blockadedBy: [],
        incomePerSecond: 0,
        lastIncomeTick: game.ticks(),
        captureCount: 0,
      });
    }
    const systems = modernSystemsFor(game)!;
    for (const faction of modernFactions) {
      const player = game.player(modernFactionPlayerId(faction)),
        capital = game.ref(faction.capital[0], faction.capital[1]);
      systems.forces.initializeFaction(player.id(), capital);
      if (
        mode.trainingLesson === "nuclear" &&
        player.type() === PlayerType.Human
      ) {
        if (!game.config().isUnitDisabled(UnitType.MissileSilo)) {
          const silo = player.buildUnit(UnitType.MissileSilo, capital, {});
          game.addExecution(new MissileSiloExecution(silo));
        }
        if (!game.config().isUnitDisabled(UnitType.SAMLauncher)) {
          const sam = player.buildUnit(UnitType.SAMLauncher, capital, {});
          game.addExecution(new SAMLauncherExecution(player, null, sam));
        }
      }
      player.removeGold(player.gold());
      player.addGold(BigInt(mode.trainingLesson ? 4_000_000 : R.initialGold));
      game.addExecution(new PlayerExecution(player));
    }
    game.addExecution(new ModernSystemsExecution());
    if (mode.trainingLesson === "ports")
      game.addExecution(new ModernPortTrainingExecution());
    game.endSpawnPhase();
  }
  snapshot(): ExecRecord {
    return ModernWorldExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== undefined,
      assignments: this.assignments ?? null,
    });
  }
  restoreSnapshot(s: ModernState, r: SnapshotReader): void {
    this.active = s.active;
    this.assignments = s.assignments;
    if (s.initialized) this.game = r.game;
  }
}
const ModernStateSchema = z.object({
  assignments: GameStartInfoSchema.shape.modernAssignments.unwrap().nullable(),
  active: z.boolean(),
  initialized: z.boolean(),
});
type ModernState = z.infer<typeof ModernStateSchema>;
export const ModernWorldExecutionSnapshot = execSnapshotType({
  name: "ModernWorld",
  version: 2,
  migrations: { 1: (data) => ({ ...data, assignments: null }) },
  schema: ModernStateSchema,
  cls: () => ModernWorldExecution,
});
