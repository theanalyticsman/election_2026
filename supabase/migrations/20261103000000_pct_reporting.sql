-- share of the vote counted for a county's row (0-100); filled by the live fetchers, null for historical rows
alter table public.county_results add column if not exists pct_reporting numeric;
