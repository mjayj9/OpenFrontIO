# Modern World v1

This fork adds an actual ownership scenario using the existing core, Intent /
Execution, Lit, WebGL and Worker architecture. Country identity is distinct from
controller type and player id. A selected human replaces that country's AI;
all other countries keep their own initial tiles. Classic remains opt-in free.

## Scope and policy

The first scenario has **198 controllers at 2000×1000**, 491,821 passable land
tiles and 13,726 ownership runs. Input is Natural Earth vector **5.1.1**, 50m
admin-0 countries and populated places, downloaded 2026-10-04 from the pinned
[countries](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.1/geojson/ne_50m_admin_0_countries.geojson)
and [places](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.1/geojson/ne_50m_populated_places_simple.geojson)
files. Natural Earth is public domain. No live boundary downloads are used.
The source version is the data reference, not a claim of current 2026 borders.
**198 is the number of playable scenario controllers**, not UN members or a
claim that every controller is a recognized sovereign country. Some country ids
are Natural Earth scenario codes rather than strict ISO3 codes.

Plate Carrée projection covers longitude −180…180 and latitude 90…−90.
The policy in `map-generator/modern-world/policy.json` groups dependencies with
explicit sovereign controllers, retains Palestine/Taiwan separately, maps
Somaliland→Somalia, Northern Cyprus→Cyprus and Western Sahara→Morocco, and omits
Antarctica and the listed Antarctic dependencies. These are game groupings.
Overseas and detached polygons retain their controller. There is no east/west
world wrapping: naval movement uses existing map routes.

The policy's default retention of `ADM0_A3` also keeps `KAS` (Siachen Glacier)
as a separate **disputed-area strategic controller**. Its committed ownership
is 11 tiles, it has no flag, and its capital marker is a strategic source-label
position rather than a claim of a real national capital. It borders the CHN,
IND and PAK controllers in this raster. `KOS` (Kosovo), `PSX` (Palestine) and
`TWN` (Taiwan) are also separate scenario controllers. These choices describe
playable game groupings; they make no claim of diplomatic recognition or
territorial sovereignty.

Twenty-one tiny countries get an explicit enlarged 3×3 footprint at a source
capital/label point. The selector labels these. This necessarily alters nearby
coastlines. Capital positions use a source capital where available and otherwise
a documented strategic label fallback, then are aligned to a country's valid
tile. Islands below the generator's normal threshold are preserved. Low
resolution simplifies borders, enclaves and straits; the committed country list
defines support, not every source dependency as an independent nation.

## Play

Main → Modern countries → map click, search or list → settings → Start.
Each controller receives a capital city, factory and a legal coastal port where
possible. Disabled structures are respected. Balanced gives the same treasury
and troop grant; territory/cities still affect actual troop capacity. Asymmetric
uses disclosed area-based **game values**, not real GDP or armed forces figures.
Captured useful structures remain part of normal core gameplay.

Territory share, capital share, timed territory score and complete conquest use
the existing winner event/result pipeline. All objectives fall back to largest
territory at the configured time limit. Initial protection, alliances, nuclear
weapons and optional total transfer after capital loss are explicit settings.
The default capital rule allows recovery. AI profiles use the existing four
difficulties; fair resources separates decisions from classic resource bonuses.

Initial rail connections are deterministically staggered by unit id. They form
gradually during the first two minutes. Modern rail searches have a fixed 4,096
iteration cap to avoid expensive impossible island routes; unusually long
detours can fail to connect. Classic rail rules are unchanged.

## Regeneration and validation

Install Python, Pillow/numpy from `requirements.txt`, and the repository's Go
version. From `map-generator` run:

```powershell
python modern-world/generate.py
$env:MODERN_WORLD_PYTHON = 'python'
go run . --maps=modernworld
```

The Python input stage writes map image/manifest input and ownership indices.
The existing Go generator produces terrain and generated map registry. Its
modern hook aligns ownership to actual passable terrain, rejects unassigned
land, produces version/hash/source hashes, and writes the build-time core data.
Do not edit generated scenario/map files by hand.

`tests/ModernWorld.test.ts` runs the real generated terrain and checks all
controllers, tile counts/borders, capitals/facilities, the twelve requested
country selections, actual Korean attack/conquest, win rules and snapshot
continuation. A mode-specific initializer is excluded from the Classic-only
execution coverage assertion and tested separately. Performance limitations and
actual browser results are recorded in the fork delivery report.
