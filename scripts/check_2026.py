"""Did the bellwether counties hold up? Compare 2026 county results with the pre-election affinity scores.

For each state with enough counties reporting, actual_gap = county margin - statewide margin (points) in the
2026 contest. A good affinity score should predict a small |actual_gap|.

Reports: Spearman correlation of affinity score vs |gap|, the median |gap| of each state's top-3 bellwethers
versus every other county, and the top-3 hit rate (within 3 pts of the state). Per-county detail goes to
data/processed/affinity_check_2026.csv.

Usage: python scripts/check_2026.py [--office senate] [--min-reporting 0.9] [--source path.csv] [--year 2026]
Reads data/processed/county_affinity.csv (from scripts/affinity.py) and county_results_2026.csv (import_2026.py).
Use --source data/processed/county_results.csv --year 2024 to dry-run it on past data (in-sample, so flattering).
"""
import argparse, csv, statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--office", default="senate", choices=["senate", "president"])
ap.add_argument("--min-reporting", type=float, default=0.9, help="share of a state's scored counties that must have results")
ap.add_argument("--source", default=str(ROOT / "data/processed/county_results_2026.csv"))
ap.add_argument("--year", type=int, default=2026)
args = ap.parse_args()

if not Path(args.source).exists():
    raise SystemExit(f"{args.source} not found - run scripts/import_2026.py with 2026 results first.")
aff = {r["county_fips"]: r for r in csv.DictReader(open(ROOT / "data/processed/county_affinity.csv", encoding="utf-8"))}
n_scored = defaultdict(int)
for r in aff.values():
    n_scored[r["state_po"]] += 1

# (state, race) -> fips -> (D, R, total)
res = defaultdict(dict)
for r in csv.DictReader(open(args.source, encoding="utf-8")):
    if int(r["year"]) == args.year and r["office"] == args.office and int(r["total_votes"]) > 0:
        res[(r["state_po"], r["race"])][r["county_fips"]] = (int(r["dem_votes"]), int(r["rep_votes"]), int(r["total_votes"]))

rows, skipped = [], []
for (state, race), counties in sorted(res.items()):
    scored = [f for f in counties if f in aff]
    if n_scored[state] == 0 or len(scored) < args.min_reporting * n_scored[state]:
        skipped.append(f"{state} {race} ({len(scored)}/{n_scored[state]} counties)")
        continue
    D, R, T = (sum(v[i] for v in counties.values()) for i in range(3))
    state_margin = (D - R) / T * 100
    for f in scored:
        d, rp, t = counties[f]
        gap = (d - rp) / t * 100 - state_margin
        a = aff[f]
        rows.append({"state_po": state, "race": race, "county_fips": f, "county_name": a["county_name"],
                     "score": float(a["score"]), "rank_in_state": int(a["rank_in_state"]),
                     "predicted_lean": float(a["lean"]), "actual_gap": round(gap, 2), "abs_gap": round(abs(gap), 2)})

if not rows:
    raise SystemExit(f"No usable {args.year} {args.office} results yet (skipped: {skipped or 'none found'}).")

out = ROOT / "data/processed/affinity_check_2026.csv"
with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, list(rows[0])); w.writeheader(); w.writerows(rows)


def ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i]); r = [0.0] * len(xs); i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(x, y):
    rx, ry = ranks(x), ranks(y)
    mx, my = statistics.mean(rx), statistics.mean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den if den else float("nan")


top = [r for r in rows if r["rank_in_state"] <= 3]
rest = [r for r in rows if r["rank_in_state"] > 3]
states = sorted({(r["state_po"], r["race"]) for r in rows})
print(f"{args.year} {args.office}: {len(rows)} counties in {len(states)} contests (skipped: {len(skipped)})")
print(f"Spearman(affinity score, |gap|) = {spearman([r['score'] for r in rows], [r['abs_gap'] for r in rows]):+.2f}  (positive = scores predicted the gaps)")
print(f"median |gap|: top-3 bellwethers {statistics.median(r['abs_gap'] for r in top):.1f} pts vs all other counties {statistics.median(r['abs_gap'] for r in rest):.1f} pts")
print(f"top-3 hit rate (within 3 pts of the state): {sum(r['abs_gap'] <= 3 for r in top) / len(top):.0%}  (others: {sum(r['abs_gap'] <= 3 for r in rest) / len(rest):.0%})")

# how did each state's #1 bellwether do?
print("\nState #1 bellwether: actual gap")
for st_, race in states:
    best = next((r for r in rows if r["state_po"] == st_ and r["race"] == race and r["rank_in_state"] == 1), None)
    if best:
        print(f"  {st_}{' (special)' if race == 'special' else ''}: {best['county_name'].title()} {best['actual_gap']:+.1f}")
if skipped:
    print("\nSkipped (not enough counties reporting yet):", "; ".join(skipped))
print(f"\nDetail: {out}")
