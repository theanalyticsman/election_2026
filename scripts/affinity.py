"""County-vs-state affinity ("bellwether") analysis for President and Senate.

Contests: President + Senate (regular and special) in YEARS, weighted by WEIGHTS (latest cycle heaviest).
For every county and contest:  gap = county margin - statewide margin   (margin = (D - R) / total votes, in points)

  gap_score   weighted mean of |gap|                 (lower = county tracks the state's level)
  lean        weighted mean of signed gap            (+ = more Democratic than the state, - = more Republican)
  swing_err   weighted mean of |county swing - state swing| between consecutive same-office contests in the
              state (e.g. President 2020 -> 2024); null when the state has no such pair
  score       0.6 * gap_score + 0.4 * swing_err  (just gap_score when there is no swing pair); lower = stronger affinity
  rank_in_state  1 = closest to the state

Big counties dominate the statewide total and so track it mechanically; state_vote_share is included so that
can be filtered. Writes data/processed/county_affinity.csv, then (unless --no-load) upserts it to Supabase.
Usage: python scripts/affinity.py [--no-load]
"""
import csv, os, shutil, statistics, subprocess, sys, tempfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
YEARS = (2020, 2022, 2024)
WEIGHTS = {2020: 1.0, 2022: 2.0, 2024: 4.0}
GAP_W, SWING_W = 0.6, 0.4
COLS = ["state_po", "county_fips", "county_name", "gap_score", "lean", "swing_err", "score",
        "rank_in_state", "state_vote_share", "n_contests", "n_swings"]

# (office, year, race, state) -> fips -> (D, R, total, name)
contests = defaultdict(dict)
for r in csv.DictReader(open(ROOT / "data/processed/county_results.csv", encoding="utf-8")):
    y = int(r["year"])
    if y not in YEARS or r["office"] not in ("president", "senate") or r["state_po"] in ("DC", "AK"):  # AK districts were redrawn in 2022, so no stable units
        continue
    t = int(r["total_votes"])
    if t > 0:
        contests[(r["office"], y, r["race"], r["state_po"])][r["county_fips"]] = (
            int(r["dem_votes"]), int(r["rep_votes"]), t, r["county_name"])

margin = lambda d, rp, t: (d - rp) / t * 100
# state_c[key] = statewide margin, county_m[key][fips] = county margin; skip contests missing a major party
state_m, county_m, vote_share, names = {}, {}, defaultdict(list), {}
for key, counties in contests.items():
    D = sum(v[0] for v in counties.values()); R = sum(v[1] for v in counties.values()); T = sum(v[2] for v in counties.values())
    if D == 0 or R == 0 or (D + R) / T < 0.5:
        continue
    state_m[key] = margin(D, R, T)
    county_m[key] = {f: margin(*v[:3]) for f, v in counties.items()}
    for f, v in counties.items():
        names[f] = v[3]
        vote_share[(key[3], f)].append(v[2] / T)

rows = []
for state in sorted({k[3] for k in state_m}):
    keys = [k for k in state_m if k[3] == state]
    fips_all = {f for k in keys for f in county_m[k]}
    state_rows = []
    for f in fips_all:
        gaps = [(WEIGHTS[k[1]], county_m[k][f] - state_m[k]) for k in keys if f in county_m[k]]
        if len(gaps) < 2:
            continue
        w = sum(a for a, _ in gaps)
        gap_score = sum(a * abs(g) for a, g in gaps) / w
        lean = sum(a * g for a, g in gaps) / w
        # swing between consecutive contests of the same office (and race type)
        sw = []
        for office in ("president", "senate"):
            seq = sorted((k for k in keys if k[0] == office and f in county_m[k]), key=lambda k: (k[2], k[1]))
            for a, b in zip(seq, seq[1:]):
                if a[2] == b[2]:
                    sw.append((WEIGHTS[b[1]], abs((county_m[b][f] - county_m[a][f]) - (state_m[b] - state_m[a]))))
        swing_err = sum(a * e for a, e in sw) / sum(a for a, _ in sw) if sw else None
        score = GAP_W * gap_score + SWING_W * swing_err if sw else gap_score
        share = statistics.mean(vote_share[(state, f)])
        state_rows.append([state, f, names[f], gap_score, lean, swing_err, score, 0, share, len(gaps), len(sw)])
    for i, r in enumerate(sorted(state_rows, key=lambda r: r[6]), 1):
        r[7] = i
    rows += state_rows

fmt = lambda v: "" if v is None else (round(v, 3) if isinstance(v, float) else v)
out = ROOT / "data/processed/county_affinity.csv"
with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(COLS)
    for r in rows:
        w.writerow([fmt(v) for v in r])

# ---- summary (the theory: only a few counties track the state tightly) ----
print(f"{len(rows)} counties scored across {len({r[0] for r in rows})} states")
sc = sorted(r[6] for r in rows)
q = lambda p: sc[int(p * (len(sc) - 1))]
print(f"score (pts) quartiles: 25%={q(.25):.1f}  median={q(.5):.1f}  75%={q(.75):.1f}")
for lim in (2, 3, 5):
    n = sum(1 for s in sc if s <= lim)
    print(f"  within {lim} pts of the state: {n} counties ({n / len(sc):.1%})")
top = defaultdict(list)
for r in rows:
    if r[7] <= 3:
        top[r[0]].append(f"{r[2].title()} ({r[3]:.1f}/{r[6]:.1f}, {r[8]:.0%} of vote)")
if "--verbose" in sys.argv:
    for s in sorted(top): print(s, "; ".join(top[s]))

if "--no-load" not in sys.argv:
    sup = shutil.which("supabase")
    def run(sql):
        with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as t:
            t.write(sql)
        try:
            r = subprocess.run([sup, "db", "query", "--linked", "-f", t.name], cwd=ROOT, capture_output=True, text=True)
            if r.returncode:
                sys.exit(r.stdout[-1200:] + r.stderr[-600:])
        finally:
            os.unlink(t.name)
    for mig in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        run(mig.read_text(encoding="utf-8"))
    lit = lambda v: "null" if v in ("", None) else ("'" + str(v).replace("'", "''") + "'")
    num = lambda v: "null" if v in ("", None) else str(v)
    run("truncate public.county_affinity;")
    for i in range(0, len(rows), 1000):
        vals = ",\n".join(
            f"({lit(r[0])},{lit(r[1])},{lit(r[2])},{num(fmt(r[3]))},{num(fmt(r[4]))},{num(fmt(r[5]))},{num(fmt(r[6]))},{r[7]},{num(fmt(r[8]))},{r[9]},{r[10]})"
            for r in rows[i:i + 1000])
        run(f"insert into public.county_affinity ({','.join(COLS)}) values\n{vals};")
        print(f"loaded {min(i + 1000, len(rows))}/{len(rows)}", flush=True)
