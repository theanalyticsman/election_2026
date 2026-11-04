-- when the data source (e.g. civicAPI) last updated this row's race; lets the map warn when a feed has stalled
alter table public.county_results add column if not exists source_updated timestamptz;
