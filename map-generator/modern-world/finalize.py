"""Align country runs with generated terrain and write immutable runtime data."""
from pathlib import Path
import hashlib
import json
import numpy as np
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
dest = ROOT / "resources/maps/modernworld"
scenario = json.loads((HERE / "scenario.input.json").read_text(encoding="utf8"))
owners = np.fromfile(HERE / "owners.raw",dtype="<u2")
terrain = np.fromfile(dest / "map.bin",dtype=np.uint8)
if len(owners) != len(terrain): raise ValueError("Terrain dimensions changed")
land = ((terrain & 128) != 0) & ((terrain & 31) != 31)
owners[~land] = 0
if np.any(land & (owners == 0)): raise ValueError("Unassigned traversable land")
runs = []
start = 0
for pos in range(1,len(owners)+1):
    if pos == len(owners) or owners[pos] != owners[start]:
        if owners[start]: runs.append([int(owners[start]),start,pos-start])
        start = pos
scenario["runs"] = runs
scenario["terrainHash"] = hashlib.sha256(terrain.tobytes()).hexdigest()
scenario["hash"] = hashlib.sha256(json.dumps(scenario,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
(dest / "scenario.json").write_text(json.dumps(scenario,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf8",newline="\n")
# Import metadata/runs at build time: gameplay never depends on a live service.
(ROOT / "src/core/game/ModernWorldData.json").write_text(json.dumps(scenario,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf8",newline="\n")
print(f"Finalized {len(runs)} country runs, hash {scenario['hash']}")
