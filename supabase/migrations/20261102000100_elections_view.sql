create or replace view public.county_result_elections with (security_invoker = true) as
  select distinct office, year, race from public.county_results;
grant select on public.county_result_elections to anon, authenticated;
