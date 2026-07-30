-- ═══════════════════════════════════════════════════════════════
-- Lifts (engine state), logged sessions, and the engine audit trail.
-- ═══════════════════════════════════════════════════════════════

create table public.lifts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,                   -- squat, bench, hipthrust, ohp, rdl…
  name text not null,
  kind public.lift_kind not null,
  exercise_id uuid references public.exercises (id) on delete set null,

  e1rm_kg numeric(6, 2) not null check (e1rm_kg >= 0),
  penalty numeric(4, 3) not null default 0 check (penalty >= 0 and penalty < 1),
  fail_count smallint not null default 0 check (fail_count between 0 and 3),
  hold boolean not null default false,
  hold_at_kg numeric(6, 2),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

comment on column public.lifts.hold is
  'Set after a first range failure: the engine repeats hold_at_kg instead of letting the wave climb.';

create table public.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  program_id uuid references public.programs (id) on delete set null,
  phase_id uuid references public.program_phases (id) on delete set null,
  slot_id uuid references public.program_slots (id) on delete set null,

  scheduled_on date not null,
  week smallint not null check (week >= 1),
  day_index smallint not null check (day_index between 0 and 6),
  session_type public.session_type not null,
  title text not null default '',

  status public.session_status not null default 'planned',
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  tonnage_kg numeric(10, 2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One instance per scheduled slot per day.
  unique (user_id, scheduled_on, slot_id)
);

create index sessions_user_date_idx on public.sessions (user_id, scheduled_on desc);
create index sessions_user_week_idx on public.sessions (user_id, program_id, week);

create table public.set_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  program_exercise_id uuid references public.program_exercises (id) on delete set null,
  lift_key text,
  exercise_name text not null,
  position integer not null default 0,
  set_index smallint not null check (set_index >= 0),

  weight_kg numeric(6, 2),
  reps smallint check (reps is null or reps >= 0),
  rir numeric(3, 1),
  seconds integer,                      -- for timed work (planchas, sóleo)
  /* True when the set landed under the prescribed minimum. */
  missed_range boolean not null default false,
  logged_at timestamptz not null default now(),
  unique (session_id, position, set_index)
);

create index set_logs_user_idx on public.set_logs (user_id, logged_at desc);
create index set_logs_lift_idx on public.set_logs (user_id, lift_key, logged_at desc);

create table public.run_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null unique references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  prescription text not null default '',
  duration_seconds integer,
  distance_km numeric(6, 2),
  avg_hr smallint,
  max_hr smallint,
  /* Pa:HR drift, in percent. Under 5 = the aerobic base is holding. */
  decoupling_pct numeric(4, 1),
  dominant_zone text,
  perceived_effort smallint check (perceived_effort is null or perceived_effort between 1 and 10),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table public.mobility_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  performed_on date not null,
  completed_slugs text[] not null default '{}',
  total_items integer not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, performed_on)
);

-- Everything the engine did, and why. Feeds the Historial timeline.
create table public.engine_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  program_id uuid references public.programs (id) on delete cascade,
  lift_id uuid references public.lifts (id) on delete set null,
  session_id uuid references public.sessions (id) on delete set null,
  week smallint,
  kind public.engine_event_kind not null,
  title text not null,
  detail text not null default '',
  payload jsonb not null default '{}'::jsonb,
  /* Set when the athlete undid the event from the banner. */
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);

create index engine_events_user_idx on public.engine_events (user_id, created_at desc);

-- Tests and body metrics.
create table public.measurements (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.measurement_kind not null,
  taken_on date not null,
  label text not null default '',
  value numeric(8, 2),
  unit text not null default '',
  payload jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index measurements_user_idx on public.measurements (user_id, kind, taken_on desc);

-- ── triggers ───────────────────────────────────────────────────

create trigger lifts_touch_updated_at
  before update on public.lifts
  for each row execute function public.touch_updated_at();

create trigger sessions_touch_updated_at
  before update on public.sessions
  for each row execute function public.touch_updated_at();

-- ── RLS ────────────────────────────────────────────────────────

alter table public.lifts enable row level security;
alter table public.sessions enable row level security;
alter table public.set_logs enable row level security;
alter table public.run_logs enable row level security;
alter table public.mobility_logs enable row level security;
alter table public.engine_events enable row level security;
alter table public.measurements enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'lifts', 'sessions', 'set_logs', 'run_logs',
    'mobility_logs', 'engine_events', 'measurements'
  ] loop
    execute format($f$
      create policy "%1$s: owner only"
        on public.%1$I for all
        to authenticated
        using (user_id = (select auth.uid()))
        with check (user_id = (select auth.uid()));
    $f$, t);
  end loop;
end;
$$;
