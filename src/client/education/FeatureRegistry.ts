import { UnitType } from "../../core/game/Game";
import { TutorialChapterID } from "../hud/Tutorial";

export type EducationMode = "classic" | "modern" | "training" | "multiplayer";
export interface EducationFeature {
  featureId: string;
  chapter: TutorialChapterID | "reference" | "modern";
  modes: readonly EducationMode[];
  intents: readonly string[];
  units: readonly UnitType[];
  settings: readonly string[];
  tutorialSteps: readonly string[];
  /** Practice requires simulation evidence; reference entries only explain. */
  kind: "practice" | "reference";
  helpAnchor: string;
}

function feature(
  featureId: string,
  chapter: EducationFeature["chapter"],
  intents: string[] = [],
  units: UnitType[] = [],
  settings: string[] = [],
  tutorialSteps: string[] = [],
  modes: EducationMode[] = ["classic", "modern", "training", "multiplayer"],
): EducationFeature {
  return {
    featureId,
    chapter,
    intents,
    units,
    settings,
    tutorialSteps,
    modes,
    kind: tutorialSteps.length ? "practice" : "reference",
    helpAnchor: `feature-${featureId}`,
  };
}

/** Public UI inventory. Descriptions/prerequisites/exercises are translation keys
 * `education.features.<featureId>.*`, shared by help and curriculum validation.
 * Existing prices and ranges remain sourced from the active worker/config UI. */
export const EDUCATION_FEATURES: readonly EducationFeature[] = [
  feature(
    "spawn",
    "basic",
    ["spawn"],
    [],
    ["randomSpawn", "spawnImmunityDuration", "startDelay"],
    ["spawn"],
  ),
  feature("camera", "reference"),
  feature("identity", "reference"),
  feature(
    "resources",
    "basic",
    [],
    [],
    [
      "startingGold",
      "goldMultiplier",
      "infiniteGold",
      "infiniteTroops",
      "hostCheats",
    ],
    ["troops", "troop_rate"],
  ),
  feature(
    "attack",
    "basic",
    ["attack"],
    [],
    [],
    ["attack_wilderness", "capture_tribes"],
  ),
  feature("attack_ratio", "basic", [], [], [], ["attack_ratio"]),
  feature("retreat", "reference", ["cancel_attack"]),
  feature("fronts", "reference"),
  feature("city", "economy", ["build_unit"], [UnitType.City], [], ["buy_city"]),
  feature(
    "defense",
    "economy",
    [],
    [UnitType.DefensePost],
    [],
    ["buy_defense_post"],
  ),
  feature(
    "factory",
    "economy",
    [],
    [UnitType.Factory, UnitType.Train],
    [],
    ["buy_factory", "factory_info"],
  ),
  feature("upgrade", "reference", ["upgrade_structure"], [], ["instantBuild"]),
  feature("delete", "reference", ["delete_unit"]),
  feature(
    "transport",
    "naval",
    ["boat", "cancel_boat"],
    [UnitType.TransportShip],
    [],
    ["send_boat"],
  ),
  feature("port", "naval", [], [UnitType.Port], [], ["buy_port", "port_info"]),
  feature("trade", "reference", [], [UnitType.TradeShip]),
  feature(
    "warship",
    "naval",
    ["move_warship"],
    [UnitType.Warship, UnitType.Shell],
    [],
    ["buy_warship"],
  ),
  feature(
    "alliance",
    "diplomacy",
    ["allianceRequest", "allianceReject", "allianceExtension", "breakAlliance"],
    [],
    ["disableAlliances", "customAllianceDuration"],
    ["propose_alliance", "alliance_info"],
  ),
  feature(
    "support",
    "reference",
    ["donate_gold", "donate_troops"],
    [],
    ["donateGold", "donateTroops"],
  ),
  feature("embargo", "reference", ["embargo", "embargo_all"]),
  feature("target", "reference", ["targetPlayer"]),
  feature("communication", "reference", ["emoji", "quick_chat"]),
  feature("silo", "weapons", [], [UnitType.MissileSilo], [], ["buy_silo"]),
  feature(
    "nukes",
    "weapons",
    [],
    [
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRV,
      UnitType.MIRVWarhead,
    ],
    ["waterNukes"],
    ["launch_atom", "atom_info", "hydrogen_info", "mirv_info"],
  ),
  feature(
    "sam",
    "weapons",
    [],
    [UnitType.SAMLauncher, UnitType.SAMMissile],
    [],
    ["sam_info"],
  ),
  feature(
    "modes",
    "reference",
    [],
    [],
    [
      "gameType",
      "gameMode",
      "playerTeams",
      "gameMap",
      "gameMapSize",
      "maxPlayers",
      "rankedType",
      "training",
    ],
  ),
  feature(
    "ai",
    "reference",
    [],
    [],
    ["bots", "nations", "difficulty", "enhancedAI"],
  ),
  feature(
    "lobby",
    "reference",
    ["update_game_config", "toggle_game_start_timer", "kick_player"],
    [],
    ["anonymizeNames", "disableClanTags"],
    [],
    ["multiplayer"],
  ),
  feature(
    "rules",
    "reference",
    [],
    [],
    ["disabledUnits", "maxTimerValue", "publicGameModifiers"],
  ),
  feature("doomsday", "reference", [], [], ["doomsdayClock", "overtime"]),
  feature("spectator", "reference", [], [], [], [], ["multiplayer"]),
  feature("keybindings", "reference"),
  feature("mobile", "reference"),
  feature("accessibility", "reference"),
  feature("audio", "reference"),
  feature("pause_speed", "reference", ["toggle_pause"]),
  feature(
    "save",
    "reference",
    [],
    [],
    [],
    [],
    ["classic", "modern", "training"],
  ),
  feature("replay", "reference"),
  feature("results", "reference"),
  feature("account", "reference"),
  feature("profile", "reference"),
  feature("clan", "reference"),
  feature("statistics", "reference"),
  feature("cosmetics", "reference"),
  feature(
    "modern",
    "modern",
    [],
    [],
    [
      "modernMode",
      "modernMode.scenario",
      "modernMode.balance",
      "modernMode.victory",
      "modernMode.targetPercent",
      "modernMode.protectionTicks",
      "modernMode.capitalElimination",
      "modernMode.trainingLesson",
    ],
    [],
    ["modern"],
  ),
  feature(
    "modern_regions",
    "modern_regions",
    [],
    [],
    ["modernMode.countryId", "modernMode.factionId"],
    ["modern_regions"],
    ["modern"],
  ),
  feature(
    "modern_population",
    "modern_population",
    ["modern_produce"],
    [],
    ["modernMode.initialPopulation"],
    ["modern_population", "modern_mobilization"],
    ["modern"],
  ),
  feature(
    "modern_commands",
    "modern_commands",
    ["modern_command"],
    [],
    [],
    [
      "modern_camera",
      "modern_branches",
      "modern_select",
      "modern_box_select",
      "modern_cursor",
      "modern_army_move",
      "modern_queue",
      "modern_stop",
      "modern_armybase",
      "modern_army_train",
      "modern_navybase",
      "modern_navy_move",
    ],
    ["modern"],
  ),
  feature(
    "modern_air",
    "modern_air",
    [],
    [],
    [],
    [
      "modern_airbase",
      "modern_air_produce",
      "modern_air_launch",
      "modern_air_return",
      "modern_air_intercept",
    ],
    ["modern"],
  ),
  feature(
    "modern_climate",
    "modern_climate",
    ["modern_train"],
    [],
    [],
    ["modern_climate_compare", "modern_climate_train"],
    ["modern"],
  ),
  feature(
    "modern_ports",
    "modern_ports",
    ["modern_develop", "modern_repair"],
    [],
    [],
    [
      "modern_port_capture",
      "modern_port_develop",
      "modern_port_blockade",
      "modern_port_defend",
    ],
    ["modern"],
  ),
  feature(
    "modern_nuclear",
    "modern_nuclear",
    [],
    [],
    [],
    ["modern_nuclear_penalty"],
    ["modern"],
  ),
  feature(
    "modern_ai",
    "modern_ai",
    [],
    [],
    [
      "modernMode.aiLevelWeights",
      "modernMode.participantSlots",
      "modernMode.fillEmptySlots",
    ],
    ["modern_ai_levels"],
    ["modern", "multiplayer"],
  ),
];

/** No public UI: protocol plumbing, admin-only integration, host-private data. */
export const INTERNAL_GAME_CONFIG_KEYS: Readonly<Record<string, string>> = {
  disableNavMesh: "Developer pathfinding switch",
  liveStatsEnabled: "Admin bot telemetry; no public UI",
  nameReveals: "Server-managed observer permissions",
  nameRevealPublicIds: "Admin observer permission input",
  allowedPublicIds: "Admin-only tournament allowlist",
  trusted: "API trust gate; no public host UI",
  pool: "Private sibling lobby credentials",
};
export const INTERNAL_INTENTS = ["mark_disconnected"] as const;
export const INTERNAL_MODERN_CONFIG_KEYS: Readonly<Record<string, string>> = {
  version: "Scenario compatibility metadata, never chosen independently",
  dataHash: "Pinned offline scenario checksum",
};

/** Every public configurable keyboard action is discoverable under this entry.
 * Help reads the current effective bindings, including unassigned actions. */
export const KEYBIND_FEATURE_ID = "keybindings";

export function searchEducationFeatures(
  query: string,
  translate: (key: string) => string,
  chapter = "all",
): readonly EducationFeature[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return EDUCATION_FEATURES.filter((feature) => {
    if (chapter !== "all" && feature.chapter !== chapter) return false;
    const text = [
      feature.featureId,
      ...[
        "title",
        "description",
        "prerequisites",
        "exercise",
        "completion",
      ].map((part) =>
        translate(`education.features.${feature.featureId}.${part}`),
      ),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}
