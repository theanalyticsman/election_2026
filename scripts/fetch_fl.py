"""Fetch Florida's official election-night files and load the 2026 U.S. Senate county results.

Usage: python scripts/fetch_fl.py [--date 20261103] [--no-load] [--dem Nixon] [--rep Moody]
Source: https://flelectionfiles.floridados.gov/enightfilespublic/ (plain files, no login).
Re-runnable: rows are upserted, so run it every few minutes on election night.

The feed carries no party, so --dem / --rep name the candidates by last name; every other
candidate counts as "other". Florida 2026 U.S. Senate is the special election for Rubio's seat.
"""
import argparse, csv, subprocess, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/processed/county_results_2026_fl.csv"
BASE = "https://flelectionfiles.floridados.gov/enightfilespublic/{d}_ElecResultsFL_PipeDlm_{k}.txt"
UA = "election-comp-research/1.0 (personal analysis; contact apparao.prattipati@gmail.com)"
CONTEST = "120000"  # United States Senator
FIELDS = ["year", "office", "race", "state_po", "county_fips", "county_name", "dem_votes",
          "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"]

ap = argparse.ArgumentParser()
ap.add_argument("--date", default="20261103")
ap.add_argument("--dem", default="Nixon")
ap.add_argument("--rep", default="Moody")
ap.add_argument("--no-load", action="store_true")
a = ap.parse_args()


def get(kind):
    req = urllib.request.Request(BASE.format(d=a.date, k=kind), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8-sig").splitlines()


def recs(lines, tag):
    for ln in lines:
        p = ln.strip().strip("[]").split("|")
        if p and p[0] == tag:
            yield p


info, votes = get("Info"), get("Votes")
cands = {p[6]: (p[4], p[5]) for p in recs(info, "c") if p[3] == CONTEST}  # id -> (last, first)
names = {p[4]: p[3] for p in recs(info, "u")}  # county code -> name
if not cands:
    sys.exit(f"No U.S. Senator candidates (contest {CONTEST}) in the {a.date} Info file.")
print("Candidates:", ", ".join(f"{f} {l}" for l, f in cands.values()))
dem_id = next((i for i, (l, _) in cands.items() if l.lower() == a.dem.lower()), None)
rep_id = next((i for i, (l, _) in cands.items() if l.lower() == a.rep.lower()), None)
if not (dem_id and rep_id):
    sys.exit(f"--dem {a.dem!r} / --rep {a.rep!r} not found among the candidates above.")

by = {}  # county code -> {candidate id: votes}
for p in recs(votes, "V"):
    # V | agency | seq | type | contest | county | precincts reporting | candidate | votes
    if p[4] == CONTEST and p[7] in cands:
        by.setdefault(p[5], {})[p[7]] = int(p[8] or 0)

rows = []
for code, v in sorted(by.items()):
    d, r = v.get(dem_id, 0), v.get(rep_id, 0)
    o = sum(x for i, x in v.items() if i not in (dem_id, rep_id))
    rows.append({"year": 2026, "office": "senate", "race": "special", "state_po": "FL", "county_fips": code.zfill(5),
                 "county_name": names.get(code, ""), "dem_votes": d, "rep_votes": r, "other_votes": o,
                 "total_votes": d + r + o, "dem_candidate": f"{cands[dem_id][1]} {cands[dem_id][0]}",
                 "rep_candidate": f"{cands[rep_id][1]} {cands[rep_id][0]}"})
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, FIELDS); w.writeheader(); w.writerows(rows)
tot = sum(r["total_votes"] for r in rows)
print(f"{len(rows)} counties, {tot:,} votes counted (D {sum(r['dem_votes'] for r in rows):,}, R {sum(r['rep_votes'] for r in rows):,}).")
if a.no_load:
    sys.exit(0)
if tot == 0:
    print("No votes counted yet; nothing loaded."); sys.exit(0)
subprocess.run([sys.executable, "-I", str(ROOT / "scripts/load_supabase.py"), str(OUT)], check=True)
