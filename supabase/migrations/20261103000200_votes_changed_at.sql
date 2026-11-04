-- when this row's vote total last changed; the map warns when a state's counts have stopped moving
alter table public.county_results add column if not exists votes_changed_at timestamptz default now();
