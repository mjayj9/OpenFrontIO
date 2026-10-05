"""Independent generated-data checks; nonzero exit means the data is invalid."""
from pathlib import Path
import hashlib
import json
import re
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
data = json.loads((ROOT / "src/core/game/ModernRegionsData.json").read_text(encoding="utf8"))
old = json.loads((ROOT / "src/core/game/ModernWorldData.json").read_text(encoding="utf8"))
assert data["parentScenarioHash"] == old["hash"]
assert data["terrainHash"] == old["terrainHash"]
terrain_path = ROOT / "resources/maps/modernworld/map.bin"
assert hashlib.sha256(terrain_path.read_bytes()).hexdigest() == data["terrainHash"], "actual terrain file changed"
terrain = np.frombuffer(terrain_path.read_bytes(), dtype=np.uint8)
assert len(terrain) == old["width"] * old["height"]
hash_input = {k: v for k, v in data.items() if k != "hash"}
assert hashlib.sha256(json.dumps(hash_input, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest() == data["hash"]
for name, digest in data["sourceHashes"].items():
    assert hashlib.sha256((HERE / "source" / name).read_bytes()).hexdigest() == digest, name
size = old["width"] * old["height"]
parent = np.zeros(size, dtype=np.uint16)
for index, start, length in old["runs"]:
    parent[start:start + length] = index
owner = np.zeros(size, dtype=np.uint16)
seen = np.zeros(size, dtype=np.uint8)
for index, start, length in data["runs"]:
    assert 1 <= index <= len(data["factions"])
    assert length > 0 and 0 <= start < start + length <= size
    assert not np.any(seen[start:start + length]), "duplicate ownership"
    seen[start:start + length] += 1
    owner[start:start + length] = index
assert np.array_equal(owner != 0, parent != 0), "parent land union changed"
assert np.all((terrain[owner != 0] & 128) != 0), "ownership assigned to water"
assert np.all((terrain[owner != 0] & 31) != 31), "ownership assigned to impassable terrain"
parent_by_id = {country["id"]: country for country in old["countries"]}
mapped_parent = np.zeros(size, dtype=np.uint16)
ids = set()
all_sources = set()
exceptions = {entry["factionId"]: entry for entry in data["exceptions"]}
split_parent_ids = set()
for faction in data["factions"]:
    assert faction["id"] not in ids
    ids.add(faction["id"])
    assert 1 <= len(faction["gameName"]) <= 27 and re.fullmatch(r"[A-Za-z0-9 _.-]+", faction["gameName"]), "illegal wire game name"
    cells = owner == faction["index"]
    assert int(np.sum(cells)) == faction["tiles"] > 0
    country = parent_by_id[faction["parentCountryId"]]
    assert np.all(parent[cells] == country["index"]), "region escaped parent"
    mapped_parent[cells] = country["index"]
    x, y = faction["capital"]
    assert owner[y * old["width"] + x] == faction["index"], "invalid regional centre"
    assert sum(faction["climateDistribution"].values()) == 10000
    assert 1 <= len(faction["adaptedClimates"]) <= 2
    if faction["isSplit"]:
        split_parent_ids.add(faction["parentCountryId"])
        in_range = 800000 <= faction["areaKm2"] <= 1200000
        assert in_range == (faction["areaException"] is None), "exception hidden or unnecessary"
        if not in_range:
            assert faction["id"] in exceptions and faction["areaException"]["reason"]
            assert faction["areaException"]["correction"]
    else:
        assert faction["id"] == country["id"] and faction["parentAreaKm2"] <= 1200000
        assert np.array_equal(cells, parent == country["index"]), "small country resized"
    for source in faction["adminUnits"]:
        assert source["unitId"] not in all_sources, "administrative piece assigned twice"
        all_sources.add(source["unitId"])
assert np.array_equal(parent, mapped_parent), "national territory not conserved"
assert split_parent_ids == {entry["parentCountryId"] for entry in data["administrativeCoverage"]}
assert all(entry["unassignedGeometryKm2"] <= 0.01 for entry in data["administrativeCoverage"]), "source geographic union not conserved"
climate = np.zeros(size, dtype=np.uint8)
for index, start, length in data["climateRuns"]:
    assert 1 <= index <= 5 and length > 0
    assert not np.any(climate[start:start + length]), "duplicate climate assignment"
    climate[start:start + length] = index
assert np.array_equal(climate != 0, parent != 0)
port_ids, port_tiles = set(), set()
for port in data["ports"]:
    assert port["portId"] not in port_ids and tuple(port["tile"]) not in port_tiles
    port_ids.add(port["portId"])
    port_tiles.add(tuple(port["tile"]))
    faction = next(f for f in data["factions"] if f["id"] == port["factionId"])
    x, y = port["tile"]
    assert owner[y * old["width"] + x] == faction["index"]
    assert port["portId"] in faction["majorPortIds"]
    assert port["initialLevel"] == 0, "initial major-port bonus breaks equal starting income"
    assert any(owner[yy * old["width"] + xx] == 0 for xx, yy in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)] if 0 <= xx < old["width"] and 0 <= yy < old["height"])
report = {"hash": data["hash"], "parentHash": old["hash"], "factions": len(data["factions"]),
          "splitParents": len(split_parent_ids), "splitRegions": sum(f["isSplit"] for f in data["factions"]),
          "inRangeRegions": sum(f["isSplit"] and f["areaException"] is None for f in data["factions"]),
          "exceptions": len(exceptions), "conservedTiles": int(np.sum(parent != 0)), "uniqueAdminUnits": len(all_sources),
          "ports": len(port_ids), "climateTiles": int(np.sum(climate != 0)), "allChecksPassed": True}
(HERE / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8", newline="\n")
print(json.dumps(report, indent=2))
