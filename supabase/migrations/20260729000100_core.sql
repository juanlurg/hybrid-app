-- ═══════════════════════════════════════════════════════════════
-- Bloques — core types, profiles, catalogue.
--
-- Ownership model: every row that belongs to an athlete carries
-- `user_id` and is guarded by RLS. Rows with `owner_id is null`
-- (exercise catalogue, mobility catalogue, template programs) are
-- shared read-only reference data.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto" with schema extensions;

-- ── enums ──────────────────────────────────────────────────────

create type public.unit_system as enum ('kg', 'lb');
create type public.distance_unit as enum ('km', 'mi');
create type public.zone_model as enum ('lthr', 'hrmax');
create type public.regression_rule as enum ('conservative', 'standard', 'aggressive');
create type public.lift_kind as enum ('lower', 'upper');

create type public.session_type as enum (
  'strength',
  'run_quality',
  'run_long',
  'run_easy',
  'run_test',
  'mobility',
  'rest'
);

create type public.load_mode as enum (
  'engine',              -- the wave × e1RM machinery decides
  'fixed',               -- a number the athlete pinned
  'bodyweight',
  'weighted_bodyweight', -- dominadas lastradas
  'rpe'                  -- by feel; nothing to compute
);

create type public.session_status as enum (
  'planned',
  'in_progress',
  'done',
  'partial',
  'skipped'
);

create type public.engine_event_kind as enum (
  'fail_hold',
  'fail_penalty',
  'clean_reset',
  'cycle_bump',
  'lthr_test',
  'rm_retest',
  'manual_rm',
  'ai_change',
  'program_created',
  'phase_started'
);

create type public.ai_proposal_status as enum (
  'pending',
  'applied',
  'discarded',
  'undone'
);

create type public.measurement_kind as enum (
  'lthr',
  'rm_estimate',
  'time_trial',
  'body'
);

-- ── profiles ───────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  locale text not null default 'es',

  -- athlete
  body_weight_kg numeric(6, 2),
  height_cm integer,
  units public.unit_system not null default 'kg',

  -- equipment
  bar_kg numeric(5, 2) not null default 20 check (bar_kg > 0),
  -- 1.25s are in by default: without them a 2.5 kg rounding step is not
  -- actually loadable, since one plate a side moves the bar 2 kg minimum.
  plates_kg numeric(5, 2)[] not null default array[25, 20, 15, 10, 5, 2.5, 1.25]::numeric(5, 2)[],
  dumbbell_step_kg numeric(5, 2) not null default 2.5 check (dumbbell_step_kg > 0),

  -- weight engine
  rounding_kg numeric(5, 2) not null default 2.5 check (rounding_kg > 0),
  regression_rule public.regression_rule not null default 'standard',
  auto_deload boolean not null default true,
  sync_rm_after_retest boolean not null default true,
  inc_lower_kg numeric(5, 2) not null default 5 check (inc_lower_kg >= 0),
  inc_upper_kg numeric(5, 2) not null default 2.5 check (inc_upper_kg >= 0),
  target_rir text not null default '1-3',

  -- session behaviour
  auto_rest_timer boolean not null default true,
  rest_sound boolean not null default true,
  rest_vibration boolean not null default true,
  keep_screen_awake boolean not null default true,
  show_plate_breakdown boolean not null default true,

  -- running
  lthr integer check (lthr is null or (lthr between 100 and 230)),
  zone_model public.zone_model not null default 'lthr',
  distance_unit public.distance_unit not null default 'km',

  -- notifications
  notify_session boolean not null default true,
  notify_deload boolean not null default true,
  notify_weekly_summary boolean not null default false,

  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per athlete. Holds every knob the weight engine reads.';

-- ── exercise catalogue ─────────────────────────────────────────

create table public.exercises (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade,
  slug text not null,
  name text not null,
  modality public.load_mode not null default 'engine',
  pattern text,               -- squat / hinge / push_h / push_v / pull_h / pull_v / carry / core / calf
  is_unilateral boolean not null default false,
  default_rest_seconds integer not null default 120,
  cues text,
  substitution_for uuid references public.exercises (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Slugs are unique inside the global catalogue and inside each athlete's.
create unique index exercises_global_slug_key
  on public.exercises (slug) where owner_id is null;
create unique index exercises_owner_slug_key
  on public.exercises (owner_id, slug) where owner_id is not null;

-- ── mobility catalogue ─────────────────────────────────────────

create table public.mobility_items (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade,
  slug text not null,
  group_name text not null,
  name text not null,
  dose text not null,
  dose_unit text not null default '',
  note text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index mobility_items_global_slug_key
  on public.mobility_items (slug) where owner_id is null;
create unique index mobility_items_owner_slug_key
  on public.mobility_items (owner_id, slug) where owner_id is not null;

-- ── updated_at helper ──────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── new user → profile ─────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RLS ────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.exercises enable row level security;
alter table public.mobility_items enable row level security;

create policy "profiles are self-service"
  on public.profiles for all
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "catalogue: read global and own"
  on public.exercises for select
  to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));

create policy "catalogue: write own"
  on public.exercises for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "mobility: read global and own"
  on public.mobility_items for select
  to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));

create policy "mobility: write own"
  on public.mobility_items for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
