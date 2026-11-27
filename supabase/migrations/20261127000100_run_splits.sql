-- Quality work logged rep by rep: pace and distance of each stride,
-- hill or interval, so the weekly review sees more than the session
-- totals. Shape: [{block, label, targetPaceSec, reps: [{paceSec, meters}]}].
-- The plan side needs no column: `program_run_sessions.structure` blocks
-- gain an optional `paceSec` target inside the jsonb.

alter table public.run_logs
  add column splits jsonb not null default '[]'::jsonb;

comment on column public.run_logs.splits is
  'Per-rep pace (s/km) and metres for the quality blocks, with the block label '
  'and target pace snapshotted from the plan on the day.';
