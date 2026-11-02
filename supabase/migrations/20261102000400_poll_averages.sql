create table if not exists public.poll_averages (
  state_po   text not null,
  race       text not null default 'regular' check (race in ('regular', 'special')),
  office     text not null default 'senate',
  n_polls    int,
  n_eff      numeric,        -- effective number of polls after weighting
  last_poll  date,
  dem_pct    numeric,        -- share of decided respondents
  rep_pct    numeric,
  margin     numeric,        -- (D - R) / decided, points
  spread     numeric,        -- weighted spread of the polls' margins
  err        numeric,        -- rough 1-sigma on the statewide margin
  computed_at timestamptz not null default now(),
  primary key (state_po, race, office)
);

alter table public.poll_averages enable row level security;

drop policy if exists "public read" on public.poll_averages;
create policy "public read" on public.poll_averages for select using (true);
