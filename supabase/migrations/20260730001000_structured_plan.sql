-- ═══════════════════════════════════════════════════════════════
-- Structured plan: everything the audit found the schema could not
-- say out loud.
--
--  · program_phases learn their own progression (wave overrides or
--    a fixed %RM) so F3/F4 stop inheriting F2's wave machinery.
--  · program_exercises learn effort (reps/seconds/amrap), superset
--    grouping and equipment; the fused "Curl + tríceps" rows are
--    split into real pairs.
--  · program_run_sessions gain a typed `structure`; the free-text
--    prescription stays as the render label.
--  · exercises (catalogue) and profiles learn about equipment, so
--    the load resolver can round dumbbells like dumbbells and snap
--    kettlebells to the two the athletes actually own.
--  · engine_events gain a dedup_key (idempotent replay, used by the
--    offline sync) and two new kinds.
--  · shift_program() moves a whole season N days in one call.
--
-- All backfills run in place over the template AND cloned programs,
-- following the precedent of 20260729000900_accessory_start_loads.
-- ═══════════════════════════════════════════════════════════════

-- ── new enum values (not used inside this transaction) ─────────

alter type public.engine_event_kind add value if not exists 'accessory_bump';
alter type public.engine_event_kind add value if not exists 'plan_shifted';

-- ── equipment ──────────────────────────────────────────────────

create type public.equipment_kind as enum (
  'barbell',
  'dumbbell',
  'kettlebell',
  'pulley',
  'bodyweight',
  'band',
  'dip_bars',
  'machine'
);

alter table public.exercises
  add column equipment public.equipment_kind not null default 'bodyweight';

update public.exercises set equipment = v.eq::public.equipment_kind
from (values
  ('sentadilla',                 'barbell'),
  ('press-banca',                'barbell'),
  ('press-banca-ligero',         'barbell'),
  ('press-militar',              'barbell'),
  ('press-militar-landmine',     'barbell'),
  ('remo-barra',                 'barbell'),
  ('rdl',                        'barbell'),
  ('hip-thrust',                 'barbell'),
  ('hip-thrust-ligero',          'barbell'),
  ('calf-raise',                 'barbell'),
  ('press-inclinado-mancuernas', 'dumbbell'),
  ('split-bulgaro',              'dumbbell'),
  ('zancada-bulgara',            'dumbbell'),
  ('elevaciones-laterales',      'dumbbell'),
  ('farmer-carry',               'dumbbell'),
  ('sentadilla-goblet',          'kettlebell'),
  ('single-leg-rdl',             'kettlebell'),
  ('remo-polea',                 'pulley'),
  ('jalon-al-pecho',             'pulley'),
  ('face-pull',                  'pulley'),
  ('curl-triceps',               'pulley'),
  ('pallof-press',               'pulley'),
  ('rotacion-externa-banda',     'band'),
  ('fondos',                     'dip_bars'),
  ('dominadas',                  'bodyweight'),
  ('dominadas-lastradas',        'bodyweight'),
  ('dominadas-supinas',          'bodyweight'),
  ('copenhagen-plank',           'bodyweight'),
  ('plancha-lateral',            'bodyweight'),
  ('nordico-excentrico',         'bodyweight'),
  ('soleo-excentrico',           'bodyweight'),
  ('tibialis-raise',             'bodyweight')
) as v(slug, eq)
where exercises.slug = v.slug and exercises.owner_id is null;

-- Athlete inventory. Defaults mirror the home gym both athletes share.
alter table public.profiles
  add column pulley_step_kg numeric(5, 2) not null default 5
    check (pulley_step_kg > 0),
  add column kettlebells_kg numeric(5, 2)[] not null
    default array[12, 16]::numeric(5, 2)[],
  add column available_equipment public.equipment_kind[] not null
    default array[
      'barbell', 'dumbbell', 'kettlebell', 'pulley',
      'bodyweight', 'band', 'dip_bars'
    ]::public.equipment_kind[];

-- ── structured strength prescription ───────────────────────────

alter table public.program_exercises
  add column effort text not null default 'reps'
    check (effort in ('reps', 'seconds', 'amrap')),
  add column superset_group smallint,
  /* Denormalised from the catalogue, like `name`: survives catalogue edits. */
  add column equipment public.equipment_kind;

comment on column public.program_exercises.effort is
  'What a "rep" means: reps counts, seconds holds (planks), amrap = as many as possible.';
comment on column public.program_exercises.superset_group is
  'Rows in the same slot sharing a group run back to back: rest only after the last one.';

-- Equipment from the catalogue; engine lifts default to the bar.
update public.program_exercises pe
set equipment = e.equipment
from public.exercises e
where pe.exercise_id = e.id and pe.equipment is null;

update public.program_exercises
set equipment = 'barbell'
where equipment is null and load_mode = 'engine';

update public.program_exercises
set equipment = 'bodyweight'
where equipment is null
  and load_mode in ('bodyweight', 'weighted_bodyweight');

-- Isometrics: the rep range was always seconds; now the row says so.
update public.program_exercises pe
set effort = 'seconds'
from public.exercises e
where pe.exercise_id = e.id
  and e.owner_id is null
  and e.slug in ('copenhagen-plank', 'plancha-lateral');

-- ── split the fused superset rows into real pairs ──────────────
-- 'Curl bíceps + tríceps polea' was one row standing for two
-- exercises. The original row becomes the first element (set_logs
-- keep pointing at it); the second element is inserted right after.

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max,
   rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes,
   effort, superset_group, equipment)
select
  f.slot_id,
  (select coalesce(max(x.position), 0) + 1
     from public.program_exercises x where x.slot_id = f.slot_id),
  (select e.id from public.exercises e
     where e.owner_id is null
       and e.slug = case when f.name like 'Tibialis%' then 'calf-raise'
                         else 'curl-triceps' end),
  case when f.name like 'Tibialis%' then 'Calf raise' else 'Tríceps en polea' end,
  '', f.sets, f.rep_min, f.rep_max, f.rest_seconds, false, f.load_mode,
  null, f.fixed_weight_kg,
  'Superserie con el anterior, sin descanso entre los dos.',
  'reps', 1,
  case when f.name like 'Tibialis%' then 'bodyweight'::public.equipment_kind
       else 'pulley'::public.equipment_kind end
from public.program_exercises f
where f.name in ('Tibialis + calf raise', 'Tibialis + calf',
                 'Curl bíceps + tríceps polea', 'Curl + tríceps');

update public.program_exercises
set name = case when name like 'Tibialis%' then 'Tibialis raise'
                else 'Curl bíceps' end,
    exercise_id = case when name like 'Tibialis%'
      then (select e.id from public.exercises e
             where e.slug = 'tibialis-raise' and e.owner_id is null)
      else exercise_id end,
    equipment = case when name like 'Tibialis%'
      then 'bodyweight'::public.equipment_kind
      else 'pulley'::public.equipment_kind end,
    superset_group = 1,
    notes = 'Superserie con el siguiente, sin descanso entre los dos.'
where name in ('Tibialis + calf raise', 'Tibialis + calf',
               'Curl bíceps + tríceps polea', 'Curl + tríceps');

-- ── per-phase progression ──────────────────────────────────────

alter table public.program_phases
  add column wave numeric(4, 3)[],
  add column cycle_weeks integer
    check (cycle_weeks is null or cycle_weeks between 2 and 8),
  add column progression_mode text not null default 'wave'
    check (progression_mode in ('wave', 'fixed_pct')),
  add column pct_of_rm numeric(4, 3)
    check (pct_of_rm is null or (pct_of_rm between 0.4 and 1));

comment on column public.program_phases.progression_mode is
  'wave = the e1RM × wave machinery, weeks counted INSIDE the phase. '
  'fixed_pct = every week at pct_of_rm, no cycle bumps, no auto deload.';

-- Backfill the master plan and every clone of it. The fix this pays
-- for: the wave used to run on the absolute program week, so F2
-- week 1 (absolute week 8) landed on wave[3] = 0.70 — a deload.
-- Phase-local weeks start every phase at wave[0].
update public.program_phases ph
set wave = array[0.75, 0.80, 0.80, 0.70]::numeric(4, 3)[]
where ph.key = 'F0'
  and ph.program_id in
    (select id from public.programs where is_template or source = 'template');

update public.program_phases ph
set progression_mode = 'fixed_pct', pct_of_rm = 0.80
where ph.key in ('F3', 'F4')
  and ph.program_id in
    (select id from public.programs where is_template or source = 'template');

-- ── structured run prescription ────────────────────────────────

alter table public.program_run_sessions
  add column structure jsonb;

comment on column public.program_run_sessions.structure is
  'Typed block list [{kind, repeat, workMin|workKm|workSec, zone, recMin, note}]. '
  'The prescription text stays as the human label; null falls back to the legacy parser.';

-- Exact mapping for every prescription the seed ever wrote, so the
-- backfill is deterministic instead of parsed. Applies to template
-- and clones alike (matched by the literal text). Rows the athletes
-- have reworded keep structure = null and render via the old parser.
update public.program_run_sessions rs
set structure = m.structure::jsonb
from (values
  -- F0 · carrera y caminatas
  ('45'' Z2 por sensación', '[{"kind":"steady","workMin":45,"zone":"Z2","note":"Por sensación, sin reloj."}]'),
  ('50'' Z2',               '[{"kind":"steady","workMin":50,"zone":"Z2"}]'),
  ('45'' Z2',               '[{"kind":"steady","workMin":45,"zone":"Z2"}]'),
  ('Caminata 90'' con mochila',   '[{"kind":"walk","workMin":90,"note":"Con la mochila del Camino."}]'),
  ('Caminata 2 h con mochila',    '[{"kind":"walk","workMin":120,"note":"Con la mochila del Camino."}]'),
  ('Caminata 3 h con mochila',    '[{"kind":"walk","workMin":180,"note":"Prueba de calzado y calcetines."}]'),
  ('Caminata 3-4 h con mochila',  '[{"kind":"walk","workMin":210,"note":"Ensayo final antes del Camino."}]'),
  -- F1 · Camino
  ('Etapas de 20-25 km',              '[{"kind":"walk","workKm":22.5,"note":"Etapa del Camino."}]'),
  ('Etapas de 20-30 km',              '[{"kind":"walk","workKm":25,"note":"Etapa del Camino."}]'),
  ('Etapas finales hasta Santiago',   '[{"kind":"walk","note":"Etapas finales."}]'),
  -- F2 · calidad
  ('35'' Z2 por sensación',           '[{"kind":"steady","workMin":35,"zone":"Z2","note":"Por sensación, sin reloj."}]'),
  ('40'' Z2 + 4 strides 20"',         '[{"kind":"steady","workMin":40,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('45'' Z2 + 6 strides',             '[{"kind":"steady","workMin":45,"zone":"Z2"},{"kind":"strides","repeat":6,"workSec":20}]'),
  ('Test LTHR 30''',                  '[{"kind":"test","workMin":30}]'),
  ('40'' Z2 + 6 cuestas 20"',         '[{"kind":"steady","workMin":40,"zone":"Z2"},{"kind":"hills","repeat":6,"workSec":20}]'),
  ('45'' Z2 + 8 cuestas 20"',         '[{"kind":"steady","workMin":45,"zone":"Z2"},{"kind":"hills","repeat":8,"workSec":20}]'),
  ('Descarga · 35'' Z1-Z2',           '[{"kind":"steady","workMin":35,"zone":"Z2","note":"Descarga, muy suave."}]'),
  ('10'' Z2 + 2×8'' Z4 (rec 3'') + 10'' Z2', '[{"kind":"steady","workMin":10,"zone":"Z2"},{"kind":"interval","repeat":2,"workMin":8,"zone":"Z4","recMin":3},{"kind":"steady","workMin":10,"zone":"Z2"}]'),
  ('45'' Z2 + 6 cuestas',             '[{"kind":"steady","workMin":45,"zone":"Z2"},{"kind":"hills","repeat":6,"workSec":20}]'),
  ('10'' Z2 + 3×8'' Z4 (rec 3'') + 10'' Z2', '[{"kind":"steady","workMin":10,"zone":"Z2"},{"kind":"interval","repeat":3,"workMin":8,"zone":"Z4","recMin":3},{"kind":"steady","workMin":10,"zone":"Z2"}]'),
  ('Descarga · 40'' Z2 + 4 strides',  '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Descarga."},{"kind":"strides","repeat":4,"workSec":20}]'),
  -- F2/F3 · rodajes planos
  ('40'' Z2',  '[{"kind":"steady","workMin":40,"zone":"Z2"}]'),
  ('55'' Z2',  '[{"kind":"steady","workMin":55,"zone":"Z2"}]'),
  ('60'' Z2',  '[{"kind":"steady","workMin":60,"zone":"Z2"}]'),
  ('65'' Z2',  '[{"kind":"steady","workMin":65,"zone":"Z2"}]'),
  ('70'' Z2',  '[{"kind":"steady","workMin":70,"zone":"Z2"}]'),
  ('75'' Z2',  '[{"kind":"steady","workMin":75,"zone":"Z2"}]'),
  ('80'' Z2',  '[{"kind":"steady","workMin":80,"zone":"Z2"}]'),
  ('85'' Z2',  '[{"kind":"steady","workMin":85,"zone":"Z2"}]'),
  ('90'' Z2',  '[{"kind":"steady","workMin":90,"zone":"Z2"}]'),
  ('95'' Z2',  '[{"kind":"steady","workMin":95,"zone":"Z2"}]'),
  ('50'' Z2',  '[{"kind":"steady","workMin":50,"zone":"Z2"}]'),
  ('90'' Z2, últimos 10'' progresivos',  '[{"kind":"steady","workMin":80,"zone":"Z2"},{"kind":"steady","workMin":10,"zone":"Z3","note":"Final progresivo."}]'),
  ('100'' Z2, últimos 15'' progresivos', '[{"kind":"steady","workMin":85,"zone":"Z2"},{"kind":"steady","workMin":15,"zone":"Z3","note":"Final progresivo."}]'),
  -- F3 · calidad
  ('3×8'' Z4 (rec 3'')',   '[{"kind":"interval","repeat":3,"workMin":8,"zone":"Z4","recMin":3}]'),
  ('20'' Z4 continuo',     '[{"kind":"steady","workMin":20,"zone":"Z4"}]'),
  ('Navidad · flexible: Z2 con strides',        '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Flexible: cumplirlo es éxito."},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('Reyes · flexible/descarga: Z2 con strides', '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Flexible/descarga."},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('4×8'' Z4 (rec 3'')',   '[{"kind":"interval","repeat":4,"workMin":8,"zone":"Z4","recMin":3}]'),
  ('25'' Z4 continuo',     '[{"kind":"steady","workMin":25,"zone":"Z4"}]'),
  ('3×10'' Z4 (rec 3'')',  '[{"kind":"interval","repeat":3,"workMin":10,"zone":"Z4","recMin":3}]'),
  ('Descarga + re-test LTHR 30''', '[{"kind":"test","workMin":30,"note":"Semana de descarga: llegas fresco."}]'),
  ('Flexible · Z2 suave si encaja', '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Flexible."}]'),
  ('60-75'' Z2 cuando encaje',      '[{"kind":"steady","workMin":70,"zone":"Z2","note":"60-75 minutos, cuando encaje."}]'),
  -- F4 · calidad
  ('5×5'' Z4 (rec 90")',    '[{"kind":"interval","repeat":5,"workMin":5,"zone":"Z4","recMin":1.5}]'),
  ('6×3'' Z5 (rec 2''30")', '[{"kind":"interval","repeat":6,"workMin":3,"zone":"Z5","recMin":2.5,"note":"Toque de VO2max."}]'),
  ('25'' tempo Z4',         '[{"kind":"steady","workMin":25,"zone":"Z4"}]'),
  ('Descarga · 40'' Z2 + strides',    '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Descarga."},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('4×10'' Z4 (rec 3'')',   '[{"kind":"interval","repeat":4,"workMin":10,"zone":"Z4","recMin":3}]'),
  ('2×15'' Z4 (rec 3'')',   '[{"kind":"interval","repeat":2,"workMin":15,"zone":"Z4","recMin":3}]'),
  ('10K test o carrera real', '[{"kind":"race","workKm":10,"note":"De aquí sale el ritmo objetivo de media: +15-20 s/km."}]'),
  ('Descarga · 45'' Z2 + 4 strides',  '[{"kind":"steady","workMin":45,"zone":"Z2","note":"Descarga."},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('3×3 km a RM (rec 3'')', '[{"kind":"interval","repeat":3,"workKm":3,"zone":"RM","recMin":3}]'),
  ('30'' tempo, últimos 10'' a RM',   '[{"kind":"steady","workMin":20,"zone":"Z4"},{"kind":"steady","workMin":10,"zone":"RM","note":"A ritmo de media."}]'),
  ('Taper · 2×10'' a RM',   '[{"kind":"interval","repeat":2,"workMin":10,"zone":"RM","recMin":3,"note":"Taper."}]'),
  ('20'' Z2 con 3×3'' a RM','[{"kind":"steady","workMin":20,"zone":"Z2"},{"kind":"interval","repeat":3,"workMin":3,"zone":"RM","recMin":2,"note":"Activación de la semana de carrera."}]'),
  -- F4 · Z2 con strides
  ('45'' Z2 + 6 strides 20"', '[{"kind":"steady","workMin":45,"zone":"Z2"},{"kind":"strides","repeat":6,"workSec":20}]'),
  ('50'' Z2 + 6 strides 20"', '[{"kind":"steady","workMin":50,"zone":"Z2"},{"kind":"strides","repeat":6,"workSec":20}]'),
  ('40'' Z2 + 4 strides 20"', '[{"kind":"steady","workMin":40,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('45'' Z2 + 4 strides 20"', '[{"kind":"steady","workMin":45,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('30'' Z2 + 4 strides 20"', '[{"kind":"steady","workMin":30,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
  -- F4 · tiradas
  ('12 km Z2',                        '[{"kind":"steady","workKm":12,"zone":"Z2"}]'),
  ('13 km Z2',                        '[{"kind":"steady","workKm":13,"zone":"Z2"}]'),
  ('13 km fáciles Z2',                '[{"kind":"steady","workKm":13,"zone":"Z2","note":"Fáciles."}]'),
  ('10 km Z2',                        '[{"kind":"steady","workKm":10,"zone":"Z2"}]'),
  ('14 km, últimos 3 km a RM',        '[{"kind":"steady","workKm":11,"zone":"Z2"},{"kind":"steady","workKm":3,"zone":"RM","note":"Al final."}]'),
  ('15 km, 4 km a RM intercalados',   '[{"kind":"steady","workKm":11,"zone":"Z2"},{"kind":"steady","workKm":4,"zone":"RM","note":"Intercalados."}]'),
  ('16 km, últimos 5 km a RM',        '[{"kind":"steady","workKm":11,"zone":"Z2"},{"kind":"steady","workKm":5,"zone":"RM","note":"Al final."}]'),
  ('18 km, 6 km a RM al final',       '[{"kind":"steady","workKm":12,"zone":"Z2"},{"kind":"steady","workKm":6,"zone":"RM","note":"Al final."}]'),
  ('19-20 km Z2 — pico',              '[{"kind":"steady","workKm":20,"zone":"Z2","note":"Pico: la tirada más larga del plan."}]'),
  ('MEDIA MARATÓN',                   '[{"kind":"race","workKm":21.1,"zone":"RM","note":"Primeros 5 km ligeramente por debajo de RM."}]'),
  -- F4 · Z1 opcional
  ('Z1 30-40'' opcional', '[{"kind":"steady","workMin":35,"zone":"Z1","note":"Opcional."}]'),
  ('Z1 30'' muy suave',   '[{"kind":"steady","workMin":30,"zone":"Z1"}]'),
  ('Descanso',            '[{"kind":"rest"}]')
) as m(prescription, structure)
where rs.prescription = m.prescription
  and rs.structure is null;

-- ── idempotent engine events ───────────────────────────────────

alter table public.engine_events add column dedup_key text;

create unique index engine_events_dedup_key
  on public.engine_events (dedup_key)
  where dedup_key is not null;

comment on column public.engine_events.dedup_key is
  'Natural key ({session_id}:fail:{pos}:{idx}, {session_id}:clean, …) so the '
  'offline sync can replay the engine any number of times without double-applying.';

-- ── clone_program: carry the new columns ───────────────────────

create or replace function public.clone_program(
  p_source_id uuid,
  p_starts_on date default null,
  p_name text default null,
  p_activate boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_src public.programs;
  v_new_id uuid;
  v_starts date;
  v_phase record;
  v_new_phase_id uuid;
  v_slot record;
  v_offset_weeks integer := 0;
  v_slot_map jsonb := '{}'::jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select * into v_src from public.programs
  where id = p_source_id and (is_template or user_id = v_user);

  if v_src.id is null then
    raise exception 'program % not readable', p_source_id;
  end if;

  v_starts := coalesce(p_starts_on, v_src.starts_on, current_date);

  if p_activate then
    update public.programs set is_active = false
    where user_id = v_user and is_active;
  end if;

  insert into public.programs (
    user_id, is_template, slug, name, goal, summary,
    starts_on, ends_on, race_on, race_name,
    wave, cycle_weeks, is_active, source
  )
  values (
    v_user, false, null,
    coalesce(p_name, v_src.name), v_src.goal, v_src.summary,
    v_starts,
    case when v_src.ends_on is null or v_src.starts_on is null then null
         else v_starts + (v_src.ends_on - v_src.starts_on) end,
    case when v_src.race_on is null or v_src.starts_on is null then null
         else v_starts + (v_src.race_on - v_src.starts_on) end,
    v_src.race_name,
    v_src.wave, v_src.cycle_weeks, p_activate,
    case when v_src.is_template then 'template' else 'manual' end
  )
  returning id into v_new_id;

  for v_phase in
    select * from public.program_phases
    where program_id = p_source_id
    order by position
  loop
    insert into public.program_phases (
      program_id, key, name, emphasis, position, weeks, starts_on, notes,
      wave, cycle_weeks, progression_mode, pct_of_rm
    )
    values (
      v_new_id, v_phase.key, v_phase.name, v_phase.emphasis,
      v_phase.position, v_phase.weeks,
      v_starts + (v_offset_weeks * 7),
      v_phase.notes,
      v_phase.wave, v_phase.cycle_weeks,
      v_phase.progression_mode, v_phase.pct_of_rm
    )
    returning id into v_new_phase_id;

    v_offset_weeks := v_offset_weeks + v_phase.weeks;

    -- slots first: days and exercises point at them
    for v_slot in
      select * from public.program_slots
      where phase_id = v_phase.id
      order by position
    loop
      declare
        v_new_slot_id uuid;
      begin
        insert into public.program_slots (
          phase_id, key, session_type, label, title, subtitle, position
        )
        values (
          v_new_phase_id, v_slot.key, v_slot.session_type,
          v_slot.label, v_slot.title, v_slot.subtitle, v_slot.position
        )
        returning id into v_new_slot_id;

        v_slot_map := v_slot_map || jsonb_build_object(v_slot.id::text, v_new_slot_id::text);

        insert into public.program_exercises (
          slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max,
          rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes,
          effort, superset_group, equipment
        )
        select
          v_new_slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max,
          rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes,
          effort, superset_group, equipment
        from public.program_exercises
        where slot_id = v_slot.id;
      end;
    end loop;

    insert into public.program_days (phase_id, day_index, slot_id)
    select
      v_new_phase_id,
      d.day_index,
      (v_slot_map ->> d.slot_id::text)::uuid
    from public.program_days d
    where d.phase_id = v_phase.id
      and v_slot_map ? d.slot_id::text;

    insert into public.program_run_sessions (
      phase_id, slot_id, week, prescription, target_minutes, notes, structure
    )
    select
      v_new_phase_id,
      (v_slot_map ->> r.slot_id::text)::uuid,
      r.week, r.prescription, r.target_minutes, r.notes, r.structure
    from public.program_run_sessions r
    where r.phase_id = v_phase.id
      and v_slot_map ? r.slot_id::text;
  end loop;

  insert into public.program_lift_defaults (
    program_id, lift_key, name, kind, exercise_slug, default_e1rm_kg, position
  )
  select v_new_id, lift_key, name, kind, exercise_slug, default_e1rm_kg, position
  from public.program_lift_defaults
  where program_id = p_source_id;

  -- Tracked lifts: create the ones this athlete does not have yet.
  insert into public.lifts (user_id, key, name, kind, exercise_id, e1rm_kg)
  select
    v_user, d.lift_key, d.name, d.kind,
    (select e.id from public.exercises e
      where e.slug = d.exercise_slug and e.owner_id is null limit 1),
    d.default_e1rm_kg
  from public.program_lift_defaults d
  where d.program_id = v_new_id
  on conflict (user_id, key) do nothing;

  insert into public.engine_events (user_id, program_id, kind, title, detail, payload)
  values (
    v_user, v_new_id, 'program_created',
    format('Programa creado · %s', coalesce(p_name, v_src.name)),
    format('Clonado desde %s. Arranca el %s.', v_src.name, to_char(v_starts, 'DD/MM/YYYY')),
    jsonb_build_object('source_program_id', p_source_id)
  );

  return v_new_id;
end;
$$;

-- ── shift the whole season N days ──────────────────────────────
-- The explicit rule this encodes: the calendar rules — missed days
-- are lost, and moving the plan is a bulk shift, not a re-queue.
-- Logged sessions keep their real dates: history stays true.

create or replace function public.shift_program(
  p_program_id uuid,
  p_days integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select user_id into v_owner from public.programs where id = p_program_id;
  if v_owner is null or v_owner <> v_user then
    raise exception 'program % not owned', p_program_id;
  end if;

  if p_days is null or p_days = 0 or abs(p_days) > 90 then
    raise exception 'shift of % days out of range', p_days;
  end if;

  update public.programs
  set starts_on = starts_on + p_days,
      ends_on = case when ends_on is null then null else ends_on + p_days end
  where id = p_program_id;

  update public.program_phases
  set starts_on = starts_on + p_days
  where program_id = p_program_id and starts_on is not null;

  insert into public.engine_events (user_id, program_id, kind, title, detail, payload)
  values (
    v_user, p_program_id, 'plan_shifted',
    case when p_days > 0
      then format('Plan desplazado %s días', p_days)
      else format('Plan adelantado %s días', abs(p_days)) end,
    'Todas las fases se mueven en bloque. Las sesiones ya registradas conservan su fecha; '
    'la carrera objetivo no se mueve.',
    jsonb_build_object('days', p_days)
  );
end;
$$;

revoke all on function public.shift_program(uuid, integer) from public;
grant execute on function public.shift_program(uuid, integer) to authenticated;
