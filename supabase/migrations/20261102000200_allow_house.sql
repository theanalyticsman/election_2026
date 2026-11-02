alter table public.county_results drop constraint if exists county_results_office_check;
alter table public.county_results add constraint county_results_office_check
  check (office in ('president', 'senate', 'house'));
