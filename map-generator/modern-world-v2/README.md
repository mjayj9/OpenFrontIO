# Reproducible modern administrative regions

Install the versions in `requirements.txt` in a Python environment, then run
from the repository root:

```sh
python map-generator/modern-world-v2/generate.py
python map-generator/modern-world-v2/validate.py
python map-generator/modern-world-v2/reproduce.py
python map-generator/modern-world-v2/report.py
```

All inputs are committed and every input byte is hashed in the generated
scenario. The generator performs no network access. To repeat the complete
partition search, delete the task-local `../modern-regions-cache` directory;
the optional cache key includes generator, policy, input and parent-scenario
bytes. Regeneration writes v2 outputs only. It never edits v1 terrain,
ownership, data or in-progress v1 saves.

The pipeline computes actual WGS84 geodesic polygon land area, selects every
parent controller exceeding 1.2 million km², preserves ADM1 units, replaces
oversized units with actual ADM2 (and oversized Canadian ADM2 with ADM3), and
searches connected partitions using whole administrative units. It never
draws a straight or grid cut to manufacture the target range. Islands and
overseas components can produce explicit area exceptions. The bounded search
does not prove a globally optimal partition; its unresolved exceptions are
published instead of called mathematically unavoidable.

The immutable parent country tile mask is applied last. Complete coastline
residual fragments between 50m countries and 10m/subadministrative sources
are assigned to the nearest original administrative unit within the same
parent before partitioning; the geographical parent union is conserved too.
Residual game pixels are assigned to the nearest region of their own parent.
Every traversable tile is assigned
once; all enlarged tiny-state representations remain exactly as in v1.
Actual geographical area remains separate from these game representations.

Disconnected administrative units may be grouped only inside the same original
ADM0 constituent territory and across a real sea gap no greater than 100 km.
These recorded edges require transport; they do not create a land route.
Distant overseas possessions stay independent. The 64 deterministic bounded
partition attempts preserve connectivity, refine oversize ADM1 units and try
actual ADM2 boundaries again when an oversized grouping can be repacked.

Major ports start closed at development level zero. The common starting
population, income and funds are game rules maintained by the v2 core; actual
country populations, projected tile count and coastline snapping confer no
starting-resource bonus. A named regional centre may be a valid geographic
centre where the pinned city data contains no administrative seat; this is
explicitly labelled rather than presented as an official capital.

Output `ModernRegionsData.json` contains independent faction IDs, parent IDs,
geodesic areas, original administrative IDs, initial ownership runs, climate
runs, regional adaptation distributions, source hashes, centres, adjacency,
real major-port coordinates and documented snapping/omission. `factions.csv`
and `generated-summary.json` make the area exceptions and source coverage
reviewable. See `LICENSES.md` for the independent third-party data licenses.

`reproduce.py` compares the SHA-256 of all five distributable outputs before
and after regeneration and writes the actual result to `reproducibility.json`.
`report.py` renders the full exception table, actual validation and source
limitations to `docs/ModernRegions.md` and the workspace's Korean output
report. It never reports a missing reproduction result as successful.

The pinned Greenland administrative source contains historical Qaasuitsup
boundaries. No lower Greenland geometry with confirmed reuse rights was added;
the remaining oversized Greenland grouping is a disclosed data limitation,
not a claim that an in-range partition is mathematically impossible.
