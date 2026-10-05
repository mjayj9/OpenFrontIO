import { GameEvent } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";

/** HUD elements (or, for "territory", the map ring) the tutorial can draw attention to. */
export type TutorialHighlight =
  | "territory"
  | "troops"
  | "troop_rate"
  | "attack_ratio"
  | "gold"
  | "city"
  | "port"
  | "defense_post"
  | "factory"
  | "warship"
  | "silo"
  | "atom"
  | "hydrogen"
  | "mirv"
  | "sam"
  | "tribes"
  | "nation";

/** Emitted whenever the highlighted HUD element changes (null clears it). */
export class TutorialHighlightEvent implements GameEvent {
  constructor(public readonly target: TutorialHighlight | null) {}
}

/** Snapshot of the player's state that the steps are evaluated against. */
export interface TutorialContext {
  modern?: ModernTutorialEvidence;
  hasSpawned: boolean;
  /** Multiplayer: the spawn timer is still running, so attacking is blocked. */
  inSpawnPhase: boolean;
  /** Any outgoing attack, wilderness or player. */
  attacking: boolean;
  /** Actual owned land; an attack command alone is not a successful conquest. */
  tilesOwned: number;
  /** Opponents actually conquered since this guide began. */
  conqueredPlayers: number;
  /** The attack ratio changed this tick (slider drag or hotkey). */
  attackRatioMoved: boolean;
  boatsDisabled: boolean;
  /** A transport ship of ours is (or was seen) afloat. */
  boatSent: boolean;
  botsExist: boolean;
  nationsExist: boolean;
  alliancesDisabled: boolean;
  /** The player has at least one active alliance. */
  allied: boolean;
  gold: bigint;
  /** Null until the worker has reported it. */
  cityCost: bigint | null;
  cityDisabled: boolean;
  cities: number;
  portDisabled: boolean;
  ports: number;
  defensePostDisabled: boolean;
  defensePosts: number;
  factoryDisabled: boolean;
  factories: number;
  warshipDisabled: boolean;
  warships: number;
  siloDisabled: boolean;
  silos: number;
  atomDisabled: boolean;
  /** A completed missile silo that isn't reloading exists. */
  siloReady: boolean;
  /** An atom bomb of ours is (or was seen) in flight. */
  atomLaunched: boolean;
  hydrogenDisabled: boolean;
  mirvDisabled: boolean;
  samDisabled: boolean;
}
/** Derived only from acknowledged core state and actual military UI events. */
export interface ModernTutorialEvidence {
  independent: boolean;
  equalPopulation: boolean;
  branchesUsed: string[];
  selectionCount: number;
  armyMissions: number;
  navyMissions: number;
  airMissions: number;
  airOutbounds: number;
  airReturns: number;
  airRearms: number;
  airCasualties: number;
  airBases: number;
  completedTraining: number;
  armyCasualties: number;
  portCaptures: number;
  portLevels: number;
  portIncome: number;
  blockadesSeen: number;
  blockadesSuffered?: number;
  portRecoveries?: number;
  nuclearLaunches: number;
  nuclearIncomeLoss: number;
  nuclearImpacts?: number;
  completedStops: number;
  climatePreviewAdapted: boolean;
  climatePreviewHarsh: boolean;
  climateAdaptedBattles?: number;
  climateHarshBattles?: number;
  aiLevelsVisible: boolean;
}
function validModernEvidence(evidence: ModernTutorialEvidence): boolean {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
    return false;
  const numbers = [
    "selectionCount",
    "armyMissions",
    "navyMissions",
    "airMissions",
    "airOutbounds",
    "airReturns",
    "airRearms",
    "airCasualties",
    "airBases",
    "completedTraining",
    "armyCasualties",
    "portCaptures",
    "portLevels",
    "portIncome",
    "blockadesSeen",
    "nuclearLaunches",
    "nuclearIncomeLoss",
    "completedStops",
  ] as const;
  const booleans = [
    "independent",
    "equalPopulation",
    "climatePreviewAdapted",
    "climatePreviewHarsh",
    "aiLevelsVisible",
  ] as const;
  return (
    numbers.every(
      (key) => Number.isSafeInteger(evidence[key]) && evidence[key] >= 0,
    ) &&
    booleans.every((key) => typeof evidence[key] === "boolean") &&
    Array.isArray(evidence.branchesUsed) &&
    evidence.branchesUsed.every((branch) =>
      ["army", "navy", "air"].includes(branch),
    ) &&
    [
      evidence.climateAdaptedBattles ?? 0,
      evidence.climateHarshBattles ?? 0,
      evidence.blockadesSuffered ?? 0,
      evidence.portRecoveries ?? 0,
      evidence.nuclearImpacts ?? 0,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
  );
}

export interface TutorialStep {
  id: string;
  highlight?: TutorialHighlight;
  /**
   * Build steps: the unit this step asks for. While the player can't afford
   * it, the panel shows the generic earn-gold text instead of the step's own.
   */
  unit?: UnitType;
  /** Keybind action whose key is interpolated into the step text as {key}. */
  hotkey?:
    | "buildCity"
    | "buildPort"
    | "buildDefensePost"
    | "buildFactory"
    | "buildWarship"
    | "buildMissileSilo"
    | "buildAtomBomb";
  /**
   * Render these `tutorial.step.*` keys as a bullet list instead of the
   * step's own single text.
   */
  bullets?: string[];
  /** Steps that don't fit this game's config are skipped. Defaults to always. */
  applies?: (ctx: TutorialContext) => boolean;
  /** Informational steps complete when the player clicks "Got it". */
  manual?: true;
  isDone?: (ctx: TutorialContext, baseline: TutorialContext) => boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // Waits out the multiplayer spawn timer too: the next step asks the
  // player to expand, which is impossible until the game actually starts.
  { id: "spawn", isDone: (c) => c.hasSpawned && !c.inSpawnPhase },
  // Keeps the spawn ring on the player's territory so they can find it.
  // Any attack counts so a player who hits a bot first doesn't get stuck.
  {
    id: "attack_wilderness",
    highlight: "territory",
    isDone: (c, baseline) => c.tilesOwned > baseline.tilesOwned,
  },
  { id: "troops", highlight: "troops", manual: true },
  { id: "troop_rate", highlight: "troop_rate", manual: true },
  {
    id: "attack_ratio",
    highlight: "attack_ratio",
    isDone: (c) => c.attackRatioMoved,
  },
  // A conquest anywhere in this chapter counts, including a tribe defeated
  // during the earlier expansion exercise. The panel latches actual events.
  {
    id: "capture_tribes",
    highlight: "tribes",
    applies: (c) => c.botsExist || c.conqueredPlayers > 0,
    isDone: (c) => c.conqueredPlayers > 0,
  },
  {
    id: "buy_city",
    highlight: "city",
    unit: UnitType.City,
    hotkey: "buildCity",
    applies: (c) => !c.cityDisabled,
    isDone: (c, baseline) => c.cities > baseline.cities,
  },
  // Marks the nearest nation with the target crosshair; done once the
  // nation accepts (nations may decline — Skip is the way past that).
  {
    id: "propose_alliance",
    highlight: "nation",
    applies: (c) => c.nationsExist && !c.alliancesDisabled,
    isDone: (c) => c.allied,
  },
  {
    id: "alliance_info",
    bullets: ["alliance_info", "traitor_info"],
    applies: (c) => c.nationsExist && !c.alliancesDisabled,
    manual: true,
  },
  {
    id: "buy_factory",
    highlight: "factory",
    unit: UnitType.Factory,
    hotkey: "buildFactory",
    applies: (c) => !c.factoryDisabled,
    isDone: (c, baseline) => c.factories > baseline.factories,
  },
  {
    id: "factory_info",
    applies: (c) => !c.factoryDisabled,
    manual: true,
  },
  // Boats are free, so no earn-gold gating; done once one of ours is afloat.
  {
    id: "send_boat",
    applies: (c) => !c.boatsDisabled,
    isDone: (c) => c.boatSent,
  },
  {
    id: "buy_port",
    highlight: "port",
    unit: UnitType.Port,
    hotkey: "buildPort",
    applies: (c) => !c.portDisabled,
    isDone: (c, baseline) => c.ports > baseline.ports,
  },
  {
    id: "port_info",
    bullets: ["port_info_ships", "port_info_warships"],
    applies: (c) => !c.portDisabled,
    manual: true,
  },
  {
    id: "buy_defense_post",
    highlight: "defense_post",
    unit: UnitType.DefensePost,
    hotkey: "buildDefensePost",
    applies: (c) => !c.defensePostDisabled,
    isDone: (c, baseline) => c.defensePosts > baseline.defensePosts,
  },
  // Warships are built from ports, so this step needs one.
  {
    id: "buy_warship",
    highlight: "warship",
    unit: UnitType.Warship,
    hotkey: "buildWarship",
    applies: (c) => !c.warshipDisabled && !c.portDisabled,
    isDone: (c, baseline) => c.warships > baseline.warships,
  },
  {
    id: "buy_silo",
    highlight: "silo",
    unit: UnitType.MissileSilo,
    hotkey: "buildMissileSilo",
    applies: (c) => !c.siloDisabled,
    isDone: (c, baseline) => c.silos > baseline.silos,
  },
  // Waits (via the earn-gold text) until the bomb is affordable, then asks
  // for a launch; done as soon as one of ours is in flight.
  {
    id: "launch_atom",
    highlight: "atom",
    unit: UnitType.AtomBomb,
    hotkey: "buildAtomBomb",
    applies: (c) => !c.siloDisabled && !c.atomDisabled,
    isDone: (c) => c.atomLaunched,
  },
  // One stop per weapon, each highlighting its spot in the unit hotbar.
  {
    id: "atom_info",
    highlight: "atom",
    applies: (c) => !c.siloDisabled && !c.atomDisabled,
    manual: true,
  },
  {
    id: "hydrogen_info",
    highlight: "hydrogen",
    applies: (c) => !c.siloDisabled && !c.hydrogenDisabled,
    manual: true,
  },
  {
    id: "mirv_info",
    highlight: "mirv",
    applies: (c) => !c.siloDisabled && !c.mirvDisabled,
    manual: true,
  },
  {
    id: "sam_info",
    highlight: "sam",
    applies: (c) => !c.samDisabled,
    manual: true,
  },
  {
    id: "modern_regions",
    applies: (c) => Boolean(c.modern),
    isDone: (c) => Boolean(c.modern?.independent),
  },
  {
    id: "modern_population",
    applies: (c) => Boolean(c.modern),
    isDone: (c) => Boolean(c.modern?.equalPopulation),
  },
  {
    id: "modern_branches",
    applies: (c) => Boolean(c.modern),
    isDone: (c) =>
      ["army", "navy", "air"].every((branch) =>
        c.modern?.branchesUsed.includes(branch),
      ),
  },
  {
    id: "modern_select",
    applies: (c) => Boolean(c.modern),
    isDone: (c) => (c.modern?.selectionCount ?? 0) > 0,
  },
  {
    id: "modern_army_move",
    applies: (c) => Boolean(c.modern),
    isDone: (c, b) =>
      (c.modern?.armyMissions ?? 0) > (b.modern?.armyMissions ?? 0),
  },
  {
    id: "modern_stop",
    applies: (c) => Boolean(c.modern),
    isDone: (c, b) =>
      (c.modern?.completedStops ?? 0) > (b.modern?.completedStops ?? 0),
  },
  {
    id: "modern_navy_move",
    applies: (c) => Boolean(c.modern) && !c.portDisabled,
    isDone: (c, b) =>
      (c.modern?.navyMissions ?? 0) > (b.modern?.navyMissions ?? 0),
  },
  {
    id: "modern_airbase",
    applies: (c) => Boolean(c.modern),
    isDone: (c, b) => (c.modern?.airBases ?? 0) > (b.modern?.airBases ?? 0),
  },
  {
    id: "modern_air_launch",
    applies: (c) => Boolean(c.modern),
    isDone: (c, b) =>
      (c.modern?.airOutbounds ?? 0) > (b.modern?.airOutbounds ?? 0),
  },
  {
    id: "modern_air_return",
    applies: (c) => Boolean(c.modern),
    isDone: (c, b) =>
      (c.modern?.airReturns ?? 0) > (b.modern?.airReturns ?? 0) &&
      (c.modern?.airRearms ?? 0) > (b.modern?.airRearms ?? 0),
  },
  {
    id: "modern_air_intercept",
    applies: (c) => Boolean(c.modern),
    isDone: (c, b) =>
      (c.modern?.airCasualties ?? 0) > (b.modern?.airCasualties ?? 0),
  },
  {
    id: "modern_climate_compare",
    applies: (c) => Boolean(c.modern),
    isDone: (c, b) =>
      Boolean(
        c.modern?.climatePreviewAdapted && c.modern?.climatePreviewHarsh,
      ) &&
      (c.modern?.climateAdaptedBattles ?? 0) >
        (b.modern?.climateAdaptedBattles ?? 0) &&
      (c.modern?.climateHarshBattles ?? 0) >
        (b.modern?.climateHarshBattles ?? 0),
  },
  {
    id: "modern_climate_train",
    applies: (c) => Boolean(c.modern),
    isDone: (c, b) =>
      (c.modern?.completedTraining ?? 0) > (b.modern?.completedTraining ?? 0),
  },
  {
    id: "modern_mobilization",
    applies: (c) => Boolean(c.modern),
    isDone: (c, b) =>
      (c.modern?.armyCasualties ?? 0) > (b.modern?.armyCasualties ?? 0),
  },
  {
    id: "modern_port_capture",
    applies: (c) => Boolean(c.modern) && !c.portDisabled,
    isDone: (c, b) =>
      (c.modern?.portCaptures ?? 0) > (b.modern?.portCaptures ?? 0),
  },
  {
    id: "modern_port_develop",
    applies: (c) => Boolean(c.modern) && !c.portDisabled,
    isDone: (c, b) =>
      (c.modern?.portLevels ?? 0) > (b.modern?.portLevels ?? 0) &&
      (c.modern?.portIncome ?? 0) > (b.modern?.portIncome ?? 0),
  },
  {
    id: "modern_port_blockade",
    applies: (c) => Boolean(c.modern) && !c.portDisabled && !c.warshipDisabled,
    isDone: (c, b) =>
      (c.modern?.blockadesSeen ?? 0) > (b.modern?.blockadesSeen ?? 0),
  },
  {
    id: "modern_port_defend",
    applies: (c) => Boolean(c.modern) && !c.portDisabled && !c.warshipDisabled,
    isDone: (c) =>
      (c.modern?.blockadesSuffered ?? 0) > 0 &&
      (c.modern?.portRecoveries ?? 0) > 0,
  },
  {
    id: "modern_nuclear_penalty",
    applies: (c) => Boolean(c.modern) && !c.atomDisabled,
    isDone: (c, b) =>
      (c.modern?.nuclearLaunches ?? 0) > (b.modern?.nuclearLaunches ?? 0) &&
      (c.modern?.nuclearIncomeLoss ?? 0) > 0 &&
      (c.modern?.nuclearImpacts ?? 0) > (b.modern?.nuclearImpacts ?? 0),
  },
  {
    id: "modern_ai_levels",
    applies: (c) => Boolean(c.modern),
    isDone: (c) => Boolean(c.modern?.aiLevelsVisible),
  },
];

/** Ticks a completed step stays on screen (with its checkmark) before advancing. */
export const STEP_DONE_LINGER_TICKS = 15;

export const EDUCATION_VERSION = 3;
export const TUTORIAL_CHAPTERS = [
  {
    id: "basic",
    stepIds: [
      "spawn",
      "attack_wilderness",
      "troops",
      "troop_rate",
      "attack_ratio",
      "capture_tribes",
      "buy_city",
    ],
  },
  {
    id: "economy",
    stepIds: ["buy_city", "buy_factory", "factory_info", "buy_defense_post"],
  },
  {
    id: "naval",
    stepIds: ["send_boat", "buy_port", "port_info", "buy_warship"],
  },
  { id: "diplomacy", stepIds: ["propose_alliance", "alliance_info"] },
  {
    id: "weapons",
    stepIds: [
      "buy_silo",
      "launch_atom",
      "atom_info",
      "hydrogen_info",
      "mirv_info",
      "sam_info",
    ],
  },
  { id: "modern_regions", stepIds: ["modern_regions", "modern_population"] },
  {
    id: "modern_population",
    stepIds: ["modern_population", "modern_mobilization"],
  },
  {
    id: "modern_commands",
    stepIds: [
      "modern_branches",
      "modern_select",
      "modern_army_move",
      "modern_stop",
      "modern_navy_move",
    ],
  },
  {
    id: "modern_air",
    stepIds: [
      "modern_airbase",
      "modern_air_launch",
      "modern_air_return",
      "modern_air_intercept",
    ],
  },
  {
    id: "modern_climate",
    stepIds: ["modern_climate_compare", "modern_climate_train"],
  },
  {
    id: "modern_ports",
    stepIds: [
      "modern_port_capture",
      "modern_port_develop",
      "modern_port_blockade",
      "modern_port_defend",
    ],
  },
  { id: "modern_nuclear", stepIds: ["modern_nuclear_penalty"] },
  { id: "modern_ai", stepIds: ["modern_ai_levels"] },
  { id: "full", stepIds: TUTORIAL_STEPS.map((step) => step.id) },
] as const;
export type TutorialChapterID = (typeof TUTORIAL_CHAPTERS)[number]["id"];
export type TutorialOutcome = "practiced" | "read" | "skipped" | "unavailable";
export interface TutorialProgressSnapshot {
  version: number;
  stepId: string | null;
  outcomes: Record<string, TutorialOutcome>;
  doneTicks?: number | null;
  baseline?: TutorialEvidence;
}
type TutorialEvidence = Pick<
  TutorialContext,
  | "tilesOwned"
  | "conqueredPlayers"
  | "cities"
  | "factories"
  | "ports"
  | "defensePosts"
  | "warships"
  | "silos"
  | "modern"
>;

export function chapterSteps(id: TutorialChapterID): readonly TutorialStep[] {
  const chapter = TUTORIAL_CHAPTERS.find((c) => c.id === id)!;
  return chapter.stepIds.map(
    (stepId) => TUTORIAL_STEPS.find((s) => s.id === stepId)!,
  );
}

/**
 * Cursor over the step list. Pure: feed it a context once per tick and read
 * back the current step. Steps whose `applies` is false for the current
 * context are skipped, so the visible count adapts to the game's config.
 */
export class TutorialProgress {
  private index = 0;
  /** Ticks since the current step completed, or null while it's pending. */
  private doneTicks: number | null = null;
  /**
   * Context snapshot used only for the step counter, taken on the first
   * update after the player has spawned (bots and nations all exist by
   * then). Bots/nations dying mid-game would otherwise shrink "Step n of N"
   * while the player is parked on an unrelated step; progression (skipping,
   * isDone) always uses the live context.
   */
  private countCtx: TutorialContext | null = null;
  private baseline: TutorialContext | null = null;
  private restoredBaseline: TutorialEvidence | null = null;
  private outcomes: Record<string, TutorialOutcome> = {};

  constructor(
    private readonly steps: readonly TutorialStep[] = TUTORIAL_STEPS,
  ) {}

  current(): TutorialStep | null {
    return this.steps[this.index] ?? null;
  }

  finished(): boolean {
    return this.index >= this.steps.length;
  }

  stepDone(): boolean {
    return this.doneTicks !== null;
  }

  result(): Readonly<Record<string, TutorialOutcome>> {
    return this.outcomes;
  }

  snapshot(): TutorialProgressSnapshot {
    const baseline = this.baseline;
    return {
      version: EDUCATION_VERSION,
      stepId: this.current()?.id ?? null,
      outcomes: { ...this.outcomes },
      doneTicks: this.doneTicks,
      baseline: baseline
        ? {
            tilesOwned: baseline.tilesOwned,
            conqueredPlayers: baseline.conqueredPlayers,
            cities: baseline.cities,
            factories: baseline.factories,
            ports: baseline.ports,
            defensePosts: baseline.defensePosts,
            warships: baseline.warships,
            silos: baseline.silos,
            modern: baseline.modern,
          }
        : undefined,
    };
  }

  /** Reject a different course version; the caller can retain the original file. */
  restore(snapshot: TutorialProgressSnapshot): boolean {
    if (
      !snapshot ||
      (snapshot.version !== EDUCATION_VERSION && snapshot.version !== 2) ||
      !snapshot.outcomes ||
      typeof snapshot.outcomes !== "object" ||
      Array.isArray(snapshot.outcomes)
    )
      return false;
    if (
      snapshot.baseline &&
      Object.values(snapshot.baseline).some(
        (value) =>
          typeof value === "number" &&
          (!Number.isSafeInteger(value) || value < 0),
      )
    )
      return false;
    if (
      snapshot.baseline?.modern &&
      !validModernEvidence(snapshot.baseline.modern)
    )
      return false;
    const index =
      snapshot.stepId === null
        ? this.steps.length
        : this.steps.findIndex((s) => s.id === snapshot.stepId);
    if (index < 0) return false;
    this.index = index;
    this.outcomes = Object.fromEntries(
      Object.entries(snapshot.outcomes).filter(
        ([id, outcome]) =>
          this.steps.some((s) => s.id === id) &&
          ["practiced", "read", "skipped", "unavailable"].includes(outcome),
      ),
    );
    this.doneTicks =
      this.outcomes[snapshot.stepId ?? ""] === "practiced" ||
      this.outcomes[snapshot.stepId ?? ""] === "read"
        ? 0
        : null;
    this.baseline = null;
    this.restoredBaseline = snapshot.baseline ?? null;
    return true;
  }

  /** 1-based position of the current step among the steps that apply. */
  position(ctx: TutorialContext): number {
    return this.applicable(this.countCtx ?? ctx, this.index) + 1;
  }

  total(ctx: TutorialContext): number {
    return this.applicable(this.countCtx ?? ctx, this.steps.length);
  }

  /** Completes the current step if it's an informational ("Got it") one. */
  acknowledge(): void {
    const step = this.current();
    if (step?.manual && this.doneTicks === null) {
      this.doneTicks = 0;
      this.outcomes[step.id] = "read";
    }
  }

  /** Moves past the current step without completing it. */
  skip(): void {
    if (this.finished()) return;
    this.outcomes[this.current()!.id] =
      this.doneTicks === null ? "skipped" : this.outcomes[this.current()!.id];
    this.index++;
    this.doneTicks = null;
    this.baseline = null;
    this.restoredBaseline = null;
  }

  update(ctx: TutorialContext): void {
    if (this.countCtx === null && ctx.hasSpawned) this.countCtx = ctx;
    if (this.doneTicks !== null) {
      this.doneTicks++;
      if (this.doneTicks < STEP_DONE_LINGER_TICKS) return;
      this.index++;
      this.doneTicks = null;
      this.baseline = null;
      this.restoredBaseline = null;
    }
    while (!this.finished() && !this.stepApplies(this.index, ctx)) {
      this.outcomes[this.current()!.id] = "unavailable";
      this.index++;
      this.baseline = null;
      this.restoredBaseline = null;
    }
    const step = this.current();
    this.baseline ??= { ...ctx, ...this.restoredBaseline };
    if (step?.isDone?.(ctx, this.baseline)) {
      this.doneTicks = 0;
      this.outcomes[step.id] = "practiced";
    }
  }

  private stepApplies(i: number, ctx: TutorialContext): boolean {
    return this.steps[i].applies?.(ctx) ?? true;
  }

  private applicable(ctx: TutorialContext, before: number): number {
    let n = 0;
    for (let i = 0; i < before; i++) {
      if (this.stepApplies(i, ctx)) n++;
    }
    return n;
  }
}
