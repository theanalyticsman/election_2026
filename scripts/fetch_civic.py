"""Fetch 2026 U.S. Senate county results from civicAPI (https://civicapi.org, free, no key) and load them.

Usage: python scripts/fetch_civic.py [STATE ...] [--no-load]
Default states: every civicAPI Senate race except FL, SC and IA, which have their own fetchers (Ohio is not on civicAPI);
pass those three here only to compare, since the last loader to run overwrites the same rows.
civicAPI says its data comes from Secretary of State sites, updated every 5-10 seconds; that is its own claim, so
spot-check a few counties against a state source. The race IDs below were found by scanning civicAPI on Nov 2 2026
(its search endpoint does not list U.S. Senate races). Only County- and Parish-type regions are used (Maine's also lists townships).
Attribution is required for non-personal projects: the site's Guide/footer should link to civicapi.org.
"""
import argparse, csv, json, re, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/processed/county_results_2026_civic.csv"
UA = "election-comp-research/1.0 (personal analysis; contact apparao.prattipati@gmail.com)"
FIELDS = ["year", "office", "race", "state_po", "county_fips", "county_name", "dem_votes",
          "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"]
IDS = {"FL": 87068, "SC": 87409, "TX": 87438, "IA": 87151, "ME": 87188, "MI": 87214, "MN": 87229, "NE": 87254, "KS": 87162,
       "GA": 87087, "NC": 87346, "KY": 87174, "CO": 87022, "DE": 87036, "ID": 87103, "IL": 87129, "LA": 87183, "MT": 87247,
       "MA": 87275, "NH": 87283, "NM": 87288, "NJ": 87302, "OR": 87374, "RI": 87396, "SD": 87446, "VA": 87472, "TN": 87475, "WV": 87477}
SPECIAL = {"FL"}  # regular unless listed
OFFICIAL = {"FL", "SC", "IA"}  # these have their own fetchers, so civicAPI does not overwrite them
DEFAULT = [po for po in IDS if po not in OFFICIAL]  # every other state civicAPI lists, contested ones first


def get_race(race_id):
    req = urllib.request.Request(f"https://civicapi.org/api/v2/race/{race_id}", headers={"User-Agent": UA})
    for attempt in range(3):  # civicAPI returned a one-off 502 during testing; retry server errors and timeouts
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(3 * (attempt + 1))


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


def rows_from_race(d, po):
    """County rows for one race. Parties come from civicAPI; every candidate who is not Democratic/Republican is 'other'."""
    regions = [r for r in (d.get("region_results") or {}).values() if r.get("type") in ("County", "Parish")]  # Louisiana's regions are parishes
    if not regions:
        raise ValueError("no County/Parish regions")
    # a county with no code in the feed gets one from its alphabetical position (county FIPS run 001, 003, ... alphabetically)
    order = sorted(regions, key=lambda r: r["name"].lower())
    out, dem_name, rep_name = [], "", ""
    for i, r in enumerate(order):
        fips = r.get("fips")
        if not fips:
            fips = str(int(f"{po_state(regions)}001") + 2 * i)
        d_v = r_v = o_v = 0
        for c in r["candidates"]:
            v = int(c.get("votes") or 0)
            p = (c.get("party") or "").strip().lower()
            if p == "democratic":
                d_v += v; dem_name = clean(c["name"])
            elif p == "republican":
                r_v += v; rep_name = clean(c["name"])
            else:
                o_v += v
        out.append({"year": 2026, "office": "senate", "race": "special" if po in SPECIAL else "regular", "state_po": po,
                    "county_fips": str(fips), "county_name": clean(r["name"]), "dem_votes": d_v, "rep_votes": r_v,
                    "other_votes": o_v, "total_votes": d_v + r_v + o_v, "dem_candidate": "", "rep_candidate": ""})
    for r in out:
        r["dem_candidate"], r["rep_candidate"] = dem_name, rep_name
    return out


def po_state(regions):
    """State FIPS prefix (e.g. '27') taken from any region that has a code."""
    return str(next(r["fips"] for r in regions if r.get("fips")))[:2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("states", nargs="*", help=f"default: {' '.join(DEFAULT)}")
    ap.add_argument("--no-load", action="store_true")
    a = ap.parse_args()
    states = [s.upper() for s in a.states] or DEFAULT
    rows = []
    for po in states:
        if po not in IDS:
            print(f"{po}: no civicAPI race ID known; skipped")
            continue
        try:
            got = rows_from_race(get_race(IDS[po]), po)
        except Exception as e:  # one state failing should not stop the rest
            print(f"{po}: failed ({e})")
            continue
        t = sum(r["total_votes"] for r in got)
        print(f"{po}: {len(got)} counties, {t:,} votes (D {sum(r['dem_votes'] for r in got):,}, R {sum(r['rep_votes'] for r in got):,}); "
              f"{got[0]['dem_candidate']} (D) vs {got[0]['rep_candidate']} (R)")
        if t > 0:  # only states with counted votes are loaded
            rows += got
        time.sleep(0.4)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, FIELDS); w.writeheader(); w.writerows(rows)
    if a.no_load or not rows:
        print("Nothing loaded." if not rows else "Preview only.")
        return
    subprocess.run([sys.executable, "-I", str(ROOT / "scripts/load_supabase.py"), str(OUT)], check=True)


if __name__ == "__main__":
    main()
