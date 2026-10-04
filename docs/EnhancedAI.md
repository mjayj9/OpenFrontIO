# Enhanced deterministic AI

Enhanced AI is opt-in in the singleplayer settings and modern-world setup. Basic tribes keep their gray presentation, automatic alliance acceptance and captured-structure deletion. The unchanged BOT/HUMAN/NATION controller types remain the simulation identities. An AI profile is explicit data derived from the game configuration, stable player ID and seed; colors, names and flags never select its behavior.

`GameConfig.enhancedAI` carries `tribePercent`, `nationPercent`, `personality`, `fairResources` and an unsigned `seed`. Percentages select a deterministic approximate proportion, rather than an exact player count. Mixed personality selection uses a separate hash from controller selection. Expansionist, defensive, economic, diplomatic and naval weights are independent of Easy/Medium/Hard/Impossible reaction difficulty. The percentages, seed and resource option travel the existing binary settings schema.

Fair resources apply the human starting troops, troop cap/growth, worker gold and combat rules to both enhanced and basic AI. They remove the classic tribe attrition advantage. Every defeated controller transfers half its gold, rounded down, including a human that has never attacked; Classic retains full gold from AI victims and its inactive-human exception. Fair mode also disables global human-only infinite resources and every host cheat override. Finite global starting gold and income multipliers remain available to everyone. The singleplayer and private-lobby forms clear and hide incompatible cheat settings before starting/publishing the configuration, and their translated explanation shows the effective rules. Config itself enforces them even for a stale or crafted configuration. Spawn protection uses the same configured duration for all fair controllers; Modern World honors protection for all controllers even with challenge resources. Disabling fairness retains existing Classic challenge rules and difficulty bonuses. Leaving the entire enhanced setting absent in Classic preserves its simulation decisions and PRNG draws.

## Simulation integration

The existing `AiAttackBehavior` now evaluates an integer-scored plan at the controller's existing thought ticks. It considers available troops after a reserve across hostile fronts and incoming armies, relative territory gain, cities/factories/ports, defense posts, public growth observations, current attack commitments, relations/trade loss and land/sea accessibility. These are tactical proxies, not a combat outcome guarantee. There is one sticky target held for up to 180 ticks, early changes for a deteriorating threat, and stalemate reevaluation after 400 ticks. Only transmitted/public simulation state is read.

Planning scores at most 12 candidates; a naval nation adds at most four nearby overseas candidates and the execution tests at most three routes. Near and overseas candidates must satisfy the public attack rules, so protected countries are excluded while the AI invests. Fair/modern land and boat senders also reject invalid targets before troop calculations or route searches. Existing transport routes, interception handling, warships, allies, leader checks and counterattacks are reused. Nation counterattacks account for committed outgoing/incoming forces; enhanced tribes retain a cheaper direct counterattack path. Retreat uses the existing `RetreatExecution` when an attack loses its useful border or endangers home reserves.

Enhanced tribes preserve useful captured facilities, assess alliance requests, and periodically upgrade/build a small economic or defensive base with at most 16 placement candidates. They do not receive the full national naval/nuclear controller. Nations reuse existing placement, spacing, cost and upgrade logic with personality-dependent priorities/ratios.

Atom/hydrogen decisions add live cost and city replacement reserves, target value, SAM trajectory checks, friendly structure/territory considerations and cautious retaliation risk. Enhanced MIRV decisions exclude allies/teammates, reserve a replacement city budget, compare live replacement asset prices plus an integer territory-value proxy against the expensive strike, and choose from a bounded set of safe center/capital/structure positions. MIRV warheads reject a friendly tile inside their actual blast circle during generation and finalization. Ownership may change after a missile is committed, so these checks describe information available at those ticks. Human weapon rules and classic national MIRV policy are preserved.

There are no external LLM calls, wall-clock inputs, machine-speed decisions or unseeded core random draws. Existing controller PRNGs continue to supply any random choices.

## Status, save and replay

`AiAttackBehavior` snapshot version 3 stores the goal, target, explanation, held-since tick, reserve, integer score and at most 12 public observations. Migration from version 2 adds null strategic state; the version 1 migration is retained. Profiles are reconstructed from the saved configuration and player IDs; existing tribe/nation PRNG state remains in its existing records.

Actual thought decisions emit `AIStatus` through the worker's normal update path. Player information shows a concise translated goal. Development builds additionally show the reason, reserve, candidate count and current personality building priorities. This is display output; it does not bypass Intent/Execution simulation changes or add network-driven AI decisions.

Replay uses the existing miscellaneous binary section for status updates. Keyframes include the latest status even on a quiet tick, and the reader materializes status while seeking. Replay palette resolution receives the recorded configuration and uses the same explicit profile and sorted human/nation/tribe + ID preallocation as live rendering. Enhanced Bot fills remain distinct while retaining the shared Bot team outline; default and colorblind theme parity is tested.

## Modern rail startup

The real 198-controller modern-world benchmark reproduced a 9,010 ms first active rail-connection tick. Initial modern city/factory/port stations now connect at deterministic tick `4 + unit.id() * 2`, at most one initial connection every two ticks. Their rails become available gradually over roughly the first two minutes. Later construction and classic games connect immediately. Station snapshot version 2 persists the pending connection tick; version 1 migrates to zero.

Modern rail A\* searches use a fixed 4,096 iteration bound; classic searches retain their existing limit. This prevents disconnected islands from exploring the whole mini-map for a short local rail request. Some large detours may therefore be omitted. Subsequent rail connection work still produces occasional long ticks; it remains a measured limitation below.

## Verification and reproducible commands

Use the repository's installed Node/npm environment and scripts; these additional harnesses run via the existing `tsx` dependency:

```sh
npx vitest run tests/EnhancedAI.test.ts tests/EnhancedAIFairResources.test.ts tests/EnhancedProtection.test.ts tests/EnhancedAIWire.test.ts tests/EnhancedMIRV.test.ts tests/ModernRailStartup.test.ts
npx vitest run tests/client/replay/codec/EnhancedAIStatus.test.ts tests/client/replay/EnhancedAIPalette.test.ts tests/WorkerAssetBase.test.ts
npx tsx tests/perf/EnhancedAIBenchmark.ts tribe.json 30 tribe 30
npx tsx tests/perf/EnhancedAIBenchmark.ts nation.json 30 nation 30
npx tsx tests/perf/fullgame/FullGamePerf.ts --map world --bots 200 --nations 60 --ticks 1200 --seed AIPERF24 --enhanced-percent 25 --no-cpu-profile --no-alloc-profile --no-gc-profile --report-json world25.json
npx tsx tests/perf/fullgame/FullGamePerf.ts --modern-country KOR --ticks 1200 --seed AIPERF24 --enhanced-percent 25 --fair-resources --no-cpu-profile --no-alloc-profile --no-gc-profile --report-json modern25.json
```

Change `--enhanced-percent` to 0 and 100 for the ratio comparison. `--modern-country` selects the generated Modern World map, all 197 national AIs and one idle human, validates the scenario hash, and provides actual country ownership before AI simulation. The scenario uses balanced starts and 300 protection ticks. A classic World fixture has 200 basic/enhanced tribes and 60 national AIs, Medium challenge resource rules. It executes 1,200 game ticks after its 202-tick spawn phase; modern has two initialization turns followed by 1,200 game ticks.

Tests cover the five profiles, all four fair-resource difficulties, several hostile fronts/allies, bounded integer/sticky plans, real captured facility retention beyond the classic deletion cooldown, actual land conquest, banned units/alliances, emitted worker status, coastal/island ports and warships, current and migrated snapshots, future identical state/hash, binary settings roundtrips, replay keyframe/random-seek status, theme parity, and real MIRV flight restoration. `WorkerAssetBase` also covers empty, root-relative, relative and absolute site bases used by inline Blob workers.

## AI comparison results

Measurements on 2026-10-04 used Node v24.15.0, Windows kernel 10.0.26200 and an Intel Core i7-14650HX (24 logical processors). Both sides start with 60,000 internal troop units and one half of the same 10,000-tile Plains map. Human-equivalent economy/combat rules apply to both sides. Buildings, weapons and alliances are disabled to isolate land decision quality; each game is capped at 6,000 ticks. This is a post-protection fixture: the existing TestConfig protection duration is zero. Each of 30 seeds is played with swapped sides (60 games). The two games within a seed are related observations. Seeds 0–29 were used while tuning; seeds 30–59 are a held-out sample. After the final uniform half-loot, cheat and protection corrections, all four sets (240 games) were rerun without changing AI strategy weights or tuning on the held-out seeds. The final JSONs carry a `fair-2` rules label. All previous winner, duration, loss, territory, worker-income and command rows remained identical; this is measured agreement, not an assumption based on banned buildings.

| Controller                        | Tuning sample 0–29 | Held-out sample 30–59 | Held-out draws |
| --------------------------------- | -----------------: | --------------------: | -------------: |
| Enhanced tribe vs basic tribe     |      44/60 (73.3%) |         48/60 (80.0%) |              0 |
| Enhanced nation vs classic nation |      44/60 (73.3%) |         40/60 (66.7%) |              0 |

Held-out mean game duration was 1,796 ticks for tribes and 1,588 for nations. Enhanced tribes gained a net 3,000 tiles per game, nations 1,667. Troop losses by conservation (combat **and retreat**, not an estimate of “unnecessary” losses) were **higher**: tribes 1.642M enhanced vs 1.636M classic, nations 1.279M vs 1.261M. Equal worker earnings were 179,510 gold per tribe and 158,668 per nation. Mean attack commands were 17.33 vs 12.02 for tribes and 10.80 vs 13.37 for nations. First-tick inactive attacks averaged 0.033 vs 0 for tribes and 1.017 vs 1 for nations; the nation count includes an initial neutral-territory attack on an already occupied map. That metric can also include a valid immediate cancellation.

The final arena also records actual conquest income and ending gold. Held-out enhanced/classic mean conquest gold was 71,113/18,642 for tribes and 50,911/28,423 for nations; ending gold was 213,340/55,925 and 152,733/85,270 respectively. These are outcomes of different win rates, not equal fixed endowments. Earlier files did not record these fields, so no direct old/new ending-gold comparison is claimed. The requested 60% target was exceeded in this controlled land fixture. This does not establish a general win rate for islands, economics, diplomacy, team games or nuclear play. Such extended tournaments remain follow-up work. Current raw rows, personality assignments, efficiency, survival, command and timing values are in [`benchmarks/`](benchmarks/); the 13 previous reports remain in [`benchmarks/pre-fair/`](benchmarks/pre-fair/).

## Full-game tick cost

These are single fixed-seed sequential runs in the same environment with execution profiling enabled and CPU/allocation/GC profiling disabled. Water counts are `WaterPathMemo.findPath` queries, including cache hits; rail counts are `AStarRail.findPath` queries, not expanded-node counts. Heap is sampled every 50 ticks without forced GC and is not a guaranteed process peak. Rendering FPS was not measured by this headless harness.

| Fixture                        | Enhanced % | p50 ms | p95 ms | Start ms | Heap MiB | Water / rail queries | Ticks >100 ms |
| ------------------------------ | ---------: | -----: | -----: | -------: | -------: | -------------------: | ------------: |
| World, 200 tribes +60 nations  |          0 |   3.17 |   7.72 |      181 |    126.0 |                0 / 0 |             0 |
| World                          |         25 |   3.27 |   7.36 |      169 |    164.9 |                0 / 0 |             0 |
| World                          |        100 |   3.18 |   6.56 |      155 |    114.5 |              15 / 11 |             0 |
| Modern World, KOR +197 nations |          0 |   7.25 |  51.28 |      241 |    121.6 |          1682 / 4909 |            13 |
| Modern World                   |         25 |   7.39 |  53.02 |      259 |     86.8 |          1461 / 4912 |            23 |
| Modern World                   |        100 |   9.78 |  60.26 |      264 |    103.3 |          1399 / 4973 |            22 |

These are reruns after the final fair-economy, protection and protected-target planning/send corrections. Modern 100% p95 was **17.5% higher** than modern 0%, within the requested initial 20% comparison target for this fixture. Different AI decisions produce different armies/economies, so lower World timing is not evidence of a universally faster planner. Multi-run uncertainty and slow/mobile hardware still require further measurements.

The historical modern first active rail tick was 9,010 ms. Staggered connections and fixed search limits removed that initial freeze; the final-policy modern 0% maximum was 503 ms and 100% maximum 639 ms (the repeat reached 591 ms). Total map/start processing was 241–264 ms. Remaining rail spikes still exceed the 100 ms tick budget, with 13/23/22 such ticks at 0/25/100%. Rail connection candidates/graph work and later dense station construction need further optimization. The original 9-second report and intermediate 470–602 ms measurements are preserved as older-policy history, not a clean performance attribution to the final protection/resource changes. Maximum World ticks were 18.21/16.61/14.19 ms at 0/25/100%.

Both 100% simulations were repeated on the final fair/protection rules and produced identical state hashes within that build: World `14453465166866804` at tick 1400 and modern `2947805725546892` at tick 1200. Initial/repeat p95 timings were 6.56/7.21 ms and 60.26/54.66 ms respectively, showing wall-time variability despite identical simulation state. World challenge-resource hashes remained unchanged from the older reports; modern hashes changed as expected after correcting actual loot, protection and protected-target decisions. These short runs did not create a MIRV execution; controlled comparisons disable all weapons. The rules corrections did not change snapshot formats or migrations: user saves still enforce their writer-build policy, and an older save's raw data remains readable/exportable without claiming same-result continuation on this newer build. No renderer performance or broad tournament result is inferred from these numbers.
