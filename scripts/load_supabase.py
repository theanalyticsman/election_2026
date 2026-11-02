"""Upsert data/processed/county_results.csv (and optionally another CSV with the same columns)
into Supabase via `supabase db query --linked`. Usage: python scripts/load_supabase.py [csv_path]"""
import csv, subprocess, sys, tempfile, os, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data/processed/county_results.csv"
CHUNK = 1000
COLS = ["year", "office", "race", "state_po", "county_fips", "county_name", "dem_votes",
        "rep_votes", "other_votes", "total_votes", "dem_candidate", "rep_candidate"]
INT = {"year", "dem_votes", "rep_votes", "other_votes", "total_votes"}
sup = shutil.which("supabase")


def lit(col, v):
    if col in INT:
        return str(int(float(v or 0)))
    return "'" + (v or "").replace("'", "''") + "'"


def run(sql):
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as t:
        t.write(sql)
    try:
        r = subprocess.run([sup, "db", "query", "--linked", "-f", t.name], cwd=ROOT, capture_output=True, text=True)
        if r.returncode:
            sys.exit((r.stdout[-1200:] + r.stderr[-600:]))
    finally:
        os.unlink(t.name)


for mig in ([] if os.environ.get("SKIP_MIGRATIONS") else sorted((ROOT / "supabase/migrations").glob("*.sql"))):
    run(mig.read_text(encoding="utf-8"))
rows = list(csv.DictReader(open(src, encoding="utf-8")))
upd = ", ".join(f"{c}=excluded.{c}" for c in COLS[5:]) + ", updated_at=now()"
for i in range(0, len(rows), CHUNK):
    vals = ",\n".join("(" + ",".join(lit(c, r[c]) for c in COLS) + ")" for r in rows[i:i + CHUNK])
    run(f"insert into public.county_results ({','.join(COLS)}) values\n{vals}\n"
        f"on conflict (year, office, race, state_po, county_fips) do update set {upd};")
    print(f"loaded {min(i + CHUNK, len(rows))}/{len(rows)}", flush=True)
