# Election night runbook (Nov 3, 2026)

Live site: https://election.theanalyticsfolks.com (GitHub Pages from `web/`, repo `theanalyticsman/election_2026`).
The 2026 tab reads 2026 rows from the Supabase `county_results` table every minute, under anything pasted in a browser.
**To start a new chat tomorrow, say "read ELECTION_NIGHT.md" first.** Run commands from the project folder.

## Quick map: which state, which route

| State | Route | Section |
|---|---|---|
| Florida, Ohio | Automatic (GitHub Actions, every 5 min) | A |
| South Carolina | Loop on your PC (same loop as Iowa) | B |
| Michigan | Download county file, run script | C |
| Iowa | Loop on your PC (downloads the workbook itself) | D |
| Texas, Maine, Alaska, Minnesota, Kansas, Nebraska, Kentucky, and every other state | Copy a county table, paste | E |

Common setup for any local run: the Supabase CLI must be logged in and linked (`supabase db query --linked` is what `scripts/load_supabase.py` uses). Set `SKIP_MIGRATIONS=1` to skip re-applying table setup. Every loader prints "No votes counted yet" and loads nothing until votes exist. Add `--no-load` to preview without loading.

## A. Florida and Ohio: automatic
- GitHub Actions workflow "Live state results" runs every 5 min from 6pm ET Nov 3 to 5am ET Nov 4. Needs the repo secret `SUPABASE_ACCESS_TOKEN`. You can also press **Run workflow** on the Actions tab. Each state is its own step, so one failing step does not stop the others (the South Carolina step is expected to fail there; see B).
- Local equivalents: `python scripts/fetch_fl.py`, `python scripts/fetch_oh.py`.
- Florida's feed has no party field: Nixon is D, Moody is R (`--dem` / `--rep` to change). Ohio's party comes from the feed. Both are the **special** Senate races. Ohio's XML feed says `IsTest=true` until real results post.

## B. South Carolina: loop on your PC
- SC's site returns an empty response to GitHub's servers, so it only works from your own connection.
- Run `.\scripts\loop_local.ps1` in PowerShell. It handles **South Carolina and Iowa** together every 5 min (Ctrl+C stops it; `-Minutes 3` changes the interval). PC must stay awake and online. (`loop_sc.ps1` is the older South Carolina-only version.)
- One-off: `python scripts/fetch_sc.py`. Party comes from the feed. Regular Senate race.

## C. Michigan: download file, run script
1. In your browser, open https://mvic.sos.state.mi.us/VoteHistory/GetElectionResultFile?electionId=706 and save the county results file (tab-delimited `..._CENR_BY_COUNTY.txt`) into `C:\Users\appar\Downloads\election_night`. This must be done by hand: the site sits behind a Cloudflare "Just a moment" check that blocks scripts (do not try to bypass it). Check the file's election date: `electionId=706` was supplied as the link for tomorrow's election, but it was not opened from a browser in advance, so confirm it is the Nov 3 general and not the August primary.
2. Run `python scripts/import_mi.py` (uses the newest Michigan file in that folder; you can also pass a file or folder path).
3. Re-download and re-run for each update.
- It refuses any file whose election date is not 2026-11-03 (the file tested in advance was the August primary).
- I have only seen the primary file's layout. Check the party labels (DEMOCRATIC / REPUBLICAN) when the general file appears; if the layout differs the script will stop with an error to fix.
- Regular Senate race.

## D. Iowa: loop on your PC (or run once)
Iowa's results site (Clarity ENR, election 127077) accepts scripts from my PC, so no manual download is needed. GitHub's servers get an empty response from Iowa's site (tested: `current_ver.txt is not a version number: ''`), same as South Carolina, so Iowa runs on your PC, not in Actions.

1. Run `python scripts/import_ia.py --download`. It reads https://electionresults.iowa.gov/IA/127077/current_ver.txt (the current version number), downloads `.../127077/<version>/reports/detailxlsx.zip` into `C:\Users\appar\Downloads\election_night`, and loads the Senate sheet. (Tested: version 383162, same 220,538-byte file as the manual download.)
2. Re-run the same command for each update (the version number changes as results update, which is why the script looks it up instead of using a fixed link; a pasted link like `.../127077/383162/reports/detailxlsx.zip` goes stale).
3. Without `--download` it reads the newest detail zip/xlsx already in the folder, if you saved one by hand. It reads the sheet named "United States Senator"; `--dem Turek --rep Hinson` are the defaults, Laehn and write-ins count as other.
- For a repeating run, `.\scripts\loop_local.ps1` (see B) already includes Iowa.
- The workbook has no party field, hence the name flags. Tested only on the zero-vote pre-election file: 99 counties, correct codes (Polk 19153, Johnson 19103). Not yet tried on real counts.
- Regular Senate race.

## E. Every other state: copy a table and paste
Use this for Texas, Maine, Alaska, Minnesota, Kansas, Nebraska, Kentucky, and any state not above. Several of these (TX, ME, AK, MN, MI's site) refuse scripts or sit behind a CAPTCHA; do not try to bypass that. Opening the page in your own browser and copying a table is fine.

### Where to copy from (best first)
1. **The state's own results site**, if it shows a county table with vote counts.
2. **CNN "Results by county"**: copies one value per line (county, "Est. 100% in", then % and votes per candidate). The paste box reads this layout (tested on Iowa 2024).
3. **NYT county table**: it only has margin ("Trump +3"), total votes and % in, no per-candidate votes. The paste box can estimate votes from those (accurate to about a point), **but that support is committed locally only until `web/live.js` is pushed** (check `git status`; push it if you want to rely on it). Prefer CNN or a state site where you can.
4. **AP**: its county data loads in the browser, not in the page, and the AP data is licensed; do not scrape it. Copying a visible table is fine, but the paste box has not been tested on AP's layout.
5. Need vote counts, not percentages. Percent-only tables do not work.

### Paste into the site (shows on your own screen only)
1. Open the site, click **+ Add 2026 results**.
2. Pick the **state** and **contest** (Senate, regular or special; Florida and Ohio are special). Paste the table, header row included.
3. **Check the line "Using X as Democratic and Y as Republican".** The box cannot tell parties from names; if it is backwards, change the pickers (a swap flips the whole state). Rows it cannot match to a county are listed with a dropdown to assign or skip.
4. Click **Add to map**. Re-paste for each update; it replaces that state's earlier rows.
- Alaska and DC are not supported (Alaska is mapped by state House district, with no county-level scores).
- Pasted results live in that browser only (`localStorage`). **Export all as CSV** in the dialog keeps a copy.

### Make a pasted state visible to everyone (optional)
1. In the dialog click **Export all as CSV** (or build a CSV from `data/2026_template.csv`: `state_po, county_fips, dem_votes, rep_votes` plus optional columns).
2. Run `python scripts/import_2026.py path\to\results.csv` to load it into Supabase; visitors see it within a minute.

### Or paste it to Claude in chat
In a new chat, paste the table with the state, the contest and "regular" or "special". Claude cleans it, shows which columns it read as D and R, and loads it with `scripts/import_2026.py`. This costs a turn per update, so it suits a refresh every 15 to 30 minutes per state, not constant updates. Pointing Claude at a downloaded file path is cheaper than pasting a big table.

## Cleanup / mistakes
- Wipe all 2026 rows: `supabase db query --linked "delete from county_results where year=2026"` (this removes every 2026 row from every state).
- Sites that block scripts (TX, ME, AK, MN, MI's site) cannot be automated; do not try to bypass them. Kansas posts no live results at all.
- The Actions run for South Carolina will show a red step each run; that is the known block, not a bug.
