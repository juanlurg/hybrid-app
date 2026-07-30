-- ═══════════════════════════════════════════════════════════════
-- Second starter program: "Primer 10K — Base y fondo".
--
-- 18 weeks for a beginner runner: 30′ continuous today, a 10 km at
-- the end. Three runs and two full-body strength sessions a week.
-- Only the basic of each strength slot rides the engine; everything
-- else is a fixed load that steps up phase by phase, because the
-- athlete starts strength from scratch and a fabricated e1RM the
-- engine can never correct is worse than a number she can edit.
--
-- Dates here are nominal: onboarding picks the real Monday and
-- clone_program re-dates every phase from it.
-- ═══════════════════════════════════════════════════════════════

do $seed$
declare
  v_prog uuid;
  v_f0 uuid; v_f1 uuid; v_f2 uuid; v_f3 uuid;
  s uuid;
begin

insert into public.programs (
  user_id, is_template, slug, name, goal, summary,
  starts_on, ends_on, race_on, race_name,
  wave, cycle_weeks, is_active, source
) values (
  null, true, 'plan-10k-base',
  'Primer 10K — Base y fondo',
  'Terminar 10 km corriendo, sana y sin lesiones. El ritmo no es el objetivo.',
  'Doce semanas donde solo se acumula fondo y seis donde aparece el ritmo de 10k. '
  'La fuerza sostiene la carrera, nunca compite con ella.',
  date '2026-09-14', date '2027-01-17', date '2027-01-16', '10 km en asfalto',
  array[0.70, 0.75, 0.80, 0.65]::numeric(4,3)[], 4, false, 'template'
) returning id into v_prog;

-- ── phases ─────────────────────────────────────────────────────

insert into public.program_phases (
  program_id, key, name, emphasis, position, weeks, starts_on, notes,
  wave, cycle_weeks, progression_mode, pct_of_rm
) values (
  v_prog, 'F0', 'Reinicio', 'Volver a correr y aprender las cargas', 1, 4, date '2026-09-14',
  'Vienes de caminar, no de correr. Todo en Z2 por sensación y cargas que puedas '
  'repetir con técnica perfecta. El martes es opcional: mejor 2+2 honestos.',
  array[0.65, 0.70, 0.75, 0.65]::numeric(4,3)[], 4, 'wave', null
) returning id into v_f0;

insert into public.program_phases (
  program_id, key, name, emphasis, position, weeks, starts_on, notes,
  wave, cycle_weeks, progression_mode, pct_of_rm
) values (
  v_prog, 'F1', 'Base', 'Fondo — el bloque grande', 2, 8, date '2026-10-12',
  'Dos ciclos completos. El volumen sube ~10 % por semana y baja en las semanas '
  '4 y 8. Strides sí, cuestas todavía no. Test de LTHR en la semana 8.',
  null, 4, 'wave', null
) returning id into v_f1;

insert into public.program_phases (
  program_id, key, name, emphasis, position, weeks, starts_on, notes,
  wave, cycle_weeks, progression_mode, pct_of_rm
) values (
  v_prog, 'F2', 'Específico 10k', 'Ritmo de 10k y llegar a la distancia', 3, 4, date '2026-12-07',
  'Aparece Z4, que para ti es el ritmo de 10k. La larga llega a los 10 km: la '
  'distancia se corre en entreno antes de correrla de verdad.',
  null, 4, 'wave', null
) returning id into v_f2;

insert into public.program_phases (
  program_id, key, name, emphasis, position, weeks, starts_on, notes,
  wave, cycle_weeks, progression_mode, pct_of_rm
) values (
  v_prog, 'F3', '10K', 'Afinar y correrlo', 4, 2, date '2027-01-04',
  'Mismo peso las dos semanas y la mitad de series: la fuerza aquí solo mantiene. '
  'Bajas volumen de carrera sin perder el toque de ritmo.',
  null, null, 'fixed_pct', 0.70
) returning id into v_f3;

-- ═══ F0 — Reinicio ═════════════════════════════════════════════

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f0, 'A', 'strength', 'FUERZA A', 'Fuerza A', 'Cuerpo completo · sentadilla', 1)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes, x.effort, x.sg, x.eq::public.equipment_kind
from (values
  (1, 'sentadilla',      'Sentadilla',       'BÁSICO', 3, 6, 8,  150, true,  'engine',     'sentadilla', null::numeric, 'Básico del día. Profundidad antes que peso.', 'reps',    null::smallint, 'barbell'),
  (2, 'press-banca',     'Press banca',      '',       2, 8, 10, 120, false, 'fixed',      null,         20,            'Barra sola las primeras semanas.',           'reps',    null,           'barbell'),
  (3, 'remo-polea',      'Remo en polea',    '',       2, 10, 12,  90, false, 'fixed',      null,         15,            'Codos al costado, sin tirar del cuello.',    'reps',    null,           'pulley'),
  (4, 'hip-thrust',      'Hip thrust',       '',       2, 10, 12,  90, false, 'fixed',      null,         20,            'Pausa 1″ arriba, costillas abajo.',          'reps',    null,           'barbell'),
  (5, 'plancha-lateral', 'Plancha lateral',  '',       2, 20, 30,  45, false, 'bodyweight', null,         null,          'Segundos por lado.',                         'seconds', 1,              'bodyweight'),
  (6, 'tibialis-raise',  'Tibialis raise',   '',       2, 15, 20,  60, false, 'bodyweight', null,         null,          'Superserie con la plancha.',                 'reps',    1,              'bodyweight')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, effort, sg, eq)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f0, 'B', 'strength', 'FUERZA B', 'Fuerza B', 'Cuerpo completo · RDL', 2)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes, x.effort, x.sg, x.eq::public.equipment_kind
from (values
  (1, 'rdl',                    'RDL',                       'BÁSICO', 3, 6, 8,  150, true,  'engine',     'rdl', null::numeric, 'Básico del día. Cadera atrás, lumbar neutra.', 'reps', null::smallint, 'barbell'),
  (2, 'press-militar-landmine', 'Press militar en landmine', '',       2, 8, 10, 120, false, 'fixed',      null,  20,            'Menos exigente de hombro que la barra.',       'reps', null,           'barbell'),
  (3, 'jalon-al-pecho',         'Jalón al pecho',            '',       2, 10, 12,  90, false, 'fixed',      null,  20,            '',                                             'reps', null,           'pulley'),
  (4, 'split-bulgaro',          'Split búlgaro',             '',       2, 8, 10,   90, false, 'bodyweight', null,  null,          'Sin peso. Por pierna, rodilla estable.',       'reps', null,           'bodyweight'),
  (5, 'pallof-press',           'Pallof press',              '',       2, 10, 12,  45, false, 'fixed',      null,  10,            'Por lado. Anti-rotación, costillas abajo.',    'reps', 1,              'pulley'),
  (6, 'soleo-excentrico',       'Sóleo excéntrico',          '',       2, 12, 12,  60, false, 'bodyweight', null,  null,          'Bajada de 3″. Seguro anti-aquíleo.',           'reps', 1,              'bodyweight')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, effort, sg, eq)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
  (v_f0, 'easy', 'run_easy',  'CARRERA',   'Rodaje corto', 'Z2 por sensación · opcional este mes', 3),
  (v_f0, 'run',  'run_easy',  'CARRERA',   'Rodaje',       'Z2 por sensación', 4),
  (v_f0, 'long', 'run_long',  'LARGA',     'Carrera larga', 'Z2 continuo, sin prisa', 5),
  (v_f0, 'mov',  'mobility',  'MOVILIDAD', 'Descanso',     'Movilidad y correctivos 20′', 6),
  (v_f0, 'off',  'rest',      'DESCANSO',  'Descanso',     'Libre', 7);

insert into public.program_days (phase_id, day_index, slot_id)
select v_f0, d.day_index, sl.id
from (values (0,'A'), (1,'easy'), (2,'B'), (3,'run'), (4,'mov'), (5,'long'), (6,'off'))
     as d(day_index, key)
join public.program_slots sl on sl.phase_id = v_f0 and sl.key = d.key;

insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes, structure)
select v_f0, sl.id, r.week, r.prescription, r.minutes, r.notes, r.structure::jsonb
from (values
  ('easy', 1, '20'' Z2 por sensación', 20, 'Opcional. Si el cuerpo pide descanso, se cae este día primero.', '[{"kind":"steady","workMin":20,"zone":"Z2","note":"Por sensación: puedes hablar."}]'),
  ('easy', 2, '20'' Z2 por sensación', 20, 'Opcional.',                                                      '[{"kind":"steady","workMin":20,"zone":"Z2","note":"Por sensación: puedes hablar."}]'),
  ('easy', 3, '20'' Z2 por sensación', 20, 'Opcional.',                                                      '[{"kind":"steady","workMin":20,"zone":"Z2","note":"Por sensación: puedes hablar."}]'),
  ('easy', 4, '20'' Z2 por sensación', 20, 'Semana de descarga.',                                            '[{"kind":"steady","workMin":20,"zone":"Z2","note":"Descarga, muy suave."}]'),
  ('run',  1, '25'' Z2 por sensación', 25, 'Los pies vienen del Camino: si algo molesta, se para.',           '[{"kind":"steady","workMin":25,"zone":"Z2","note":"Por sensación, sin reloj."}]'),
  ('run',  2, '25'' Z2 por sensación', 25, '',                                                               '[{"kind":"steady","workMin":25,"zone":"Z2","note":"Por sensación, sin reloj."}]'),
  ('run',  3, '30'' Z2 por sensación', 30, '',                                                               '[{"kind":"steady","workMin":30,"zone":"Z2","note":"Por sensación, sin reloj."}]'),
  ('run',  4, '25'' Z2 por sensación', 25, 'Semana de descarga.',                                            '[{"kind":"steady","workMin":25,"zone":"Z2","note":"Descarga, muy suave."}]'),
  ('long', 1, '35'' Z2',               35, 'Tu larga de hoy es lo que ya sabes correr, ni un minuto más.',    '[{"kind":"steady","workMin":35,"zone":"Z2"}]'),
  ('long', 2, '40'' Z2',               40, '',                                                               '[{"kind":"steady","workMin":40,"zone":"Z2"}]'),
  ('long', 3, '45'' Z2',               45, 'Andar un minuto para beber no rompe nada.',                       '[{"kind":"steady","workMin":45,"zone":"Z2"}]'),
  ('long', 4, '35'' Z2',               35, 'Semana de descarga.',                                            '[{"kind":"steady","workMin":35,"zone":"Z2"}]')
) as r(key, week, prescription, minutes, notes, structure)
join public.program_slots sl on sl.phase_id = v_f0 and sl.key = r.key;

-- ═══ F1 — Base ═════════════════════════════════════════════════

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f1, 'A', 'strength', 'FUERZA A', 'Fuerza A', 'Cuerpo completo · sentadilla', 1)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes, x.effort, x.sg, x.eq::public.equipment_kind
from (values
  (1, 'sentadilla',      'Sentadilla',      'BÁSICO', 3, 5, 8,  150, true,  'engine',     'sentadilla', null::numeric, 'Básico del día — olas de %.',             'reps',    null::smallint, 'barbell'),
  (2, 'press-banca',     'Press banca',     '',       3, 8, 10, 120, false, 'fixed',      null,         22.5,          'Sube 2,5 kg cuando cierres las 3×10.',    'reps',    null,           'barbell'),
  (3, 'remo-polea',      'Remo en polea',   '',       3, 10, 12,  90, false, 'fixed',      null,         20,            '',                                        'reps',    null,           'pulley'),
  (4, 'hip-thrust',      'Hip thrust',      '',       2, 10, 12,  90, false, 'fixed',      null,         30,            'Pausa 1″ arriba.',                        'reps',    null,           'barbell'),
  (5, 'plancha-lateral', 'Plancha lateral', '',       2, 25, 35,  45, false, 'bodyweight', null,         null,          'Segundos por lado.',                      'seconds', 1,              'bodyweight'),
  (6, 'tibialis-raise',  'Tibialis raise',  '',       2, 15, 20,  60, false, 'bodyweight', null,         null,          'Superserie con la plancha.',              'reps',    1,              'bodyweight')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, effort, sg, eq)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f1, 'B', 'strength', 'FUERZA B', 'Fuerza B', 'Cuerpo completo · RDL', 2)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes, x.effort, x.sg, x.eq::public.equipment_kind
from (values
  (1, 'rdl',                    'RDL',                       'BÁSICO', 3, 6, 8,  150, true,  'engine',     'rdl', null::numeric, 'Básico del día — olas de %.',            'reps', null::smallint, 'barbell'),
  (2, 'press-militar-landmine', 'Press militar en landmine', '',       3, 8, 10, 120, false, 'fixed',      null,  20,            '',                                       'reps', null,           'barbell'),
  (3, 'jalon-al-pecho',         'Jalón al pecho',            '',       3, 10, 12,  90, false, 'fixed',      null,  25,            'Sube 5 kg cuando cierres las 3×12.',     'reps', null,           'pulley'),
  (4, 'split-bulgaro',          'Split búlgaro',             '',       2, 8, 10,   90, false, 'bodyweight', null,  null,          'Sin peso todavía. Por pierna.',          'reps', null,           'bodyweight'),
  (5, 'pallof-press',           'Pallof press',              '',       2, 10, 12,  45, false, 'fixed',      null,  10,            'Por lado.',                              'reps', 1,              'pulley'),
  (6, 'soleo-excentrico',       'Sóleo excéntrico',          '',       2, 12, 15,  60, false, 'bodyweight', null,  null,          'Bajada de 3″. Con el volumen que sube, esto no se salta.', 'reps', 1, 'bodyweight')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, effort, sg, eq)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
  (v_f1, 'easy', 'run_easy',    'CARRERA',   'Rodaje corto',  'Z2 continuo', 3),
  (v_f1, 'run',  'run_quality', 'CARRERA',   'Rodaje',        'Z2 con strides · según la semana', 4),
  (v_f1, 'long', 'run_long',    'LARGA',     'Carrera larga', 'Z2 continuo, la sesión que da el fondo', 5),
  (v_f1, 'mov',  'mobility',    'MOVILIDAD', 'Descanso',      'Movilidad y correctivos 20′', 6),
  (v_f1, 'off',  'rest',        'DESCANSO',  'Descanso',      'Libre', 7);

insert into public.program_days (phase_id, day_index, slot_id)
select v_f1, d.day_index, sl.id
from (values (0,'A'), (1,'easy'), (2,'B'), (3,'run'), (4,'mov'), (5,'long'), (6,'off'))
     as d(day_index, key)
join public.program_slots sl on sl.phase_id = v_f1 and sl.key = d.key;

insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes, structure)
select v_f1, sl.id, r.week, r.prescription, r.minutes, r.notes, r.structure::jsonb
from (values
  ('easy', 1, '25'' Z2',                  25, '',                                          '[{"kind":"steady","workMin":25,"zone":"Z2"}]'),
  ('easy', 2, '25'' Z2',                  25, '',                                          '[{"kind":"steady","workMin":25,"zone":"Z2"}]'),
  ('easy', 3, '30'' Z2',                  30, '',                                          '[{"kind":"steady","workMin":30,"zone":"Z2"}]'),
  ('easy', 4, '25'' Z2',                  25, 'Descarga.',                                 '[{"kind":"steady","workMin":25,"zone":"Z2","note":"Descarga."}]'),
  ('easy', 5, '30'' Z2',                  30, '',                                          '[{"kind":"steady","workMin":30,"zone":"Z2"}]'),
  ('easy', 6, '30'' Z2',                  30, '',                                          '[{"kind":"steady","workMin":30,"zone":"Z2"}]'),
  ('easy', 7, '30'' Z2',                  30, '',                                          '[{"kind":"steady","workMin":30,"zone":"Z2"}]'),
  ('easy', 8, '30'' Z2',                  30, 'Descarga: el jueves toca test.',            '[{"kind":"steady","workMin":30,"zone":"Z2","note":"Descarga."}]'),
  ('run',  1, '30'' Z2',                  30, 'Todavía sin strides: primero el hábito.',   '[{"kind":"steady","workMin":30,"zone":"Z2"}]'),
  ('run',  2, '30'' Z2 + 4 strides 20"',  41, 'Strides: 20″ rápidos en llano, recuperación completa andando.', '[{"kind":"steady","workMin":30,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('run',  3, '30'' Z2 + 4 strides 20"',  41, '',                                          '[{"kind":"steady","workMin":30,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('run',  4, '25'' Z2 + 4 strides 20"',  36, 'Descarga.',                                 '[{"kind":"steady","workMin":25,"zone":"Z2","note":"Descarga."},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('run',  5, '35'' Z2 + 4 strides 20"',  46, '',                                          '[{"kind":"steady","workMin":35,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('run',  6, '35'' Z2 + 6 strides 20"',  49, '',                                          '[{"kind":"steady","workMin":35,"zone":"Z2"},{"kind":"strides","repeat":6,"workSec":20}]'),
  ('run',  7, '40'' Z2 + 6 strides 20"',  54, '',                                          '[{"kind":"steady","workMin":40,"zone":"Z2"},{"kind":"strides","repeat":6,"workSec":20}]'),
  ('run',  8, 'Test LTHR 30''',           55, 'Aquí salen tus zonas. Llegas en semana de descarga y ya corres más de una hora seguida: los 30′ del test están a tu alcance.', '[{"kind":"test","workMin":30}]'),
  ('long', 1, '45'' Z2',                  45, '',                                          '[{"kind":"steady","workMin":45,"zone":"Z2"}]'),
  ('long', 2, '45'' Z2',                  45, '',                                          '[{"kind":"steady","workMin":45,"zone":"Z2"}]'),
  ('long', 3, '50'' Z2',                  50, '',                                          '[{"kind":"steady","workMin":50,"zone":"Z2"}]'),
  ('long', 4, '45'' Z2',                  45, 'Descarga.',                                 '[{"kind":"steady","workMin":45,"zone":"Z2","note":"Descarga."}]'),
  ('long', 5, '55'' Z2',                  55, '',                                          '[{"kind":"steady","workMin":55,"zone":"Z2"}]'),
  ('long', 6, '60'' Z2',                  60, 'Una hora corriendo. Hace tres meses eran 30′.', '[{"kind":"steady","workMin":60,"zone":"Z2"}]'),
  ('long', 7, '65'' Z2',                  65, '',                                          '[{"kind":"steady","workMin":65,"zone":"Z2"}]'),
  ('long', 8, '50'' Z2',                  50, 'Descarga.',                                 '[{"kind":"steady","workMin":50,"zone":"Z2","note":"Descarga."}]')
) as r(key, week, prescription, minutes, notes, structure)
join public.program_slots sl on sl.phase_id = v_f1 and sl.key = r.key;

-- ═══ F2 — Específico 10k ═══════════════════════════════════════

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f2, 'A', 'strength', 'FUERZA A', 'Fuerza A', 'Cuerpo completo · sentadilla', 1)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes, x.effort, x.sg, x.eq::public.equipment_kind
from (values
  (1, 'sentadilla',       'Sentadilla',        'BÁSICO', 3, 5, 6,  150, true,  'engine',     'sentadilla', null::numeric, 'Básico del día. La carrera manda: sin fallo.', 'reps',    null::smallint, 'barbell'),
  (2, 'press-banca',      'Press banca',       '',       3, 8, 10, 120, false, 'fixed',      null,         25,            '',                                             'reps',    null,           'barbell'),
  (3, 'remo-polea',       'Remo en polea',     '',       2, 10, 12,  90, false, 'fixed',      null,         25,            '',                                             'reps',    null,           'pulley'),
  (4, 'hip-thrust',       'Hip thrust',        '',       2, 8, 10,   90, false, 'fixed',      null,         40,            'Pausa 1″ arriba.',                             'reps',    null,           'barbell'),
  (5, 'copenhagen-plank', 'Copenhagen plank',  '',       2, 15, 25,  45, false, 'bodyweight', null,         null,          'Segundos por lado. Empieza con la rodilla apoyada.', 'seconds', 1,        'bodyweight'),
  (6, 'tibialis-raise',   'Tibialis raise',    '',       2, 15, 20,  60, false, 'bodyweight', null,         null,          'Superserie con el copenhagen.',                'reps',    1,              'bodyweight')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, effort, sg, eq)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f2, 'B', 'strength', 'FUERZA B', 'Fuerza B', 'Cuerpo completo · RDL', 2)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes, x.effort, x.sg, x.eq::public.equipment_kind
from (values
  (1, 'rdl',                    'RDL',                       'BÁSICO', 3, 6, 8,  150, true,  'engine',     'rdl', null::numeric, 'Básico del día.',                    'reps', null::smallint, 'barbell'),
  (2, 'press-militar-landmine', 'Press militar en landmine', '',       3, 8, 10, 120, false, 'fixed',      null,  25,            '',                                   'reps', null,           'barbell'),
  (3, 'jalon-al-pecho',         'Jalón al pecho',            '',       2, 10, 12,  90, false, 'fixed',      null,  30,            '',                                   'reps', null,           'pulley'),
  (4, 'split-bulgaro',          'Split búlgaro',             '',       2, 8, 10,   90, false, 'fixed',      null,  5,             'Mancuernas ligeras. Por pierna.',    'reps', null,           'dumbbell'),
  (5, 'pallof-press',           'Pallof press',              '',       2, 10, 12,  45, false, 'fixed',      null,  15,            'Por lado.',                          'reps', 1,              'pulley'),
  (6, 'soleo-excentrico',       'Sóleo excéntrico',          '',       2, 12, 15,  60, false, 'bodyweight', null,  null,          'Bajada de 3″.',                      'reps', 1,              'bodyweight')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, effort, sg, eq)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
  (v_f2, 'easy', 'run_easy',    'CARRERA',   'Rodaje corto',  'Z2 con strides', 3),
  (v_f2, 'run',  'run_quality', 'CALIDAD',   'Calidad',       'Ritmo de 10k · según la semana', 4),
  (v_f2, 'long', 'run_long',    'LARGA',     'Carrera larga', 'Z2 · aquí llegas a los 10 km', 5),
  (v_f2, 'mov',  'mobility',    'MOVILIDAD', 'Descanso',      'Movilidad y correctivos 20′', 6),
  (v_f2, 'off',  'rest',        'DESCANSO',  'Descanso',      'Libre', 7);

insert into public.program_days (phase_id, day_index, slot_id)
select v_f2, d.day_index, sl.id
from (values (0,'A'), (1,'easy'), (2,'B'), (3,'run'), (4,'mov'), (5,'long'), (6,'off'))
     as d(day_index, key)
join public.program_slots sl on sl.phase_id = v_f2 and sl.key = d.key;

insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes, structure)
select v_f2, sl.id, r.week, r.prescription, r.minutes, r.notes, r.structure::jsonb
from (values
  ('easy', 1, '35'' Z2 + 4 strides 20"',   46, '',                                                            '[{"kind":"steady","workMin":35,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('easy', 2, '35'' Z2',                   35, 'Suave: el sábado corres 5 km de ensayo.',                     '[{"kind":"steady","workMin":35,"zone":"Z2"}]'),
  ('easy', 3, '40'' Z2 + 4 strides 20"',   51, '',                                                            '[{"kind":"steady","workMin":40,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('easy', 4, '30'' Z2',                   30, 'Descarga.',                                                   '[{"kind":"steady","workMin":30,"zone":"Z2","note":"Descarga."}]'),
  ('run',  1, '4×4'' Z4 (rec 2'')',        42, 'Z4 es tu ritmo de 10k: incómodo pero sostenible, no a tope.', '[{"kind":"interval","repeat":4,"workMin":4,"zone":"Z4","recMin":2}]'),
  ('run',  2, '30'' Z2 + 6 cuestas 20"',   44, 'Cuesta corta y empinada, bajando andando. La única semana de cuestas del plan.', '[{"kind":"steady","workMin":30,"zone":"Z2"},{"kind":"hills","repeat":6,"workSec":20}]'),
  ('run',  3, '3×6'' Z4 (rec 3'')',        44, '',                                                            '[{"kind":"interval","repeat":3,"workMin":6,"zone":"Z4","recMin":3}]'),
  ('run',  4, '4×3'' Z4 (rec 2'')',        38, 'Descarga: menos volumen, mismo ritmo.',                       '[{"kind":"interval","repeat":4,"workMin":3,"zone":"Z4","recMin":2}]'),
  ('long', 1, '70'' Z2',                   70, '',                                                            '[{"kind":"steady","workMin":70,"zone":"Z2"}]'),
  ('long', 2, 'Ensayo · 5 km',             48, 'Un 5k de verdad, con dorsal o sin él: que el día del 10k no sea tu primera salida.', '[{"kind":"steady","workMin":10,"zone":"Z2"},{"kind":"race","workKm":5,"note":"Sales a Z3 y aprietas el último kilómetro."}]'),
  ('long', 3, '10 km Z2',                  78, 'Los 10 km, sin cronómetro. El día de la carrera ya sabes que puedes.', '[{"kind":"steady","workKm":10,"zone":"Z2","note":"Sin mirar el reloj: solo terminar cómoda."}]'),
  ('long', 4, '55'' Z2',                   55, 'Descarga.',                                                   '[{"kind":"steady","workMin":55,"zone":"Z2","note":"Descarga."}]')
) as r(key, week, prescription, minutes, notes, structure)
join public.program_slots sl on sl.phase_id = v_f2 and sl.key = r.key;

-- ═══ F3 — 10K ══════════════════════════════════════════════════

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f3, 'A', 'strength', 'FUERZA A', 'Fuerza A', 'Mantenimiento · sentadilla', 1)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes, x.effort, x.sg, x.eq::public.equipment_kind
from (values
  (1, 'sentadilla',       'Sentadilla',       'BÁSICO', 2, 5, 5,  150, true,  'engine',     'sentadilla', null::numeric, 'Mismo peso las dos semanas. Nada de buscar récords.', 'reps',    null::smallint, 'barbell'),
  (2, 'press-banca',      'Press banca',      '',       2, 8, 8,  120, false, 'fixed',      null,         25,            '',                                                    'reps',    null,           'barbell'),
  (3, 'remo-polea',       'Remo en polea',    '',       2, 10, 10,  90, false, 'fixed',      null,         25,            '',                                                    'reps',    null,           'pulley'),
  (4, 'hip-thrust',       'Hip thrust',       '',       2, 8, 8,   90, false, 'fixed',      null,         40,            '',                                                    'reps',    null,           'barbell'),
  (5, 'copenhagen-plank', 'Copenhagen plank', '',       1, 15, 25,  45, false, 'bodyweight', null,         null,          'Segundos por lado.',                                  'seconds', 1,              'bodyweight'),
  (6, 'tibialis-raise',   'Tibialis raise',   '',       1, 15, 20,  60, false, 'bodyweight', null,         null,          'Superserie con el copenhagen.',                       'reps',    1,              'bodyweight')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, effort, sg, eq)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f3, 'B', 'strength', 'FUERZA B', 'Fuerza B', 'Mantenimiento · RDL', 2)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes, x.effort, x.sg, x.eq::public.equipment_kind
from (values
  (1, 'rdl',                    'RDL',                       'BÁSICO', 2, 6, 6,  150, true,  'engine',     'rdl', null::numeric, 'Mismo peso las dos semanas.',   'reps', null::smallint, 'barbell'),
  (2, 'press-militar-landmine', 'Press militar en landmine', '',       2, 8, 8,  120, false, 'fixed',      null,  25,            '',                              'reps', null,           'barbell'),
  (3, 'jalon-al-pecho',         'Jalón al pecho',            '',       2, 10, 10,  90, false, 'fixed',      null,  30,            '',                              'reps', null,           'pulley'),
  (4, 'split-bulgaro',          'Split búlgaro',             '',       2, 8, 8,   90, false, 'fixed',      null,  5,             'Por pierna.',                   'reps', null,           'dumbbell'),
  (5, 'pallof-press',           'Pallof press',              '',       1, 10, 12,  45, false, 'fixed',      null,  15,            'Por lado.',                     'reps', 1,              'pulley'),
  (6, 'soleo-excentrico',       'Sóleo excéntrico',          '',       1, 12, 15,  60, false, 'bodyweight', null,  null,          'Bajada de 3″.',                 'reps', 1,              'bodyweight')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes, effort, sg, eq)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
  (v_f3, 'easy', 'run_easy',    'CARRERA',   'Rodaje corto', 'Z2 con strides', 3),
  (v_f3, 'run',  'run_quality', 'CALIDAD',   'Calidad',      'Toque de ritmo, nada más', 4),
  (v_f3, 'long', 'run_long',    'CARRERA',   'Larga · 10K',  'La semana 2 es la carrera', 5),
  (v_f3, 'mov',  'mobility',    'MOVILIDAD', 'Descanso',     'Movilidad y correctivos 20′', 6),
  (v_f3, 'off',  'rest',        'DESCANSO',  'Descanso',     'Libre', 7);

insert into public.program_days (phase_id, day_index, slot_id)
select v_f3, d.day_index, sl.id
from (values (0,'A'), (1,'easy'), (2,'B'), (3,'run'), (4,'mov'), (5,'long'), (6,'off'))
     as d(day_index, key)
join public.program_slots sl on sl.phase_id = v_f3 and sl.key = d.key;

insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes, structure)
select v_f3, sl.id, r.week, r.prescription, r.minutes, r.notes, r.structure::jsonb
from (values
  ('easy', 1, '30'' Z2 + 4 strides 20"',        41, '',                                                        '[{"kind":"steady","workMin":30,"zone":"Z2"},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('easy', 2, '25'' Z2 + 4 strides 20"',        36, 'Semana de carrera: piernas frescas.',                     '[{"kind":"steady","workMin":25,"zone":"Z2","note":"Muy suave."},{"kind":"strides","repeat":4,"workSec":20}]'),
  ('run',  1, '3×4'' Z4 (rec 2'')',             36, 'Última sesión de calidad. Sales con la sensación de poder hacer una más.', '[{"kind":"interval","repeat":3,"workMin":4,"zone":"Z4","recMin":2}]'),
  ('run',  2, '20'' Z2 con 3×2'' Z4 (rec 2'')', 40, 'Activación, no entrenamiento.',                           '[{"kind":"steady","workMin":20,"zone":"Z2"},{"kind":"interval","repeat":3,"workMin":2,"zone":"Z4","recMin":2}]'),
  ('long', 1, '50'' Z2',                        50, 'Ya no se gana fondo: se llega descansada.',               '[{"kind":"steady","workMin":50,"zone":"Z2"}]'),
  ('long', 2, '10K',                            85, 'Los tres primeros kilómetros en Z2, aunque te sobren piernas. El último, lo que quede.', '[{"kind":"steady","workMin":10,"zone":"Z2","note":"Calentamiento andando y trotando."},{"kind":"race","workKm":10,"note":"Sales en Z2 y subes a partir del km 3."}]')
) as r(key, week, prescription, minutes, notes, structure)
join public.program_slots sl on sl.phase_id = v_f3 and sl.key = r.key;

-- ── starting RMs ───────────────────────────────────────────────
-- Only the two basics ride the engine, so only these two exist.
-- Provisional numbers: the first sessions correct them from /programa.

insert into public.program_lift_defaults (program_id, lift_key, name, kind, exercise_slug, default_e1rm_kg, position)
values
  (v_prog, 'sentadilla', 'Sentadilla', 'lower', 'sentadilla', 35, 1),
  (v_prog, 'rdl',        'RDL',        'lower', 'rdl',        40, 2);

end
$seed$;
