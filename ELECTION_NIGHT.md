# Election night runbook (Nov 3, 2026)

Live site: https://election.theanalyticsfolks.com (GitHub Pages from `web/`, repo `theanalyticsman/election_2026`).
The map's 2026 tab reads 2026 rows from the Supabase `county_results` table every minute, under anything pasted in the browser.

## Automatic / semi-automatic feeds
| State | How | Command |
|---|---|---|
| Florida, Ohio | GitHub Actions "Live state results" (every 5 min, 6pm ET Nov 3 to 5am ET Nov 4) | `python scripts/fetch_fl.py`, `python scripts/fetch_oh.py` (local test: add `--no-load`) |
| South Carolina | Blocks GitHub's servers, so run on your PC | `.\scripts\loop_sc.ps1` (every 5 min, Ctrl+C to stop) |
| Michigan | Download the county file from Michigan's results site into `C:\Users\appar\Downloads\election_night`, then run it | `python scripts/import_mi.py` (uses the newest Michigan file in that folder; you can also pass a file or folder path) |

- Actions needs the repo secret `SUPABASE_ACCESS_TOKEN`. You can also press "Run workflow" on the Actions tab.
- Every loader skips loading while no votes are counted. Add `--no-load` to preview.
- `import_mi.py` refuses any file whose election date is not 2026-11-03 (the file you tested was the August primary). It expects the same layout as that primary file; check the party labels (DEMOCRATIC / REPUBLICAN) when the general file appears.
- Local runs need the Supabase CLI logged in and linked (`supabase db query --linked` is what `scripts/load_supabase.py` uses). Set `SKIP_MIGRATIONS=1` to skip re-applying table setup.

## Every other state
Paste the county table into the site's **+ Add 2026 results** box (reads CNN's one-value-per-line layout; NYT's margin-only table is supported in `web/live.js` once that change is pushed). Check the "Using ... as Democratic" line before adding. Pasted data only shows in your own browser.

## Cleanup / mistakes
- Wipe all 2026 rows: `supabase db query --linked "delete from county_results where year=2026"`.
- Sites that block scripts (TX, IA, ME, AK, MN CAPTCHA, MI site) cannot be automated; do not try to bypass them.
