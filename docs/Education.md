# Public feature education

The existing state-based tutorial is reused. The new curriculum version is 2.
The basic course has seven steps and targets 5–8 minutes; completion time has not
yet been measured across devices or player skill. Optional economy, naval,
diplomacy and weapons chapters can be started independently from Help or the
in-game chapter selector. The full legacy sequence remains available.

`src/client/education/FeatureRegistry.ts` is the public feature inventory. Each
feature has a stable `featureId`, available modes, a help anchor, prerequisites,
an exercise or inspection, completion evidence, and related intents, settings,
units and existing practical steps. Help searches titles and all lesson fields
in the selected language and links directly from an in-game exercise.

| Chapter   | Public feature IDs                                                                                                                                                                                                                                                             | Evidence                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Basic     | spawn, resources, attack, attack_ratio                                                                                                                                                                                                                                         | Spawn phase ended; owned land grew; real opponent conquest; ratio changed                                              |
| Economy   | city, factory, defense                                                                                                                                                                                                                                                         | Newly completed owned facility; train explanation is read separately                                                   |
| Naval     | transport, port, warship                                                                                                                                                                                                                                                       | Transport observed afloat; newly completed port or warship                                                             |
| Diplomacy | alliance                                                                                                                                                                                                                                                                       | Active alliance; traitor explanation is read separately                                                                |
| Weapons   | silo, nukes, sam                                                                                                                                                                                                                                                               | Newly completed silo; atom bomb in flight; weapon/defense rules read separately                                        |
| Reference | camera, identity, retreat, fronts, upgrade, delete, trade, support, embargo, target, communication, modes, ai, lobby, rules, doomsday, spectator, keybindings, mobile, accessibility, audio, pause_speed, save, replay, results, account, profile, clan, statistics, cosmetics | Searchable explanation and inspection; these entries do **not** claim automatic practical completion                   |
| Modern    | modern                                                                                                                                                                                                                                                                         | Country selection, scenario borders, starting economy, actual conquest and result explained; no false completion check |

The practical expansion step no longer completes at attack launch. It requires
actual tile ownership growth. The tribe exercise no longer completes just by
banking city money; it requires a real `ConquestEvent`. Facility completion checks
exclude inactive units and construction sites. Repeating a construction chapter
requires a newly completed facility beyond the baseline count. Existing coast,
worker-reported cost, disabled-unit, alliance, touch and silo-reload guidance is
retained. Key guidance reads the effective `UserSettings.keybinds()` map each time
and displays unassigned controls without falling back to an obsolete default.

Outcomes are `practiced`, `read`, `skipped` or `unavailable`. Chapter selection,
repeat, hint, guide pause, hide, resume and help are available from the panel.
Pausing the guide does not pause the match. A separate game control handles that.
Progress is stored under `education.progress.v2.<chapter>`, with cursor, evidence
baseline and outcomes. A new education version uses another key and leaves older
data in place. Storage failure is surfaced and does not show false save success.
This course store is **not** a saved simulation: running-game save/restore uses
the existing core snapshot architecture through the local game's save controls.
The panel exposes `educationSnapshot` and `restoreEducationSnapshot` for that
integration, including latched transport/launch/conquest evidence.

All new UI text uses `translateText`. English and Korean source additions are in
`resources/education/`. The personal fork's explicit Korean request takes
precedence over the upstream en-only contribution rule; upstream translations
should still follow Crowdin. These dictionaries are merged into
`resources/lang/en.json` and `resources/lang/ko.json` and use the existing loader.
No external account, statistics, clan or shop implementation is claimed here.
Their reference entries identify required account/service conditions.

Run the repository's supported test runner:

```sh
npx vitest tests/Tutorial.test.ts tests/EducationCoverage.test.ts --run
```

`EducationCoverage.test.ts` checks every actual public `IntentSchema` variant,
every `UnitType` (including automatically spawned trains, trade ships, shells,
SAM missiles and MIRV warheads), and every root `GameConfigSchema` field. Internal
protocol/admin fields have explicit exclusions and reasons. The test also checks
all practical steps, unique IDs/links, English/Korean metadata, translated search,
version rejection and quota failure. When adding an intent, unit or configuration
field, add its feature linkage or a justified internal exclusion. For a new public
UI action not represented in those schemas, update this inventory during review;
the test cannot discover arbitrary controls by itself.

The dedicated `training:true` single-player initialization uses a stable raster
search and bounded land traversal to prepare 1,200 legal coastal tiles, 100,000
internal raw troop units (10,000 displayed troops, subject to the actual troop
cap), 10M gold, an adjacent 120-tile weak tribe,
and a cooperative coastal nation sharing reachable water. The tribe's reserve is
capped at 3,000; the partner accepts a real incoming alliance request. Normal
human/bot/nation spawning is skipped. Resources and these advantages are disclosed
before and during training. Construction, attacks and alliances still run through
the existing executions. Snapshots preserve initialization and the training cap.

`TrainingExecution.test.ts` validates actual legal initial ownership, shared
coastal access, real conquest events, completed construction, accepted alliance,
disabled ports and snapshot continuation before and after initialization.

Remaining teaching limitations: only the existing practical actions have
automatic checks. Advanced reference actions and camera/navigation are explained
and inspectable but not scored. Naval routes, building prerequisites and nuclear
cooldowns still follow the actual rules, with reason-specific existing guidance
plus skip/retry. Controlled opponent responses and automatic practical checks for
every advanced command are further work. The safe preparation removes the
random-coast and uncooperative-alliance blockers for the supported training map.
