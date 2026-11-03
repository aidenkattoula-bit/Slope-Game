-- Run once in Supabase SQL Editor to add speed tiers WITHOUT deleting existing scores.
alter table public.scores
  add column if not exists tier text not null default 'normal'
  check (tier in ('normal', 'advanced', 'extreme', 'godly'));
