# Enhanced deterministic AI

Enhanced AI is opt-in in the singleplayer settings and modern-world setup. Basic tribes keep their gray presentation, automatic alliance acceptance and captured-structure deletion. The unchanged BOT/HUMAN/NATION controller types remain the simulation identities. An AI profile is explicit data derived from the game configuration, stable player ID and seed; colors, names and flags never select its behavior.

`GameConfig.enhancedAI` carries `tribePercent`, `nationPercent`, `personality`, `fairResources` and an unsigned `seed`. Percentages select a deterministic approximate proportion, rather than an exact player count. Mixed personality selection uses a separate hash from controller selection. Expansionist, defensive, economic, diplomatic and naval weights are independent of Easy/Medium/Hard/Impossible reaction difficulty. The percentages, seed and resource option travel the existing binary settings schema.

Fair resources apply the human starting troops, troop cap/growth, worker gold and combat rules to both enhanced and basic AI. They remove the classic tribe attrition advantage. Disabling fairness retains the existing challenge rules and difficulty bonuses. Leaving the entire enhanced setting absent preserves classic simulation decisions and PRNG draws.

## Simulation integration

The existing `AiAttackBehavior` now evaluates an integer-scored plan at the controller's existing thought ticks. It considers available troops after a reserve across hostile fronts and incoming armies, relative territory gain, cities/factories/ports, defense posts, public growth observations, current attack commitments, relations/trade loss and land/sea accessibility. These are tactical proxies, not a combat outcome guarantee. There is one sticky target held for up to 180 ticks, early changes for a deteriorating threat, and stalemate reevaluation after 400 ticks. Only transmitted/public simulation state is read.

Planning scores at most 12 candidates; a naval nation adds at most four nearby overseas candidates and the execution tests at most three routes. Existing transport routes, interception handling, warships, allies, leader checks and counterattacks are reused. Nation counterattacks account for committed outgoing/incoming forces; enhanced tribes retain a cheaper direct counterattack path. Retreat uses the existing `RetreatExecution` when an attack loses its useful border or endangers home reserves.

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
npx vitest run tests/EnhancedAI.test.ts tests/EnhancedAIWire.test.ts tests/EnhancedMIRV.test.ts tests/ModernRailStartup.test.ts
npx vitest run tests/client/replay/codec/EnhancedAIStatus.test.ts tests/client/replay/EnhancedAIPalette.test.ts tests/WorkerAssetBase.test.ts
npx tsx tests/perf/EnhancedAIBenchmark.ts tribe.json 30 tribe 30
npx tsx tests/perf/EnhancedAIBenchmark.ts nation.json 30 nation 30
npx tsx tests/perf/fullgame/FullGamePerf.ts --map world --bots 200 --nations 60 --ticks 1200 --seed AIPERF24 --enhanced-percent 25 --no-cpu-profile --no-alloc-profile --no-gc-profile --report-json world25.json
npx tsx tests/perf/fullgame/FullGamePerf.ts --modern-country KOR --ticks 1200 --seed AIPERF24 --enhanced-percent 25 --fair-resources --no-cpu-profile --no-alloc-profile --no-gc-profile --report-json modern25.json
```

Change `--enhanced-percent` to 0 and 100 for the ratio comparison. `--modern-country` selects the generated Modern World map, all 197 national AIs and one idle human, validates the scenario hash, and provides actual country ownership before AI simulation. The scenario uses balanced starts and 300 protection ticks. A classic World fixture has 200 basic/enhanced tribes and 60 national AIs, Medium challenge resource rules. It executes 1,200 game ticks after its 202-tick spawn phase; modern has two initialization turns followed by 1,200 game ticks.

Tests cover the five profiles, all four fair-resource difficulties, several hostile fronts/allies, bounded integer/sticky plans, real captured facility retention beyond the classic deletion cooldown, actual land conquest, banned units/alliances, emitted worker status, coastal/island ports and warships, current and migrated snapshots, future identical state/hash, binary settings roundtrips, replay keyframe/random-seek status, theme parity, and real MIRV flight restoration. `WorkerAssetBase` also covers empty, root-relative, relative and absolute site bases used by inline Blob workers.

## AI comparison results

Measurements on 2026-10-04 used Node v24.15.0, Windows kernel 10.0.26200 and an Intel Core i7-14650HX (24 logical processors). Both sides start with 60,000 troops and one half of the same 10,000-tile Plains map. Human-equivalent economy/combat rules apply to both sides. Buildings, weapons and alliances are disabled to isolate land decision quality; each game is capped at 6,000 ticks. Each of 30 seeds is played with swapped sides (60 games). The two games within a seed are related observations. Seeds 0–29 were used while tuning; seeds 30–59 are an additional held-out sample evaluated without policy changes.

| Controller                        | Tuning sample 0–29 | Held-out sample 30–59 | Held-out draws |
| --------------------------------- | -----------------: | --------------------: | -------------: |
| Enhanced tribe vs basic tribe     |      44/60 (73.3%) |         48/60 (80.0%) |              0 |
| Enhanced nation vs classic nation |      44/60 (73.3%) |         40/60 (66.7%) |              0 |

Held-out mean game duration was 1,796 ticks for tribes and 1,588 for nations. Enhanced tribes gained a net 3,000 tiles per game, nations 1,667. Troop losses by conservation (combat **and retreat**, not an estimate of “unnecessary” losses) were **higher**: tribes 1.642M enhanced vs 1.636M classic, nations 1.279M vs 1.261M. Equal worker earnings were 179,510 gold per tribe and 158,668 per nation. Mean attack commands were 17.33 vs 12.02 for tribes and 10.80 vs 13.37 for nations. First-tick inactive attacks averaged 0.033 vs 0 for tribes and 1.017 vs 1 for nations; the nation count includes an initial neutral-territory attack on an already occupied map. That metric can also include a valid immediate cancellation.

The requested 60% target was exceeded in this controlled land fixture. This does not establish a general win rate for islands, economics, diplomacy, team games or nuclear play. Such extended tournaments remain follow-up work. Raw rows, personality assignments, efficiency, survival, command and timing values are in [`benchmarks/`](benchmarks/).

## Full-game tick cost

These are single fixed-seed sequential runs in the same environment with execution profiling enabled and CPU/allocation/GC profiling disabled. Water counts are `WaterPathMemo.findPath` queries, including cache hits; rail counts are `AStarRail.findPath` queries, not expanded-node counts. Heap is sampled every 50 ticks without forced GC and is not a guaranteed process peak. Rendering FPS was not measured by this headless harness.

| Fixture                        | Enhanced % | p50 ms | p95 ms | Start ms | Heap MiB | Water / rail queries | Ticks >100 ms |
| ------------------------------ | ---------: | -----: | -----: | -------: | -------: | -------------------: | ------------: |
| World, 200 tribes +60 nations  |          0 |   2.89 |   7.58 |      154 |    154.7 |                0 / 0 |             0 |
| World                          |         25 |   3.00 |   7.13 |      172 |    141.1 |                0 / 0 |             0 |
| World                          |        100 |   2.40 |   5.79 |      157 |    114.4 |              15 / 11 |             0 |
| Modern World, KOR +197 nations |          0 |   6.71 |  47.88 |      196 |    122.2 |          1571 / 4758 |            12 |
| Modern World                   |         25 |   7.02 |  47.84 |      243 |     95.7 |          1576 / 4932 |            18 |
| Modern World                   |        100 |   8.12 |  49.37 |      239 |    116.6 |          1488 / 4805 |            17 |

Modern 100% p95 increased **3.1%** relative to modern 0%, within the requested initial 20% comparison target. Different AI decisions produce different armies/economies, so lower World timing is not evidence of a universally faster planner. Multi-run uncertainty and slow/mobile hardware still require further measurements.

The original modern first active tick was 9,010 ms; after staggered connections and fixed search limits the worst modern 0% tick was 470 ms and 100% was 602 ms. Modern initialization itself remained roughly 150–183 ms, with total map/start processing 196–243 ms. The large initial freeze is removed, but the remaining rail spikes exceed the 100 ms tick budget. Rail connection candidates/graph work and later dense station construction need further optimization. The raw before/after reports retain these unfavorable numbers rather than hiding them in averages.

The table measurements predate the final enhanced-only MIRV collateral guard. These short runs did not create a MIRV execution; controlled comparisons disable all weapons. The final 100% World and modern simulations were repeated after those guards and produced identical state hashes: World `14453465166866804` at tick 1400 and modern `3013574097282654` at tick 1200. Repeat p95 timings were 4.67 ms and 36.71 ms respectively, showing wall-time variability despite identical simulation state. Reproduction reports are retained. No renderer performance or broad tournament result is inferred from these numbers.
