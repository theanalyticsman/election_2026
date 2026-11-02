"""Hold-out test: how well can a few bellwether counties project a state's result?

Affinity is rebuilt from 2020 + 2022 only (weights 1:2). Then for every 2024 statewide contest (President and
Senate) we reveal N counties, estimate the state margin from each as  county margin - county lean,  combine the
estimates (weight 1/(score+0.5)^2), and compare with the true statewide margin. Three ways of choosing the N
counties are compared:
  bellwether : the N best-scoring counties in the state
  random     : N random counties (average over many draws)
  largest    : the N biggest counties by 2024 votes
A naive baseline for President is "same as the 2020 state margin".
Errors are in margin points. This is an out-of-time test but the counties' scores use gap only (the swing
component needs same-office pairs that mostly don't exist in 2020/2022).

Usage: python scripts/backtest.py
"""
import csv, random, statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRAIN = {2020: 1.0, 2022: 2.0}
TEST_YEAR = 2024
NS = (1, 3, 5, 10)
DRAWS = 300
random.seed(7)

contests = defaultdict(dict)  # (office, year, race, state) -> fips -> (D, R, T)
for r in csv.DictReader(open(ROOT / "data/processed/county_results.csv", encoding="utf-8")):
    y = int(r["year"]); t = int(r["total_votes"])
    if r["office"] in ("president", "senate") and r["state_po"] not in ("DC", "AK") and t > 0 and y in (*TRAIN, TEST_YEAR):
        contests[(r["office"], y, r["race"], r["state_po"])][r["county_fips"]] = (int(r["dem_votes"]), int(r["rep_votes"]), t)


def margins(counties):
    D = sum(v[0] for v in counties.values()); R = sum(v[1] for v in counties.values()); T = sum(v[2] for v in counties.values())
    if D == 0 or R == 0 or (D + R) / T < 0.5:
        return None
    return (D - R) / T * 100, {f: (v[0] - v[1]) / v[2] * 100 for f, v in counties.items()}, {f: v[2] for f, v in counties.items()}


train, test = defaultdict(list), {}
for key, counties in contests.items():
    m = margins(counties)
    if not m:
        continue
    if key[1] in TRAIN:
        train[key[3]].append((key, m))
    else:
        test[key] = m

# per-state county scores from training contests
score, lean = {}, {}
for state, items in train.items():
    per = defaultdict(list)
    for key, (sm, cm, _) in items:
        for f, v in cm.items():
            per[f].append((TRAIN[key[1]], v - sm))
    for f, g in per.items():
        if len(g) >= 2:
            w = sum(a for a, _ in g)
            score[f] = sum(a * abs(x) for a, x in g) / w
            lean[f] = sum(a * x for a, x in g) / w


def project(state_counties, picked, cm):
    ests = [(1 / (score[f] + 0.5) ** 2, cm[f] - lean[f]) for f in picked]
    return sum(w * e for w, e in ests) / sum(w for w, _ in ests)


errs = defaultdict(list)  # (office, method, N) -> signed errors
detail = []
for key, (sm, cm, tv) in sorted(test.items()):
    office, _, race, state = key
    eligible = [f for f in cm if f in score]
    if len(eligible) < max(NS) + 2:
        continue
    if office == "president":
        prev = margins(contests.get(("president", 2020, "regular", state), {}))
        if prev:
            errs[(office, "naive_2020", 0)].append(prev[0] - sm)
    ranked = sorted(eligible, key=lambda f: score[f])
    biggest = sorted(eligible, key=lambda f: -tv[f])
    for n in NS:
        picks = {"bellwether": ranked[:n], "largest": biggest[:n]}
        for method, p in picks.items():
            e = project(None, p, cm) - sm
            errs[(office, method, n)].append(e)
            detail.append([state, office, race, method, n, round(e, 2)])
        rnd = [abs(project(None, random.sample(eligible, n), cm) - sm) for _ in range(DRAWS)]
        errs[(office, "random_abs", n)].append(statistics.mean(rnd))

with open(ROOT / "data/processed/backtest_2024.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["state", "office", "race", "method", "n", "error_pts"]); w.writerows(detail)

print(f"Train: 2020+2022 | Test: {TEST_YEAR} statewide contests | scored counties: {len(score)}")
for office in ("president", "senate"):
    k = [x for x in errs if x[0] == office and x[1] == "bellwether" and x[2] == NS[0]]
    n_states = len(errs[k[0]]) if k else 0
    print(f"\n{office.upper()}  ({n_states} states)   mean absolute error in points [share within 2 pts]")
    if ("president", "naive_2020", 0) in errs and office == "president":
        e = errs[(office, "naive_2020", 0)]
        print(f"  naive (2020 margin carried forward): {statistics.mean(abs(x) for x in e):.1f}")
    print(f"  {'N counties':<12}" + "".join(f"{n:>14}" for n in NS))
    for method in ("bellwether", "largest", "random"):
        cells = []
        for n in NS:
            if method == "random":
                e = errs[(office, "random_abs", n)]
                cells.append(f"{statistics.mean(e):.1f}")
            else:
                e = errs[(office, method, n)]
                cells.append(f"{statistics.mean(abs(x) for x in e):.1f} [{sum(abs(x) <= 2 for x in e) / len(e):.0%}]")
        print(f"  {method:<12}" + "".join(f"{c:>14}" for c in cells))
    e = errs[(office, "bellwether", 5)]
    print(f"  bellwether N=5 bias (projected - actual): {statistics.mean(e):+.1f} pts, worst miss {max(abs(x) for x in e):.1f}")
