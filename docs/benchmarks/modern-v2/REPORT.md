# Modern v2 final measured results — 2026-10-05

The final frozen implementation produced **161 high wins in 240 controlled
timed games (67.08%)**. Default mixed AI measured **p50 20.58 / p95 99.83 ms**,
with a fresh repeat at **21.12 / 106.68 ms**. The requested **20% p95 cost
ceiling is not met**. These actual simulation runs do not measure browser
rendering or demonstrate elimination wins.

All ten final raw reports have the same core-source SHA256:

    b76f47b090aa372de5c3e0be378fbe95e3f6e272f57275c0f8c06e6e2405a6e0

Every report records sourceUnchangedDuringMeasurement=true. Scenario SHA:

    dc9636c7fa7200fcf9380f249f0dacae365fcb108d10bad1feac952128e0aac6

Mixed cache-on, cache-cleared and fresh-repeat runs all finished with **modern
state hash 364226041** and existing numeric core hash **39583355797961960**.
All **8/8 seed-zero regional repeats** matched their original modern-state
hashes. The existing core hash is a JavaScript numeric signature; the separate
modern hash covers modern records. Actual snapshot tests also cover mid-flight
landing and a naval order beside a hostile merchant.

Branch: feature/strategic-ai-modern-world, based on commit
11e37e04702084bff8b138a9bb63f05b4d9bcd36. The SHA above identifies uncommitted
core sources. Host: Windows 10.0.26200, Intel Core i7-14650HX, 24 logical CPUs,
Node 24.15.0. Geography generation, builds, dev servers and verification
browsers were stopped. Each preset used a fresh process, seed 2026 and 1,200
ticks after initialization. Source hashing is outside the tick timer and cannot
affect an AI decision.

## Full-world simulation

| Preset                     | Starting controllers | Final alive | AI low / medium / high   | p50 ms | p95 ms | p99 ms | Peak heap MiB | Peak RSS MiB | Ticks over 100 ms |
| -------------------------- | -------------------: | ----------: | ------------------------ | -----: | -----: | -----: | ------------: | -----------: | ----------------: |
| Existing modern v1         |                  198 |         104 | Existing NationExecution |   9.13 |  51.85 | 133.72 |        116.67 |       343.40 |                17 |
| v2 AI idle                 |                  294 |         294 | 0 / 0 / 0                |   3.58 |  50.86 | 126.21 |         99.16 |       288.92 |                17 |
| v2 all low                 |                  294 |         279 | 293 / 0 / 0              |   9.30 |  68.99 | 129.08 |        105.24 |       346.50 |                20 |
| v2 all medium              |                  294 |         270 | 0 / 293 / 0              |  16.60 |  88.62 | 152.05 |        137.59 |       359.52 |                39 |
| v2 all high                |                  294 |         253 | 0 / 0 / 293              |  24.52 | 117.18 | 183.83 |        136.11 |       368.77 |                92 |
| v2 default probability mix |                  294 |         268 | 100 / 91 / 102           |  20.58 |  99.83 | 163.75 |        134.64 |       362.83 |                60 |
| Mixed fresh repeat         |                  294 |         268 | 100 / 91 / 102           |  21.12 | 106.68 | 160.33 |        134.67 |       360.38 |                70 |

Active presets have one human and 293 world AIs, with zero invited-slot AIs.
The default probabilities remain **one third each**; the sample difference is
intentional. All 294 controllers start at N0=1,000,000. At the end of every v2
preset, **living population + deaths = 294,000,000**, all population branch
sums are valid, and there are **zero alive-with-zero-population factions**.
Mixed has 290,226,858 living people and 3,773,142 deaths.

Relative to v1, p95 increased **33.1% low, 70.9% medium, 126.0% high and
92.5% mixed**. The mixed repeat is +105.7%. Relative to v2 idle, mixed p95 is
+96.3%. Default probabilities were not changed to reduce the measurement;
even all-low misses 20% in this comparison.

Legacy is this fork's **modern-world-v1 with enhanced NationExecution**, not
unmodified upstream Classic. Controller count, ownership, population and
aircraft differ: percentages compare whole modes, not isolated AI overhead.
Mixed-repeat spread demonstrates timing noise; one seed/host is not a
device-independent guarantee.

Mixed ended with 2,067 native units, 2,751 formation records including destroyed
formations, and 1,357 planes. All-high retained 3,464 formation records. Active
formations are capped at 24 per faction; retained history still contributes
to long-game memory and traversal cost.

## Actual paths and cache preservation

| Preset                  | Water queries | Rail queries | Land requests | A\* searches | Visited nodes | Failed-path cache hits | Native warnings |
| ----------------------- | ------------: | -----------: | ------------: | -----------: | ------------: | ---------------------: | --------------: |
| v1                      |         1,311 |        4,583 |             0 |            0 |             0 |                      0 |              29 |
| v2 idle                 |             0 |        4,491 |             0 |            0 |             0 |                      0 |               0 |
| v2 low                  |         1,001 |        4,587 |         3,819 |        2,665 |       340,594 |                  1,118 |               6 |
| v2 medium               |         1,034 |        4,614 |         9,421 |        6,909 |     1,099,686 |                  2,332 |              10 |
| v2 high                 |           919 |        4,529 |        11,543 |        8,049 |     1,430,030 |                  3,367 |              21 |
| Mixed cache on          |           971 |        4,596 |         9,633 |        6,468 |     1,444,801 |                  3,050 |              10 |
| Mixed cleared each tick |           971 |        4,596 |         9,633 |        8,561 |     2,468,485 |                    957 |              10 |
| Mixed cache-on repeat   |           971 |        4,596 |         9,633 |        6,468 |     1,444,801 |                  3,050 |              10 |

Owner-revision failure caching reduced searches **24.4%** and nodes **41.5%**,
preserving both hashes and path-request totals. The comparison clears this
cache every tick; same-tick reuse and existing water/rail memoization remain.
It does not disable all path caches. Entries are bounded per player and
invalidated by tileChangeVersion; device speed never skips AI decisions.

Cache-on p95 was 99.83 ms, cleared 104.06 ms and cache-on repeat 106.68 ms.
Timing variation exceeds this single comparison's apparent gain. The reliable
finding is reduced deterministic path work, not a proven p95 speedup.
Water/rail counts include memo hits; land-node counts are actual expansions.

Mixed native warnings: four failed trade-ship constructions, four Cities,
one Defense Post and one Factory. Rejected construction also appeared in
controlled games. The counter covers native console.warn events, not every
invalid preview or strategically wasteful command. Placement/ownership
changes between planning and execution still need better build-site retries.

## Controlled AI quality and geography

Thirty seeds, both assignments and four actual region pairs produced 240 games.
All **480 starting records** have N0=1,000,000, gold=400,000, army people=18,000
and air people=800. Both sides share economy/combat rules. Other countries are
neutral; alliances/nukes are disabled. This is modern **high versus low**,
distinct from the existing Nation comparison maintained separately.

| Starting regions  | Geographic area km²       | Map tiles     | Major ports | Initial army climate adaptation                |
| ----------------- | ------------------------- | ------------- | ----------- | ---------------------------------------------- |
| KOR / PRK         | 97,176.59 / 122,627.94    | 352 / 471     | 3 / 0       | Continental + temperate / continental          |
| DEU / FRA         | 357,460.84 / 657,695.67   | 1,451 / 2,520 | 3 / 11      | Temperate + continental / temperate + tropical |
| DZA-r02 / LBY-r01 | 1,159,509.47 / 816,722.53 | 3,330 / 2,323 | 0 / 0       | Arid + temperate / arid                        |
| NOR / SWE         | 386,809.31 / 445,650.58   | 3,195 / 2,603 | 4 / 1       | Continental + polar / continental              |

The arid pair includes inland administrative regions without major ports.
France includes overseas territory. Norway has more screen tiles despite a
smaller geographic area than Sweden. Modern income/manpower caps do not use
tile counts; combat fixes both existing numTiles inputs at 10,000. Path
distance, raster capture steps and bounded border sampling still cause
location bias.

| Pair                    | High wins / 60 | High win % | Mean high net gain km² | Mean high deaths | Mean low deaths | Mean territory-quiet ticks |
| ----------------------- | -------------: | ---------: | ---------------------: | ---------------: | --------------: | -------------------------: |
| South / North Korea     |             58 |      96.67 |             100,521.46 |         5,242.03 |       22,580.98 |                   2,617.57 |
| Germany / France        |             33 |      55.00 |              36,069.37 |        22,503.00 |       22,415.35 |                     242.12 |
| Algeria r02 / Libya r01 |             35 |      58.33 |             -18,180.38 |        22,342.67 |       21,850.25 |                     247.42 |
| Norway / Sweden         |             35 |      58.33 |              37,178.23 |        18,176.03 |       11,589.43 |                     360.33 |

High won **161/240 (67.08%)**, low **79/240 (32.92%)**, no ties. Every game
reached **3,000 ticks / 300 game seconds**; **none ended by elimination**.
Winners use net geographic area gained at the time limit, not the production
victory screen or initial area. Arid high AI has a positive win count but
negative mean net gain because some low victories are large. High does not
reliably outperform low in every geographic category.

All 240 games preserve **living + deaths = 2,000,000**, with no alive population-
zero states. Korea seed zero retains a one-tile North Korean faction with
977,026 living people and 18,241 raw army units, able to recover rather than
becoming a population-zero ghost.

| Aggregate metric                            |  High mean |   Low mean |
| ------------------------------------------- | ---------: | ---------: |
| Recorded deaths                             |  17,065.93 |  19,609.00 |
| Final gold stock                            | 188,650.01 | 202,508.18 |
| Completed air missions                      |      31.45 |      13.73 |
| Current major-port income, gold/game second |   1,101.57 |     239.21 |
| Remaining aircraft                          |       7.33 |       1.80 |

Gold stock is not growth rate: production/investment spend it. Deaths are
actual losses, without classifying necessary versus avoidable loss. Mean
survival is 3,000 ticks on both sides because neither is eliminated. Mean
territory-quiet time is 866.86 ticks; 59/240 games exceed 1,000 quiet ticks,
maximum 2,794. Economy, combat and missions may continue during this measurable
conquest stall.

## Corrections and earlier results

Final code includes final-tick attack/landing loss reporting, exact survivor
return, zero-person destruction, ownership checks, indexed naval lookup,
merchant-pursuit versus explicit-order priority, and rejection of late
orders on destroyed formations. Actual modern/native regression checks passed
**180 tests in ten files**; final military/AI guard rerun passed **36 tests**,
with full type checking and scoped lint. Tests include lethal land/landing
loss, real 25% transport retreat, opposing attacks, independent formation
identity during manual attack merging, and mid-flight/mid-sailing snapshots.

Earlier measurements remain for audit and are not final-code claims:

| Stage                                     | Controlled high wins | Interpretation                                                                          |
| ----------------------------------------- | -------------------: | --------------------------------------------------------------------------------------- |
| Before zero-territory population transfer |     231/240 = 96.25% | Population-zero remnants; invalid as final AI quality                                   |
| After population/capital-recovery fix     |     230/240 = 95.83% | Population conserved; earlier survivor/loss behavior; browsers active, timings excluded |
| Final frozen implementation               |     161/240 = 67.08% | Current results, clear-CPU conditions, source SHA recorded                              |

Outcome changes are material. Old 95–96% figures must not be reported as
current. Raw _-final.json, matches-post-annex_ and files without current-
belong to earlier stages.

## Limits and next work

- **20% p95 ceiling is missed**, even all-low. Keep equal default probabilities.
  Profile recurring update generation, routing, combat and retained history
  before further optimization; no dominant CPU cause was proven by flame graph.
- **No controlled elimination wins**; small coastal remnants persist. First-512
  border sampling, 4,096-node land paths and major-port naval fallback can miss
  isolated non-port remnants. Fixed deterministic budgets need better coverage.
- Four pairs do not isolate every climate, personality, region structure or
  full-world diplomacy. High exceeds 60% only in this aggregate modern-high/low
  timed proxy, not against original Nation AI or in full-world victories.
- Rejected builds remain. Warning counts and territorial quiet are proxies;
  avoidable losses/all meaningless commands lack a validated complete classifier.
- Browser/GPU rendering, worker transfer, reconnect latency and mobile hardware
  performance are unmeasured here. Browser and integration checks are separate.
- Heap/RSS samples are every 25 ticks. Long sessions, multiple full-world seeds
  and other hosts need further measurements.

## Reproduce and raw results

    npx tsx tests/perf/ModernSystemsBenchmark.ts report.json mixed 1200 2026
    npx tsx tests/perf/ModernSystemsBenchmark.ts report-no-cache.json mixed 1200 2026 no-cache
    npx tsx tests/perf/ModernAIMatches.ts matches.json 30 3000

Modes: legacy, idle, low, medium, high, mixed. Use fresh processes with other
CPU work stopped. Final raw files: current-legacy.json, current-idle.json,
current-low.json, current-medium.json, current-high.json, current-mixed.json,
current-mixed-no-cache.json, current-mixed-repeat.json, current-matches.json
and current-matches-repeat.json.
