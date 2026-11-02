"""State polling averages for the 2026 Senate, from a long-format poll file (one row per candidate per poll).

Input : data/raw/senate_polls.csv   (not committed; only the averages below leave this machine)
Output: data/processed/poll_averages_2026.csv, loaded to Supabase table poll_averages unless --no-load

Method
  * general-election questions only, cycle 2026, polls ending on or after START; ranked-choice rows: first round only
  * one question per poll: likely voters over registered over all adults, then the fullest candidate list
  * margin = (D - R) / (all decided respondents) * 100, so undecided/"don't know" are set aside and the number
    is comparable to a certified result (which is margin over all votes cast)
  * weight = recency (half-life HALF_LIFE days) x sqrt(sample size / 600, capped) x 0.5 for partisan sponsors,
    then divided by sqrt(number of polls from that pollster) so one frequent pollster cannot dominate
  * err = rough 1-sigma on the statewide margin: sqrt(TYPICAL_MISS^2 + spread^2 / effective polls)
States where no Democrat or no Republican is polled (e.g. an independent-only challenger) are skipped.
Usage: python scripts/polls.py [--no-load] [--ref YYYY-MM-DD]
"""
import csv, datetime as dt, math, os, shutil, subprocess, sys, tempfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
START = dt.date(2026, 8, 1)
HALF_LIFE = 14.0
TYPICAL_MISS = 4.0
SPECIAL_2026 = {"OH", "FL"}  # 2026 Senate specials; every other 2026 contest is a regular election
COLS = ["state_po", "race", "office", "n_polls", "n_eff", "last_poll", "dem_pct", "rep_pct", "margin", "spread", "err"]
POP_RANK = {"lv": 0, "rv": 1, "a": 2}

ref = dt.date.fromisoformat(sys.argv[sys.argv.index("--ref") + 1]) if "--ref" in sys.argv else None
parse = lambda s: dt.datetime.strptime(s.strip(), "%m/%d/%y").date()

questions = defaultdict(lambda: {"rows": [], "poll": None})
for r in csv.DictReader(open(ROOT / "data/raw/senate_polls.csv", encoding="utf-8-sig")):
    if r["stage"] != "general" or r["cycle"] != "2026" or not r["end_date"] or r["ranked_choice_round"] not in ("", "1"):
        continue
    if parse(r["end_date"]) < START:
        continue
    q = questions[r["question_id"]]
    q["rows"].append(r); q["poll"] = r["poll_id"]

# one question per poll
best = {}
for qid, q in questions.items():
    r0 = q["rows"][0]
    n_cand = len({x["candidate_name"] for x in q["rows"] if x["party"] != "NONE"})
    key = (POP_RANK.get(r0["population"], 3), -n_cand)
    if q["poll"] not in best or key < best[q["poll"]][0]:
        best[q["poll"]] = (key, qid)

polls = defaultdict(list)  # state -> list of dicts
for poll_id, (_, qid) in best.items():
    rows = questions[qid]["rows"]
    pct = defaultdict(float)
    for x in rows:
        try:
            pct[x["party"]] += float(x["pct"])
        except ValueError:
            pass
    d, rp = pct.get("DEM", 0.0), pct.get("REP", 0.0)
    decided = sum(v for k, v in pct.items() if k != "NONE")
    if d <= 0 or rp <= 0 or decided <= 0:
        continue
    r0 = rows[0]
    try:
        n = float(r0["sample_size"])
    except ValueError:
        n = 600.0
    polls[r0["state"]].append({"end": parse(r0["end_date"]), "pollster": r0["pollster"], "n": n,
                               "partisan": bool(r0["partisan"]), "d": d / decided * 100, "r": rp / decided * 100,
                               "m": (d - rp) / decided * 100})

ref = ref or max(p["end"] for v in polls.values() for p in v)
out = []
for state, ps in sorted(polls.items()):
    per_pollster = defaultdict(int)
    for p in ps:
        per_pollster[p["pollster"]] += 1
    ws = []
    for p in ps:
        age = max(0, (ref - p["end"]).days)
        w = 0.5 ** (age / HALF_LIFE) * math.sqrt(min(p["n"], 1500) / 600) * (0.5 if p["partisan"] else 1.0)
        ws.append(w / math.sqrt(per_pollster[p["pollster"]]))
    W = sum(ws)
    m = sum(w * p["m"] for w, p in zip(ws, ps)) / W
    d = sum(w * p["d"] for w, p in zip(ws, ps)) / W
    rp = sum(w * p["r"] for w, p in zip(ws, ps)) / W
    spread = math.sqrt(sum(w * (p["m"] - m) ** 2 for w, p in zip(ws, ps)) / W)
    n_eff = W ** 2 / sum(w * w for w in ws)
    err = math.sqrt(TYPICAL_MISS ** 2 + spread ** 2 / max(n_eff, 1))
    out.append([state, "special" if state in SPECIAL_2026 else "regular", "senate", len(ps), round(n_eff, 1),
                max(p["end"] for p in ps).isoformat(), round(d, 1), round(rp, 1), round(m, 2), round(spread, 2), round(err, 2)])

path = ROOT / "data/processed/poll_averages_2026.csv"
with open(path, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(COLS); w.writerows(out)

print(f"{len(out)} states averaged, reference date {ref}, polls since {START}")
fmt = lambda v: ("D +" if v >= 0 else "R +") + f"{abs(v):.1f}"
for r in sorted(out, key=lambda r: abs(r[8])):
    print(f"  {r[0]}{'*' if r[1] == 'special' else ' '} {fmt(r[8]):>7}  D {r[6]:.0f} R {r[7]:.0f}  {r[3]:>2} polls (eff {r[4]:>4}), last {r[5]}, err +/-{r[10]:.1f}")

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
    run("truncate public.poll_averages;")
    vals = ",\n".join("(" + ",".join(f"'{v}'" if isinstance(v, str) else str(v) for v in r) + ")" for r in out)
    run(f"insert into public.poll_averages ({','.join(COLS)}) values\n{vals};")
    print("loaded to Supabase")
