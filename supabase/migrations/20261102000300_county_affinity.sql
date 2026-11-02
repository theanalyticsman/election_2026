create table if not exists public.county_affinity (
  state_po         text not null,
  county_fips      text not null primary key check (county_fips ~ '^[0-9]{5}$'),
  county_name      text,
  gap_score        numeric,   -- weighted mean |county margin - state margin|, points
  lean             numeric,   -- weighted mean signed gap, + = more Democratic than state
  swing_err        numeric,   -- weighted mean |county swing - state swing|, points (null if no swing pair)
  score            numeric,   -- blended affinity score, lower = tracks the state more closely
  rank_in_state    int,
  state_vote_share numeric,   -- county's average share of the statewide vote
  n_contests       int,
  n_swings         int,
  computed_at      timestamptz not null default now()
);

create index if not exists county_affinity_state on public.county_affinity (state_po, rank_in_state);

alter table public.county_affinity enable row level security;

drop policy if exists "public read" on public.county_affinity;
create policy "public read" on public.county_affinity for select using (true);
