"""Aggregate MEDSL source files into one county-level table: data/processed/county_results.csv

Columns: year, office, race, state_po, county_fips, county_name,
         dem_votes, rep_votes, other_votes, total_votes, dem_candidate, rep_candidate
Rules:
  * House: a county's rows sum every district it touches (uncontested seats count as 0 for the missing party)
  * general-election stage only (runoffs excluded)
  * summary rows (TOTAL..., STRAIGHT PARTY, over/under votes, registered voters...) are not candidates
  * per candidate, a TOTAL-mode row wins; otherwise all modes (early, election day, ...) are summed
  * a candidate's party comes from any party column (DEM*/REP*), otherwise 'other'; state/year labels
    fill in blanks from the candidate's other rows, 
Other independents count as 'other'; King (ME) and Sanders (VT) count as D (see CAUCUS_DEM). Only prints summary counts.
"""
import csv, re, sys
from collections import defaultdict, Counter
from pathlib import Path

csv.field_size_limit(sys.maxsize)
ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "data/raw", ROOT / "data/processed"
OUT.mkdir(exist_ok=True)

SOURCES = [
    ("countypres_2000-2024.tab", "president"),
    ("senate_county_2022.tab", "senate"),
    ("senate_precinct_2016.tab", "senate"),
    ("senate_precinct_2018.tab", "senate"),
    ("senate_precinct_2020.tab", "senate"),
    ("senate_precinct_2024.tab", "senate"),
    ("house_precinct_2016.tab", "house"),
    ("house_precinct_2018.tab", "house"),
    ("house_precinct_2020.tab", "house"),
    ("house_precinct_2022.tab", "house"),
    ("house_precinct_2024.tab", "house"),
]
MIN_YEAR = 2016
SKIP_PREFIX = ("TOTAL", "STRAIGHT PARTY", "OVER VOTE", "OVERVOTE", "UNDER VOTE", "UNDERVOTE", "BLANK",
               "REGISTERED", "BALLOTS", "SCATTERING", "VOID", "NO VOTE", "FEDERAL", "PUBLIC COUNTER",
               "ABSENTEE", "AFFIDAVIT", "PROVISIONAL", "MILITARY", "MANUAL")
# Independents who caucus with Democrats and had no Democratic opponent on the ballot are counted as D
# so their states read correctly on the map: (state, surname substring)
CAUCUS_DEM = [("ME", "KING"), ("VT", "SANDERS")]
PARTY_COLS = ("party_detailed", "party", "candidate_party", "party_simplified")


def party_of(row):
    for c in PARTY_COLS:
        p = (row.get(c) or "").upper().strip()
        if p.startswith("DEM"):
            return "D"
        if p.startswith("REP"):
            return "R"
    return None


def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


# key -> candidate -> mode -> votes
votes = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
labels = defaultdict(Counter)  # (year, state, candidate) -> Counter of 'D'/'R'
names, skipped = {}, defaultdict(int)
districts = defaultdict(set)  # key -> House districts a county touches

for fname, office in SOURCES:
    with open(RAW / fname, newline="", encoding="utf-8-sig") as f:
        delim = "\t" if "\t" in f.readline() else ","
        f.seek(0)
        for row in csv.DictReader(f, delimiter=delim):
            year = num(row.get("year"))
            if year < MIN_YEAR:
                continue
            off = (row.get("office") or "").upper()
            if office == "president" and "PRESIDENT" not in off:
                continue
            if office == "senate" and "SENATE" not in off:
                continue
            if office == "house" and "HOUSE" not in off:
                continue
            stage = (row.get("stage") or "GEN").upper().strip()
            if stage not in ("GEN", "GENERAL", ""):
                skipped[(fname, "non_general_stage")] += 1
                continue
            cand = (row.get("candidate") or "").upper().strip()
            if not cand or cand.startswith(SKIP_PREFIX):
                skipped[(fname, "summary_row")] += 1
                continue
            fips = (row.get("county_fips") or "").split(".")[0].strip().zfill(5)
            state = row.get("state_po") or row.get("state_postal") or ""
            if state == "AK":
                # Alaska is mapped by state House district (02ddd, as in the president file), even where rows also carry a borough FIPS
                m = re.search(r"DISTRICT\s*0*(\d+)", (row.get("jurisdiction_name") or row.get("jurisdiction") or "").upper())
                if m and 1 <= int(m.group(1)) <= 40:
                    fips = "02" + m.group(1).zfill(3)
                    row["county_name"] = "DISTRICT " + m.group(1).zfill(2)
            if not fips.strip("0") or len(fips) != 5 or not fips.isdigit():
                skipped[(fname, "no_county_fips")] += 1
                continue
            race = "special" if (row.get("special") or "").upper() in ("TRUE", "T", "1") else "regular"
            mode = (row.get("mode") or "TOTAL").upper().strip() or "TOTAL"
            if mode == "TOTAL VOTES CAST":
                mode = "TOTAL"
            key = (year, office, race, state, fips)
            names[key] = row.get("county_name", "")
            if office == "house":
                districts[key].add((row.get("district") or "").strip())
            votes[key][cand][mode] += num(row.get("candidatevotes") or row.get("votes"))
            p = party_of(row)
            if p:
                labels[(year, office, race, state, cand)][p] += 1

def cand_party(year, office, race, state, cand):
    if office == "senate" and any(state == st and sub in cand for st, sub in CAUCUS_DEM):
        return "D"
    c = labels.get((year, office, race, state, cand))
    return c.most_common(1)[0][0] if c else "O"

with open(OUT / "county_results.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["year", "office", "race", "state_po", "county_fips", "county_name",
                "dem_votes", "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"])
    n, summary = 0, defaultdict(int)
    state_tot = defaultdict(lambda: [0, 0])
    for key in sorted(votes):
        year, office, race, state, fips = key
        D, R, O = {}, {}, 0
        for cand, modes in votes[key].items():
            v = modes["TOTAL"] if "TOTAL" in modes else sum(modes.values())
            p = cand_party(year, office, race, state, cand)
            if p == "D": D[cand] = v
            elif p == "R": R[cand] = v
            else: O += v
        d, r = sum(D.values()), sum(R.values())
        dc = max(D, key=D.get).title() if D else ""
        rc = max(R, key=R.get).title() if R else ""
        if office == "house" and len(districts[key]) > 1:  # county split across districts: no single candidate
            dc, rc = ("Democrats (all districts)" if D else ""), ("Republicans (all districts)" if R else "")
        w.writerow([year, office, race, state, fips, names[key], d, r, O, d + r + O, dc, rc])
        n += 1
        summary[(year, office, race)] += 1
        s = state_tot[(year, office, race, state)]
        s[0] += d + r; s[1] += d + r + O

print(f"{n} county rows")
for k in sorted(summary):
    print(k, summary[k], "counties")
for k, v in sorted(skipped.items()):
    print("skipped", k, v)
print("State races where Democrat+Republican are <85% of votes (check labels / independents):")
for k, (dr, t) in sorted(state_tot.items()):
    if t and dr / t < 0.85:
        print("  ", k, round(dr / t, 2))
