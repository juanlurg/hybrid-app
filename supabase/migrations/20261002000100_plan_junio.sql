-- ═══════════════════════════════════════════════════════════════
-- The master plan moves to a June half: F0-bis 28 sep – 25 oct,
-- F2 26 oct – 17 ene (Navidad in its weeks 9-10), F3 18 ene –
-- 14 mar, F4 15 mar – 6 jun, race the weekend of 5-6 jun 2027.
-- Per docs/PROGRAMA-juanlu.md, FUERZA-juanlu.md, CARRERA-juanlu.md:
--
--  · loaded hip abduction and the eccentric step-down in every
--    phase, bent-knee soleus beside the straight-knee calf raise,
--    lateral raises in F2 B/C and F3 B, an arm triserie in F2 C;
--  · F2's wave drops the basic to 4×5 at 80 % and 4×3-4 at 85 % —
--    program_phases.wave_reps carries the per-step rep range so a
--    4-rep set at 85 % is not a range failure;
--  · F2 runs: the first tempo moves to week 7, weeks 9-10 are the
--    flexible Christmas weeks; F3 loses its Christmas weeks;
--  · copy: ~2 months off, no August heat, Semana Santa, May heat.
--
-- In place over the template AND its clones, following the
-- precedent of 20260814000100_f0bis_readaptacion. Only the template
-- is re-dated: a clone keeps the dates its athlete set (Ajustes →
-- desplazar), and its race day follows its own F4. F0-bis is the
-- phase being trained, so its rows keep their ids and positions
-- (closed sessions keep resolving their logs): the soleus replaces
-- the calf raise as a new row, and new rows go after the old ones.
-- Idempotent: a second run finds no phase named 'Readaptación
-- extendida' and does nothing.
-- ═══════════════════════════════════════════════════════════════

-- ── per-step rep range for the basic ───────────────────────────

alter table public.program_phases
  add column wave_reps jsonb
    check (wave_reps is null or jsonb_typeof(wave_reps) = 'array');

comment on column public.program_phases.wave_reps is
  'The basic''s rep range per wave step, parallel to the wave: '
  '[[min, max] | null, …]. null keeps the exercise''s own range.';

-- ── catalogue: what the new plan names ─────────────────────────

insert into public.exercises
  (slug, name, modality, pattern, is_unilateral, default_rest_seconds, cues, equipment)
values
  ('abduccion-cadera',     'Abducción de cadera con carga', 'fixed',      'hip',   true,  60, 'Polea baja con tobillera, máquina o tumbado con tobillera o banda pesada. Pelvis quieta.', 'pulley'),
  ('step-down-excentrico', 'Step-down excéntrico',          'bodyweight', 'squat', true,  60, 'Cajón bajo, 3″ de bajada, rodilla alineada con el pie.',                               'bodyweight'),
  ('soleo-sentado',        'Sóleo rodilla flexionada',      'fixed',      'calf',  false, 60, 'Sentado, barra o mancuernas sobre las rodillas, o en máquina.',                        'dumbbell'),
  ('curl-martillo',        'Curl martillo',                 'fixed',      'arm',   false, 60, 'Codos quietos, sin balanceo.',                                                         'dumbbell'),
  ('extension-triceps',    'Extensión de tríceps',          'fixed',      'arm',   false, 60, 'Por encima de la cabeza, con polea o mancuerna.',                                      'pulley')
on conflict (slug) where owner_id is null do nothing;

-- ── clone_program: carry wave_reps ─────────────────────────────
-- Full body from 20260821000100, with wave_reps added to the phase copy.

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
      wave, cycle_weeks, progression_mode, pct_of_rm, priority, wave_reps
    )
    values (
      v_new_id, v_phase.key, v_phase.name, v_phase.emphasis,
      v_phase.position, v_phase.weeks,
      v_starts + (v_offset_weeks * 7),
      v_phase.notes,
      v_phase.wave, v_phase.cycle_weeks,
      v_phase.progression_mode, v_phase.pct_of_rm, v_phase.priority,
      v_phase.wave_reps
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

-- ── the plan, in place over the template and its clones ────────

do $mig$
declare
  r record;
  v_fb_start date;
begin

for r in
  select p.id as program_id, p.is_template
  from public.programs p
  where exists (
    select 1 from public.program_phases ph
    where ph.program_id = p.id
      and ph.key = 'F0-bis' and ph.name = 'Readaptación extendida'
  )
loop

  -- ── dates: the template moves; every race day follows its F4 ──

  if r.is_template then
    select starts_on into v_fb_start from public.program_phases
    where program_id = r.program_id and key = 'F0-bis';
    update public.program_phases
    set starts_on = starts_on + (date '2026-09-28' - v_fb_start)
    where program_id = r.program_id;
    update public.programs set starts_on = date '2026-09-28'
    where id = r.program_id;
  end if;

  update public.programs pr set
    goal = 'Media maratón de asfalto a principios de junio, sin renunciar al físico.',
    summary = 'Dieciséis semanas donde manda la fuerza y veinte donde manda '
              'progresivamente la carrera. Nunca las dos a tope a la vez.',
    race_on = ph.starts_on + ((ph.weeks - 1) * 7 + 5),
    ends_on = ph.starts_on + (ph.weeks * 7 - 1)
  from public.program_phases ph
  where pr.id = r.program_id
    and ph.program_id = pr.id and ph.key = 'F4';

  -- ── phases ───────────────────────────────────────────────────

  update public.program_phases set
    name = 'Readaptación',
    emphasis = 'Reconstruir tras ~2 meses sin entrenar + base aeróbica mínima',
    notes = 'Cero fallo. La carga sube sola cada semana del 60-65 al 75-80 % de junio; '
            'forzarlo solo añade agujetas y riesgo. Si la semana 1 deja agujetas fuertes, '
            'repite sus cargas en la 2. Nada de series ni strides hasta la semana 4.'
  where program_id = r.program_id and key = 'F0-bis';

  update public.program_phases set
    notes = 'Tres ciclos completos de progresión. Test de LTHR en la semana 4, nunca en la 1. '
            'Navidad cae en las semanas 9-10: si aprieta, el mínimo es Fuerza A + Fuerza B '
            'con los pesos de la última semana completa.',
    wave_reps = '[null, [5, 5], [3, 4], null]'::jsonb
  where program_id = r.program_id and key = 'F2';

  update public.program_phases set
    notes = 'Sin fiestas por medio: las ocho semanas son de trabajo real. '
            'Semanas 4 y 8 de descarga: 2 series por ejercicio, mismos pesos.'
  where program_id = r.program_id and key = 'F3';

  update public.program_phases set
    notes = 'La fuerza aquí es un seguro: protege masa, economía y estructuras. Nada más. '
            'Desde la semana 7 aprieta el calor: todo a primera hora, y en Z2 manda la FC, no el ritmo.'
  where program_id = r.program_id and key = 'F4';

  -- ── strength: rows that change identity ──────────────────────

  -- F0-bis A is being trained: the soleus comes in as a new row, so the
  -- calf raise already logged this week stays a calf raise in its resumen.
  delete from public.program_exercises e
  using public.program_slots sl, public.program_phases ph
  where e.slot_id = sl.id and sl.phase_id = ph.id
    and ph.program_id = r.program_id and ph.key = 'F0-bis'
    and sl.key = 'A' and e.name = 'Calf raise';

  -- F3 B has no history: its calf raise simply becomes the soleus.
  update public.program_exercises e set
    name = 'Sóleo rodilla flexionada',
    exercise_id = (select x.id from public.exercises x
                   where x.slug = 'soleo-sentado' and x.owner_id is null),
    load_mode = 'fixed',
    equipment = 'dumbbell',
    fixed_weight_kg = 20
  from public.program_slots sl, public.program_phases ph
  where e.slot_id = sl.id and sl.phase_id = ph.id
    and ph.program_id = r.program_id and ph.key = 'F3'
    and sl.key = 'B' and e.name = 'Calf raise';

  -- ── strength: existing rows move, regroup or get a new cue ───
  -- null = keep. F0-bis rows are not touched.

  update public.program_exercises e set
    position = coalesce(v.position, e.position),
    sets = coalesce(v.sets, e.sets),
    superset_group = coalesce(v.sg, e.superset_group),
    notes = coalesce(v.notes, e.notes)
  from (values
    ('F2', 'A', 'Sentadilla',                         null::integer, null::integer, null::smallint, 'Frontal o trasera. Cuñas bajo el talón si la dorsiflexión limita.'),
    ('F2', 'A', 'Copenhagen plank',                   6,    null, 1,    'Segundos por lado. Superserie con el anterior, sin descanso entre los dos.'),
    ('F2', 'A', 'Calf raise',                         7,    2,    2,    'Rodilla estirada. Superserie con el siguiente, sin descanso entre los dos.'),
    ('F2', 'B', 'Face pull',                          null, null, 2,    'Codos altos, sin encogerse. Superserie con el siguiente, sin descanso entre los dos.'),
    ('F2', 'B', 'Curl bíceps',                        7,    null, null, null),
    ('F2', 'B', 'Tríceps en polea',                   8,    null, null, null),
    ('F2', 'C', 'Jalón al pecho o dominadas supinas', 4,    null, null, null),
    ('F2', 'C', 'Fondos o press banca ligero',        5,    null, null, null),
    ('F2', 'C', 'Single-leg RDL',                     6,    null, null, null),
    ('F2', 'C', 'Tibialis raise',                     10,   null, 2,    'Superserie con el siguiente, sin descanso entre los dos.'),
    ('F2', 'C', 'Pallof press',                       11,   null, 2,    'Por lado. Superserie con el anterior, sin descanso entre los dos.'),
    ('F3', 'A', 'Curl bíceps',                        6,    null, null, null),
    ('F3', 'A', 'Tríceps en polea',                   7,    null, null, null),
    ('F3', 'B', 'Tibialis raise',                     7,    null, null, null),
    ('F3', 'B', 'Sóleo rodilla flexionada',           8,    null, null, 'Sentado, mancuernas sobre las rodillas. Superserie con el anterior, sin descanso entre los dos.'),
    ('F4', 'B', 'RDL',                                null, null, null, 'Mantener carga, sin progresar. Semanas 9-10: si pesa en las piernas, swing con KB 3×15 + hip thrust.'),
    ('F4', 'B', 'Sóleo excéntrico',                   5,    null, null, null)
  ) as v(phase_key, slot_key, name, position, sets, sg, notes)
  join public.program_phases ph on ph.program_id = r.program_id and ph.key = v.phase_key
  join public.program_slots sl on sl.phase_id = ph.id and sl.key = v.slot_key
  where e.slot_id = sl.id and e.name = v.name;

  -- ── strength: new rows ───────────────────────────────────────

  insert into public.program_exercises
    (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds,
     is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
  select sl.id, x.position, e.id, x.name, '', x.sets, x.rep_min, x.rep_max, 60,
         false, x.mode::public.load_mode, null, x.fixed, x.notes,
         'reps', x.sg, x.eq::public.equipment_kind
  from (values
    ('F0-bis', 'A', 7,  'soleo-sentado',         'Sóleo rodilla flexionada',      2, 15, 15, 'fixed',      16::numeric, 'Sentado, mancuernas sobre las rodillas. Superserie con el anterior, sin descanso entre los dos.', 1::smallint, 'dumbbell'),
    ('F0-bis', 'A', 8,  'abduccion-cadera',      'Abducción de cadera con carga', 2, 12, 12, 'fixed',      5,    'Por pierna, polea baja con tobillera.',                                               null, 'pulley'),
    ('F0-bis', 'B', 6,  'step-down-excentrico',  'Step-down excéntrico',          2, 8,  8,  'bodyweight', null, 'Por pierna. Cajón bajo, 3″ de bajada, rodilla alineada con el pie.',                  null, 'bodyweight'),
    ('F2',     'A', 5,  'abduccion-cadera',      'Abducción de cadera con carga', 3, 10, 12, 'fixed',      5,    'Por pierna, polea baja con tobillera. Superserie con el siguiente, sin descanso entre los dos.', 1, 'pulley'),
    ('F2',     'A', 8,  'soleo-sentado',         'Sóleo rodilla flexionada',      2, 15, 20, 'fixed',      20,   'Sentado, mancuernas sobre las rodillas. Superserie con el anterior, sin descanso entre los dos.', 2, 'dumbbell'),
    ('F2',     'B', 6,  'elevaciones-laterales', 'Elevaciones laterales',         3, 12, 15, 'fixed',      8,    'Deltoides lateral: el ancho de hombros. Superserie con el anterior, sin descanso entre los dos.', 2, 'dumbbell'),
    ('F2',     'C', 3,  'step-down-excentrico',  'Step-down excéntrico',          2, 8,  8,  'bodyweight', null, 'Por pierna. Cajón bajo, 3″ de bajada, rodilla alineada con el pie.',                  null, 'bodyweight'),
    ('F2',     'C', 7,  'elevaciones-laterales', 'Elevaciones laterales',         2, 12, 15, 'fixed',      8,    'Triserie con los dos siguientes, sin descanso entre los tres.',                      1, 'dumbbell'),
    ('F2',     'C', 8,  'curl-martillo',         'Curl martillo',                 2, 10, 12, 'fixed',      12,   'Triserie con el anterior y el siguiente, sin descanso entre los tres.',              1, 'dumbbell'),
    ('F2',     'C', 9,  'extension-triceps',     'Extensión de tríceps',          2, 10, 12, 'fixed',      15,   'Triserie con los dos anteriores, sin descanso entre los tres.',                      1, 'pulley'),
    ('F3',     'A', 5,  'abduccion-cadera',      'Abducción de cadera con carga', 2, 12, 12, 'fixed',      5,    'Por pierna, polea baja con tobillera.',                                               null, 'pulley'),
    ('F3',     'B', 5,  'step-down-excentrico',  'Step-down excéntrico',          2, 8,  8,  'bodyweight', null, 'Por pierna. Cajón bajo, 3″ de bajada, rodilla alineada con el pie.',                  null, 'bodyweight'),
    ('F3',     'B', 6,  'elevaciones-laterales', 'Elevaciones laterales',         2, 12, 15, 'fixed',      8,    '',                                                                                    null, 'dumbbell'),
    ('F4',     'A', 5,  'abduccion-cadera',      'Abducción de cadera con carga', 2, 12, 12, 'fixed',      5,    'Por pierna, polea baja con tobillera. Se queda también en el taper.',                 null, 'pulley'),
    ('F4',     'B', 4,  'step-down-excentrico',  'Step-down excéntrico',          2, 8,  8,  'bodyweight', null, 'Por pierna. Cajón bajo, 3″ de bajada, rodilla alineada con el pie.',                  null, 'bodyweight')
  ) as x(phase_key, slot_key, position, slug, name, sets, rep_min, rep_max, mode, fixed, notes, sg, eq)
  join public.program_phases ph on ph.program_id = r.program_id and ph.key = x.phase_key
  join public.program_slots sl on sl.phase_id = ph.id and sl.key = x.slot_key
  left join public.exercises e on e.slug = x.slug and e.owner_id is null;

  -- ── running ──────────────────────────────────────────────────

  update public.program_slots sl
  set subtitle = 'Z2 por sensación · sin mirar el pulso'
  from public.program_phases ph
  where sl.phase_id = ph.id and ph.program_id = r.program_id
    and ph.key = 'F0-bis' and sl.key = 'run'
    and sl.subtitle = 'Z2 por sensación · madruga, hace calor';

  -- Sessions the new plan rewrites.
  update public.program_run_sessions rs set
    prescription = v.prescription,
    target_minutes = v.minutes,
    notes = v.notes,
    structure = v.structure::jsonb
  from (values
    ('F2', 'run',   7, '10'' Z2 + 2×8'' Z4 (rec 3'') + 10'' Z2', 42, 'Primer tempo del bloque.',
     '[{"kind":"steady","workMin":10,"zone":"Z2"},{"kind":"interval","repeat":2,"workMin":8,"zone":"Z4","recMin":3},{"kind":"steady","workMin":10,"zone":"Z2"}]'),
    ('F2', 'run',   9, 'Flexible · 45'' Z2 + 6 strides',          51, 'Navidad: el mínimo son 2 salidas Z2, una de 60′ o más.',
     '[{"kind":"steady","workMin":45,"zone":"Z2","note":"Flexible."},{"kind":"strides","repeat":6,"workSec":20}]'),
    ('F2', 'run',  10, 'Flexible · 45'' Z2 + 6 cuestas',          55, 'Año Nuevo: el mínimo son 2 salidas Z2, una de 60′ o más.',
     '[{"kind":"steady","workMin":45,"zone":"Z2","note":"Flexible."},{"kind":"hills","repeat":6,"workSec":20}]'),
    ('F2', 'long',  9, '80'' Z2 cuando encaje',                   80, '',
     '[{"kind":"steady","workMin":80,"zone":"Z2","note":"Cuando encaje."}]'),
    ('F2', 'long', 10, '85'' Z2 cuando encaje',                   85, '',
     '[{"kind":"steady","workMin":85,"zone":"Z2","note":"Cuando encaje."}]'),
    ('F3', 'run',   3, '4×7'' Z4 (rec 2'')',                      48, '',
     '[{"kind":"interval","repeat":4,"workMin":7,"zone":"Z4","recMin":2}]'),
    ('F3', 'run',   4, 'Descarga · 40'' Z2 + 6 strides',          46, '',
     '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Descarga."},{"kind":"strides","repeat":6,"workSec":20}]'),
    ('F3', 'easy',  3, '45'' Z2',                                 45, '',
     '[{"kind":"steady","workMin":45,"zone":"Z2"}]'),
    ('F3', 'easy',  4, '35'' Z2',                                 35, '',
     '[{"kind":"steady","workMin":35,"zone":"Z2"}]'),
    ('F3', 'long',  3, '85'' Z2',                                 85, '',
     '[{"kind":"steady","workMin":85,"zone":"Z2"}]')
  ) as v(phase_key, slot_key, week, prescription, minutes, notes, structure)
  join public.program_phases ph on ph.program_id = r.program_id and ph.key = v.phase_key
  join public.program_slots sl on sl.phase_id = ph.id and sl.key = v.slot_key
  where rs.phase_id = ph.id and rs.slot_id = sl.id and rs.week = v.week;

  -- Sessions that only gain a note.
  update public.program_run_sessions rs set notes = v.notes
  from (values
    ('F0-bis', 'run',   1, 'La FC está inflada por el desentrenamiento y no significa nada todavía: guíate por la conversación.'),
    ('F4',     'run',   2, 'Toque de VO2max. Semana Santa: si hay viaje, la calidad pasa a miércoles o jueves; la larga no se toca.'),
    ('F4',     'long',  7, 'Empieza el calor: sal a primera hora, con agua y sodio.'),
    ('F4',     'long',  9, 'Ensaya la mañana de carrera, gel y zapatillas.'),
    ('F4',     'long', 12, 'Salida al amanecer. Primeros 5 km ligeramente por debajo de RM. Negativo si puedes.')
  ) as v(phase_key, slot_key, week, notes)
  join public.program_phases ph on ph.program_id = r.program_id and ph.key = v.phase_key
  join public.program_slots sl on sl.phase_id = ph.id and sl.key = v.slot_key
  where rs.phase_id = ph.id and rs.slot_id = sl.id and rs.week = v.week;

end loop;

end
$mig$;
