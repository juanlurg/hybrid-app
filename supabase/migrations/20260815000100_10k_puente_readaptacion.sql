-- ═══════════════════════════════════════════════════════════════
-- The Camino fell through for the 10K plan too: its F0 assumed
-- three weeks of walking base, and the athlete arrives instead
-- from a month-plus without training. A 4-week F00 "Puente"
-- (nominally 17 ago – 13 sep) goes in front of F0: two strength
-- days at 50-60 % of the provisional RMs (≈ empty bar) and two
-- run-walk sessions building back to 30′ continuous, so F0 works
-- as designed. The 10K date does not move.
--
-- In place over the template AND its clones, following the
-- precedent of 20260814000100_f0bis_readaptacion. The clone has
-- nothing logged, so both get the identical insert; every date is
-- derived from F0.starts_on, so a clone on a different Monday
-- shifts with it. Idempotent: a second run finds F00 already
-- present and does nothing.
-- ═══════════════════════════════════════════════════════════════

do $mig$
declare
  r record;
  v_f0 uuid;
  v_pt uuid;
  v_pt_start date;
  s uuid;
begin

for r in
  select p.id as program_id
  from public.programs p
  where exists (
    select 1 from public.program_phases ph
    where ph.program_id = p.id
      and ph.key = 'F0' and ph.name = 'Reinicio'
  )
  and not exists (
    select 1 from public.program_phases ph
    where ph.program_id = p.id and ph.key = 'F00'
  )
loop
  select id, starts_on - 28 into v_f0, v_pt_start from public.program_phases
  where program_id = r.program_id and key = 'F0' and name = 'Reinicio';

  -- F0's premise was the Camino; the puente replaces it.
  update public.program_phases
  set notes = 'El puente te ha devuelto los 30′ seguidos; ahora empieza a contar la carga. '
              'Todo en Z2 por sensación y cargas que puedas repetir con técnica perfecta. '
              'El martes es opcional: mejor 2+2 honestos.'
  where id = v_f0;

  update public.program_run_sessions
  set notes = 'Si algo molesta al correr, se para. No se negocia.'
  where phase_id = v_f0 and week = 1
    and notes like 'Los pies vienen del Camino%';

  -- ── F00 'Puente' in front of everything ───────────────────────

  update public.program_phases set position = position + 100
  where program_id = r.program_id;
  update public.program_phases set position = position - 99
  where program_id = r.program_id;

  insert into public.program_phases (
    program_id, key, name, emphasis, position, weeks, starts_on, notes,
    wave, cycle_weeks, progression_mode, pct_of_rm
  ) values (
    r.program_id, 'F00', 'Puente', 'Readaptación tras un mes parada', 1, 4, v_pt_start,
    'Un mes parada no se arregla apretando. Dos días de fuerza con la barra casi '
    'vacía — la onda sube sola del 50 al 60 % de unas RM puestas por lo bajo — y dos '
    'de correr-andar hasta los 30′ seguidos. La caminata del martes es paseo, no entreno.',
    array[0.500, 0.550, 0.600, 0.500]::numeric(4, 3)[], 4, 'wave', null
  ) returning id into v_pt;

  update public.programs
  set starts_on = v_pt_start,
      summary = 'Cuatro semanas de puente para volver a moverte, doce donde solo se '
                'acumula fondo y seis donde aparece el ritmo de 10k. La fuerza '
                'sostiene la carrera, nunca compite con ella.'
  where id = r.program_id;

  -- ── strength: F0's exercises, one squat set fewer, técnica ────

  insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
  values (v_pt, 'A', 'strength', 'FUERZA A', 'Fuerza A', 'Técnica · sentadilla', 1)
  returning id into s;

  insert into public.program_exercises
    (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds,
     is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
  select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest,
         x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes,
         x.effort, x.sg, x.eq::public.equipment_kind
  from (values
    (1, 'sentadilla',      'Sentadilla',      'BÁSICO', 2, 6, 8,  150, true,  'engine',     'sentadilla', null::numeric, 'Básico del día. La barra sale casi vacía a propósito: este mes es de técnica.', 'reps',    null::smallint, 'barbell'),
    (2, 'press-banca',     'Press banca',     '',       2, 8, 10, 120, false, 'fixed',      null,         20,            'Barra sola.',                              'reps',    null,           'barbell'),
    (3, 'remo-polea',      'Remo en polea',   '',       2, 10, 12,  90, false, 'fixed',      null,         15,            'Codos al costado, sin tirar del cuello.',  'reps',    null,           'pulley'),
    (4, 'hip-thrust',      'Hip thrust',      '',       2, 10, 12,  90, false, 'fixed',      null,         20,            'Pausa 1″ arriba, costillas abajo.',        'reps',    null,           'barbell'),
    (5, 'plancha-lateral', 'Plancha lateral', '',       2, 20, 30,  45, false, 'bodyweight', null,         null,          'Segundos por lado.',                       'seconds', 1,              'bodyweight'),
    (6, 'tibialis-raise',  'Tibialis raise',  '',       2, 15, 20,  60, false, 'bodyweight', null,         null,          'Superserie con la plancha.',               'reps',    1,              'bodyweight')
  ) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, effort, sg, eq)
  left join public.exercises e on e.slug = x.slug and e.owner_id is null;

  insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
  values (v_pt, 'B', 'strength', 'FUERZA B', 'Fuerza B', 'Técnica · RDL', 2)
  returning id into s;

  insert into public.program_exercises
    (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds,
     is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
  select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest,
         x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes,
         x.effort, x.sg, x.eq::public.equipment_kind
  from (values
    (1, 'rdl',                    'RDL',                       'BÁSICO', 2, 6, 8,  150, true,  'engine',     'rdl', null::numeric, 'Básico del día. Cadera atrás, lumbar neutra.', 'reps', null::smallint, 'barbell'),
    (2, 'press-militar-landmine', 'Press militar en landmine', '',       2, 8, 10, 120, false, 'fixed',      null,  20,            'Menos exigente de hombro que la barra.',       'reps', null,           'barbell'),
    (3, 'jalon-al-pecho',         'Jalón al pecho',            '',       2, 10, 12,  90, false, 'fixed',      null,  20,            '',                                             'reps', null,           'pulley'),
    (4, 'split-bulgaro',          'Split búlgaro',             '',       2, 8, 10,   90, false, 'bodyweight', null,  null,          'Sin peso. Por pierna, rodilla estable.',       'reps', null,           'bodyweight'),
    (5, 'pallof-press',           'Pallof press',              '',       2, 10, 12,  45, false, 'fixed',      null,  10,            'Por lado.',                                    'reps', 1,              'pulley'),
    (6, 'soleo-excentrico',       'Sóleo excéntrico',          '',       2, 12, 12,  60, false, 'bodyweight', null,  null,          'Bajada de 3″. Seguro anti-aquíleo.',           'reps', 1,              'bodyweight')
  ) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, effort, sg, eq)
  left join public.exercises e on e.slug = x.slug and e.owner_id is null;

  -- ── running: correr-andar, dos días, hasta 30′ seguidos ───────

  insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
    (v_pt, 'run',  'run_easy', 'CARRERA',   'Correr-andar',  'La carrera vuelve por intervalos', 3),
    (v_pt, 'long', 'run_long', 'LARGA',     'Carrera larga', 'Correr-andar · la salida grande de la semana', 4),
    (v_pt, 'walk', 'rest',     'DESCANSO',  'Descanso',      'Caminata rápida si apetece · 30-40′', 5),
    (v_pt, 'mov',  'mobility', 'MOVILIDAD', 'Descanso',      'Movilidad y correctivos 20′', 6),
    (v_pt, 'off',  'rest',     'DESCANSO',  'Descanso',      'Libre', 7);

  insert into public.program_days (phase_id, day_index, slot_id)
  select v_pt, d.day_index, sl.id
  from (values (0,'A'), (1,'walk'), (2,'B'), (3,'run'), (4,'mov'), (5,'long'), (6,'off'))
       as d(day_index, key)
  join public.program_slots sl on sl.phase_id = v_pt and sl.key = d.key;

  insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes, structure)
  select v_pt, sl.id, x.week, x.prescription, x.minutes, x.notes, x.structure::jsonb
  from (values
    ('run',  1, '8×2'' trote + 1'' andando',  38, 'Primera carrera en más de un mes: el trote más lento que sepas, y el minuto se anda entero.',
     '[{"kind":"walk","workMin":5,"note":"Calienta andando rápido."},{"kind":"interval","repeat":8,"workMin":2,"zone":"Z2","recMin":1,"note":"Trote suave de verdad; la recuperación se anda entera."}]'),
    ('run',  2, '6×3'' trote + 1'' andando',  38, '',
     '[{"kind":"walk","workMin":5,"note":"Calienta andando rápido."},{"kind":"interval","repeat":6,"workMin":3,"zone":"Z2","recMin":1,"note":"Trote suave; la recuperación se anda."}]'),
    ('run',  3, '20'' trote suave',           25, '',
     '[{"kind":"walk","workMin":5,"note":"Calienta andando rápido."},{"kind":"steady","workMin":20,"zone":"Z2","note":"Primer rodaje continuo. Andar un minuto no rompe nada."}]'),
    ('run',  4, '25'' trote suave',           30, '',
     '[{"kind":"walk","workMin":5,"note":"Calienta andando rápido."},{"kind":"steady","workMin":25,"zone":"Z2","note":"Por sensación: puedes hablar."}]'),
    ('long', 1, '10×2'' trote + 1'' andando', 44, '',
     '[{"kind":"walk","workMin":5,"note":"Calienta andando rápido."},{"kind":"interval","repeat":10,"workMin":2,"zone":"Z2","recMin":1,"note":"Trote suave; la recuperación se anda entera."}]'),
    ('long', 2, '8×3'' trote + 1'' andando',  46, '',
     '[{"kind":"walk","workMin":5,"note":"Calienta andando rápido."},{"kind":"interval","repeat":8,"workMin":3,"zone":"Z2","recMin":1,"note":"Trote suave; la recuperación se anda."}]'),
    ('long', 3, '25'' trote continuo',        30, '',
     '[{"kind":"walk","workMin":5,"note":"Calienta andando rápido."},{"kind":"steady","workMin":25,"zone":"Z2","note":"Continuo y cómoda. Andar para beber no rompe nada."}]'),
    ('long', 4, '30'' Z2 continuo',           35, 'Cierre del puente: 30′ seguidos otra vez. F0 empieza donde lo dejaste.',
     '[{"kind":"walk","workMin":5,"note":"Calienta andando rápido."},{"kind":"steady","workMin":30,"zone":"Z2"}]')
  ) as x(key, week, prescription, minutes, notes, structure)
  join public.program_slots sl on sl.phase_id = v_pt and sl.key = x.key;

end loop;

end
$mig$;
