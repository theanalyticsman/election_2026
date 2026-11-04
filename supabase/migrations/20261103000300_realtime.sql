-- push county_results changes to open browsers (Supabase Realtime) so the map refreshes as soon as new votes load
alter publication supabase_realtime add table public.county_results;
