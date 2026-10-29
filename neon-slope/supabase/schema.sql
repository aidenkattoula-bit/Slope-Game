-- =============================================================================
-- NEON SLOPE - Supabase schema
-- Paste this whole file into: Supabase Dashboard -> SQL Editor -> New query -> Run
-- It is safe to re-run. WARNING: it drops and recreates the `scores` table.
-- =============================================================================

drop table if exists public.scores cascade;

create table public.scores (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text        not null check (char_length(name) between 1 and 14),
  score       integer     not null check (score between 0 and 1000000),
  -- the track/race code (e.g. FUN42). Null is allowed for old/unknown runs.
  seed        text                 check (seed is null or seed ~ '^[A-Z0-9]{1,12}$'),
  mode        text        not null check (mode in ('solo', 'seeded', 'pass'))
);

-- global top-N, and per-race-code scoreboards
create index scores_score_idx      on public.scores (score desc);
create index scores_seed_score_idx on public.scores (seed, score desc) where seed is not null;

-- -----------------------------------------------------------------------------
-- Row Level Security: anyone may READ scores and INSERT a new one.
-- There are deliberately NO update / delete policies, so the public (anon) key
-- can never edit or erase anything.
-- -----------------------------------------------------------------------------
alter table public.scores enable row level security;

create policy "scores are readable by everyone"
  on public.scores for select
  to anon, authenticated
  using (true);

create policy "anyone can submit a score"
  on public.scores for insert
  to anon, authenticated
  with check (
    char_length(name) between 1 and 14
    and score between 0 and 1000000
    and mode in ('solo', 'seeded', 'pass')
  );

grant usage on schema public to anon, authenticated;
grant select, insert on public.scores to anon, authenticated;
