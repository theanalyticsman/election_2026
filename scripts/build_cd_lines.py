"""Download congressional district boundaries from the Census TIGERweb service and write small files for the map.

Usage: python scripts/build_cd_lines.py
Writes web/cd116.json, web/cd119.json, web/cd120.json (GeoJSON, geometry only, simplified to about 1 km).
Layers: 116th Congress (2018 and 2020 elections), 119th (2024 elections, also used for 2022), 120th (2026 elections, after the
mid-decade redistricting). Alaska is left out (the map draws Alaska by state House district, and its one district is the state).
Territories are left out. Re-run if the Census updates a layer.
"""
import json, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/{}/query"
UA = "election-comp-research/1.0 (personal analysis; contact apparao.prattipati@gmail.com)"
LAYERS = {"cd120": 0, "cd119": 4, "cd116": 12}
TERRITORIES = {"60", "66", "69", "72", "78"}


def fetch(layer):
    q = urllib.parse.urlencode({"where": "1=1", "outFields": "GEOID,STATE", "outSR": 4326, "f": "geojson",
                                "maxAllowableOffset": 0.01, "geometryPrecision": 3})
    req = urllib.request.Request(BASE.format(layer) + "?" + q, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


for name, layer in LAYERS.items():
    d = fetch(layer)
    feats = []
    for f in d["features"]:
        p = f["properties"]
        if p["GEOID"].endswith("ZZ") or p["STATE"] in TERRITORIES or p["STATE"] == "02" or not f.get("geometry"):
            continue  # "not defined" placeholders, territories, Alaska
        geom = f["geometry"]
        # the Census/ArcGIS ring direction is the opposite of what d3 expects (shapes would come out inside-out), so reverse every ring
        if geom["type"] == "Polygon":
            geom["coordinates"] = [ring[::-1] for ring in geom["coordinates"]]
        else:
            geom["coordinates"] = [[ring[::-1] for ring in poly] for poly in geom["coordinates"]]
        feats.append({"type": "Feature", "properties": {"g": p["GEOID"]}, "geometry": geom})
    out = ROOT / "web" / f"{name}.json"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")
    print(f"{name}: {len(feats)} districts, {out.stat().st_size:,} bytes")
    time.sleep(1)
