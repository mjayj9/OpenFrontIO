"""Offline, reproducible Natural Earth -> modern scenario input.

Run with Python + Pillow + numpy, then `go run . --maps=modernworld`.
The Go generator calls finalize.py after producing the terrain binaries.
No downloads occur here or at game start; source inputs are committed.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
policy = json.loads((HERE / "policy.json").read_text(encoding="utf8"))
features = json.loads((HERE / "source/countries.geojson").read_text(encoding="utf8"))["features"]
places = json.loads((HERE / "source/capitals.geojson").read_text(encoding="utf8"))["features"]
W, H = policy["width"], policy["height"]
def xy(lon, lat):
    return (max(0, min(W-1, int((lon+180)*W/360))), max(0, min(H-1, int((90-lat)*H/180))))
def controller(p):
    adm = p["ADM0_A3"]
    if adm in policy["excluded"]:
        return None
    return policy["overrides"].get(adm, policy["sovereignControllers"].get(p["SOV_A3"], adm))

groups = {}
for f in features:
    cid = controller(f["properties"])
    if cid:
        groups.setdefault(cid, []).append(f)
ids = sorted(groups)
countries = []
capitals = {}
for f in places:
    p = f["properties"]
    if p.get("adm0cap") == 1:
        capitals.setdefault(p.get("adm0_a3"), f)
canvas = Image.new("I", (W,H), 0)
for idx, cid in enumerate(ids, 1):
    group = groups[cid]
    primary = next((f for f in group if f["properties"]["ADM0_A3"] == cid), group[0])
    p = primary["properties"]
    capital = capitals.get(cid)
    if capital:
        cx,cy = xy(*capital["geometry"]["coordinates"])
        capital_name = capital["properties"]["name"]
    else:
        cx,cy = xy(p["LABEL_X"], p["LABEL_Y"])
        capital_name = p.get("NAME_EN", p["ADMIN"])
    for f in group:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        # Draw each feature onto its own mask so an inland lake cannot erase
        # another country's already rasterised enclave.
        mask = Image.new("1", (W,H), 0)
        draw = ImageDraw.Draw(mask)
        for rings in polys:
            draw.polygon([xy(*point) for point in rings[0]], fill=1)
            for ring in rings[1:]:
                draw.polygon([xy(*point) for point in ring], fill=0)
        canvas.paste(idx, mask=mask)
    source_name=p.get("NAME_EN",p["ADMIN"])
    # Existing public player/map labels are limited to 27 characters.
    # Keep source identity separately and use common short game labels.
    short_name={"COD":"DR Congo","FSM":"Micronesia","VCT":"St Vincent & Grenadines"}.get(cid,source_name)
    countries.append({"id":cid, "name":short_name, "sourceName":source_name, "nameKo":p.get("NAME_KO",p["ADMIN"]),
        "flag":p.get("ISO_A2_EH","").lower() if p.get("ISO_A2_EH","") != "-99" else "",
        "capitalName":capital_name, "sourceCapital":[cx,cy], "capital":[cx,cy],
        "index":idx, "represented":False})
owners = np.array(canvas, dtype=np.uint16)
for c in countries:
    ys,xs = np.where(owners == c["index"])
    if len(xs) < 9:
        x,y = c["sourceCapital"]
        owners[max(0,y-1):min(H,y+2),max(0,x-1):min(W,x+2)] = c["index"]
        c["represented"] = True
for c in countries:
    ys,xs = np.where(owners == c["index"])
    if not len(xs):
        raise ValueError("Missing country " + c["id"])
    cx,cy = c["sourceCapital"]
    distances = (xs-cx)**2 + (ys-cy)**2
    nearest = int(np.argmin(distances))
    c["capital"] = [int(xs[nearest]),int(ys[nearest])]
    c["tiles"] = int(len(xs))
    c["neighbors"] = []
for a,b in [(owners[:,:-1],owners[:,1:]),(owners[:-1,:],owners[1:,:])]:
    pairs = np.unique(np.stack((a.ravel(), b.ravel()),axis=1), axis=0)
    for x,y in pairs:
        if x and y and x != y:
            for source,target in [(x,y),(y,x)]:
                neighbors = countries[int(source)-1]["neighbors"]
                target_id = countries[int(target)-1]["id"]
                if target_id not in neighbors: neighbors.append(target_id)
for c in countries: c["neighbors"].sort()
dest = ROOT / "map-generator/assets/maps/modernworld"
dest.mkdir(parents=True, exist_ok=True)
rgb = np.full((H,W,3), 106, dtype=np.uint8)
rgb[owners != 0] = 140
Image.fromarray(rgb).save(dest / "image.png")
owners.astype("<u2").tofile(HERE / "owners.raw")
source_hashes = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((HERE / "source").glob("*.geojson"))}
scenario = {"version":1,"id":"modern-world-v1","width":W,"height":H,"source":policy["sourceVersion"],
    "policy":policy,"sourceHashes":source_hashes,"countries":countries}
(HERE / "scenario.input.json").write_text(json.dumps(scenario,ensure_ascii=False,indent=2)+"\n",encoding="utf8",newline="\n")
info = {"id":"ModernWorld","name":"Modern World","translation_key":"map.modernworld","categories":["world"],
    "multiplayer_frequency":0,"preserve_small_islands":True,
    "nations":[{"name":c["name"],"flag":c["flag"],"coordinates":c["capital"]} for c in countries]}
(dest / "info.json").write_text(json.dumps(info,ensure_ascii=False,indent=2)+"\n",encoding="utf8",newline="\n")
print(f"Generated {len(countries)} controllers, {sum(c['represented'] for c in countries)} small-country representations")
