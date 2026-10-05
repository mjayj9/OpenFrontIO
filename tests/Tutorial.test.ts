import {
  chapterSteps,
  ModernTutorialEvidence,
  STEP_DONE_LINGER_TICKS,
  TUTORIAL_STEPS,
  TutorialContext,
  TutorialProgress,
} from "../src/client/hud/Tutorial";

function ctx(overrides: Partial<TutorialContext> = {}): TutorialContext {
  return {
    hasSpawned: false,
    inSpawnPhase: false,
    attacking: false,
    tilesOwned: 0,
    conqueredPlayers: 0,
    attackRatioMoved: false,
    boatsDisabled: false,
    boatSent: false,
    botsExist: true,
    nationsExist: true,
    alliancesDisabled: false,
    allied: false,
    gold: 0n,
    cityCost: null,
    cityDisabled: false,
    cities: 0,
    portDisabled: false,
    ports: 0,
    defensePostDisabled: false,
    defensePosts: 0,
    factoryDisabled: false,
    factories: 0,
    warshipDisabled: false,
    warships: 0,
    siloDisabled: false,
    silos: 0,
    atomDisabled: false,
    siloReady: false,
    atomLaunched: false,
    hydrogenDisabled: false,
    mirvDisabled: false,
    samDisabled: false,
    ...overrides,
  };
}

// Feed the same context until the completed step has lingered and advanced.
function settle(progress: TutorialProgress, c: TutorialContext) {
  for (let i = 0; i <= STEP_DONE_LINGER_TICKS; i++) progress.update(c);
}

describe("TutorialProgress", () => {
  it("credits a tribe conquered during early expansion even after the last tribe is gone", () => {
    const p = new TutorialProgress(chapterSteps("basic"));
    const initial = ctx({ hasSpawned: true, tilesOwned: 1200 });
    settle(p, initial);
    expect(p.current()?.id).toBe("attack_wilderness");
    const conquered = {
      ...initial,
      tilesOwned: 1320,
      conqueredPlayers: 1,
      botsExist: false,
    };
    settle(p, conquered);
    expect(p.current()?.id).toBe("troops");
    p.acknowledge();
    settle(p, conquered);
    expect(p.current()?.id).toBe("troop_rate");
    p.acknowledge();
    settle(p, conquered);
    expect(p.current()?.id).toBe("attack_ratio");
    settle(p, { ...conquered, attackRatioMoved: true });
    expect(p.current()?.id).toBe("capture_tribes");
    settle(p, conquered);
    expect(p.current()?.id).toBe("buy_city");
    settle(p, { ...conquered, cities: 1 });
    expect(p.finished()).toBe(true);
    expect(
      Object.values(p.result()).filter((outcome) => outcome === "practiced"),
    ).toHaveLength(5);
    expect(
      Object.values(p.result()).filter((outcome) => outcome === "read"),
    ).toHaveLength(2);
    expect(p.result().capture_tribes).toBe("practiced");
  });

  it("keeps conquest practice independent of city availability and skips an absent unpracticed target", () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === "capture_tribes")!;
    const disabledCity = new TutorialProgress([step]);
    disabledCity.update(ctx({ cityDisabled: true }));
    expect(disabledCity.result()).toEqual({});
    disabledCity.update(ctx({ cityDisabled: true, conqueredPlayers: 1 }));
    expect(disabledCity.result().capture_tribes).toBe("practiced");
    const missingTarget = new TutorialProgress([step]);
    missingTarget.update(ctx({ botsExist: false }));
    expect(missingTarget.finished()).toBe(true);
    expect(missingTarget.result().capture_tribes).toBe("unavailable");
  });

  it("walks the steps in order as the player acts", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(false);

    p.update(ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(true);

    settle(p, ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");

    settle(p, ctx({ hasSpawned: true, attacking: true, tilesOwned: 1 }));
    expect(p.current()?.id).toBe("troops");

    p.acknowledge();
    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("troop_rate");
    p.acknowledge();
    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("attack_ratio");
    // Completed by moving the slider, which only shows up for a single tick.
    p.update(
      ctx({ hasSpawned: true, attacking: true, attackRatioMoved: true }),
    );
    expect(p.stepDone()).toBe(true);
    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("capture_tribes");

    settle(
      p,
      ctx({
        hasSpawned: true,
        attacking: true,
        gold: 125_000n,
        cityCost: 125_000n,
        conqueredPlayers: 1,
      }),
    );
    expect(p.current()?.id).toBe("buy_city");
  });

  it("holds the spawn step until the multiplayer spawn timer ends", () => {
    const p = new TutorialProgress();
    // Spot picked, but the spawn phase is still running: stay put.
    for (let i = 0; i < 100; i++) {
      p.update(ctx({ hasSpawned: true, inSpawnPhase: true }));
    }
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(false);

    settle(p, ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");
  });

  it("lingers on a completed step before advancing", () => {
    const p = new TutorialProgress();
    p.update(ctx({ hasSpawned: true }));
    for (let i = 1; i < STEP_DONE_LINGER_TICKS; i++) {
      p.update(ctx({ hasSpawned: true }));
      expect(p.current()?.id).toBe("spawn");
    }
    p.update(ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");
  });

  it("only advances informational steps on acknowledge", () => {
    const p = new TutorialProgress();
    const c = ctx({ hasSpawned: true, attacking: true });
    settle(p, c);
    settle(p, { ...c, tilesOwned: 1 });
    expect(p.current()?.id).toBe("troops");

    for (let i = 0; i < 100; i++) p.update(c);
    expect(p.current()?.id).toBe("troops");
    expect(p.stepDone()).toBe(false);

    p.acknowledge();
    expect(p.stepDone()).toBe(true);
    settle(p, c);
    expect(p.current()?.id).toBe("troop_rate");
  });

  it("ignores acknowledge on action steps", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    p.acknowledge();
    expect(p.stepDone()).toBe(false);
  });

  it("skips steps that don't apply to the game and counts only the rest", () => {
    const p = new TutorialProgress();
    const c = ctx({
      hasSpawned: true,
      attacking: true,
      boatsDisabled: true,
      botsExist: false,
      nationsExist: false,
      cityDisabled: true,
      portDisabled: true,
      defensePostDisabled: true,
      factoryDisabled: true,
      warshipDisabled: true,
      siloDisabled: true,
      atomDisabled: true,
      hydrogenDisabled: true,
      mirvDisabled: true,
      samDisabled: true,
    });
    expect(p.total(c)).toBe(
      TUTORIAL_STEPS.filter((step) => !step.id.startsWith("modern_")).length -
        17,
    );

    settle(p, c);
    settle(p, { ...c, tilesOwned: 1 });
    expect(p.current()?.id).toBe("troops");
    expect(p.position(c)).toBe(3);

    p.acknowledge();
    settle(p, c);
    expect(p.current()?.id).toBe("troop_rate");
    expect(p.position(c)).toBe(4);
    p.acknowledge();
    settle(p, c);
    expect(p.current()?.id).toBe("attack_ratio");
    p.update({ ...c, attackRatioMoved: true });
    settle(p, c);
    expect(p.finished()).toBe(true);
    expect(p.current()).toBeNull();
  });

  it("asks for an alliance after the city, then explains traitors", () => {
    const first = TUTORIAL_STEPS.findIndex((s) => s.id === "propose_alliance");
    const p = new TutorialProgress(TUTORIAL_STEPS.slice(first));
    p.update(ctx());
    expect(p.current()?.id).toBe("propose_alliance");
    expect(p.current()?.highlight).toBe("nation");

    settle(p, ctx({ allied: true }));
    expect(p.current()?.id).toBe("alliance_info");
    p.acknowledge();
    settle(p, ctx({ allied: true }));
    expect(p.current()?.id).toBe("buy_factory");

    // Without nations (or with alliances off) both steps are skipped.
    const q = new TutorialProgress(TUTORIAL_STEPS.slice(first));
    q.update(ctx({ nationsExist: false }));
    expect(q.current()?.id).toBe("buy_factory");
  });

  it("requires real conquest and a completed city rather than earned gold or a sent attack", () => {
    const p = new TutorialProgress([
      TUTORIAL_STEPS.find((s) => s.id === "capture_tribes")!,
      TUTORIAL_STEPS.find((s) => s.id === "buy_city")!,
    ]);
    p.update(ctx({ gold: 500_000n, cityCost: null }));
    expect(p.stepDone()).toBe(false);

    p.update(ctx({ gold: 100_000n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(false);

    p.update(ctx({ gold: 125_000n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(false);
    p.update(ctx({ conqueredPlayers: 1 }));
    expect(p.stepDone()).toBe(true);
    settle(p, ctx({ conqueredPlayers: 1 }));
    expect(p.current()?.id).toBe("buy_city");

    // Spending the gold elsewhere doesn't complete the step; the city does.
    p.update(ctx({ gold: 0n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(false);
    p.update(ctx({ gold: 0n, cityCost: 250_000n, cities: 1 }));
    expect(p.stepDone()).toBe(true);
  });

  it("runs city, factory, port, warship, silo, pausing on each info step", () => {
    const first = TUTORIAL_STEPS.findIndex((s) => s.id === "buy_factory");
    const p = new TutorialProgress(TUTORIAL_STEPS.slice(first));
    p.update(ctx());
    expect(p.current()?.id).toBe("buy_factory");

    settle(p, ctx({ factories: 1 }));
    expect(p.current()?.id).toBe("factory_info");
    for (let i = 0; i < 50; i++) p.update(ctx({ factories: 1 }));
    expect(p.current()?.id).toBe("factory_info");
    p.acknowledge();
    settle(p, ctx({ factories: 1 }));

    expect(p.current()?.id).toBe("send_boat");
    settle(p, ctx({ factories: 1, boatSent: true }));

    expect(p.current()?.id).toBe("buy_port");
    expect(p.current()?.highlight).toBe("port");
    settle(p, ctx({ factories: 1, ports: 1 }));
    expect(p.current()?.id).toBe("port_info");
    expect(p.current()?.bullets).toHaveLength(2);
    p.acknowledge();
    settle(p, ctx({ factories: 1, ports: 1 }));

    expect(p.current()?.id).toBe("buy_defense_post");
    expect(p.current()?.highlight).toBe("defense_post");
    settle(p, ctx({ factories: 1, ports: 1, defensePosts: 1 }));

    expect(p.current()?.id).toBe("buy_warship");
    expect(p.current()?.highlight).toBe("warship");
    settle(p, ctx({ factories: 1, ports: 1, warships: 1 }));

    expect(p.current()?.id).toBe("buy_silo");
    expect(p.current()?.highlight).toBe("silo");
    p.update(ctx({ factories: 1, ports: 1, warships: 1 }));
    expect(p.stepDone()).toBe(false);
    settle(p, ctx({ factories: 1, ports: 1, warships: 1, silos: 1 }));

    expect(p.current()?.id).toBe("launch_atom");
    expect(p.current()?.highlight).toBe("atom");
    settle(p, ctx({ silos: 1, atomLaunched: true }));

    for (const [id, highlight] of [
      ["atom_info", "atom"],
      ["hydrogen_info", "hydrogen"],
      ["mirv_info", "mirv"],
      ["sam_info", "sam"],
    ]) {
      expect(p.current()?.id).toBe(id);
      expect(p.current()?.highlight).toBe(highlight);
      p.acknowledge();
      settle(p, ctx({ silos: 1 }));
    }
    expect(p.finished()).toBe(true);
  });
});
describe("Modern lessons require actual simulation evidence", () => {
  const modern = (
    patch: Partial<ModernTutorialEvidence> = {},
  ): ModernTutorialEvidence => ({
    independent: true,
    equalPopulation: true,
    branchesUsed: [],
    selectionCount: 0,
    armyMissions: 0,
    navyMissions: 0,
    airMissions: 0,
    airOutbounds: 0,
    airReturns: 0,
    airRearms: 0,
    airCasualties: 0,
    airBases: 1,
    completedTraining: 0,
    armyCasualties: 0,
    portCaptures: 0,
    portLevels: 0,
    portIncome: 0,
    blockadesSeen: 0,
    nuclearLaunches: 0,
    nuclearIncomeLoss: 0,
    completedStops: 0,
    climatePreviewAdapted: false,
    climatePreviewHarsh: false,
    climateAdaptedBattles: 0,
    climateHarshBattles: 0,
    aiLevelsVisible: false,
    ...patch,
  });
  it.each([
    ["modern_camera", { cameraMoves: 1, zoomChanges: 1 }],
    ["modern_box_select", { boxSelections: 1, additionalSelections: 1 }],
    ["modern_cursor", { cursorPreviews: 1 }],
    ["modern_queue", { queuedOrders: 1, armyMissions: 1 }],
    ["modern_armybase", { armyBasesCompleted: 1 }],
    ["modern_army_train", { armyTrained: 1 }],
    ["modern_navybase", { navalBasesCompleted: 1 }],
    ["modern_air_produce", { aircraftProduced: 1 }],
    ["modern_army_move", { armyMissions: 1 }],
    ["modern_navy_move", { navyMissions: 1 }],
    ["modern_stop", { completedStops: 1 }],
    ["modern_airbase", { airBases: 2 }],
    ["modern_air_launch", { airOutbounds: 1 }],
    ["modern_air_return", { airReturns: 1, airRearms: 1 }],
    ["modern_air_intercept", { airCasualties: 1 }],
    ["modern_climate_train", { completedTraining: 1 }],
    ["modern_mobilization", { armyCasualties: 1 }],
    ["modern_port_capture", { portCaptures: 1 }],
    ["modern_port_develop", { portLevels: 1, portIncome: 200 }],
    ["modern_port_blockade", { blockadesSeen: 1 }],
    ["modern_port_defend", { blockadesSuffered: 1, portRecoveries: 1 }],
    [
      "modern_nuclear_penalty",
      { nuclearLaunches: 1, nuclearIncomeLoss: 150, nuclearImpacts: 1 },
    ],
  ] as const)(
    "%s cannot be completed by acknowledging text or unchanged state",
    (id, change) => {
      const progress = new TutorialProgress([
        TUTORIAL_STEPS.find((step) => step.id === id)!,
      ]);
      progress.update(ctx({ modern: modern() }));
      progress.acknowledge();
      progress.update(ctx({ modern: modern() }));
      expect(progress.stepDone()).toBe(false);
      progress.update(ctx({ modern: modern(change) }));
      expect(progress.result()[id]).toBe("practiced");
    },
  );
  it("requires the student's actual nuclear impact as well as launch responsibility", () => {
    const progress = new TutorialProgress([
      TUTORIAL_STEPS.find((step) => step.id === "modern_nuclear_penalty")!,
    ]);
    progress.update(ctx({ modern: modern() }));
    progress.update(
      ctx({
        modern: modern({
          nuclearLaunches: 1,
          nuclearIncomeLoss: 150,
          armyCasualties: 1000,
        }),
      }),
    );
    expect(progress.stepDone()).toBe(false);
    progress.update(
      ctx({
        modern: modern({
          nuclearLaunches: 1,
          nuclearIncomeLoss: 150,
          nuclearImpacts: 1,
        }),
      }),
    );
    expect(progress.stepDone()).toBe(true);
  });

  it("requires two real climate exchanges as well as both public previews", () => {
    const progress = new TutorialProgress([
      TUTORIAL_STEPS.find((step) => step.id === "modern_climate_compare")!,
    ]);
    progress.update(ctx({ modern: modern() }));
    progress.update(
      ctx({
        modern: modern({
          climatePreviewAdapted: true,
          climatePreviewHarsh: true,
          armyCasualties: 10,
        }),
      }),
    );
    expect(progress.stepDone()).toBe(false);
    progress.update(
      ctx({
        modern: modern({
          climatePreviewAdapted: true,
          climatePreviewHarsh: true,
          climateAdaptedBattles: 1,
          climateHarshBattles: 1,
        }),
      }),
    );
    expect(progress.stepDone()).toBe(true);
  });
  it("preserves modern practice baseline across saves and rejects corrupt evidence", () => {
    const step = TUTORIAL_STEPS.find(
      (entry) => entry.id === "modern_air_intercept",
    )!;
    const progress = new TutorialProgress([step]);
    progress.update(ctx({ modern: modern({ airCasualties: 2 }) }));
    const saved = progress.snapshot(),
      restored = new TutorialProgress([step]);
    expect(restored.restore(saved)).toBe(true);
    restored.update(ctx({ modern: modern({ airCasualties: 2 }) }));
    expect(restored.stepDone()).toBe(false);
    restored.update(ctx({ modern: modern({ airCasualties: 3 }) }));
    expect(restored.stepDone()).toBe(true);
    expect(
      new TutorialProgress([step]).restore({
        ...saved,
        baseline: { ...saved.baseline!, modern: modern({ airCasualties: -1 }) },
      }),
    ).toBe(false);
  });
});

describe("TutorialProgress.skip", () => {
  it("moves past the current step without completing it", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    expect(p.current()?.id).toBe("spawn");

    p.skip();
    expect(p.stepDone()).toBe(false);
    p.update(ctx());
    expect(p.current()?.id).toBe("attack_wilderness");

    // Skipping lands on the next *applicable* step.
    p.skip();
    p.update(ctx({ botsExist: false }));
    expect(p.current()?.id).toBe("troops");
    p.skip();
    p.skip();
    p.skip();
    p.update(ctx({ botsExist: false, cityDisabled: true }));
    expect(p.current()?.id).toBe("propose_alliance");
  });

  it("can skip through to the end", () => {
    const p = new TutorialProgress();
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) p.skip();
    p.update(ctx());
    expect(p.finished()).toBe(true);
    p.skip();
    expect(p.finished()).toBe(true);
  });
});

describe("TutorialProgress step counter", () => {
  it("doesn't shrink when bots or nations die off mid-tutorial", () => {
    const p = new TutorialProgress();
    // Pre-spawn ticks (nothing spawned yet) must not freeze the counter.
    p.update(ctx({ botsExist: false, nationsExist: false }));
    const before = ctx({ hasSpawned: true });
    p.update(before);
    const total = p.total(before);
    expect(total).toBe(
      TUTORIAL_STEPS.filter((step) => !step.id.startsWith("modern_")).length,
    );

    const after = ctx({
      hasSpawned: true,
      botsExist: false,
      nationsExist: false,
    });
    p.update(after);
    expect(p.total(after)).toBe(total);
    expect(p.position(after)).toBeGreaterThanOrEqual(1);
  });
});

describe("TutorialProgress evidence and outcomes", () => {
  it("reopens newly introduced exercises while preserving old recorded outcomes", () => {
    const steps = chapterSteps("modern_commands");
    const outcomes = Object.fromEntries(
      [
        "modern_branches",
        "modern_select",
        "modern_army_move",
        "modern_stop",
        "modern_navy_move",
      ].map((id) => [id, "practiced" as const]),
    );
    const progress = new TutorialProgress(steps);
    expect(progress.restore({ version: 3, stepId: null, outcomes })).toBe(true);
    expect(progress.finished()).toBe(false);
    expect(progress.current()?.id).toBe("modern_camera");
    expect(progress.result().modern_army_move).toBe("practiced");
    progress.acknowledge();
    expect(progress.result().modern_camera).toBeUndefined();
  });
  it("does not mark attack launch as successful land capture", () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === "attack_wilderness")!;
    const progress = new TutorialProgress([step]);
    progress.update(ctx({ tilesOwned: 50 }));
    progress.update(ctx({ tilesOwned: 50, attacking: true }));
    expect(progress.stepDone()).toBe(false);
    progress.acknowledge();
    expect(progress.stepDone()).toBe(false);
    progress.update(ctx({ tilesOwned: 51, attacking: false }));
    expect(progress.stepDone()).toBe(true);
    expect(progress.result().attack_wilderness).toBe("practiced");
  });

  it("repeated construction requires a new completed facility", () => {
    const progress = new TutorialProgress([
      TUTORIAL_STEPS.find((s) => s.id === "buy_city")!,
    ]);
    progress.update(ctx({ cities: 2 }));
    progress.update(ctx({ cities: 2, gold: 1_000_000n }));
    expect(progress.stepDone()).toBe(false);
    progress.update(ctx({ cities: 3 }));
    expect(progress.stepDone()).toBe(true);
  });

  it("retains the practical baseline through save and restore", () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === "attack_wilderness")!;
    const progress = new TutorialProgress([step]);
    progress.update(ctx({ tilesOwned: 50 }));
    const restored = new TutorialProgress([step]);
    expect(restored.restore(progress.snapshot())).toBe(true);
    restored.update(ctx({ tilesOwned: 51 }));
    expect(restored.stepDone()).toBe(true);
    const completed = new TutorialProgress([step]);
    expect(completed.restore(restored.snapshot())).toBe(true);
    expect(completed.stepDone()).toBe(true);
    settle(completed, ctx({ tilesOwned: 51 }));
    expect(completed.finished()).toBe(true);
  });

  it("distinguishes skipped, read, practiced and unavailable lessons", () => {
    const progress = new TutorialProgress([
      { id: "skip", isDone: () => false },
      { id: "read", manual: true },
      { id: "practice", isDone: (c) => c.hasSpawned },
      { id: "disabled", applies: () => false },
    ]);
    progress.skip();
    progress.acknowledge();
    settle(progress, ctx({ hasSpawned: true }));
    settle(progress, ctx({ hasSpawned: true }));
    expect(progress.result()).toEqual({
      skip: "skipped",
      read: "read",
      practice: "practiced",
      disabled: "unavailable",
    });
  });
});
