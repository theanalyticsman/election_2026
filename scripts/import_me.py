"""Load Maine's official U.S. Senator results workbook (one row per municipality) as county totals.

Usage: python scripts/import_me.py [file-or-folder] [--no-load] [--dem LASTNAME --rep LASTNAME] [--year-check]
Default folder: ~/Downloads/election_night (the newest .xlsx with "senator" in its name, else any .xlsx).
Layout (from the 2024 file): columns COUNTY (3-letter code), MUNICIPALITY, then one column per candidate (header row 1 =
"Last, First"; row 3 = party), then BLANK and TBC (total ballots). Municipalities are summed into the 16 counties.
Rows with no county code (the "STATE UOCAVA" absentee line) belong to no county and are left out; the script prints them.
Democratic / Republican come from the party row; if there is no clear one, pass --dem / --rep (last names).
Reads the .xlsx with the standard library only.
"""
import argparse, csv, io, re, subprocess, sys, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/processed/county_results_2026_me.csv"
FIELDS = ["year", "office", "race", "state_po", "county_fips", "county_name", "dem_votes",
          "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"]
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
# county code -> (name, FIPS). Maine's FIPS are the odd numbers 23001..23031 in alphabetical order.
COUNTIES = {c: (n, 23001 + 2 * i) for i, (c, n) in enumerate([
    ("AND", "Androscoggin"), ("ARO", "Aroostook"), ("CUM", "Cumberland"), ("FRA", "Franklin"), ("HAN", "Hancock"),
    ("KEN", "Kennebec"), ("KNO", "Knox"), ("LIN", "Lincoln"), ("OXF", "Oxford"), ("PEN", "Penobscot"),
    ("PIS", "Piscataquis"), ("SAG", "Sagadahoc"), ("SOM", "Somerset"), ("WAL", "Waldo"), ("WAS", "Washington"), ("YOR", "York")])}

ap = argparse.ArgumentParser()
ap.add_argument("file", nargs="?", default=str(Path.home() / "Downloads" / "election_night"))
ap.add_argument("--dem")
ap.add_argument("--rep")
ap.add_argument("--no-load", action="store_true")
ap.add_argument("--allow-old", action="store_true", help="testing only: accept a file that does not look like 2026")
a = ap.parse_args()

src = Path(a.file)
if src.is_dir():
    xs = [p for p in src.iterdir() if p.suffix.lower() == ".xlsx"]
    xs = [p for p in xs if "senator" in p.name.lower()] or xs
    if not xs:
        sys.exit(f"No .xlsx file in {src}. Download Maine's U.S. Senator results workbook into that folder first.")
    src = sorted(xs, key=lambda p: p.stat().st_mtime)[-1]
print(f"Reading {src.name}")
if not a.allow_old and "2026" not in src.name and "2024" in src.name:
    sys.exit("This looks like the 2024 file (its name says 2024); refusing to load it as 2026.")
wb = zipfile.ZipFile(io.BytesIO(src.read_bytes()))
ss = ["".join(t.text or "" for t in si.iter(M + "t")) for si in ET.fromstring(wb.read("xl/sharedStrings.xml")).findall(M + "si")] \
    if "xl/sharedStrings.xml" in wb.namelist() else []
rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(wb.read("xl/_rels/workbook.xml.rels"))}
sheets = [(s.get("name"), "xl/" + rels[s.get(R + "id")].lstrip("/").replace("xl/", ""))
          for s in ET.fromstring(wb.read("xl/workbook.xml")).find(M + "sheets")]
part = next((p for n, p in sheets if "senat" in n.lower()), sheets[0][1])


def read_rows(part):
    for row in ET.fromstring(wb.read(part)).iter(M + "row"):
        cells = {}
        for c in row.findall(M + "c"):
            v = c.find(M + "v")
            if c.get("t") == "s" and v is not None:
                val = ss[int(v.text)]
            elif c.get("t") == "inlineStr":
                val = "".join(t.text or "" for t in c.iter(M + "t"))
            else:
                val = v.text if v is not None else ""
            cells[re.match(r"[A-Z]+", c.get("r")).group()] = val.strip()
        yield cells


rows = list(read_rows(part))
head, party = rows[0], rows[2] if len(rows) > 2 else {}
cols = [c for c in head if c not in ("A", "B") and head[c].strip().upper() not in ("BLANK", "TBC", "")]
if not cols:
    sys.exit("Could not find candidate columns in the header row.")
cand = {c: head[c] for c in cols}
par = {c: party.get(c, "").lower() for c in cols}
print("Candidates:", "; ".join(f"{cand[c]} ({par[c] or '?'})" for c in cols))
last = lambda n: n.split(",")[0].strip().lower()
if a.dem or a.rep:
    dem = next((c for c in cols if last(cand[c]) == (a.dem or "").lower()), None)
    rep = next((c for c in cols if last(cand[c]) == (a.rep or "").lower()), None)
else:
    d = [c for c in cols if par[c].startswith("dem")]
    r = [c for c in cols if par[c].startswith("rep")]
    dem, rep = (d[0] if len(d) == 1 else None), (r[0] if len(r) == 1 else None)
if not (dem and rep):
    sys.exit("Could not pick exactly one Democrat and one Republican from the party row; pass --dem and --rep (last names).")
num = lambda v: int(float(v)) if re.fullmatch(r"-?\d+(\.\d+)?", (v or "").replace(",", "")) else 0
tot = {c: {"d": 0, "r": 0, "o": 0, "towns": 0} for c in COUNTIES}
skipped = []
for row in rows[3:]:
    code = row.get("A", "").upper()
    if code in COUNTIES:
        for c in cols:
            k = "d" if c == dem else "r" if c == rep else "o"
            tot[code][k] += num(row.get(c))
        tot[code]["towns"] += 1
    elif row.get("B") and not row.get("A") and "total" not in row["B"].lower() and any(num(row.get(c)) for c in cols):
        skipped.append((row["B"], sum(num(row.get(c)) for c in cols)))
for name, v in skipped:
    print(f"Not in any county (left out): {name}: {v:,} votes")
out = [{"year": 2026, "office": "senate", "race": "regular", "state_po": "ME", "county_fips": str(f), "county_name": n,
        "dem_votes": tot[c]["d"], "rep_votes": tot[c]["r"], "other_votes": tot[c]["o"],
        "total_votes": tot[c]["d"] + tot[c]["r"] + tot[c]["o"], "dem_candidate": cand[dem], "rep_candidate": cand[rep]}
       for c, (n, f) in COUNTIES.items()]
empty = [COUNTIES[c][0] for c in COUNTIES if tot[c]["towns"] == 0]
if empty:
    sys.exit(f"No municipalities found for: {', '.join(empty)}; the county codes may have changed.")
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, FIELDS); w.writeheader(); w.writerows(out)
t = sum(r["total_votes"] for r in out)
print(f"{len(out)} counties from {sum(v['towns'] for v in tot.values())} municipalities, {t:,} votes (D {sum(r['dem_votes'] for r in out):,}, R {sum(r['rep_votes'] for r in out):,}).")
if a.no_load:
    sys.exit(0)
if t == 0:
    print("No votes counted yet; nothing loaded."); sys.exit(0)
subprocess.run([sys.executable, "-I", str(ROOT / "scripts/load_supabase.py"), str(OUT)], check=True)
