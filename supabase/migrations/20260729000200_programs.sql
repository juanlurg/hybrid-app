-- ═══════════════════════════════════════════════════════════════
-- Programs.
--
-- A program is a season: phases in order, each phase a weekly
-- template of 7 days pointing at reusable "slots" (Fuerza A, la
-- larga, movilidad…). Slots hold the exercise list, so retyping a
-- day is a pointer change and editing Fuerza A edits it everywhere.
--
-- `user_id is null and is_template` = shared starter plan, readable
-- by everyone, cloned into a private copy at onboarding.
-- ═══════════════════════════════════════════════════════════════

create table public.programs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  is_template boolean not null default false,
  slug text,
  name text not null,
  goal text not null default '',
  summary text not null default '',
  starts_on date not null,
  ends_on date,
  race_on date,
  race_name text,

  -- engine parameters that belong to the plan rather than the athlete
  wave numeric(4, 3)[] not null default array[0.75, 0.80, 0.85, 0.70]::numeric(4, 3)[],
  cycle_weeks integer not null default 4 check (cycle_weeks between 2 and 8),

  is_active boolean not null default true,
  source text not null default 'template' check (source in ('template', 'manual', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programs_owner_or_template
    check ((user_id is not null) or is_template),
  constraint programs_wave_length
    check (array_length(wave, 1) = cycle_weeks)
);

create unique index programs_template_slug_key
  on public.programs (slug) where is_template;
create index programs_user_idx on public.programs (user_id) where user_id is not null;

-- Exactly one active program per athlete.
create unique index programs_one_active_per_user
  on public.programs (user_id) where is_active and user_id is not null;

create table public.program_phases (
  id uuid primary key default extensions.gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  key text not null,                       -- F0, F1, F2…
  name text not null,
  emphasis text not null default '',
  position integer not null,
  weeks integer not null check (weeks between 1 and 52),
  starts_on date,
  notes text not null default '',
  -- Weeks are numbered inside the phase; the run plan is indexed by them.
  created_at timestamptz not null default now(),
  unique (program_id, position),
  unique (program_id, key)
);

-- A reusable session template inside a phase.
create table public.program_slots (
  id uuid primary key default extensions.gen_random_uuid(),
  phase_id uuid not null references public.program_phases (id) on delete cascade,
  key text not null,                       -- A, B, C, run, long, easy, mov, off
  session_type public.session_type not null,
  label text not null,                     -- FUERZA B
  title text not null,                     -- Fuerza B
  subtitle text not null default '',       -- Torso + glúteo pesado · hip thrust
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (phase_id, key)
);

-- The weekly template: 7 rows per phase, each pointing at a slot.
create table public.program_days (
  id uuid primary key default extensions.gen_random_uuid(),
  phase_id uuid not null references public.program_phases (id) on delete cascade,
  day_index smallint not null check (day_index between 0 and 6),  -- 0 = Monday
  slot_id uuid not null references public.program_slots (id) on delete cascade,
  unique (phase_id, day_index)
);

create table public.program_exercises (
  id uuid primary key default extensions.gen_random_uuid(),
  slot_id uuid not null references public.program_slots (id) on delete cascade,
  position integer not null,
  exercise_id uuid references public.exercises (id) on delete set null,
  name text not null,
  tag text not null default '',            -- BÁSICO
  sets smallint not null check (sets between 1 and 12),
  rep_min smallint not null check (rep_min >= 0),
  rep_max smallint not null check (rep_max >= 0),
  rest_seconds integer not null default 120,
  /* The basic of the day. Only this one can trigger the regression. */
  is_primary boolean not null default false,
  load_mode public.load_mode not null default 'engine',
  /* Which tracked lift supplies the weight when load_mode = 'engine'. */
  lift_key text,
  fixed_weight_kg numeric(6, 2),
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint program_exercises_range check (rep_max >= rep_min)
);

create index program_exercises_slot_idx
  on public.program_exercises (slot_id, position);

-- Only one basic per slot: the regression has to have a single owner.
create unique index program_exercises_one_primary_per_slot
  on public.program_exercises (slot_id) where is_primary;

-- The running plan, week by week.
create table public.program_run_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  phase_id uuid not null references public.program_phases (id) on delete cascade,
  slot_id uuid not null references public.program_slots (id) on delete cascade,
  week smallint not null check (week >= 1),
  prescription text not null,
  target_minutes integer,
  notes text not null default '',
  unique (phase_id, slot_id, week)
);

-- ── triggers ───────────────────────────────────────────────────

create trigger programs_touch_updated_at
  before update on public.programs
  for each row execute function public.touch_updated_at();

-- ── RLS ────────────────────────────────────────────────────────

alter table public.programs enable row level security;
alter table public.program_phases enable row level security;
alter table public.program_slots enable row level security;
alter table public.program_days enable row level security;
alter table public.program_exercises enable row level security;
alter table public.program_run_sessions enable row level security;

/* Owns the program a row belongs to (or it is a shared template). */
create or replace function public.can_read_program(p_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.programs p
    where p.id = p_program_id
      and (p.user_id = (select auth.uid()) or p.is_template)
  );
$$;

create or replace function public.owns_program(p_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.programs p
    where p.id = p_program_id and p.user_id = (select auth.uid())
  );
$$;

create or replace function public.program_of_phase(p_phase_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select program_id from public.program_phases where id = p_phase_id;
$$;

create or replace function public.program_of_slot(p_slot_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ph.program_id
  from public.program_slots s
  join public.program_phases ph on ph.id = s.phase_id
  where s.id = p_slot_id;
$$;

create policy "programs: read own and templates"
  on public.programs for select
  to authenticated
  using (user_id = (select auth.uid()) or is_template);

create policy "programs: write own"
  on public.programs for insert
  to authenticated
  with check (user_id = (select auth.uid()) and not is_template);

create policy "programs: update own"
  on public.programs for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and not is_template);

create policy "programs: delete own"
  on public.programs for delete
  to authenticated
  using (user_id = (select auth.uid()));

create policy "phases: read"
  on public.program_phases for select
  to authenticated
  using (public.can_read_program(program_id));

create policy "phases: write own"
  on public.program_phases for all
  to authenticated
  using (public.owns_program(program_id))
  with check (public.owns_program(program_id));

create policy "slots: read"
  on public.program_slots for select
  to authenticated
  using (public.can_read_program(public.program_of_phase(phase_id)));

create policy "slots: write own"
  on public.program_slots for all
  to authenticated
  using (public.owns_program(public.program_of_phase(phase_id)))
  with check (public.owns_program(public.program_of_phase(phase_id)));

create policy "days: read"
  on public.program_days for select
  to authenticated
  using (public.can_read_program(public.program_of_phase(phase_id)));

create policy "days: write own"
  on public.program_days for all
  to authenticated
  using (public.owns_program(public.program_of_phase(phase_id)))
  with check (public.owns_program(public.program_of_phase(phase_id)));

create policy "program exercises: read"
  on public.program_exercises for select
  to authenticated
  using (public.can_read_program(public.program_of_slot(slot_id)));

create policy "program exercises: write own"
  on public.program_exercises for all
  to authenticated
  using (public.owns_program(public.program_of_slot(slot_id)))
  with check (public.owns_program(public.program_of_slot(slot_id)));

create policy "run sessions: read"
  on public.program_run_sessions for select
  to authenticated
  using (public.can_read_program(public.program_of_phase(phase_id)));

create policy "run sessions: write own"
  on public.program_run_sessions for all
  to authenticated
  using (public.owns_program(public.program_of_phase(phase_id)))
  with check (public.owns_program(public.program_of_phase(phase_id)));
