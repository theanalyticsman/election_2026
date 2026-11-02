create table if not exists public.county_results (
  year          int  not null,
  office        text not null check (office in ('president', 'senate')),
  race          text not null default 'regular' check (race in ('regular', 'special')),
  state_po      text not null,
  county_fips   text not null check (county_fips ~ '^[0-9]{5}$'),
  county_name   text,
  dem_votes     int  not null default 0,
  rep_votes     int  not null default 0,
  other_votes   int  not null default 0,
  total_votes   int  not null default 0,
  dem_candidate text,
  rep_candidate text,
  updated_at    timestamptz not null default now(),
  primary key (year, office, race, state_po, county_fips)
);

create index if not exists county_results_lookup on public.county_results (office, year);

alter table public.county_results enable row level security;

drop policy if exists "public read" on public.county_results;
create policy "public read" on public.county_results for select using (true);
-- writes happen only with the service role key (importer script), which bypasses RLS
