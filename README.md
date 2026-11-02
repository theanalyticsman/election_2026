# County election map (2016–2024, plus 2026)

Static map (`web/`) reading county results from Supabase table `county_results`.

- `scripts/download.ps1` – fetch MEDSL source files into `data/raw/` (needs `DV_NAME`, `DV_EMAIL` env vars for Dataverse's guestbook)
- `scripts/build_county_results.py` – aggregate to `data/processed/county_results.csv`
- `scripts/load_supabase.py` – create the table (migration in `supabase/migrations/`) and upsert rows via `supabase db query --linked`
- `scripts/import_2026.py results.csv` – load 2026 results (see `data/2026_template.csv`); re-run as counts update
- `scripts/affinity.py` – county-vs-state affinity scores (Affinity view); `scripts/check_2026.py` – after importing 2026, test whether the bellwethers held
- `scripts/backtest.py` – hold-out test: how well do a few bellwether counties project a state's result (scores from 2020+2022, tested on 2024)
- In the page, **+ Add 2026 results** takes pasted county tables (stored in your browser; Export gives a CSV that `scripts/import_2026.py` can load into Supabase). Clicking a state then shows a bellwether projection (`web/live.js`).
- Run the map: `python -m http.server 5173 --directory web`, open http://localhost:5173

Known gaps: Alaska is reported by state House district, so it is drawn from `web/ak13_districts.json` (2013 plan, 2016-2020) and `web/ak22_districts.json` (2021 plan, 2022+) built from Census cartographic boundaries; Alaska 2022 Senate has only a statewide total so shows no data; Connecticut planning regions vs. old counties in some years,
Kansas City MO (2016 reports it as a separate unit), and precinct rows lacking a county FIPS were dropped.
Senate shows only states with a race that year; Georgia 2020/Oklahoma 2022 etc. regular and special races use the "Senate race" selector.

Aggregation notes: general-election stage only (runoffs excluded); summary rows dropped; King (ME) and Sanders (VT) are counted as D;
other independents/third parties (e.g. McMullin in UT) are 'other'. Swing compares the same race type (regular/special) on both sides.
