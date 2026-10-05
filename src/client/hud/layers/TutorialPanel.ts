import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { PlayerType, Relation, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { UserSettings } from "../../../core/game/UserSettings";
import { climateCombatEfficiency } from "../../../core/modern/ModernClimate";
import { MODERN_RULES } from "../../../core/modern/ModernRules";
import { nuclearEffects } from "../../../core/modern/ModernState";
import { Controller } from "../../Controller";
import {
  EducationProgressStore,
  consumeRequestedChapter,
  requestChapter,
} from "../../education/EducationProgressStore";
import { EDUCATION_FEATURES } from "../../education/FeatureRegistry";
import { HelpModal } from "../../HelpModal";
import { modernKeybinds } from "../../ModernInput";
import { Platform } from "../../Platform";
import { GoToPlayerEvent } from "../../TransformHandler";
import { UIState } from "../../UIState";
import {
  formatKeyForDisplay,
  renderNumber,
  textDirection,
  translateText,
} from "../../Utils";
import { GameView } from "../../view";
import { PlayerView } from "../../view/PlayerView";
import {
  ModernTutorialEvidence,
  TUTORIAL_CHAPTERS,
  TutorialChapterID,
  TutorialContext,
  TutorialHighlight,
  TutorialHighlightEvent,
  TutorialProgress,
  TutorialProgressSnapshot,
  TutorialStep,
  chapterSteps,
} from "../Tutorial";

/** How often (in ticks) to ask the worker for current build costs. */
const COST_POLL_TICKS = 10;

/** Units whose costs the panel tracks (the build steps). */
const COST_POLL_TYPES = [
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
  UnitType.DefensePost,
  UnitType.Warship,
  UnitType.MissileSilo,
  UnitType.AtomBomb,
] as const;

/** `unit_type.*` name key per build-step unit, for the earn-gold text. */
const UNIT_NAME_KEYS: Partial<Record<UnitType, string>> = {
  [UnitType.City]: "city",
  [UnitType.Factory]: "factory",
  [UnitType.Port]: "port",
  [UnitType.DefensePost]: "defense_post",
  [UnitType.Warship]: "warship",
  [UnitType.MissileSilo]: "missile_silo",
  [UnitType.AtomBomb]: "atom_bomb",
};

/** How many of the nearest attack targets get a marker during the tribes step. */
const NEARBY_TRIBE_MARK_COUNT = 3;

/** How often (in ticks) to recompute what we share a border with. */
const BORDER_REFRESH_TICKS = 10;

/** Steps that need a coast: until we own one, they ask the player to expand to it. */
const COAST_STEPS = new Set(["send_boat", "buy_port"]);

/**
 * Steps with a `tutorial.step_touch.*` variant: their desktop text leans on
 * hotkeys, clicks and the hotbar (hidden below lg), so touch devices get the
 * tap → radial menu route instead.
 */
const TOUCH_TEXT_STEPS = new Set([
  "spawn",
  "attack_wilderness",
  "buy_city",
  "propose_alliance",
  "buy_factory",
  "send_boat",
  "buy_port",
  "buy_defense_post",
  "buy_warship",
  "buy_silo",
  "launch_atom",
]);

@customElement("tutorial-panel")
export class TutorialPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public userSettings: UserSettings;
  public uiState: UIState;

  @state() private active = false;
  @state() private confirmingClose = false;
  @state() private ctx: TutorialContext | null = null;
  @state() private chapter: TutorialChapterID = "basic";
  @state() private guidePaused = false;
  @state() private showingHint = false;
  @state() private storageError = false;

  private progress = new TutorialProgress(chapterSteps("basic"));
  private progressStore = new EducationProgressStore();
  private lastSavedProgress = "";
  private conqueredPlayers = 0;
  private lastConquestTick = -1;
  private started = false;
  private chapterRequested = false;
  private gameGeneration = 0;
  private costs = new Map<UnitType, bigint>();
  private mapMarksActive = false;
  /** Latched: an atom bomb of ours was seen in flight at least once. */
  private atomLaunchSeen = false;
  /** Latched: a transport ship of ours was seen afloat at least once. */
  private boatSeen = false;
  /** Attack ratio as of the previous tick, to spot the slider moving. */
  private lastAttackRatio: number | null = null;
  /** Nation smallID → its attitude toward us, fetched during the ally step. */
  private nationRelations = new Map<number, Relation>();
  /** smallIDs we share a border with; null until the first fetch lands. */
  private borderingIds: Set<number> | null = null;
  /**
   * Whether we own a shore tile; null until the first fetch lands. Any water
   * counts: ports and boats work on lakes too, and the map generator drops
   * bodies under 200 tiles, so there are no ponds to exclude.
   */
  @state() private hasCoast: boolean | null = null;
  private borderFetch: Promise<void> | null = null;
  /** Tribes step: every reachable tribe is walled off, so point at nations. */
  @state() private attackNations = false;
  private completeTicks: number | null = null;
  private highlight: TutorialHighlight | null = null;
  private modernPhases = new Map<string, string>();
  private modernAirOutbounds = 0;
  private modernAirReturns = 0;
  private modernAirRearms = 0;
  private modernBlockades = new Set<string>();
  private modernArmyLosses = new Map<string, number>();
  private modernAdaptedBattles = 0;
  private modernHarshBattles = 0;
  private modernSufferedBlockades = new Set<string>();
  private modernPortRecoveries = new Set<string>();
  private modernNuclearTargets = new Map<number, [number, number]>();
  private modernNuclearImpacts = new Set<number>();

  createRenderRoot() {
    return this;
  }

  /** The DOM panel is reused across matches; game evidence is not. */
  init(): void {
    this.gameGeneration++;
    this.active = false;
    this.classList.add("hidden");
    this.started = false;
    this.chapterRequested = false;
    this.progress = new TutorialProgress(chapterSteps("basic"));
    this.chapter = "basic";
    this.ctx = null;
    this.completeTicks = null;
    this.guidePaused = false;
    this.showingHint = false;
    this.confirmingClose = false;
    this.storageError = false;
    this.lastSavedProgress = "";
    this.conqueredPlayers = 0;
    this.lastConquestTick = -1;
    this.costs.clear();
    this.mapMarksActive = false;
    this.atomLaunchSeen = false;
    this.boatSeen = false;
    this.lastAttackRatio = null;
    this.nationRelations.clear();
    this.borderingIds = null;
    this.hasCoast = null;
    this.borderFetch = null;
    this.attackNations = false;
    this.highlight = null;
    this.modernPhases.clear();
    this.modernAirOutbounds = this.modernAirReturns = this.modernAirRearms = 0;
    this.modernBlockades.clear();
    this.modernArmyLosses.clear();
    this.modernAdaptedBattles = this.modernHarshBattles = 0;
    this.modernSufferedBlockades.clear();
    this.modernPortRecoveries.clear();
    this.modernNuclearTargets.clear();
    this.modernNuclearImpacts.clear();
  }

  tick() {
    // Deferred to the first tick so every controller's init() has already
    // subscribed to TutorialStateEvent.
    if (!this.started) {
      this.started = true;
      const requested = consumeRequestedChapter();
      if (requested) this.startChapter(requested);
      // Fully occupied scenarios cannot teach the Classic wilderness course
      // automatically. Explicit practice/resume remains available.
      this.setActive(
        this.chapterRequested ||
          (!this.game.config().gameConfig().modernMode &&
            !this.userSettings.tutorialDismissed()),
      );
    }
    if (!this.active) return;

    const player = this.game.myPlayer();
    if (
      this.game.config().isReplay() ||
      player === null ||
      (player.hasSpawned() && !player.isAlive())
    ) {
      this.setActive(false);
      return;
    }

    // The renderer's first tick can precede the worker's scenario bootstrap.
    // Missing initial state is loading, not an unavailable practice feature.
    if (
      this.game.config().gameConfig().modernMode?.scenario ===
        "modern-regions-v2" &&
      !this.game
        .modernSystems()
        ?.factions.some((faction) => faction.playerId === player.id())
    )
      return;

    if (this.completeTicks !== null) {
      return;
    }

    if (this.game.ticks() % COST_POLL_TICKS === 0) {
      const generation = this.gameGeneration;
      player
        .buildables(undefined, COST_POLL_TYPES)
        .then((buildables) => {
          if (generation !== this.gameGeneration) return;
          this.costs = new Map(buildables.map((b) => [b.type, b.cost]));
        })
        .catch(() => {
          /* Retain unknown costs until the current worker responds. */
        });
    }

    const ctx = this.buildContext(player);
    if (!this.guidePaused) this.progress.update(ctx);
    this.ctx = ctx;
    this.saveProgress();

    if (this.progress.finished()) {
      this.completeTicks = 0;
      this.setHighlight(null);
      return;
    }
    const step = this.progress.current();
    if (step && (step.id === "capture_tribes" || COAST_STEPS.has(step.id))) {
      this.refreshBordering(player);
    }
    const target =
      step && !this.progress.stepDone() && !this.guidePaused
        ? (step.highlight ?? null)
        : null;
    this.setHighlight(target);
    this.syncMapMarkers(target);
    this.game.setOwnSpawnRing(target === "territory");
  }

  /**
   * Marks players with the target crosshair while a step points at the map
   * (tribes to capture, a nation to ally with); as they die or are captured,
   * the next candidates take their place.
   */
  private syncMapMarkers(target: TutorialHighlight | null) {
    if (target !== "tribes" && target !== "nation") {
      if (this.mapMarksActive) {
        this.mapMarksActive = false;
        this.game.setMarkedPlayers(null);
      }
      return;
    }
    const player = this.game.myPlayer();
    if (player === null) return;
    // Name locations are the position anchor; they're recomputed every ~3s.
    // Keep the last set while ours is missing rather than flashing empty.
    const me = player.nameLocation();
    if (!me || (me.x === 0 && me.y === 0)) return;
    const ids =
      target === "tribes"
        ? this.attackTargets(player, me)
        : this.allianceTarget(me);
    this.game.setMarkedPlayers(new Set(ids));
    this.mapMarksActive = true;
  }

  /** Living players of `type` sorted nearest to `me` first. */
  private nearest(type: PlayerType, me: { x: number; y: number }): number[] {
    const candidates: { id: number; distSquared: number }[] = [];
    for (const p of this.game.playerViews()) {
      if (p.type() !== type || !p.isAlive()) continue;
      const loc = p.nameLocation();
      if (!loc || (loc.x === 0 && loc.y === 0)) continue;
      const dx = loc.x - me.x;
      const dy = loc.y - me.y;
      candidates.push({ id: p.smallID(), distSquared: dx * dx + dy * dy });
    }
    candidates.sort((a, b) => a.distSquared - b.distSquared);
    return candidates.map((c) => c.id);
  }

  /**
   * Tribes step: the tribes we share a border with, nearest first. When
   * nations have walled every tribe off, the nations we border instead
   * (minus allies) — and the step text switches to attacking nations.
   */
  private attackTargets(
    player: PlayerView,
    me: { x: number; y: number },
  ): number[] {
    const bordering = this.borderingIds;
    const bots = this.nearest(PlayerType.Bot, me);
    // Until the first border fetch lands, fall back to plain nearest.
    if (bordering === null) {
      this.attackNations = false;
      return bots.slice(0, NEARBY_TRIBE_MARK_COUNT);
    }
    const borderingBots = bots.filter((id) => bordering.has(id));
    if (borderingBots.length > 0) {
      this.attackNations = false;
      return borderingBots.slice(0, NEARBY_TRIBE_MARK_COUNT);
    }
    const nations = this.nearest(PlayerType.Nation, me).filter(
      (id) =>
        bordering.has(id) &&
        !player.isFriendly(this.game.playerBySmallID(id) as PlayerView),
    );
    this.attackNations = nations.length > 0;
    return this.attackNations
      ? nations.slice(0, NEARBY_TRIBE_MARK_COUNT)
      : bots.slice(0, NEARBY_TRIBE_MARK_COUNT);
  }

  /** Ally step: the nearest nation that doesn't dislike us, if any. */
  private allianceTarget(me: { x: number; y: number }): number[] {
    const nations = this.nearest(PlayerType.Nation, me);
    // Refresh from the pre-filter list: relations decay back toward
    // neutral, so a nation that dipped hostile must stay refreshable or
    // it would be blacklisted forever.
    this.fetchNationRelations(nations.slice(0, 5));
    // Unknown relations count as neutral until their profile fetch lands.
    return nations
      .filter(
        (id) =>
          (this.nationRelations.get(id) ?? Relation.Neutral) >=
          Relation.Neutral,
      )
      .slice(0, 1);
  }

  /**
   * Recompute (once a second, one fetch in flight) who we share a border
   * with and whether any of it is coast.
   */
  private refreshBordering(player: PlayerView) {
    if (
      this.game.ticks() % BORDER_REFRESH_TICKS !== 0 ||
      this.borderFetch !== null
    )
      return;
    const generation = this.gameGeneration;
    this.borderFetch = player
      .borderTiles()
      .then((bt) => {
        if (generation !== this.gameGeneration) return;
        this.borderFetch = null;
        const myID = player.smallID();
        const ids = new Set<number>();
        let coast = false;
        for (const tile of bt.borderTiles) {
          if (this.game.isShore(tile)) coast = true;
          for (const n of this.game.neighbors(tile)) {
            const owner = this.game.ownerID(n);
            if (owner !== 0 && owner !== myID) ids.add(owner);
          }
        }
        this.borderingIds = ids;
        this.hasCoast = coast;
      })
      .catch(() => {
        if (generation === this.gameGeneration) this.borderFetch = null;
      });
  }

  /**
   * Where the Go-to button flies the camera: our own territory during the
   * spawn-ring step, otherwise the nearest marked player (the marked set is
   * built nearest-first). Null when the step points at nothing on the map.
   */
  private goToTarget(): PlayerView | null {
    if (this.highlight === "territory") return this.game.myPlayer();
    const id = this.game.markedPlayers()?.values().next().value;
    if (id === undefined) return null;
    const p = this.game.playerBySmallID(id);
    return p.isPlayer() ? (p as PlayerView) : null;
  }

  /** Refresh (throttled) how the given nations feel about us. */
  private fetchNationRelations(ids: number[]) {
    if (this.game.ticks() % 20 !== 0) return;
    const me = this.game.myPlayer();
    if (me === null) return;
    const generation = this.gameGeneration;
    for (const id of ids) {
      const nation = this.game.playerBySmallID(id);
      if (!nation.isPlayer()) continue;
      (nation as PlayerView)
        .profile()
        .then((profile) => {
          if (generation !== this.gameGeneration) return;
          this.nationRelations.set(
            id,
            profile.relations[me.smallID()] ?? Relation.Neutral,
          );
        })
        .catch(() => {
          /* Unknown relations remain neutral while reconnecting. */
        });
    }
  }

  private buildContext(player: PlayerView): TutorialContext {
    const attacks = player.outgoingAttacks();
    const attackRatio = this.uiState.attackRatio;
    const attackRatioMoved =
      this.lastAttackRatio !== null && attackRatio !== this.lastAttackRatio;
    this.lastAttackRatio = attackRatio;
    // Only a real conquest event validates defeating an opponent. Neither
    // issuing an attack nor banking gold counts as completing this practice.
    if (this.lastConquestTick !== this.game.ticks()) {
      this.lastConquestTick = this.game.ticks();
      this.conqueredPlayers += (
        this.game.updatesSinceLastTick()?.[GameUpdateType.ConquestEvent] ?? []
      ).filter((c) => c.conquerorId === player.id()).length;
    }
    const completed = (type: UnitType) =>
      player
        .units(type)
        .filter((unit) => unit.isActive() && !unit.isUnderConstruction())
        .length;
    return {
      modern: this.buildModernEvidence(player),
      hasSpawned: player.hasSpawned(),
      inSpawnPhase: this.game.inSpawnPhase(),
      attacking: attacks.length > 0,
      tilesOwned: player.numTilesOwned(),
      conqueredPlayers: this.conqueredPlayers,
      attackRatioMoved,
      boatsDisabled: this.game.config().isUnitDisabled(UnitType.TransportShip),
      boatSent: (this.boatSeen ||=
        player.units(UnitType.TransportShip).length > 0),
      botsExist: this.game
        .playerViews()
        .some((p) => p.type() === PlayerType.Bot && p.isAlive()),
      nationsExist: this.game
        .playerViews()
        .some((p) => p.type() === PlayerType.Nation && p.isAlive()),
      alliancesDisabled: this.game.config().disableAlliances(),
      allied: player.alliances().length > 0,
      gold: player.gold(),
      cityCost: this.costs.get(UnitType.City) ?? null,
      cityDisabled: this.game.config().isUnitDisabled(UnitType.City),
      cities: completed(UnitType.City),
      portDisabled: this.game.config().isUnitDisabled(UnitType.Port),
      ports: completed(UnitType.Port),
      defensePostDisabled: this.game
        .config()
        .isUnitDisabled(UnitType.DefensePost),
      defensePosts: completed(UnitType.DefensePost),
      factoryDisabled: this.game.config().isUnitDisabled(UnitType.Factory),
      factories: completed(UnitType.Factory),
      warshipDisabled: this.game.config().isUnitDisabled(UnitType.Warship),
      warships: completed(UnitType.Warship),
      siloDisabled: this.game.config().isUnitDisabled(UnitType.MissileSilo),
      silos: completed(UnitType.MissileSilo),
      atomDisabled: this.game.config().isUnitDisabled(UnitType.AtomBomb),
      // Mirrors PlayerImpl.nukeSpawn's ready-silo filter.
      siloReady: player
        .units(UnitType.MissileSilo)
        .some(
          (s) => s.isActive() && !s.isInCooldown() && !s.isUnderConstruction(),
        ),
      atomLaunched: (this.atomLaunchSeen ||=
        player.units(UnitType.AtomBomb).length > 0),
      hydrogenDisabled: this.game
        .config()
        .isUnitDisabled(UnitType.HydrogenBomb),
      mirvDisabled: this.game.config().isUnitDisabled(UnitType.MIRV),
      samDisabled: this.game.config().isUnitDisabled(UnitType.SAMLauncher),
    };
  }

  private buildModernEvidence(
    player: PlayerView,
  ): ModernTutorialEvidence | undefined {
    const systems = this.game.modernSystems?.();
    if (!systems) return undefined;
    const own = systems.factions.find(
      (faction) => faction.playerId === player.id(),
    );
    if (!own) return undefined;
    const nukeTypes = [
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRVWarhead,
    ];
    for (const unit of player.units(...nukeTypes)) {
      const target = unit.targetTile();
      if (
        target !== undefined &&
        !this.modernNuclearTargets.has(unit.id()) &&
        this.modernNuclearTargets.size < 64
      )
        this.modernNuclearTargets.set(unit.id(), [
          target,
          this.game.ownerID(target),
        ]);
    }
    const impacted = new Set(this.game.recentlyNukedTiles?.() ?? []);
    for (const update of this.game.updatesSinceLastTick()?.[
      GameUpdateType.Unit
    ] ?? []) {
      const target = this.modernNuclearTargets.get(update.id);
      if (
        target &&
        update.ownerID === player.smallID() &&
        nukeTypes.includes(update.unitType) &&
        update.reachedTarget &&
        target[1] !== 0 &&
        target[1] !== player.smallID() &&
        impacted.has(target[0])
      )
        this.modernNuclearImpacts.add(update.id);
    }
    const forces = systems.forces.filter(
      (force) => force.playerId === player.id(),
    );
    for (const force of forces) {
      const previous = this.modernPhases.get(force.id);
      if (force.branch === "air" && previous !== force.phase) {
        if (force.phase === "outbound") this.modernAirOutbounds++;
        if (force.phase === "returning") this.modernAirReturns++;
        if (force.phase === "rearming") {
          this.modernAirRearms++;
          // Modern state is sent every ten ticks. A short return flight can
          // finish between updates; a completed sortie rearming at its real
          // base still proves the return. New production has no such mission.
          if (
            previous !== "returning" &&
            force.completedMissions > 0 &&
            systems.bases.some(
              (base) =>
                base.id === force.baseId &&
                base.playerId === player.id() &&
                base.tile === force.tile,
            )
          )
            this.modernAirReturns++;
        }
      }
      this.modernPhases.set(force.id, force.phase);
      if (force.branch === "army") {
        const previousLoss = this.modernArmyLosses.get(force.id);
        if (previousLoss !== undefined && force.casualties > previousLoss) {
          const efficiency = climateCombatEfficiency(
            own,
            force.command?.target ?? force.tile,
          );
          if (efficiency > 1000) this.modernAdaptedBattles++;
          if (efficiency < 1000) this.modernHarshBattles++;
        }
        this.modernArmyLosses.set(force.id, force.casualties);
      }
    }
    const ports = systems.ports.filter((port) => port.ownerId === player.id());
    for (const port of ports) {
      if (port.blockadedBy.length > 0)
        this.modernSufferedBlockades.add(port.portId);
      else if (
        port.incomePerSecond > 0 &&
        this.modernSufferedBlockades.has(port.portId)
      )
        this.modernPortRecoveries.add(port.portId);
    }
    for (const port of systems.ports) {
      if (port.blockadedBy.includes(player.id()))
        this.modernBlockades.add(port.portId);
    }
    const total =
      this.game.config().gameConfig().modernMode?.initialPopulation ??
      MODERN_RULES.initialPopulation;
    return {
      independent:
        new Set(systems.factions.map((faction) => faction.playerId)).size ===
          systems.factions.length &&
        new Set(systems.factions.map((faction) => faction.factionId)).size ===
          systems.factions.length,
      equalPopulation: systems.factions.every(
        (faction) =>
          faction.population.total + faction.population.dead === total &&
          faction.population.total ===
            faction.population.civilian +
              faction.population.available +
              faction.population.army +
              faction.population.navy +
              faction.population.air,
      ),
      branchesUsed: [...(this.uiState.modernBranchesUsed ?? [])],
      selectionCount: this.uiState.modernSelectedForceIds?.length ?? 0,
      armyMissions: forces
        .filter((force) => force.branch === "army")
        .reduce((sum, force) => sum + force.completedMissions, 0),
      navyMissions: forces
        .filter((force) => force.branch === "navy")
        .reduce((sum, force) => sum + force.completedMissions, 0),
      airMissions: forces
        .filter((force) => force.branch === "air")
        .reduce((sum, force) => sum + force.completedMissions, 0),
      airOutbounds: this.modernAirOutbounds,
      airReturns: this.modernAirReturns,
      airRearms: this.modernAirRearms,
      airCasualties: forces
        .filter((force) => force.branch === "air")
        .reduce((sum, force) => sum + force.casualties, 0),
      armyCasualties: forces
        .filter((force) => force.branch === "army")
        .reduce((sum, force) => sum + force.casualties, 0),
      airBases: systems.bases.filter(
        (base) => base.playerId === player.id() && base.health > 0,
      ).length,
      completedTraining: own.completedTraining,
      portCaptures: ports.reduce((sum, port) => sum + port.captureCount, 0),
      portLevels: ports.reduce((sum, port) => sum + port.level, 0),
      portIncome: ports.reduce((sum, port) => sum + port.incomePerSecond, 0),
      blockadesSeen: this.modernBlockades.size,
      blockadesSuffered: this.modernSufferedBlockades.size,
      portRecoveries: this.modernPortRecoveries.size,
      nuclearLaunches: own.nuclearStrikes.length,
      nuclearIncomeLoss: nuclearEffects(own, this.game.ticks())
        .incomeLossPermille,
      nuclearImpacts: this.modernNuclearImpacts.size,
      completedStops: this.uiState.modernCompletedStops ?? 0,
      climatePreviewAdapted: Boolean(this.uiState.modernClimatePreviewAdapted),
      climatePreviewHarsh: Boolean(this.uiState.modernClimatePreviewHarsh),
      climateAdaptedBattles: this.modernAdaptedBattles,
      climateHarshBattles: this.modernHarshBattles,
      aiLevelsVisible: Boolean(this.uiState.modernAIInfoInspected),
    };
  }

  private hotkeyFor(step: TutorialStep): string {
    if (!step.hotkey) return "";
    const binding = this.userSettings.keybinds(Platform.isMac)[step.hotkey];
    return binding
      ? binding
          .split("+")
          .map((key) => key.replace(/^Key|^Digit/, ""))
          .join(" + ")
      : translateText("education.unbound");
  }

  public startChapter(id: TutorialChapterID, resume = false): void {
    this.chapterRequested = true;
    this.chapter = id;
    this.progress = new TutorialProgress(chapterSteps(id));
    if (!resume) {
      this.conqueredPlayers = 0;
      this.modernSufferedBlockades.clear();
      this.modernPortRecoveries.clear();
      this.uiState.modernAIInfoInspected = false;
      // An update already delivered before this chapter began is old evidence.
      this.lastConquestTick = this.game.ticks();
    }
    if (resume) {
      const saved = this.progressStore.load(id);
      if (saved) this.progress.restore(saved);
    }
    this.completeTicks = null;
    this.confirmingClose = false;
    this.guidePaused = false;
    this.showingHint = false;
    this.lastSavedProgress = "";
    this.userSettings?.setTutorialDismissed(false);
    this.setActive(true);
  }

  private chooseChapter(id: TutorialChapterID, restart = false): void {
    const mode = this.game.config().gameConfig().modernMode;
    if (
      id.startsWith("modern_") &&
      (restart ||
        mode?.scenario !== "modern-regions-v2" ||
        mode.trainingLesson !== id.slice(7))
    ) {
      requestChapter(id);
      document.dispatchEvent(
        new CustomEvent("start-tutorial", { detail: { chapter: id } }),
      );
      return;
    }
    this.startChapter(id);
  }

  public educationSnapshot() {
    return {
      panelVersion: 1 as const,
      active: this.active,
      guidePaused: this.guidePaused,
      chapter: this.chapter,
      progress: this.progress.snapshot(),
      evidence: {
        conqueredPlayers: this.conqueredPlayers,
        atomLaunchSeen: this.atomLaunchSeen,
        boatSeen: this.boatSeen,
        modern: {
          phases: [...this.modernPhases],
          outbounds: this.modernAirOutbounds,
          returns: this.modernAirReturns,
          rearms: this.modernAirRearms,
          blockades: [...this.modernBlockades],
          branches: this.uiState.modernBranchesUsed ?? [],
          completedStops: this.uiState.modernCompletedStops ?? 0,
          climatePreviewAdapted:
            this.uiState.modernClimatePreviewAdapted ?? false,
          climatePreviewHarsh: this.uiState.modernClimatePreviewHarsh ?? false,
          aiInfoInspected: this.uiState.modernAIInfoInspected ?? false,
          armyLosses: [...this.modernArmyLosses],
          adaptedBattles: this.modernAdaptedBattles,
          harshBattles: this.modernHarshBattles,
          sufferedBlockades: [...this.modernSufferedBlockades],
          portRecoveries: [...this.modernPortRecoveries],
          nuclearTargets: [...this.modernNuclearTargets].map(
            ([id, [tile, owner]]) =>
              [id, tile, owner] as [number, number, number],
          ),
          nuclearImpacts: [...this.modernNuclearImpacts],
        },
      },
    };
  }

  public restoreEducationSnapshot(saved: {
    panelVersion?: 1;
    active?: boolean;
    guidePaused?: boolean;
    chapter: TutorialChapterID;
    progress: TutorialProgressSnapshot;
    evidence?: {
      conqueredPlayers: number;
      atomLaunchSeen: boolean;
      boatSeen: boolean;
      modern?: {
        phases: [string, string][];
        outbounds: number;
        returns: number;
        rearms: number;
        blockades: string[];
        branches: string[];
        completedStops: number;
        climatePreviewAdapted: boolean;
        climatePreviewHarsh: boolean;
        aiInfoInspected?: boolean;
        armyLosses?: [string, number][];
        adaptedBattles?: number;
        harshBattles?: number;
        sufferedBlockades?: string[];
        portRecoveries?: string[];
        nuclearTargets?: [number, number, number][];
        nuclearImpacts?: number[];
      };
    };
  }): boolean {
    if (!TUTORIAL_CHAPTERS.some((c) => c.id === saved.chapter)) return false;
    if (
      (saved.panelVersion !== undefined && saved.panelVersion !== 1) ||
      (saved.active !== undefined && typeof saved.active !== "boolean") ||
      (saved.guidePaused !== undefined &&
        typeof saved.guidePaused !== "boolean")
    )
      return false;
    const progress = new TutorialProgress(chapterSteps(saved.chapter));
    if (!progress.restore(saved.progress)) return false;
    const evidence = saved.evidence;
    if (
      evidence &&
      (!Number.isSafeInteger(evidence.conqueredPlayers) ||
        evidence.conqueredPlayers < 0 ||
        typeof evidence.atomLaunchSeen !== "boolean" ||
        typeof evidence.boatSeen !== "boolean")
    )
      return false;
    const modernEvidence = evidence?.modern;
    if (
      modernEvidence &&
      (!Array.isArray(modernEvidence.nuclearTargets ?? []) ||
        (modernEvidence.nuclearTargets ?? []).length > 64 ||
        !(modernEvidence.nuclearTargets ?? []).every(
          (entry) =>
            Array.isArray(entry) &&
            entry.length === 3 &&
            entry.every((value) => Number.isSafeInteger(value) && value >= 0),
        ) ||
        !Array.isArray(modernEvidence.nuclearImpacts ?? []) ||
        (modernEvidence.nuclearImpacts ?? []).length > 64 ||
        !(modernEvidence.nuclearImpacts ?? []).every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ))
    )
      return false;
    if (
      modernEvidence &&
      (![
        modernEvidence.outbounds,
        modernEvidence.returns,
        modernEvidence.rearms,
        modernEvidence.completedStops,
        modernEvidence.adaptedBattles ?? 0,
        modernEvidence.harshBattles ?? 0,
      ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
        ![
          modernEvidence.climatePreviewAdapted,
          modernEvidence.climatePreviewHarsh,
          modernEvidence.aiInfoInspected ?? false,
        ].every((value) => typeof value === "boolean") ||
        !Array.isArray(modernEvidence.phases) ||
        !modernEvidence.phases.every(
          (entry) =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            entry.every((value) => typeof value === "string"),
        ) ||
        !Array.isArray(modernEvidence.branches) ||
        !modernEvidence.branches.every((branch) =>
          ["army", "navy", "air"].includes(branch),
        ) ||
        !Array.isArray(modernEvidence.blockades) ||
        !modernEvidence.blockades.every((id) => typeof id === "string") ||
        ![
          modernEvidence.sufferedBlockades ?? [],
          modernEvidence.portRecoveries ?? [],
        ].every(
          (entries) =>
            Array.isArray(entries) &&
            entries.every((id) => typeof id === "string"),
        ) ||
        (modernEvidence.armyLosses !== undefined &&
          (!Array.isArray(modernEvidence.armyLosses) ||
            !modernEvidence.armyLosses.every(
              (entry) =>
                Array.isArray(entry) &&
                entry.length === 2 &&
                typeof entry[0] === "string" &&
                Number.isSafeInteger(entry[1]) &&
                entry[1] >= 0,
            ))))
    )
      return false;
    this.chapter = saved.chapter;
    this.progress = progress;
    // Previous saves captured a basic cursor even when the panel was hidden.
    // Missing visibility must never turn that cursor into a Modern lesson.
    const active =
      saved.active ??
      (!this.game.config().gameConfig().modernMode &&
        !this.userSettings.tutorialDismissed());
    this.started = true;
    this.chapterRequested = active;
    this.guidePaused = saved.guidePaused ?? false;
    this.completeTicks = progress.finished() ? 0 : null;
    this.confirmingClose = false;
    this.showingHint = false;
    this.lastSavedProgress = "";
    if (saved.evidence) {
      this.conqueredPlayers = saved.evidence.conqueredPlayers;
      this.atomLaunchSeen = saved.evidence.atomLaunchSeen;
      this.boatSeen = saved.evidence.boatSeen;
      if (saved.evidence.modern) {
        const modern = saved.evidence.modern;
        this.modernPhases = new Map(modern.phases);
        this.modernAirOutbounds = modern.outbounds;
        this.modernAirReturns = modern.returns;
        this.modernAirRearms = modern.rearms;
        this.modernBlockades = new Set(modern.blockades);
        this.uiState.modernBranchesUsed = [...modern.branches];
        this.uiState.modernCompletedStops = modern.completedStops;
        this.uiState.modernClimatePreviewAdapted = modern.climatePreviewAdapted;
        this.uiState.modernClimatePreviewHarsh = modern.climatePreviewHarsh;
        this.uiState.modernAIInfoInspected = modern.aiInfoInspected ?? false;
        this.modernArmyLosses = new Map(modern.armyLosses ?? []);
        this.modernAdaptedBattles = modern.adaptedBattles ?? 0;
        this.modernHarshBattles = modern.harshBattles ?? 0;
        this.modernSufferedBlockades = new Set(modern.sufferedBlockades ?? []);
        this.modernPortRecoveries = new Set(modern.portRecoveries ?? []);
        this.modernNuclearTargets = new Map(
          (modern.nuclearTargets ?? []).map(([id, tile, owner]) => [
            id,
            [tile, owner],
          ]),
        );
        this.modernNuclearImpacts = new Set(modern.nuclearImpacts ?? []);
      }
    }
    this.lastConquestTick = this.game.ticks();
    this.setActive(active);
    return true;
  }

  private saveProgress(): void {
    const snapshot = this.progress.snapshot();
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.lastSavedProgress) return;
    this.storageError = !this.progressStore.save(this.chapter, snapshot);
    if (!this.storageError) this.lastSavedProgress = serialized;
  }

  private setHighlight(target: TutorialHighlight | null) {
    if (this.highlight === target) return;
    this.highlight = target;
    this.eventBus.emit(new TutorialHighlightEvent(target));
  }

  private setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    // The host sits in the bottom HUD column above the control panel; leave
    // the flow when hidden so it doesn't add a gap there.
    this.classList.toggle("hidden", !active);
    if (!active) {
      this.setHighlight(null);
      this.syncMapMarkers(null);
      this.game.setOwnSpawnRing(false);
    }
  }

  private dismissForever() {
    this.userSettings.setTutorialDismissed(true);
    this.setActive(false);
  }

  render() {
    if (!this.active) return nothing;
    return html`
      <div
        dir=${textDirection()}
        class="pointer-events-auto w-full sm:rounded-lg bg-gray-800/92 backdrop-blur-sm shadow-lg text-white text-base p-2 sm:mb-1"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="flex items-center justify-between gap-2 mb-1">
          <span
            class="font-bold text-cyber-yellow uppercase tracking-wide text-sm"
            >${translateText("tutorial.title")}</span
          >
          <span class="flex items-center gap-2 text-sm text-gray-300">
            ${this.confirmingClose ? nothing : this.renderHeaderActions()}
            ${this.ctx && !this.progress.finished()
              ? translateText("tutorial.step_counter", {
                  current: this.progress.position(this.ctx),
                  total: this.progress.total(this.ctx),
                })
              : nothing}
            <button
              class="text-gray-400 hover:text-white text-base leading-none px-1"
              title=${translateText("tutorial.close")}
              aria-label=${translateText("tutorial.close")}
              @click=${() => (this.confirmingClose = !this.confirmingClose)}
            >
              ✕
            </button>
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2 mb-1 text-xs">
          <label>
            ${translateText("education.chapter")}
            <select
              class="bg-gray-900 border border-gray-500 rounded px-1 py-0.5"
              .value=${this.chapter}
              @change=${(event: Event) =>
                this.chooseChapter(
                  (event.target as HTMLSelectElement)
                    .value as TutorialChapterID,
                )}
            >
              ${TUTORIAL_CHAPTERS.map(
                (chapter) =>
                  html`<option
                    value=${chapter.id}
                    ?selected=${chapter.id === this.chapter}
                  >
                    ${translateText(`education.chapters.${chapter.id}`)}
                  </option>`,
              )}
            </select>
          </label>
          <button
            class="underline"
            @click=${() => this.chooseChapter(this.chapter, true)}
          >
            ${translateText("education.repeat")}
          </button>
          <button
            class="underline"
            @click=${() => this.startChapter(this.chapter, true)}
          >
            ${translateText("education.resume")}
          </button>
          <button
            class="underline"
            @click=${() => (this.guidePaused = !this.guidePaused)}
          >
            ${translateText(
              this.guidePaused
                ? "education.resume_guide"
                : "education.pause_guide",
            )}
          </button>
          <button
            class="underline"
            @click=${() => (this.showingHint = !this.showingHint)}
          >
            ${translateText("education.hint")}
          </button>
          <button
            class="underline"
            @click=${() => {
              const stepId = this.progress.current()?.id;
              const feature = EDUCATION_FEATURES.find((feature) =>
                feature.tutorialSteps.includes(stepId ?? ""),
              );
              const help = document.querySelector(
                "help-modal",
              ) as HelpModal | null;
              if (feature && help) help.openFeature(feature.featureId);
            }}
          >
            ${translateText("main.help")}
          </button>
        </div>
        ${this.game.config().gameConfig().training
          ? html`<p class="text-xs text-blue-200 mb-1">
              <strong>${translateText("education.trainee")}:</strong>
              ${translateText("education.training_rules")}
            </p>`
          : nothing}
        ${this.confirmingClose ? this.renderCloseChoice() : this.renderStep()}
        ${this.showingHint
          ? html`<p class="text-xs text-blue-200 mt-1">
              ${translateText(
                Platform.isTouch
                  ? "education.touch_hint"
                  : "education.practice_hint",
              )}
            </p>`
          : nothing}
        ${this.guidePaused
          ? html`<p class="text-xs text-yellow-200">
              ${translateText("education.guide_paused")}
            </p>`
          : nothing}
        ${this.storageError
          ? html`<p role="status" class="text-xs text-yellow-200">
              ${translateText("education.storage_error")}
            </p>`
          : nothing}
      </div>
    `;
  }

  /** Got it / Go to / Skip live in the header row to keep the panel short. */
  private renderHeaderActions() {
    const step = this.progress.current();
    if (
      step === null ||
      this.completeTicks !== null ||
      this.progress.stepDone()
    )
      return nothing;
    const goTo = this.goToTarget();
    return html`
      ${step.manual
        ? html`<button
            class="rounded bg-malibu-blue hover:bg-aquarius px-2 py-0.5 font-semibold text-white"
            @click=${() => this.progress.acknowledge()}
          >
            ${translateText("tutorial.got_it")}
          </button>`
        : nothing}
      ${goTo
        ? html`<button
            class="rounded bg-malibu-blue hover:bg-aquarius px-2 py-0.5 font-semibold text-white"
            @click=${() => this.eventBus.emit(new GoToPlayerEvent(goTo))}
          >
            ${translateText("tutorial.go_to")}
          </button>`
        : nothing}
      <button
        class="text-gray-400 hover:text-white underline"
        @click=${() => this.progress.skip()}
      >
        ${translateText("tutorial.skip")}
      </button>
    `;
  }

  private renderCloseChoice() {
    return html`
      <div class="flex flex-col gap-1.5">
        <button
          class="rounded-md border border-gray-500 hover:bg-gray-700 px-2 py-1"
          @click=${() => this.setActive(false)}
        >
          ${translateText("tutorial.hide_for_game")}
        </button>
        <button
          class="rounded-md border border-gray-500 hover:bg-gray-700 px-2 py-1"
          @click=${() => this.dismissForever()}
        >
          ${translateText("tutorial.never_show")}
        </button>
      </div>
    `;
  }

  private renderStep() {
    if (this.completeTicks !== null) {
      const outcomes = Object.values(this.progress.result());
      return html`<p>
        ${translateText("education.chapter_complete", {
          practiced: outcomes.filter((outcome) => outcome === "practiced")
            .length,
          read: outcomes.filter((outcome) => outcome === "read").length,
          skipped: outcomes.filter((outcome) => outcome === "skipped").length,
        })}
      </p>`;
    }
    const step = this.progress.current();
    if (step === null) return nothing;
    const done = this.progress.stepDone();
    return html`
      <p class="flex gap-1.5 ${done ? "text-green-400" : ""}">
        ${step.bullets && !done
          ? nothing
          : html`<span class="shrink-0">${done ? "✓" : "•"}</span>`}
        ${step.bullets
          ? html`<ul class="list-disc ms-4 flex flex-col gap-1">
              ${step.bullets.map(
                // dir=auto keeps step text on its content's side while the
                // panel chrome mirrors — untranslated steps (English fallback)
                // then keep their punctuation on the correct end.
                (b) =>
                  html`<li dir="auto">
                    ${translateText(`tutorial.step.${b}`)}
                  </li>`,
              )}
            </ul>`
          : html`<span dir="auto">${this.stepText(step, done)}</span>`}
        ${done
          ? html`<span class="block text-xs text-green-200 mt-1"
              >${translateText(
                step.manual
                  ? "education.read_confirmed"
                  : "education.practice_confirmed",
              )}</span
            >`
          : nothing}
      </p>
    `;
  }

  private stepText(step: TutorialStep, done: boolean): string {
    if (step.id.startsWith("modern_")) {
      return translateText(`education.modern_steps.${step.id}`, {
        population:
          this.game.config().gameConfig().modernMode?.initialPopulation ??
          MODERN_RULES.initialPopulation,
        armyKey: this.modernKey("modernArmy"),
        navyKey: this.modernKey("modernNavy"),
        airKey: this.modernKey("modernAir"),
        cost: MODERN_RULES.climateTrainingGold,
        seconds: MODERN_RULES.climateTrainingTicks / 10,
      });
    }
    if (step.id === "spawn" && this.game.config().gameConfig().training)
      return translateText("education.training_spawn");
    // Multiplayer: the spot is picked but the spawn timer is still running,
    // so don't keep asking the player to pick one.
    if (!done && step.id === "spawn" && this.ctx?.hasSpawned) {
      return translateText("tutorial.step.spawn_wait");
    }
    // Boats and ports need shore; landlocked players are sent to get some.
    if (!done && COAST_STEPS.has(step.id) && this.hasCoast === false) {
      return translateText("tutorial.step.no_coast");
    }
    // Build steps: until the unit is affordable, ask for gold instead of
    // telling the player to build something they can't.
    const cost =
      step.unit !== undefined ? this.costs.get(step.unit) : undefined;
    if (
      !done &&
      cost !== undefined &&
      (this.game.myPlayer()?.gold() ?? 0n) < cost
    ) {
      return translateText("tutorial.step.earn_gold", {
        unit: translateText(`unit_type.${UNIT_NAME_KEYS[step.unit!]}`),
        cost: renderNumber(cost),
      });
    }
    // The launch step must not claim the silo is armed while it's still
    // under construction or reloading.
    if (!done && step.id === "launch_atom" && this.ctx?.siloReady === false) {
      return translateText("tutorial.step.silo_loading");
    }
    const id =
      !done && step.id === "capture_tribes" && this.attackNations
        ? "attack_nations"
        : step.id;
    if (
      id === "attack_wilderness" ||
      id === "capture_tribes" ||
      id === "attack_nations"
    ) {
      return translateText(`education.practice.${id}`);
    }
    const block =
      Platform.isTouch && TOUCH_TEXT_STEPS.has(id) ? "step_touch" : "step";
    return translateText(`tutorial.${block}.${id}`, {
      cost: renderNumber(this.costs.get(UnitType.City) ?? 0n),
      key: this.hotkeyFor(step),
    });
  }
  private modernKey(action: string): string {
    const key = modernKeybinds(this.userSettings, Platform.isMac)[action];
    return key ? formatKeyForDisplay(key) : translateText("education.unbound");
  }
}
