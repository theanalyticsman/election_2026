"""Load Michigan's official county results file (tab-delimited, "..._CENR_BY_COUNTY.txt") for the U.S. Senate.

Usage: python scripts/import_mi.py path/to/file.txt [--no-load] [--allow-any-date]
Download the file from Michigan's election results site on election night, then run this on it.
Democratic / Republican come from PartyDescription; every other party and write-ins count as other.
Refuses files that are not the Nov 3, 2026 general (a primary would add up several candidates per party).
"""
import argparse, csv, subprocess, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/processed/county_results_2026_mi.csv"
FIELDS = ["year", "office", "race", "state_po", "county_fips", "county_name", "dem_votes",
          "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"]

ap = argparse.ArgumentParser()
ap.add_argument("file", nargs="?", default=str(Path.home() / "Downloads" / "election_night"),
                help="results file, or a folder (default ~/Downloads/election_night): the newest .txt in it is used")
ap.add_argument("--no-load", action="store_true")
ap.add_argument("--allow-any-date", action="store_true", help="testing only: accept a primary file")
a = ap.parse_args()

src = Path(a.file)
if src.is_dir():
    # other states' downloads can share the folder, so prefer Michigan's county file name, else any .txt
    found = sorted(src.glob("*MI_CENR_BY_COUNTY*.txt") or src.glob("*.txt"), key=lambda p: p.stat().st_mtime)
    if not found:
        sys.exit(f"No .txt file in {src}. Download Michigan's county results file into that folder first.")
    src = found[-1]
print(f"Reading {src.name} (saved {__import__('datetime').datetime.fromtimestamp(src.stat().st_mtime):%H:%M:%S})")
lines = src.read_text(encoding="utf-8-sig", errors="replace").splitlines()
hi = next(i for i, l in enumerate(lines) if l.startswith("ElectionDate"))
rows = list(csv.DictReader(lines[hi:], delimiter="\t", restval=""))
sen = [r for r in rows if "UNITED STATES SENATOR" in r["OfficeDescription"].upper()]
if not sen:
    sys.exit("No U.S. Senator rows in this file.")
dates = {r["ElectionDate"] for r in sen}
if dates != {"2026-11-03"} and not a.allow_any_date:
    sys.exit(f"This file is for {sorted(dates)}, not the 2026-11-03 general election; refusing to load it.")

tot = defaultdict(lambda: {"DEM": 0, "REP": 0, "OTH": 0})
names, cand = {}, {}
for r in sen:
    code = int(r["CountyCode"])
    if not 1 <= code <= 83:  # statewide or other non-county lines
        continue
    v = int(r["CandidateVotes"] or 0)
    p = r["PartyDescription"].strip().upper()
    k = "DEM" if p.startswith("DEM") else "REP" if p.startswith("REP") else "OTH"
    if r["WriteIn(W)/Uncommitted(Z)"].strip():
        k = "OTH"
    tot[code][k] += v
    names[code] = r["CountyName"].title()
    if k != "OTH":
        cand.setdefault(k, set()).add(f'{r["CandidateFirstName"]} {r["CandidateLastName"]}'.strip())
if len(tot) != 83:
    sys.exit(f"Expected 83 counties, found {len(tot)}.")
out = []
for code in sorted(tot):  # Michigan county codes are alphabetical 1..83; FIPS are the odd numbers 26001..26165
    t = tot[code]
    out.append({"year": 2026, "office": "senate", "race": "regular", "state_po": "MI", "county_fips": str(26001 + 2 * (code - 1)),
                "county_name": names[code], "dem_votes": t["DEM"], "rep_votes": t["REP"], "other_votes": t["OTH"],
                "total_votes": sum(t.values()), "dem_candidate": " / ".join(sorted(cand.get("DEM", ()))) if len(cand.get("DEM", ())) == 1 else "",
                "rep_candidate": " / ".join(sorted(cand.get("REP", ()))) if len(cand.get("REP", ())) == 1 else ""})
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, FIELDS); w.writeheader(); w.writerows(out)
total = sum(r["total_votes"] for r in out)
print(f"{len(out)} counties, {total:,} votes (D {sum(r['dem_votes'] for r in out):,}, R {sum(r['rep_votes'] for r in out):,}). Candidates: {dict(cand)}")
if a.no_load:
    sys.exit(0)
if total == 0:
    print("No votes counted yet; nothing loaded."); sys.exit(0)
subprocess.run([sys.executable, "-I", str(ROOT / "scripts/load_supabase.py"), str(OUT)], check=True)
