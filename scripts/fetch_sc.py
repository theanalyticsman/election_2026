"""Fetch South Carolina's official election-night results (Clarity ENR) and load 2026 U.S. Senate county rows.

Usage: python scripts/fetch_sc.py [--no-load] [--election 127300]
Source: https://www.enr-scvotes.org/SC/<election>/ (public JSON, no login). Re-runnable.
Party comes from the feed (DEM / REP; every other candidate counts as other).
"""
import argparse, csv, gzip, json, subprocess, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/processed/county_results_2026_sc.csv"
UA = "election-comp-research/1.0 (personal analysis; contact apparao.prattipati@gmail.com)"
KEY = "26000"  # U.S. Senate
FIELDS = ["year", "office", "race", "state_po", "county_fips", "county_name", "dem_votes",
          "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"]

ap = argparse.ArgumentParser()
ap.add_argument("--election", default="127300")
ap.add_argument("--no-load", action="store_true")
a = ap.parse_args()
BASE = f"https://www.enr-scvotes.org/SC/{a.election}/"


def get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read()
    return gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b


ver = get("current_ver.txt").decode().strip()
summ = json.loads(get(f"{ver}/json/en/summary.json"))
con = next((c for c in summ if c["K"] == KEY), None)
if not con:
    sys.exit(f"Contest {KEY} (U.S. Senate) not found in election {a.election}.")
chs, parties = con["CH"], con["P"]  # "REP Darline Graham", party codes
print("Candidates:", ", ".join(chs))
di, ri = parties.index("DEM"), parties.index("REP")
cname = lambda i: chs[i].split(" ", 1)[1] if " " in chs[i] else chs[i]

counties = [c for c in json.loads(get(f"{ver}/json/ALL.json"))["Contests"] if c["A"] != "-1" and c["A"]]
counties.sort(key=lambda c: c["A"])
if len(counties) != 46:
    sys.exit(f"Expected 46 counties, got {len(counties)}; refusing to guess FIPS codes.")
rows = []
for n, c in enumerate(counties):  # SC county FIPS are odd numbers in alphabetical order: 45001 ... 45091
    v = c["V"][c["C"].index(KEY)]
    d, r = v[di], v[ri]
    o = sum(v) - d - r
    rows.append({"year": 2026, "office": "senate", "race": "regular", "state_po": "SC", "county_fips": str(45001 + 2 * n),
                 "county_name": c["A"], "dem_votes": d, "rep_votes": r, "other_votes": o, "total_votes": d + r + o,
                 "dem_candidate": cname(di), "rep_candidate": cname(ri)})
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, FIELDS); w.writeheader(); w.writerows(rows)
tot = sum(r["total_votes"] for r in rows)
print(f"{len(rows)} counties, {tot:,} votes counted (D {sum(r['dem_votes'] for r in rows):,}, R {sum(r['rep_votes'] for r in rows):,}).")
if a.no_load:
    sys.exit(0)
if tot == 0:
    print("No votes counted yet; nothing loaded."); sys.exit(0)
subprocess.run([sys.executable, "-I", str(ROOT / "scripts/load_supabase.py"), str(OUT)], check=True)
