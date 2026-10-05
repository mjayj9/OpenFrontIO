"""Regenerate offline and assert byte-identical scenario outputs."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
paths = [ROOT / "src/core/game/ModernRegionsData.json",
         HERE / "owners.raw", HERE / "climate.raw", HERE / "factions.csv",
         HERE / "generated-summary.json"]


def digests():
    return {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths}


before = digests()
started = time.perf_counter()
with (HERE / "reproduction.log").open("w", encoding="utf8", newline="\n") as log:
    subprocess.run([sys.executable, str(HERE / "generate.py")], cwd=ROOT,
                   stdout=log, stderr=subprocess.STDOUT, check=True)
after = digests()
assert before == after, "Regeneration changed output bytes; inspect reproduction.log"
subprocess.run([sys.executable, str(HERE / "validate.py")], cwd=ROOT, check=True)
report = {"scenarioHash": json.loads(paths[0].read_text(encoding="utf8"))["hash"],
          "byteIdentical": True, "elapsedSeconds": round(time.perf_counter() - started, 3),
          "filesBefore": before, "filesAfter": after,
          "command": "python map-generator/modern-world-v2/reproduce.py",
          "networkAccess": False, "cache": "optional derived cache, keyed by every generator, policy, source and parent byte"}
(HERE / "reproducibility.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8", newline="\n")
print(json.dumps(report, indent=2))
