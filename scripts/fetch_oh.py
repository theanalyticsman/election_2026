"""Fetch Ohio's official election-night XML feed and load 2026 U.S. Senate (special) county rows.

Usage: python scripts/fetch_oh.py [--no-load]
Source: https://liveresults.ohiosos.gov/Api/v1/download?filename=VSSC1622XmlFileBlob (public, no login).
Parties come from the feed (Democratic / Republican; everything else counts as other). Re-runnable.
"""
import argparse, csv, subprocess, sys, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/processed/county_results_2026_oh.csv"
URL = "https://liveresults.ohiosos.gov/Api/v1/download?filename=VSSC1622XmlFileBlob"
UA = "election-comp-research/1.0 (personal analysis; contact apparao.prattipati@gmail.com)"
N = "{http://grouper.ieee.org/groups/1622/groups/2/V1/1622_2-election_results_reporting.xsd}"
FIELDS = ["year", "office", "race", "state_po", "county_fips", "county_name", "dem_votes",
          "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"]

ap = argparse.ArgumentParser()
ap.add_argument("--no-load", action="store_true")
a = ap.parse_args()

with urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": UA}), timeout=60) as r:
    root = ET.fromstring(r.read())
if root.get("IsTest") == "true":
    print("Note: the feed is flagged IsTest=true (not live results yet).")
print("Feed status:", root.get("Status"), "generated", root.get("GeneratedDate"))

txt = lambda e, p: e.find(N + p + "/" + N + "LanguageString").text
party = {p.get("ObjectId"): p.get("Abbreviation") for p in root.iter(N + "Party")}
cand = {c.get("ObjectId"): (txt(c, "BallotName"), party.get(c.find(N + "PartyId").text)) for c in root.iter(N + "Candidate")}
counties = list({g.get("ObjectId"): g for g in root.iter(N + "GpUnit") if g.get("Type") == "County" and g.get("IsElectoralDistrict") == "false"}.values())
counties.sort(key=lambda g: g.get("Name"))
if len(counties) != 88:
    sys.exit(f"Expected 88 counties, got {len(counties)}; refusing to guess FIPS codes.")
cmap = {g.get("ObjectId"): (str(39001 + 2 * n), g.get("Name")) for n, g in enumerate(counties)}  # odd, alphabetical

con = next((c for c in root.iter(N + "Contest") if c.get("Name") == "U.S. Senator"), None)
if con is None:
    sys.exit("U.S. Senator contest not found in the feed.")
votes = {}  # county id -> {party abbr or 'x': n}, plus candidate names
names = {}
for bs in con.iter(N + "BallotSelection"):
    cid = bs.find(".//" + N + "CandidateId").text
    nm, ab = cand[cid]
    if ab in ("DEM", "REP"):
        names[ab] = nm
    for vc in bs.iter(N + "VoteCounts"):
        if vc.get("Type") != "Total":
            continue
        g = vc.find(N + "GpUnitId").text
        if g in cmap:
            votes.setdefault(g, {}).setdefault(ab if ab in ("DEM", "REP") else "OTH", 0)
            votes[g][ab if ab in ("DEM", "REP") else "OTH"] += int(vc.get("Count") or 0)
print("Candidates:", names)
rows = []
for g, (fips, nm) in cmap.items():
    v = votes.get(g, {})
    d, r, o = v.get("DEM", 0), v.get("REP", 0), v.get("OTH", 0)
    rows.append({"year": 2026, "office": "senate", "race": "special", "state_po": "OH", "county_fips": fips, "county_name": nm,
                 "dem_votes": d, "rep_votes": r, "other_votes": o, "total_votes": d + r + o,
                 "dem_candidate": names.get("DEM", ""), "rep_candidate": names.get("REP", "")})
rows.sort(key=lambda x: x["county_fips"])
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, FIELDS); w.writeheader(); w.writerows(rows)
tot = sum(r["total_votes"] for r in rows)
print(f"{len(rows)} counties, {tot:,} votes counted (D {sum(r['dem_votes'] for r in rows):,}, R {sum(r['rep_votes'] for r in rows):,}).")
if a.no_load:
    sys.exit(0)
if tot == 0:
    sys.exit("No votes counted yet; nothing loaded.")
subprocess.run([sys.executable, "-I", str(ROOT / "scripts/load_supabase.py"), str(OUT)], check=True)
