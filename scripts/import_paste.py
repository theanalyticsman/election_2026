"""Load a county table you pasted into Excel (e.g. from USA Today) for a U.S. Senate race.

Usage: python scripts/import_paste.py [file.xlsx] [--state TX] [--dem Talarico --rep Paxton] [--no-load]
Default file: ~/Downloads/election_night/copypaste.xlsx (first sheet; read in one go, so it can stay open in Excel).
Expected layout (USA Today): a header row, then one row per county: County | "NN% in" | one column per candidate
(last name) | ... "Other" ... | "Vote margin" | "Population". Header cells are matched by name, so column order can vary:
a candidate column is any header that is not County / % in / Other / Vote margin / Population / Total.
--state is guessed from the county names if left out (printed so you can check it). --dem / --rep are candidate last names
as they appear in the header; the 2026 nominees below are used when the header matches them.
The vote counts must be per candidate, not percentages. Everything that is not Dem or Rep (incl. the Other column) is other.
"""
import argparse, csv, io, re, subprocess, sys, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/processed/county_results_2026_paste.csv"
REF = ROOT / "data/processed/county_affinity.csv"  # one row per county: state_po, county_fips, county_name
FIELDS = ["year", "office", "race", "state_po", "county_fips", "county_name", "dem_votes",
          "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"]
# (Dem, Rep) last names as listed by civicAPI / state feeds on Nov 2-3 2026; the header must match them to be used
NOMINEES = {"TX": ("Talarico", "Paxton"), "MN": ("Flanagan", "Tafoya"), "ME": ("Jackson", "Collins"), "KS": ("Hamilton", "Marshall"),
            "MI": ("El-Sayed", "Rogers"), "KY": ("Booker", "Barr"), "FL": ("Nixon", "Moody"), "OH": ("Brown", "Husted"),
            "SC": ("Andrews", "Graham"), "IA": ("Turek", "Hinson")}
SPECIAL = {"FL", "OH"}
SKIP_HEAD = re.compile(r"^(county|%|.*\bin$|other|others|vote margin|margin|population|total|pop|state)", re.I)
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

ap = argparse.ArgumentParser()
ap.add_argument("file", nargs="?", default=str(Path.home() / "Downloads" / "election_night" / "copypaste.xlsx"))
ap.add_argument("--state")
ap.add_argument("--dem")
ap.add_argument("--rep")
ap.add_argument("--no-load", action="store_true")
a = ap.parse_args()


def norm(s):
    s = re.sub(r"[̀-ͯ]", "", str(s or "").lower())
    s = re.sub(r"\b(county|parish|borough|census area|municipality|city and borough)\b", "", s.replace("&", "and"))
    return re.sub(r"[^a-z0-9]", "", s.replace("saint", "st"))


def read_rows(path):
    if True:  # read the bytes in one go, so the file can stay open in Excel
        wb = zipfile.ZipFile(io.BytesIO(Path(path).read_bytes()))
        ss = ["".join(x.text or "" for x in si.iter(M + "t")) for si in ET.fromstring(wb.read("xl/sharedStrings.xml")).findall(M + "si")] \
            if "xl/sharedStrings.xml" in wb.namelist() else []
        part = "xl/worksheets/sheet1.xml" if "xl/worksheets/sheet1.xml" in wb.namelist() else sorted(n for n in wb.namelist() if n.startswith("xl/worksheets/sheet"))[0]
        rows = []
        for row in ET.fromstring(wb.read(part)).iter(M + "row"):
            cells = {}
            for c in row.findall(M + "c"):
                v = c.find(M + "v")
                if c.get("t") == "s" and v is not None:
                    val = ss[int(v.text)]
                elif c.get("t") == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(M + "t"))
                else:
                    val = v.text if v is not None else ""
                cells[re.match(r"[A-Z]+", c.get("r")).group()] = val.strip()
            if cells:
                rows.append(cells)
        return rows


path = Path(a.file)
if not path.exists():
    sys.exit(f"{path} not found.")
rows = read_rows(path)
if len(rows) < 2:
    sys.exit("The sheet has no data rows.")
head = rows[0]
cols = sorted(head, key=lambda c: (len(c), c))
# the "% in" column is the one whose values look like "75% in"; its header cell may be blank
pct_col = next((c for c in cols if sum(bool(re.search(r"%\s*in\b", r.get(c, ""), re.I)) for r in rows[1:]) > len(rows) * 0.5), None)
cand_cols = {c: head[c] for c in cols if c != "A" and c != pct_col and head.get(c) and not SKIP_HEAD.match(head[c])}
other_cols = [c for c in cols if head.get(c, "").strip().lower() in ("other", "others")]
if not cand_cols:
    sys.exit(f"Could not find candidate columns in the header row: {list(head.values())}")

ref = {}  # state -> {normalised county name -> (fips, name)}
for r in csv.DictReader(open(REF, encoding="utf-8")):
    ref.setdefault(r["state_po"], {})[norm(r["county_name"])] = (r["county_fips"], r["county_name"])
names = [norm(r.get("A")) for r in rows[1:] if r.get("A")]
po = (a.state or "").upper()
if not po:  # guess the state: the one whose counties match the most names
    score = {s: sum(n in m for n in names) for s, m in ref.items()}
    po = max(score, key=score.get)
    print(f"State guessed from county names: {po} ({score[po]} of {len(names)} names matched). Pass --state to override.")
if po not in ref:
    sys.exit(f"No county reference for state {po}.")

lastname = lambda h: re.sub(r"[^a-z]", "", h.lower().split(",")[0].split()[-1] if "," not in h else h.lower().split(",")[0])
want = {"dem": (a.dem or "").lower(), "rep": (a.rep or "").lower()}
if po in NOMINEES:
    want["dem"] = want["dem"] or NOMINEES[po][0].lower()
    want["rep"] = want["rep"] or NOMINEES[po][1].lower()
find = lambda w: next((c for c, h in cand_cols.items() if w and re.sub(r"[^a-z]", "", w) in re.sub(r"[^a-z]", "", h.lower())), None)
dem, rep = find(want["dem"]), find(want["rep"])
print("Candidate columns:", ", ".join(cand_cols.values()), "| Other:", [head[c] for c in other_cols] or "none")
if not (dem and rep):
    sys.exit(f"Could not match --dem {a.dem!r} / --rep {a.rep!r} to those headers; pass both (last names as in the header).")
print(f"Using {head[dem]} as Democratic and {head[rep]} as Republican.")

num = lambda v: int(float(v.replace(",", ""))) if re.fullmatch(r"-?[\d,]+(\.\d+)?", (v or "").strip()) else 0
out, unmatched, seen = [], [], set()
for r in rows[1:]:
    label = r.get("A", "")
    if not label or re.match(r"^(total|statewide|state total)", label, re.I):
        continue
    hit = ref[po].get(norm(label))
    if not hit:
        unmatched.append(label)
        continue
    if hit[0] in seen:
        continue
    seen.add(hit[0])
    d, rp = num(r.get(dem)), num(r.get(rep))
    o = sum(num(r.get(c)) for c in cand_cols if c not in (dem, rep)) + sum(num(r.get(c)) for c in other_cols)
    out.append({"year": 2026, "office": "senate", "race": "special" if po in SPECIAL else "regular", "state_po": po,
                "county_fips": hit[0], "county_name": hit[1], "dem_votes": d, "rep_votes": rp, "other_votes": o,
                "total_votes": d + rp + o, "dem_candidate": head[dem], "rep_candidate": head[rep]})
if unmatched:
    print(f"Not matched to a {po} county (left out): {', '.join(unmatched[:12])}{' ...' if len(unmatched) > 12 else ''}")
if not out:
    sys.exit("No county rows matched.")
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, FIELDS); w.writeheader(); w.writerows(out)
tot = sum(r["total_votes"] for r in out)
print(f"{po}: {len(out)} of {len(ref[po])} counties, {tot:,} votes (D {sum(r['dem_votes'] for r in out):,}, R {sum(r['rep_votes'] for r in out):,}).")
if a.no_load:
    sys.exit(0)
if tot == 0:
    print("No votes counted yet; nothing loaded."); sys.exit(0)
subprocess.run([sys.executable, "-I", str(ROOT / "scripts/load_supabase.py"), str(OUT)], check=True)
