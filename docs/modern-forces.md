# Modern v2 military simulation and measurements

`ModernForces` executes army, navy and air commands inside the existing game
simulation. `ModernCommandExecution` validates the issuing player and applies
the existing Intent → Execution path. Classic controllers are unchanged.

Army formations reserve existing troops (10 core troop units represent one
person). They move over owned passable land, then use `AttackExecution` to
capture enemy territory. An island attack walks to an eligible departure and
uses `TransportShipExecution` before the existing landing attack. Ships and
attacks are associated with at most one formation. Stop before execution
initialization remains a retreat request when the real attack appears.
Overrun formations retreat to adjacent owned ground at their normal movement
rate; surrounded formations lose their existing personnel.
Native combat and transport executions report their final surviving troops
before deleting an attack or ship. Formation losses include the final lethal
tick, opposing-attack cancellation and the existing 25% retreat penalty.
Survivors transfer back from the actual troop pool once; a zero-person
formation is destroyed. The population ledger accounts for these deaths from
the real troop totals, so the reporting hook does not charge them again.
Manual pooled attacks do not absorb a separately commanded modern formation.

Navy formations use the existing warship, path finder, patrol and combat
executions. Each warship needs 100 available people. Existing build-menu ships
are also registered and charged personnel, so that menu cannot bypass the
modern population budget. Escort orders select an allied transport near the
ordered position and follow its actual location every ten ticks. When no
transport is present they defend the ordered rendezvous. High AI can assign
its available navy to an active transport before considering a blockade.
Modern movement pins the native warship's actual water destination until
arrival; merely changing its native patrol centre would allow random patrol
points to postpone arrival indefinitely. Stop/wait and completed movement hold
position while native combat and repair remain active. Coastal blockade orders
stop at the path's water endpoint. Navy ETA counts native water-path nodes plus
one observation tick and can change when combat or repair interrupts travel.
Native merchant hunting does not override a modern move, escort, blockade or
hold order. A merchant already within capture distance can still be captured;
an explicit patrol retains the existing merchant pursuit behavior. The
unit-to-formation lookup is a derived per-controller index and is rebuilt from
saved force records after restoration.

Fighters and strike aircraft are finite squadrons based at owned airfields.
They fly a deterministic route, perform their assigned mission, return to an
available base and rearm. Returning aircraft divert when their base is
captured; no reachable base means the squadron is lost. Grounded aircraft at
a captured base lose their allocated crew once. Fighters engage opposing airborne formations.
SAM aircraft engagement has its own paid reload state and does not modify the
existing missile interception queue. Strike aircraft damage the existing
defender troop pool, structures, airfields and major ports. Aircraft never
change tile ownership.
Fighter interception and aircraft-SAM firing use the same public
`canAttackPlayer` protection rules as native naval targeting; protected aircraft
do not consume a SAM shot or reload.

The central rules are in `ModernRules.ts` and `ModernForceTypes.ts`.

| Rule                                    | Default game value                         |
| --------------------------------------- | ------------------------------------------ |
| Personnel per aircraft / warship        | 100 / 100 people                           |
| Army formation                          | 1,000 people                               |
| Initial air force                       | 4 fighters + 4 strike aircraft             |
| Fighter / strike production             | 5,000 / 7,000 gold per plane               |
| Airfield                                | 30,000 gold, 24 aircraft capacity          |
| Air operation radius                    | 180 map tiles                              |
| Air movement                            | Up to 6 tiles per tick                     |
| Mission / rearm                         | 30 / 120 ticks                             |
| Aircraft maintenance                    | 25 gold per plane per 100 ticks            |
| Aircraft SAM range / reload / shot cost | 24 tiles / 30 ticks / 100 gold             |
| Simultaneous formations / queued orders | 24 per faction / 8 per formation           |
| Army path search                        | At most 4,096 visited candidates per query |

Ten ticks represent one game second. Timings are simulation values; they are
independent of rendering speed. Production and combat deaths debit the common
modern population ledger. Aircraft casualties include their allocated crew.
The complete force, queue, route, cooldown, base and aircraft-SAM reload state
is serialized by the modern state schema and core snapshots.

Modern AI levels vary command quality and thinking frequency, never initial
population, income, damage or hidden information. Low thinks every 80 ticks
and permits one operation; medium uses 40 ticks and two operations; high uses
20 ticks and four operations. Stable faction IDs and the game seed stagger
thoughts. Personality weights remain independent of level. Public troops,
territory, ports, climate, active air missions and alliance requests are the
inputs. Owner indexes are derived caches rebuilt from persisted state, not
additional simulation state.

Failed ground searches use a derived cache keyed by the player's persisted
territory revision, source, destination and work budget. Each player retains
at most 128 failures. Territory changes invalidate that player's cache.
`modernLandPathMetrics()` exposes diagnostic query/search/node/cache-hit
counts; none of these counters influences AI decisions. The benchmark's
optional `no-cache` argument clears this memo each tick to compare identical
rules with and without reuse.

High AI can use naval blockades, climate training and joint air/ground commands.
After losing its original capital, AI reorganizes existing army reserves at a
valid owned base, facility or bounded border candidate. It does not need to
own its original spawn tile. Medium/high can rebuild a paid airfield and
replace aircraft from available personnel rather than receiving free forces.
When no usable land-front target exists, AI considers public enemy coastal
ports for actual transport landings. It checks naval risk at at most sixteen
nearby candidates and transport routes at at most two; lower levels check one.
Nuclear use additionally requires a ready silo, substantial spare gold, a
valuable stronger opponent, no active nuclear penalty and no detected ready
retaliation silo or defending SAM. The complete atomic blast disk is checked
for friendly territory and structures. Existing nuclear executions apply
responsibility and penalties; the AI cannot bypass them.

`forcePreview` calls the same `Config.attackLogic` as actual combat. Its army
estimate includes both sides' climate efficiency and the central ratio cap.
It estimates one contested tile; subsequent troop loss, defenses and front
changes make the wider battle uncertain. Navy and air do not receive land
climate multipliers.

Run the actual military and deterministic AI regression tests:

```text
npx vitest run tests/ModernForces.test.ts tests/ModernAI.test.ts
```

The suite covers real territory capture, sea transport/landing, army retreat,
stop before attack initialization, finite crews, real warship movement,
aircraft damage/return/rearming, fighter and aircraft-SAM losses, invalid
orders, climate movement, per-level planning, island AI transport departure,
live convoy escort, queued sorties, capital-loss reorganization, final lethal
land/landing losses, merchant pursuit versus holding, and full core
save/restore with in-flight commands. The fixtures use real core execution,
not mocked players.

Two measurement entry points use production terrain and scenario data:

```text
npx tsx tests/perf/ModernSystemsBenchmark.ts report.json mixed 1200 2026
npx tsx tests/perf/ModernAIMatches.ts matches.json 30 3000
```

The first supports `legacy`, `idle`, `low`, `medium`, `high` and `mixed` modes.
It includes core execution and GameRunner update generation. It reports
percentile tick duration, sampled peak heap/RSS, water/rail path query counts,
fixed-seed hashes and actual AI-level counts. Path counts include cache hits.
It does not measure browser rendering, worker message transfer or network
latency. Legacy has different player and population models; compare `idle`
with active v2 presets to isolate modern decision overhead.
Legacy means the existing modern-world-v1 in this fork, with NationExecution
and enhanced profiles enabled, rather than an unmodified upstream Classic
match. Command warning counts expose existing execution failures; they are
not a count of every rejected preview or a subjective measure of wasted
strategic decisions.

The second compares high and low AI with equal starting population, gold,
army and pilots. Four real-region pairs cover small coastal continental,
temperate with overseas holdings, large arid administrative regions and high
latitude coastal conditions. Thirty seeds with both starting assignments
produce 240 matches. Other countries are neutral terrain; alliances and
nuclear weapons are disabled for the controlled comparison. It records
elimination or net geodesic area gained at the time limit (area units are
0.001 km²), deaths, air missions, economy, stalls, tick duration and state
hashes. This controlled timed score is distinct from the production victory
screen and from a full-world win-rate claim.

Measured results must identify the scenario hash and environment. Do not
treat smoke-test timings, runs concurrent with a build, or legacy/v2 player
count differences as evidence that the 20% overhead target is met.
