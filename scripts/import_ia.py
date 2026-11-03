"""Load Iowa's official results workbook (detail.xlsx, usually inside detailxlsx.zip) for the U.S. Senate.

Usage: python scripts/import_ia.py [file-or-folder] [--no-load] [--dem Turek] [--rep Hinson]
Default folder: ~/Downloads/election_night (the newest detailxlsx.zip / detail.xlsx in it is used).
The workbook has one sheet per contest; the "United States Senator" sheet lists each county with Election Day,
Absentee and Total Votes per candidate. It carries no party, so --dem / --rep name the candidates by last name
and everyone else counts as other. Reads the .xlsx with the standard library only (no openpyxl needed).
"""
import argparse, csv, io, re, subprocess, sys, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/processed/county_results_2026_ia.csv"
FIELDS = ["year", "office", "race", "state_po", "county_fips", "county_name", "dem_votes",
          "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"]
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

ap = argparse.ArgumentParser()
ap.add_argument("file", nargs="?", default=str(Path.home() / "Downloads" / "election_night"))
ap.add_argument("--dem", default="Turek")
ap.add_argument("--rep", default="Hinson")
ap.add_argument("--no-load", action="store_true")
a = ap.parse_args()

src = Path(a.file)
if src.is_dir():
    found = sorted([p for p in src.iterdir() if p.suffix.lower() in (".zip", ".xlsx") and "detail" in p.name.lower()],
                   key=lambda p: p.stat().st_mtime)
    if not found:
        sys.exit(f"No detail.xlsx / detailxlsx.zip in {src}. Download Iowa's results workbook into that folder first.")
    src = found[-1]
print(f"Reading {src.name}")
data = src.read_bytes()
if src.suffix.lower() == ".zip":
    z = zipfile.ZipFile(io.BytesIO(data))
    name = next((n for n in z.namelist() if n.lower().endswith(".xlsx")), None)
    if not name:
        sys.exit("No .xlsx inside that zip.")
    data = z.read(name)
wb = zipfile.ZipFile(io.BytesIO(data))

ss = ["".join(t.text or "" for t in si.iter(M + "t")) for si in ET.fromstring(wb.read("xl/sharedStrings.xml")).findall(M + "si")] \
    if "xl/sharedStrings.xml" in wb.namelist() else []
rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(wb.read("xl/_rels/workbook.xml.rels"))}
sheets = [(s.get("name"), "xl/" + rels[s.get(R + "id")].lstrip("/").replace("xl/", ""))
          for s in ET.fromstring(wb.read("xl/workbook.xml")).find(M + "sheets")]


def sheet_rows(part):
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
            cells[re.match(r"[A-Z]+", c.get("r")).group()] = val
        yield cells


colnum = lambda s: sum((ord(ch) - 64) * 26 ** i for i, ch in enumerate(reversed(s)))
rows = None
for _, part in sheets[1:]:  # skip the table of contents
    it = sheet_rows(part)
    first = next(it, {})
    if any("united states senator" in v.lower() for v in first.values()):
        rows = list(it)
        break
if rows is None:
    sys.exit("No 'United States Senator' sheet found in the workbook.")

names = {colnum(c): v.strip() for c, v in rows[0].items() if v.strip()}  # candidate name sits above its first column
hdr = rows[1]
cand_cols = {}  # candidate -> column letter of its Total Votes
for c, v in hdr.items():
    if v.strip().lower() == "total votes":
        owner = max((k for k in names if k <= colnum(c)), default=None)
        if owner:
            cand_cols[names[owner]] = c
print("Candidates:", ", ".join(cand_cols))
last = lambda n: n.split()[-1].lower()
dem = next((n for n in cand_cols if last(n) == a.dem.lower()), None)
rep = next((n for n in cand_cols if last(n) == a.rep.lower()), None)
if not (dem and rep):
    sys.exit(f"--dem {a.dem!r} / --rep {a.rep!r} not found among the candidates above.")

num = lambda v: int(float(v or 0))
out = []
for r in rows[2:]:
    county = (r.get("A") or "").strip()
    if not county or county.lower().startswith("total"):
        continue
    d, rp = num(r.get(cand_cols[dem])), num(r.get(cand_cols[rep]))
    o = sum(num(r.get(c)) for n, c in cand_cols.items() if n not in (dem, rep))
    out.append({"county_name": county, "dem_votes": d, "rep_votes": rp, "other_votes": o})
if len(out) != 99:
    sys.exit(f"Expected 99 counties, found {len(out)}; refusing to guess FIPS codes.")
out.sort(key=lambda r: r["county_name"].lower())  # Iowa county FIPS are the odd numbers 19001..19197 in alphabetical order
for i, r in enumerate(out):
    r.update({"year": 2026, "office": "senate", "race": "regular", "state_po": "IA", "county_fips": str(19001 + 2 * i),
              "total_votes": r["dem_votes"] + r["rep_votes"] + r["other_votes"], "dem_candidate": dem, "rep_candidate": rep})
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, FIELDS); w.writeheader(); w.writerows(out)
tot = sum(r["total_votes"] for r in out)
print(f"{len(out)} counties, {tot:,} votes counted (D {sum(r['dem_votes'] for r in out):,}, R {sum(r['rep_votes'] for r in out):,}).")
if a.no_load:
    sys.exit(0)
if tot == 0:
    print("No votes counted yet; nothing loaded."); sys.exit(0)
subprocess.run([sys.executable, "-I", str(ROOT / "scripts/load_supabase.py"), str(OUT)], check=True)
