"""Import 2026 county results (re-runnable as numbers update; rows are upserted).

Usage: python scripts/import_2026.py path/to/results.csv
Required columns: state_po, county_fips, dem_votes, rep_votes
Optional columns: county_name, other_votes, dem_candidate, rep_candidate, office (default senate), race (default regular)
"""
import csv, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1])
out = ROOT / "data/processed/county_results_2026.csv"
FIELDS = ["year", "office", "race", "state_po", "county_fips", "county_name", "dem_votes",
          "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"]


def n(v):
    return int(float((v or "0").replace(",", "") or 0))


rows, bad = [], 0
for r in csv.DictReader(open(src, encoding="utf-8-sig")):
    fips = (r.get("county_fips") or "").strip().split(".")[0].zfill(5)
    if not (fips.isdigit() and len(fips) == 5):
        bad += 1
        continue
    d, rp, o = n(r.get("dem_votes")), n(r.get("rep_votes")), n(r.get("other_votes"))
    rows.append({"year": 2026, "office": (r.get("office") or "senate").lower(), "race": (r.get("race") or "regular").lower(),
                 "state_po": (r.get("state_po") or "").upper(), "county_fips": fips, "county_name": r.get("county_name", ""),
                 "dem_votes": d, "rep_votes": rp, "other_votes": o, "total_votes": d + rp + o,
                 "dem_candidate": r.get("dem_candidate", ""), "rep_candidate": r.get("rep_candidate", "")})
with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, FIELDS); w.writeheader(); w.writerows(rows)
print(f"{len(rows)} rows ready ({bad} skipped for bad FIPS); loading…")
subprocess.run([sys.executable, "-I", str(ROOT / "scripts/load_supabase.py"), str(out)], check=True)
