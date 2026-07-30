-- The dedup index was partial (where dedup_key is not null), which
-- ON CONFLICT (dedup_key) cannot use as an arbiter: every engine-event
-- upsert in /api/sync failed with 42P10 — silently, because the error
-- was never checked — so no fail/clean/bump event ever persisted and
-- the replay rewind had nothing to rewind from. A plain unique index
-- treats NULLs as distinct, so the many null-dedup_key event kinds
-- (ai_change, manual_rm, program_created…) still insert freely.
drop index if exists public.engine_events_dedup_key;
create unique index engine_events_dedup_key
  on public.engine_events (dedup_key);
