-- ═══════════════════════════════════════════════════════════════
-- The Camino fell through: F0 "Puente verano" + F1 "Camino
-- Primitivo" become one 4-week phase F0-bis "Readaptación
-- extendida" (17 ago – 13 sep). Progressive barbell ramp
-- (60-65 % → 75-80 % of the June RMs) and 2→3 Z2 runs/week by
-- feel, per docs/PROGRAMA-juanlu.md.
--
-- In place over the template AND its clones, following the
-- precedent of 20260730001000_structured_plan:
--   · template: F0 is deleted outright and the season now starts
--     on F0-bis — fresh clones get the new plan only.
--   · clones: F0 is truncated to its 3 lived weeks so logged
--     history keeps resolving; F0-bis replaces the Camino weeks.
-- The F1 row itself is converted (not dropped + reinserted) so
-- nothing that points at the phase id goes stale. Idempotent: a
-- second run finds no phase named 'Camino Primitivo' and does
-- nothing.
--
-- The ramp is encoded as a 5-step wave over a 5-week cycle on a
-- 4-week phase: the engine marks the last week of a cycle as the
-- deload and halves its sets, and F0-bis week 4 is the heaviest
-- week, not a deload — parking the deload on a week 5 that never
-- happens keeps weeks 1-4 at full sets.
-- ═══════════════════════════════════════════════════════════════

do $mig$
declare
  r record;
  v_f0 uuid;
  v_fb uuid;
  v_f2 uuid;
  v_fb_start date;
  s uuid;
begin

for r in
  select p.id as program_id, p.is_template
  from public.programs p
  where exists (
    select 1 from public.program_phases ph
    where ph.program_id = p.id
      and ph.key = 'F1' and ph.name = 'Camino Primitivo'
  )
loop
  select id into v_f0 from public.program_phases
  where program_id = r.program_id and key = 'F0' and name = 'Puente verano';
  select id, starts_on - 7 into v_fb, v_fb_start from public.program_phases
  where program_id = r.program_id and key = 'F1' and name = 'Camino Primitivo';

  if r.is_template then
    -- Fresh clones start on the new plan: no vestigial F0.
    delete from public.program_phases where id = v_f0;
    update public.programs set starts_on = v_fb_start where id = r.program_id;
    update public.program_phases set position = position + 100
    where program_id = r.program_id;
    update public.program_phases set position = position - 101
    where program_id = r.program_id;
  elsif v_f0 is not null then
    -- Live clone: weeks 1-3 were trained under F0 — keep them.
    update public.program_phases
    set weeks = 3,
        notes = notes || ' Recortada a 3 semanas: el Camino se cayó.'
    where id = v_f0 and weeks = 4;
    delete from public.program_run_sessions where phase_id = v_f0 and week > 3;
  end if;

  -- ── F1 'Camino Primitivo' → F0-bis 'Readaptación extendida' ──

  update public.program_phases set
    key = 'F0-bis',
    name = 'Readaptación extendida',
    emphasis = 'Reconstruir tras ~1.5 meses flojo + base aeróbica mínima',
    weeks = 4,
    starts_on = v_fb_start,
    notes = 'Cero fallo. La ola semanal sube sola del 60-65 al 75-80 % de junio; '
            'forzarlo solo añade agujetas y riesgo. Nada de series ni strides hasta la semana 4.',
    wave = array[0.625, 0.675, 0.725, 0.775, 0.775]::numeric(4, 3)[],
    cycle_weeks = 5,
    progression_mode = 'wave',
    pct_of_rm = null
  where id = v_fb;

  -- Camino content out; slots cascade their days and run sessions.
  delete from public.program_slots where phase_id = v_fb;

  -- ── strength ──────────────────────────────────────────────────

  insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
  values (v_fb, 'A', 'strength', 'FUERZA A', 'Fuerza A', 'Corta · empuje y sentadilla', 1)
  returning id into s;

  insert into public.program_exercises
    (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds,
     is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
  select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest,
         x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes,
         'reps', x.superset, x.equipment::public.equipment_kind
  from (values
    (1, 'sentadilla',     'Sentadilla goblet o frontal', 'BÁSICO', 3, 5,  5,  150, true,  'engine',     'sentadilla', null::numeric, 'Semana 1 casi ridículamente fácil a propósito: la memoria muscular lo devuelve sola.', null::smallint, 'barbell'),
    (2, 'press-banca',    'Press banca',                 '',       3, 5,  5,  150, false, 'engine',     'banca',      null,          '',                                                 null, 'barbell'),
    (3, 'remo-barra',     'Remo con barra o polea',      '',       3, 8,  8,  120, false, 'fixed',      null,         55,            '',                                                 null, 'barbell'),
    (4, 'hip-thrust',     'Hip thrust',                  '',       2, 8,  8,  120, false, 'engine',     'hipthrust',  null,          'Pausa arriba.',                                    null, 'barbell'),
    (5, 'tibialis-raise', 'Tibialis raise',              '',       2, 15, 15,  60, false, 'bodyweight', null,         null,          'Superserie con el siguiente, sin descanso entre los dos.', 1, 'bodyweight'),
    (6, 'calf-raise',     'Calf raise',                  '',       2, 15, 15,  60, false, 'bodyweight', null,         null,          'Superserie con el anterior, sin descanso entre los dos.',  1, 'bodyweight')
  ) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, superset, equipment)
  left join public.exercises e on e.slug = x.slug and e.owner_id is null;

  insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
  values (v_fb, 'B', 'strength', 'FUERZA B', 'Fuerza B', 'Corta · bisagra y empuje vertical', 2)
  returning id into s;

  insert into public.program_exercises
    (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds,
     is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
  select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest,
         x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes,
         'reps', null, x.equipment::public.equipment_kind
  from (values
    (1, 'rdl',           'RDL',            'BÁSICO', 3, 5, 5, 150, true,  'engine',     'rdl',     null::numeric, '',                    'barbell'),
    (2, 'press-militar', 'Press militar',  '',       3, 5, 5, 150, false, 'engine',     'militar', null,          '',                    'barbell'),
    (3, 'dominadas',     'Dominadas',      '',       3, 6, 8, 120, false, 'bodyweight', null,      null,          '',                    'bodyweight'),
    (4, 'split-bulgaro', 'Split búlgaro',  '',       2, 8, 8, 120, false, 'fixed',      null,      16,            'Ligero, por pierna.', 'dumbbell'),
    (5, 'farmer-carry',  'Farmer carry',   '',       2, 1, 1,  90, false, 'fixed',      null,      24,            '30-40 m por serie.',  'dumbbell')
  ) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, equipment)
  left join public.exercises e on e.slug = x.slug and e.owner_id is null;

  -- ── running: 2→3 salidas Z2 por sensación ─────────────────────

  insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
    (v_fb, 'run',  'run_easy', 'CARRERA',   'Carrera',          'Z2 por sensación · madruga, hace calor', 3),
    (v_fb, 'run2', 'run_easy', 'CARRERA',   'Carrera',          'Z2 por sensación · la más larga de la semana', 4),
    (v_fb, 'run3', 'run_easy', 'CARRERA',   'Carrera opcional', 'La 3ª salida · se cae sin culpa', 5),
    (v_fb, 'mov',  'mobility', 'MOVILIDAD', 'Descanso',         'Movilidad y correctivos 20′', 6),
    (v_fb, 'off',  'rest',     'DESCANSO',  'Descanso',         'Libre', 7);

  insert into public.program_days (phase_id, day_index, slot_id)
  select v_fb, d.day_index, sl.id
  from (values (0,'A'), (1,'run'), (2,'mov'), (3,'B'), (4,'off'), (5,'run2'), (6,'run3'))
       as d(day_index, key)
  join public.program_slots sl on sl.phase_id = v_fb and sl.key = d.key;

  insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes, structure)
  select v_fb, sl.id, x.week, x.prescription, x.minutes, x.notes, x.structure::jsonb
  from (values
    ('run',  1, '35'' Z2 por sensación',      35, 'Con el calor la FC está inflada y no significa nada: madruga y guíate por la conversación.',
     '[{"kind":"steady","workMin":35,"zone":"Z2","note":"Por sensación."}]'),
    ('run',  2, '40'' Z2 por sensación',      40, '',
     '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Por sensación."}]'),
    ('run',  3, '40'' Z2 por sensación',      40, '',
     '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Por sensación."}]'),
    ('run',  4, '45'' Z2 + 4 strides 20"',    51, 'Primeros strides desde el parón — solo si no hay molestias.',
     '[{"kind":"steady","workMin":45,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
    ('run2', 1, '40'' Z2 por sensación',      40, '',
     '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Por sensación."}]'),
    ('run2', 2, '40'' Z2 por sensación',      40, '',
     '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Por sensación."}]'),
    ('run2', 3, '50'' Z2 por sensación',      50, '',
     '[{"kind":"steady","workMin":50,"zone":"Z2","note":"Por sensación."}]'),
    ('run2', 4, '60'' Z2 por sensación',      60, 'Objetivo cumplido: entras en F2 con 3 carreras/semana y ~2 h de volumen.',
     '[{"kind":"steady","workMin":60,"zone":"Z2","note":"Por sensación."}]'),
    ('run3', 1, 'Descanso',                    0, '',
     '[{"kind":"rest"}]'),
    ('run3', 2, '30'' Z2 opcional',           30, 'La 3ª salida entra esta semana; si la semana aprieta, se cae sin culpa.',
     '[{"kind":"steady","workMin":30,"zone":"Z2","note":"Opcional."}]'),
    ('run3', 3, '40'' Z2 por sensación',      40, '',
     '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Por sensación."}]'),
    ('run3', 4, '40'' Z2 por sensación',      40, '',
     '[{"kind":"steady","workMin":40,"zone":"Z2","note":"Por sensación."}]')
  ) as x(key, week, prescription, minutes, notes, structure)
  join public.program_slots sl on sl.phase_id = v_fb and sl.key = x.key;

  -- ── F2: week 1 runs on provisional zones, Sunday builds base ──

  select id into v_f2 from public.program_phases
  where program_id = r.program_id and key = 'F2';

  update public.program_run_sessions set
    prescription = '35'' Z2 · zonas provisionales',
    notes = 'Zonas de la LTHR antigua — ahora sí hay continuidad — o por sensación.',
    structure = '[{"kind":"steady","workMin":35,"zone":"Z2","note":"Zonas provisionales de la LTHR antigua o por sensación."}]'::jsonb
  where phase_id = v_f2 and week = 1
    and prescription = '35'' Z2 por sensación';

  update public.program_slots
  set subtitle = 'Z1 30-40′ o caminata · construye la base'
  where phase_id = v_f2 and session_type = 'rest'
    and subtitle = 'Opcional: Z1 30-40′ muy suave';

end loop;

end
$mig$;
