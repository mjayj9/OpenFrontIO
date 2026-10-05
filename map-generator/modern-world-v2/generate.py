"""Offline administrative factions, actual area, climate and major-port overlay.

Inputs are pinned source archives; this script never accesses the network.
Run: python map-generator/modern-world-v2/generate.py
The v1 terrain and country ownership are read-only: all 491821 owned tiles
retain their parent controller, including explicitly enlarged microstates.
"""
from pathlib import Path
import csv
import gzip
import hashlib
import io
import json
import math
import pickle
import re
import unicodedata
import zipfile
import numpy as np
from PIL import Image, ImageDraw
import shapefile
from pyproj import Geod
from scipy.ndimage import distance_transform_edt, label
from shapely import make_valid, STRtree
from shapely.geometry import shape, Point, Polygon, MultiPolygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union, nearest_points

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SOURCE = HERE / "source"
POLICY = json.loads((HERE / "policy.json").read_text(encoding="utf8"))
V1 = json.loads((ROOT / "src/core/game/ModernWorldData.json").read_text(encoding="utf8"))
OLD_POLICY = json.loads((HERE.parent / "modern-world/policy.json").read_text(encoding="utf8"))
W, H = V1["width"], V1["height"]
GEOD = Geod(ellps="WGS84")
MIN, MAX, TARGET = (POLICY[x] for x in ["minimumAreaKm2", "maximumAreaKm2", "targetAreaKm2"])


def controller(properties, lowercase=False):
    adm = properties.get("adm0_a3" if lowercase else "ADM0_A3")
    sov = properties.get("sov_a3" if lowercase else "SOV_A3")
    if adm in OLD_POLICY["excluded"]:
        return None
    return OLD_POLICY["overrides"].get(adm, OLD_POLICY["sovereignControllers"].get(sov, adm))


def polygons(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type in ["MultiPolygon", "GeometryCollection"]:
        return [p for g in geom.geoms for p in polygons(g)]
    return []


def valid(geom):
    return unary_union(polygons(make_valid(geom)))


def area(geom):
    return sum(abs(GEOD.geometry_area_perimeter(orient(p, sign=1))[0]) / 1e6 for p in polygons(geom))


def xy(lon, lat):
    return [max(0, min(W - 1, int((lon + 180) * W / 360))), max(0, min(H - 1, int((90 - lat) * H / 180)))]


def read_shapefile(archive, stem):
    with zipfile.ZipFile(SOURCE / archive) as z:
        reader = shapefile.Reader(shp=io.BytesIO(z.read(stem + ".shp")),
                                  shx=io.BytesIO(z.read(stem + ".shx")),
                                  dbf=io.BytesIO(z.read(stem + ".dbf")), encoding="utf8")
        result = []
        for record in reader.iterShapeRecords():
            geom = shape(record.shape.__geo_interface__)
            result.append((record.record.as_dict(), geom if geom.geom_type == "Point" else valid(geom)))
        return result


def read_subunits(parent, level):
    path = SOURCE / f"{parent}-ADM{level}.geojson.gz"
    if not path.exists():
        return []
    data = json.loads(gzip.decompress(path.read_bytes()))
    result = []
    for feature in data["features"]:
        p = feature["properties"]
        result.append({"sourceId": f"gb:{p['shapeID']}", "name": p["shapeName"], "nameKo": p["shapeName"],
                       "level": level, "geometry": valid(shape(feature["geometry"]))})
    return result


def preserve_coastline(units, parent_geometry):
    """Assign each complete source-coastline residual to an existing ADM1.

    This aligns two generalized source resolutions without constructing a
    grid/straight subdivision. The original unit ID survives the adjustment.
    """
    covered = valid(unary_union([unit["geometry"] for unit in units]))
    residual = valid(parent_geometry.difference(covered))
    tree = STRtree([unit["geometry"] for unit in units])
    by_unit = {}
    for part in polygons(residual):
        matches = tree.query_nearest(part, all_matches=True)
        nearest = min((int(i) for i in matches), key=lambda i: units[i]["sourceId"])
        by_unit.setdefault(nearest, []).append(part)
    for i, fragments in by_unit.items():
        units[i]["coastlineAlignmentKm2"] = round(area(unary_union(fragments)), 2)
        units[i]["geometry"] = valid(unary_union([units[i]["geometry"], *fragments]))
    return round(area(residual), 2)


def split_oversized(unit, parent, level, sources, force=False):
    if (not force and area(unit["geometry"]) <= MAX) or level > 3:
        return [unit]
    candidates = sources.get((parent, level), [])
    if not candidates:
        return [unit]
    geom = unit["geometry"]
    selected = []
    # Each subunit is clipped to its actual enclosing ADM1; coarse coastlines
    # may differ, and the mismatch is documented rather than foreign land taken.
    for candidate in sorted(candidates, key=lambda u: u["sourceId"]):
        if not geom.intersects(candidate["geometry"]):
            continue
        clipped = valid(candidate["geometry"].intersection(geom))
        if area(clipped) < 1:
            continue
        child = dict(candidate, geometry=clipped, parentSourceId=unit["sourceId"],
                     rootAdmin1Id=unit.get("rootAdmin1Id", unit["sourceId"]),
                     sourceAdmin0Id=unit["sourceAdmin0Id"],
                     refinementReason="area-band repacking" if force else "oversized administrative unit")
        selected.append(child)
    if len(selected) < 2:
        return [unit]
    covered = valid(unary_union([child["geometry"] for child in selected]))
    # Coastline residuals belong to the nearest existing administrative unit,
    # as complete disconnected fragments, never a straight-line subdivision.
    residual = valid(geom.difference(covered))
    selected_tree = STRtree([child["geometry"] for child in selected])
    residual_by_unit = {}
    for part in polygons(residual):
        nearest_candidates = selected_tree.query_nearest(part, all_matches=True)
        nearest = min((int(i) for i in nearest_candidates), key=lambda i: selected[i]["sourceId"])
        residual_by_unit.setdefault(nearest, []).append(part)
    for nearest, fragments in residual_by_unit.items():
        selected[nearest]["geometry"] = valid(unary_union([selected[nearest]["geometry"], *fragments]))
    return [child for chosen in selected for child in split_oversized(chosen, parent, level + 1, sources)]


def adjacency(units):
    geoms = [u["geometry"] for u in units]
    tree = STRtree(geoms)
    adj = [set() for _ in units]
    epsilon = POLICY["geometryJoinToleranceDegrees"]
    for i, g in enumerate(geoms):
        for j in tree.query(g, predicate="dwithin", distance=epsilon):
            j = int(j)
            if i != j:
                adj[i].add(j)
                adj[j].add(i)
    initial_components = components(range(len(units)), adj)
    component_for_unit = {i: number for number, group in enumerate(initial_components) for i in group}
    maritime_edges = []
    # Adjacent islands inside an actual shared ADM0 constituent territory may be connected by
    # transport; this does not turn them into a land route. A 100km real
    # geodesic cap excludes arbitrary distant/overseas merging.
    for i, source in enumerate(units):
        root_admin = source.get("sourceAdmin0Id")
        if not root_admin:
            continue
        for j in range(i + 1, len(units)):
            if component_for_unit[i] == component_for_unit[j] or units[j].get("sourceAdmin0Id") != root_admin:
                continue
            a, b = geoms[i].bounds, geoms[j].bounds
            box_gap = math.hypot(max(0, a[0] - b[2], b[0] - a[2]), max(0, a[1] - b[3], b[1] - a[3]))
            angular_cap = POLICY["maximumSameAdminSeaGapKm"] / (111 * max(.05, math.cos(math.radians(max(abs(a[1]), abs(a[3]), abs(b[1]), abs(b[3]))))))
            if box_gap > angular_cap:
                continue
            p, q = nearest_points(geoms[i], geoms[j])
            gap = abs(GEOD.inv(p.x, p.y, q.x, q.y)[2]) / 1000
            if gap <= POLICY["maximumSameAdminSeaGapKm"]:
                adj[i].add(j)
                adj[j].add(i)
                maritime_edges.append({"a": source["sourceId"], "b": units[j]["sourceId"],
                    "sourceAdmin0Id": root_admin, "distanceKm": round(gap, 2), "requiresTransport": True})
    return adj, maritime_edges


def components(nodes, adj):
    remaining = set(nodes)
    groups = []
    while remaining:
        todo = [min(remaining)]
        group = set()
        while todo:
            node = todo.pop()
            if node not in remaining:
                continue
            remaining.remove(node)
            group.add(node)
            todo.extend(sorted(adj[node] & remaining, reverse=True))
        groups.append(group)
    return groups


def connected(nodes, adj):
    return not nodes or len(components(nodes, adj)) == 1


def articulation_points(nodes, adj):
    """One linear graph pass replaces candidate-by-candidate flood fills."""
    visited, low, parent, result = {}, {}, {}, set()
    clock = 0
    def visit(node):
        nonlocal clock
        visited[node] = low[node] = clock
        clock += 1
        children = 0
        for neighbor in sorted(adj[node] & nodes):
            if neighbor not in visited:
                parent[neighbor] = node
                children += 1
                visit(neighbor)
                low[node] = min(low[node], low[neighbor])
                if node not in parent and children > 1:
                    result.add(node)
                if node in parent and low[neighbor] >= visited[node]:
                    result.add(node)
            elif parent.get(node) != neighbor:
                low[node] = min(low[node], visited[neighbor])
    for node in sorted(nodes):
        if node not in visited:
            visit(node)
    return result


def objective(groups, areas):
    totals = [sum(areas[i] for i in g) for g in groups]
    # An explicit out-of-band penalty prioritises 800k..1200k over target fit.
    return (sum(max(0, MIN - a, a - MAX) for a in totals),
            sum((a - TARGET) ** 2 for a in totals), len(groups))


def cluster_component(nodes, adj, areas, wanted_override=None):
    total = sum(areas[i] for i in nodes)
    minimum_count = max(1, math.ceil(total / MAX))
    maximum_count = max(minimum_count, math.floor(total / MIN))
    wanted = max(minimum_count, min(maximum_count, round(total / TARGET)))
    if wanted_override is not None:
        wanted = max(minimum_count, min(maximum_count, wanted_override))
    else:
        counts = sorted({wanted, max(minimum_count, wanted - 1), min(maximum_count, wanted + 1)})
        if len(counts) > 1:
            options = [cluster_component(nodes, adj, areas, count) for count in counts]
            return min(options, key=lambda groups: objective(groups, areas))
    if wanted == 1:
        return [set(nodes)]
    best = None
    ordered = sorted(nodes)
    for attempt in range(POLICY["partitionAttempts"]):
        remaining = set(nodes)
        groups = []
        for group_no in range(wanted - 1):
            goal = sum(areas[i] for i in remaining) / (wanted - group_no)
            # Try deterministic leaves and geographic frontier seeds; source ID
            # order and integer hashes make regenerated choices reproducible.
            ranked = sorted(remaining, key=lambda i: (len(adj[i] & remaining),
                hashlib.sha256(f"{attempt}:{i}".encode()).hexdigest(), i))
            seed = ranked[attempt % min(8, len(ranked))]
            group = {seed}
            remaining.remove(seed)
            current = areas[seed]
            while remaining and current < goal:
                frontier = set.union(*(adj[i] for i in group)) & remaining
                articulation = articulation_points(remaining, adj)
                bundles = []
                for i in sorted(frontier):
                    bundle = {i}
                    if i in articulation:
                        branches = components(remaining - {i}, adj)
                        retained = max(branches, key=lambda branch: (sum(areas[n] for n in branch), -min(branch)))
                        bundle |= (remaining - {i}) - retained
                    added = sum(areas[n] for n in bundle)
                    if current + added <= MAX:
                        bundles.append((bundle, added, i))
                if not bundles:
                    break
                bundle, added, next_node = min(bundles, key=lambda item: (abs(current + item[1] - goal),
                    -len(adj[item[2]] & group), item[2]))
                if current >= MIN and abs(current - goal) < abs(current + added - goal):
                    break
                group.update(bundle)
                remaining.difference_update(bundle)
                current += added
            groups.append(group)
        if remaining:
            groups.extend(components(remaining, adj))
        # Move whole boundary administrative units without disconnecting either
        # region. This improves the greedy packing without cutting any unit.
        for _ in range(20):
            previous = objective(groups, areas)
            move = None
            totals = [sum(areas[i] for i in g) for g in groups]
            penalty = lambda value: max(0, MIN - value, value - MAX)
            for a, group in enumerate(groups):
                if len(group) <= 1:
                    continue
                articulation = articulation_points(group, adj)
                for i in sorted(group):
                    if i in articulation:
                        continue
                    for b, target in enumerate(groups):
                        if b == a or not (adj[i] & target):
                            continue
                        after_a, after_b = totals[a] - areas[i], totals[b] + areas[i]
                        score = (previous[0] - penalty(totals[a]) - penalty(totals[b]) + penalty(after_a) + penalty(after_b),
                            previous[1] - (totals[a] - TARGET) ** 2 - (totals[b] - TARGET) ** 2 + (after_a - TARGET) ** 2 + (after_b - TARGET) ** 2,
                            previous[2])
                        if score < previous and (move is None or score < move[0]):
                            move = (score, a, b, i)
            if move is None:
                break
            _, a, b, i = move
            groups[a].remove(i)
            groups[b].add(i)
        score = objective(groups, areas)
        if best is None or score < best[0]:
            best = (score, groups)
    return best[1]


def rasterize(geom):
    image = Image.new("1", (W, H), 0)
    draw = ImageDraw.Draw(image)
    for polygon in polygons(geom):
        draw.polygon([xy(*p) for p in polygon.exterior.coords], fill=1)
        for ring in polygon.interiors:
            draw.polygon([xy(*p) for p in ring.coords], fill=0)
    return np.asarray(image)


def runs(values):
    flat = values.ravel()
    boundaries = np.flatnonzero(np.r_[True, flat[1:] != flat[:-1], True])
    return [[int(flat[a]), int(a), int(b - a)] for a, b in zip(boundaries[:-1], boundaries[1:]) if flat[a]]


def generate():
    parent_geoms = {}
    country_sources = json.loads((HERE.parent / "modern-world/source/countries.geojson").read_text(encoding="utf8"))
    for feature in country_sources["features"]:
        parent = controller(feature["properties"])
        if parent:
            parent_geoms.setdefault(parent, []).append(valid(shape(feature["geometry"])))
    parent_geoms = {p: valid(unary_union(gs)) for p, gs in parent_geoms.items()}
    parent_areas = {p: area(g) for p, g in parent_geoms.items()}
    oversized = {p for p, a in parent_areas.items() if a > POLICY["splitThresholdKm2"]}
    print("Split parents:", ",".join(sorted(oversized)), flush=True)
    admin_by_parent = {}
    for p, geom in read_shapefile("ne-admin1-5.1.1.zip", "ne_10m_admin_1_states_provinces"):
        parent = controller(p, lowercase=True)
        if parent not in oversized:
            continue
        clipped = valid(geom.intersection(parent_geoms[parent]))
        if area(clipped) >= 1:
            admin_by_parent.setdefault(parent, []).append({"sourceId": "ne:" + p["adm1_code"],
                "name": p.get("name_en") or p["name"], "nameKo": p.get("name_ko") or p["name"],
                "level": 1, "sourceAdmin0Id": p["adm0_a3"], "geometry": clipped})
    sub_sources = {(parent, level): read_subunits(parent, level)
                   for parent in ["RUS", "AUS", "CAN", "BRA", "CHN", "USA"] for level in [2, 3]}
    coastline_alignment = {parent: preserve_coastline(units, parent_geoms[parent])
                           for parent, units in admin_by_parent.items()}
    cache_digest = hashlib.sha256((HERE / "generate.py").read_bytes() + (HERE / "policy.json").read_bytes())
    for path in sorted(SOURCE.iterdir()):
        if path.is_file():
            cache_digest.update(path.read_bytes())
    cache_digest.update(V1["hash"].encode())
    # Optional local acceleration only; no cached file is a distributable input.
    # Key includes every source, policy and generator byte. Delete this folder
    # to repeat the complete administrative partition calculation from scratch.
    cache_dir = ROOT.parent / "modern-regions-cache" / cache_digest.hexdigest()
    cache_dir.mkdir(parents=True, exist_ok=True)
    parent_tiles = np.zeros((H, W), dtype=np.uint16)
    for index, start, length in V1["runs"]:
        parent_tiles.ravel()[start:start + length] = index
    owner = np.zeros_like(parent_tiles)
    factions = []
    exceptions = []
    coverage = []
    for country in V1["countries"]:
        parent = country["id"]
        is_split = parent in oversized
        if is_split:
            cache_path = cache_dir / (parent + ".pickle")
            if cache_path.exists():
                units, areas, adj, groups, maritime_edges, refined_ids = pickle.loads(cache_path.read_bytes())
            else:
                original = admin_by_parent.get(parent, [])
                units = [child for u in original for child in split_oversized(u, parent, 2, sub_sources)]
                if not units:
                    raise ValueError("No administrative geometry for split parent " + parent)
                units.sort(key=lambda u: u["sourceId"])
                areas = [area(u["geometry"]) for u in units]
                adj, maritime_edges = adjacency(units)
                print(parent, "partition units", len(units), "components", len(components(range(len(units)), adj)), flush=True)
                groups = [group for component in components(range(len(units)), adj)
                          for group in cluster_component(component, adj, areas)]
                # A grouping can be oversized even though none of its ADM1
                # units is. Try actual smaller subdivisions of the problematic
                # units before calling that failure an area exception.
                refined_ids = []
                if sub_sources.get((parent, 2)):
                    bad_units = set.union(*(group for group in groups if sum(areas[i] for i in group) > MAX)) if any(sum(areas[i] for i in group) > MAX for group in groups) else set()
                    refined = []
                    for i, unit in enumerate(units):
                        if i in bad_units and unit["level"] == 1:
                            children = split_oversized(unit, parent, 2, sub_sources, force=True)
                            if len(children) > 1:
                                refined_ids.append(unit["sourceId"])
                            refined.extend(children)
                        else:
                            refined.append(unit)
                    if refined_ids:
                        units = sorted(refined, key=lambda u: (u["sourceId"], u.get("parentSourceId", "")))
                        areas = [area(u["geometry"]) for u in units]
                        adj, maritime_edges = adjacency(units)
                        groups = [group for component in components(range(len(units)), adj)
                                  for group in cluster_component(component, adj, areas)]
                        print(parent, "refined ADM1", refined_ids, "new units", len(units), flush=True)
                groups.sort(key=lambda g: sorted(units[i]["sourceId"] for i in g))
                cache_path.write_bytes(pickle.dumps((units, areas, adj, groups, maritime_edges, refined_ids), protocol=5))
            coverage.append({"parentCountryId": parent, "areaKm2": round(parent_areas[parent], 2),
                "adminCoverageKm2": round(sum(areas), 2), "coastlineDifferenceKm2": round(parent_areas[parent] - sum(areas), 2),
                "coastlineAlignmentKm2": coastline_alignment[parent],
                "unassignedGeometryKm2": round(area(valid(parent_geoms[parent].difference(unary_union([u["geometry"] for u in units])))), 6),
                "administrativeUnits": len(units), "regions": len(groups), "sameConstituentMaritimeEdges": maritime_edges,
                "refinedAdmin1Ids": refined_ids})
        else:
            units = [{"sourceId": "ne:adm0:" + parent, "level": 0, "name": country["sourceName"],
                      "nameKo": country["nameKo"], "geometry": parent_geoms[parent]}]
            areas = [parent_areas[parent]]
            groups = [{0}]
        local_indices = []
        local_geoms = []
        for ordinal, group in enumerate(groups, 1):
            dominant = min(group, key=lambda i: (-areas[i], units[i]["sourceId"]))
            region = units[dominant]
            fid = f"{parent}-r{ordinal:02d}" if is_split else parent
            index = len(factions) + 1
            geom = valid(unary_union([units[i]["geometry"] for i in sorted(group)]))
            actual_area = area(geom)
            exception = None
            if is_split and not MIN <= actual_area <= MAX:
                component = next(c for c in components(range(len(units)), adj) if group <= c)
                component_area = sum(areas[i] for i in component)
                if parent_areas[parent] < MIN * 2:
                    category = "parent-area-arithmetic"
                    reason = "parent total cannot form two minimum-sized regions"
                elif component_area < MIN:
                    category = "isolated-component"
                    reason = "isolated administrative/overseas component smaller than the minimum; no arbitrary overseas merge"
                elif MAX < component_area < MIN * 2:
                    category = "component-area-arithmetic"
                    reason = "connected component total cannot form two minimum-sized regions"
                else:
                    category = "administrative-packing"
                    reason = "whole administrative units and contiguity prevent an in-range partition in the bounded search"
                    if not sub_sources.get((parent, 2)):
                        reason += "; no pinned reusable lower administrative input is available for this parent"
                exception = {"reason": reason, "correction": "identical N0, base income, mobilisation and starting funds; no tile-area troop bonus",
                             "category": category, "componentAreaKm2": round(component_area, 2),
                             "deviationKm2": round(max(MIN - actual_area, actual_area - MAX, 0), 2)}
                exceptions.append({"factionId": fid, "parentCountryId": parent, "areaKm2": round(actual_area, 2), **exception})
            full_name = country["name"] + " · " + region["name"] if is_split else country["name"]
            ko_name = country["nameKo"] + " · " + region["nameKo"] if is_split else country["nameKo"]
            raw_game_name = (parent + " " + region["name"]) if is_split else country["name"]
            game_name = unicodedata.normalize("NFKD", raw_game_name).encode("ascii", "ignore").decode()
            game_name = re.sub(r"[^A-Za-z0-9 _.-]", "", game_name.replace("&", "and").replace("'", ""))[:27].strip()
            faction = {"id": fid, "factionId": fid, "parentCountryId": parent, "index": index,
                "name": full_name, "nameKo": ko_name,
                "gameName": game_name or fid,
                "flag": country["flag"], "areaKm2": round(actual_area, 2), "parentAreaKm2": round(parent_areas[parent], 2),
                "adminUnits": [{"sourceId": units[i]["sourceId"], "level": units[i]["level"], "name": units[i]["name"],
                    "unitId": units[i]["sourceId"] + "/" + units[i].get("parentSourceId", "root"),
                    "rootAdmin1Id": units[i].get("rootAdmin1Id"),
                    "sourceAdmin0Id": units[i].get("sourceAdmin0Id", parent),
                    "coastlineAlignmentKm2": units[i].get("coastlineAlignmentKm2", 0),
                    "refinementReason": units[i].get("refinementReason"),
                    "parentSourceId": units[i].get("parentSourceId"), "areaKm2": round(areas[i], 2)} for i in sorted(group)],
                "areaException": exception, "capital": country["capital"], "capitalName": country["capitalName"],
                "tiles": 0, "neighbors": [], "adaptedClimates": [], "climateDistribution": {}, "majorPortIds": [],
                "represented": country["represented"], "isSplit": is_split}
            factions.append(faction)
            mask = rasterize(geom) & (parent_tiles == country["index"])
            owner[mask] = index
            local_indices.append(index)
            local_geoms.append(geom)
        # Preserve every parent tile even where the original 50m coastline and
        # 10m administrative coastline differ. No foreign parent may fill a gap.
        missing_y, missing_x = np.where((parent_tiles == country["index"]) & (owner == 0))
        for y, x in zip(missing_y, missing_x):
            point = Point((int(x) + .5) * 360 / W - 180, 90 - (int(y) + .5) * 180 / H)
            nearest = min(range(len(local_geoms)), key=lambda i: (local_geoms[i].distance(point), local_indices[i]))
            owner[y, x] = local_indices[nearest]
        for index, geom in zip(local_indices, local_geoms):
            f = factions[index - 1]
            ys, xs = np.where(owner == index)
            if len(xs) == 0:
                raise ValueError("Administrative faction disappears at terrain resolution: " + f["id"])
            f["tiles"] = int(len(xs))
            # A regional city rather than the parent capital duplicated into
            # every region. Source point is pinned and snapped inside ownership.
            capital_point = Point((country["capital"][0] + .5) * 360 / W - 180, 90 - (country["capital"][1] + .5) * 180 / H)
            city_candidates = [p for p in CITIES if geom.covers(Point(p["lon"], p["lat"]))]
            if geom.covers(capital_point):
                candidate_xy = country["capital"]
            elif city_candidates:
                city = min(city_candidates, key=lambda p: (-p["capital"], -p["population"], p["name"]))
                candidate_xy = xy(city["lon"], city["lat"])
                f["capitalName"] = city["name"]
            else:
                point = geom.representative_point()
                candidate_xy = xy(point.x, point.y)
                f["capitalName"] = f["adminUnits"][0]["name"] + " centre"
            nearest = int(np.argmin((xs - candidate_xy[0]) ** 2 + (ys - candidate_xy[1]) ** 2))
            f["capital"] = [int(xs[nearest]), int(ys[nearest])]
        print(parent, "regions", len(local_indices), "tiles", int(np.sum(parent_tiles == country["index"])), flush=True)
    # Actual climatology, sampled by geographical coordinates. Artificial tiny
    # country footprints use the nearest measured land cell; it is documented.
    climate_source = np.asarray(Image.open(SOURCE / "koppen-1991-2020-0p1.tif"))
    source_h, source_w = climate_source.shape
    sx = np.minimum(source_w - 1, ((np.arange(W) + .5) * source_w / W).astype(int))
    sy = np.minimum(source_h - 1, ((np.arange(H) + .5) * source_h / H).astype(int))
    climate = climate_source[sy[:, None], sx[None, :]].copy()
    no_data = (climate == 0) & (owner != 0)
    if np.any(no_data):
        nearest = distance_transform_edt(climate == 0, return_distances=False, return_indices=True)
        climate[no_data] = climate[nearest[0][no_data], nearest[1][no_data]]
    lookup = np.zeros(31, dtype=np.uint8)
    lookup[1:4], lookup[4:8], lookup[8:17], lookup[17:29], lookup[29:31] = 2, 1, 3, 4, 5
    climate = lookup[climate]
    climate[owner == 0] = 0
    row_areas = np.array([abs(GEOD.polygon_area_perimeter([-180, -180 + 360 / W, -180 + 360 / W, -180],
        [90 - y * 180 / H, 90 - y * 180 / H, 90 - (y + 1) * 180 / H, 90 - (y + 1) * 180 / H])[0]) for y in range(H)])
    for f in factions:
        totals = [float(np.sum(np.bincount(np.where((owner == f["index"]) & (climate == i))[0], minlength=H) * row_areas)) for i in range(1, 6)]
        summed = sum(totals)
        percentages = [round(a * 10000 / summed) for a in totals]
        percentages[int(np.argmax(totals))] += 10000 - sum(percentages)
        f["climateDistribution"] = dict(zip(POLICY["climateIds"], percentages))
        sorted_climates = sorted(range(5), key=lambda i: (-percentages[i], i))
        f["adaptedClimates"] = [POLICY["climateIds"][sorted_climates[0]]]
        if percentages[sorted_climates[1]] >= POLICY["secondAdaptationMinimumBasisPoints"]:
            f["adaptedClimates"].append(POLICY["climateIds"][sorted_climates[1]])
    for a, b in [(owner[:, :-1], owner[:, 1:]), (owner[:-1, :], owner[1:, :])]:
        for x, y in np.unique(np.stack([a.ravel(), b.ravel()], axis=1), axis=0):
            if x and y and x != y:
                for source, target in [(int(x), int(y)), (int(y), int(x))]:
                    neighbors = factions[source - 1]["neighbors"]
                    target_id = factions[target - 1]["id"]
                    if target_id not in neighbors:
                        neighbors.append(target_id)
    for f in factions:
        f["neighbors"].sort()
    sea = owner == 0
    water_components, _ = label(sea)
    component_sizes = np.bincount(water_components.ravel())
    component_sizes[0] = 0
    # Major shipping bonuses require a coast connected to the open ocean, not
    # an isolated inland lake mistakenly treated as a maritime trade route.
    sea = water_components == int(np.argmax(component_sizes))
    coast = np.zeros_like(sea)
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        coast |= np.roll(np.roll(sea, dx, axis=1), dy, axis=0)
    coast &= owner != 0
    ports, port_skips, used_tiles = [], [], set()
    for p, geom in read_shapefile("ne-ports-5.1.2.zip", "ne_10m_ports"):
        if (p["scalerank"] > POLICY["maximumPortScaleRank"]
                and p["name"] not in POLICY["alwaysIncludePortNames"]):
            continue
        lon, lat = geom.x, geom.y
        x, y = xy(lon, lat)
        radius = POLICY["maximumPortSnapTiles"]
        y0, y1 = max(0, y - radius), min(H, y + radius + 1)
        x0, x1 = max(0, x - radius), min(W, x + radius + 1)
        port_point = Point(lon, lat)
        parent = min(parent_geoms, key=lambda candidate: (parent_geoms[candidate].distance(port_point), candidate))
        parent_index = next(c["index"] for c in V1["countries"] if c["id"] == parent)
        yy, xx = np.where(coast[y0:y1, x0:x1] & (parent_tiles[y0:y1, x0:x1] == parent_index))
        if len(xx) == 0:
            port_skips.append({"sourceId": str(p["ne_id"]), "name": p["name"], "reason": "no passable coastal tile within eight tiles"})
            continue
        yy, xx = yy + y0, xx + x0
        nearest = int(np.argmin((xx - x) ** 2 + (yy - y) ** 2))
        tile = [int(xx[nearest]), int(yy[nearest])]
        if tuple(tile) in used_tiles:
            port_skips.append({"sourceId": str(p["ne_id"]), "name": p["name"], "reason": "same coarse terrain tile as another major port"})
            continue
        used_tiles.add(tuple(tile))
        faction = factions[int(owner[tile[1], tile[0]]) - 1]
        port_id = "ne-port-" + str(p["ne_id"])
        ports.append({"portId": port_id, "name": p["name"], "lon": lon, "lat": lat, "tile": tile,
            "factionId": faction["id"], "parentCountryId": faction["parentCountryId"], "sourceId": str(p["ne_id"]),
            "initialLevel": POLICY["initialMajorPortLevel"], "scaleRank": p["scalerank"],
            "snapDistanceKm": round(GEOD.inv(lon, lat, (tile[0] + .5) * 360 / W - 180, 90 - (tile[1] + .5) * 180 / H)[2] / 1000, 2)})
        faction["majorPortIds"].append(port_id)
    ports.sort(key=lambda p: p["portId"])
    source_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(SOURCE.iterdir()) if p.is_file()}
    result = {"version": 2, "scenarioId": POLICY["scenarioId"], "parentScenarioHash": V1["hash"],
        "terrainHash": V1["terrainHash"], "width": W, "height": H, "projection": OLD_POLICY["projection"],
        "areaMethod": "WGS84 ellipsoidal geodesic polygon area, pyproj.Geod; actual land geometries, not map pixels",
        "splitPolicy": POLICY, "factions": factions, "runs": runs(owner), "climateRuns": runs(climate),
        "ports": ports, "exceptions": exceptions, "administrativeCoverage": coverage,
        "climateCoastalFallbackTiles": int(np.sum(no_data)), "unrepresentedPorts": port_skips, "sourceHashes": source_hashes}
    result["hash"] = hashlib.sha256(json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    content = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    (ROOT / "src/core/game/ModernRegionsData.json").write_text(content, encoding="utf8", newline="\n")
    (HERE / "generated-summary.json").write_text(json.dumps({k: v for k, v in result.items() if k not in ["factions", "runs", "climateRuns"]}, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    with (HERE / "factions.csv").open("w", newline="", encoding="utf8") as out:
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(["factionId", "parentCountryId", "name", "areaKm2", "tiles", "capitalName", "climates", "exception"])
        for f in factions:
            writer.writerow([f["id"], f["parentCountryId"], f["name"], f["areaKm2"], f["tiles"], f["capitalName"], ",".join(f["adaptedClimates"]), f["areaException"]["reason"] if f["areaException"] else ""])
    owner.astype("<u2").tofile(HERE / "owners.raw")
    climate.astype("u1").tofile(HERE / "climate.raw")
    print("Generated", len(factions), "factions", len(exceptions), "exceptions", len(ports), "ports; hash", result["hash"], flush=True)


CITIES = []
for feature in json.loads((HERE.parent / "modern-world/source/capitals.geojson").read_text(encoding="utf8"))["features"]:
    p = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"]
    CITIES.append({"lon": lon, "lat": lat, "name": p["name"], "population": p.get("pop_max", 0) or 0,
                   "capital": (p.get("adm0cap", 0) or 0) * 2 + (p.get("adm1cap", 0) or 0)})

if __name__ == "__main__":
    generate()
