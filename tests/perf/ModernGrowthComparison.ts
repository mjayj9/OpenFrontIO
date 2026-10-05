/** Reproducible stockpiling comparison. Uses the actual original/reported checkout code. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ModernSystems } from "../../src/core/modern/ModernSystems";
const variants = [
  {
    id: "original-natural",
    repo: "../OpenFrontIO-original",
    model: "original-natural",
  },
  {
    id: "original-normalized",
    repo: "../OpenFrontIO-original",
    model: "original-normalized",
  },
  { id: "reported", repo: "../OpenFrontIO-reported", model: "legacy-fixed" },
  { id: "repaired", repo: ".", model: "stockpile-v1" },
];
const rows: Record<string, unknown>[] = [];
for (const variant of variants) {
  const dir = path.resolve(variant.repo);
  const { setup, playerInfo } = await import(
    pathToFileURL(path.join(dir, "tests/util/Setup.ts")).href
  );
  const { Config } = await import(
    pathToFileURL(path.join(dir, "src/core/configuration/Config.ts")).href
  );
  const { PlayerType } = await import(
    pathToFileURL(path.join(dir, "src/core/game/Game.ts")).href
  );
  const { PlayerExecution } = await import(
    pathToFileURL(path.join(dir, "src/core/execution/PlayerExecution.ts")).href
  );
  const modern = variant.id === "reported" || variant.id === "repaired";
  const { Config: Class } =
    variant.model === "original-normalized"
      ? {
          Config: class Normalized extends Config {
            maxTroops() {
              return 982000;
            }
          },
        }
      : { Config };
  const overrides: Record<string, unknown> = { instantBuild: false };
  if (modern) {
    const { modernRegions } = await import(
      pathToFileURL(path.join(dir, "src/core/game/ModernRegions.ts")).href
    );
    overrides.modernMode = {
      scenario: "modern-regions-v2",
      version: 2,
      dataHash: modernRegions.hash,
      countryId: "KOR",
      balance: "balanced",
      victory: "territory",
      targetPercent: 60,
      protectionTicks: 0,
      capitalElimination: false,
    };
  }
  const game = await setup("plains", overrides, [], undefined, Class);
  const human = game.addPlayer(playerInfo("comparison", PlayerType.Human));
  game.forEachTile((tile: number) => {
    if (game.isLand(tile) && !game.isImpassable(tile)) human.conquer(tile);
  });
  const capital = [...human.tiles()][Math.floor(human.numTilesOwned() / 2)];
  human.setSpawnTile(capital);
  human.setTroops(modern ? 180000 : 170000);
  human.addGold(400000n);
  let systems: ModernSystems | undefined;
  if (modern) {
    game.setModernSystems({
      version: variant.id === "repaired" ? 3 : 2,
      tick: 0,
      seed: 7,
      factions: [
        {
          playerId: human.id(),
          factionId: "comparison",
          parentCountryId: "comparison",
          ownedAreaUnits: 1,
          aiLevel: null,
          aiRole: "human",
          climateAdaptation: ["temperate"],
          completedTraining: 0,
          populationTransferredTo: null,
          population: {
            total: 1000000,
            civilian: 970000,
            available: 12000,
            army: 18000,
            navy: 0,
            air: 0,
            dead: 0,
          },
          nuclearStrikes: [],
        },
      ],
      forces: [],
      bases: [],
      ports: [],
      nextForceId: 1,
      aiPlans: [],
    });
    const { modernSystemsFor } = await import(
      pathToFileURL(path.join(dir, "src/core/modern/ModernSystems.ts")).href
    );
    systems = modernSystemsFor(game) as ModernSystems;
    systems.forces.initializeFaction(human.id(), capital);
  }
  const execution = new PlayerExecution(human);
  execution.init(game, game.ticks());
  const sample = () => {
    const p = human.modernFaction?.()?.population;
    rows.push({
      variant: variant.id,
      sourceModel: variant.model,
      gameSeconds: game.ticks() / 10,
      reserveRawTroops: human.troops(),
      reservePeople: human.troops() / 10,
      committedArmyPeople: systems
        ? systems.forces.committedArmyRaw(human.id()) / 10
        : null,
      totalArmyPeople: p?.army ?? null,
      availablePeople: p?.available ?? null,
      civilianPeople: p?.civilian ?? null,
      militaryPeople: p ? p.army + p.navy + p.air : null,
      totalLiving: p?.total ?? null,
      totalDead: p?.dead ?? null,
      gold: human.gold().toString(),
      rawCapacity: game.config().maxTroops(human),
      growthRawPerTick: game.config().troopIncreaseRate(human),
      actualGrowthPeoplePerTick:
        human.modernFaction?.()?.growthPeoplePerTick ?? null,
      trainedPeoplePerTick:
        human.modernFaction?.()?.civilianTrainedPerTick ?? null,
      growthReason: human.modernFaction?.()?.growthReason ?? null,
      carryPermille: human.modernFaction?.()?.growthCarryPermille ?? null,
    });
  };
  sample();
  for (let i = 0; i < 1200; i++) {
    execution.tick(game.ticks());
    game.executeNextTick();
    if ([100, 300, 600, 1200].includes(game.ticks())) sample();
  }
}
const json = {
  runtime: { node: process.version, platform: process.platform },
  provenance: variants.map((variant) => ({
    variant: variant.id,
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: variant.repo,
      encoding: "utf8",
    }).trim(),
    sourceHashes: Object.fromEntries(
      [
        "src/core/configuration/Config.ts",
        "src/core/execution/PlayerExecution.ts",
        ...(variant.id === "reported" || variant.id === "repaired"
          ? [
              "src/core/modern/ModernRules.ts",
              "src/core/modern/ModernSystems.ts",
              "src/core/modern/ModernForces.ts",
            ]
          : []),
      ].map((file) => [
        file,
        createHash("sha256")
          .update(readFileSync(path.resolve(variant.repo, file)))
          .digest("hex"),
      ]),
    ),
  })),
  scenario:
    "plains owned land; human, no combat/AI/production; 10 ticks/s; 170000 reserve raw plus modern 1000 committed army people and 800 pilots; 400000 starting gold; modern 1M population; normalized original reserve cap982000raw",
  variants,
  rows,
};
writeFileSync(
  "../../outputs/repair-growth-comparison.json",
  JSON.stringify(json, null, 2),
);
writeFileSync(
  "../../outputs/repair-growth-comparison.csv",
  Object.keys(rows[0]).join(",") +
    "\n" +
    rows
      .map((r) =>
        Object.values(r)
          .map((v) => v ?? "")
          .join(","),
      )
      .join("\n") +
    "\n",
);
const trackedDir = "docs/benchmarks/repair";
mkdirSync(trackedDir, { recursive: true });
writeFileSync(
  path.join(trackedDir, "growth-comparison.json"),
  JSON.stringify(json, null, 2) + "\n",
);
writeFileSync(
  path.join(trackedDir, "growth-comparison.csv"),
  readFileSync("../../outputs/repair-growth-comparison.csv"),
);
console.log(JSON.stringify(rows, null, 2));
