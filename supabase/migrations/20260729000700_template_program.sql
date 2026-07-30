-- ═══════════════════════════════════════════════════════════════
-- The starter program: "Plan Maestro — Atleta Híbrido".
--
-- 39 weeks, Jul 2026 → Apr 2027, ending on a road half marathon.
-- Cloned into a private copy for every athlete at onboarding, then
-- theirs to edit. Shipped as a migration so it exists in the cloud
-- project too.
-- ═══════════════════════════════════════════════════════════════

do $seed$
declare
  v_prog uuid;
  v_f0 uuid; v_f1 uuid; v_f2 uuid; v_f3 uuid; v_f4 uuid;
  s uuid;
begin

insert into public.programs (
  user_id, is_template, slug, name, goal, summary,
  starts_on, ends_on, race_on, race_name,
  wave, cycle_weeks, is_active, source
) values (
  null, true, 'plan-maestro-hibrido',
  'Plan Maestro — Atleta Híbrido',
  'Media maratón de asfalto en la segunda quincena de abril, sin renunciar al físico.',
  'Catorce semanas donde manda la fuerza y veinte donde manda progresivamente la carrera. '
  'Nunca las dos a tope a la vez.',
  date '2026-07-27', date '2027-04-25', date '2027-04-25', 'Media maratón de asfalto',
  array[0.75, 0.80, 0.85, 0.70]::numeric(4,3)[], 4, false, 'template'
) returning id into v_prog;

-- ── phases ─────────────────────────────────────────────────────

insert into public.program_phases (program_id, key, name, emphasis, position, weeks, starts_on, notes)
values (v_prog, 'F0', 'Puente verano', 'Mantener y llegar sano al Camino', 1, 4, date '2026-07-27',
        'Cero intensidad, cero fallo. Cargas al 75-80 % de lo último que movías.')
returning id into v_f0;

insert into public.program_phases (program_id, key, name, emphasis, position, weeks, starts_on, notes)
values (v_prog, 'F1', 'Camino Primitivo', 'Base aeróbica masiva', 2, 3, date '2026-08-24',
        'Caminar ES el entreno. Sin reloj y sin culpa. Comer para caminar, no para perder.')
returning id into v_f1;

insert into public.program_phases (program_id, key, name, emphasis, position, weeks, starts_on, notes)
values (v_prog, 'F2', 'Hipertrofia / Fuerza', 'Ganar músculo y fuerza — el bloque del físico', 3, 12, date '2026-09-14',
        'Tres ciclos completos de progresión. Test de LTHR en la semana 4, nunca en la 1.')
returning id into v_f2;

insert into public.program_phases (program_id, key, name, emphasis, position, weeks, starts_on, notes)
values (v_prog, 'F3', 'Base híbrida', 'Subir volumen de carrera, fuerza a mantenimiento-plus', 4, 8, date '2026-12-07',
        'Navidad cae en las semanas 3-4, diseñadas flexibles a propósito. Mantener es ganar en diciembre.')
returning id into v_f3;

insert into public.program_phases (program_id, key, name, emphasis, position, weeks, starts_on, notes)
values (v_prog, 'F4', 'Específico media maratón', 'Carrera: calidad y tiradas hasta 20 km', 5, 12, date '2027-02-01',
        'La fuerza aquí es un seguro: protege masa, economía y estructuras. Nada más.')
returning id into v_f4;

-- ═══ F0 — Puente verano ════════════════════════════════════════

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f0, 'A', 'strength', 'FUERZA A', 'Fuerza A', 'Corta · empuje y sentadilla', 1)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes
from (values
  (1, 'sentadilla',        'Sentadilla goblet o frontal',  'BÁSICO', 3, 5, 5,  150, true,  'engine', 'sentadilla', null::numeric, 'Sin buscar progresión. Objetivo: no perder.'),
  (2, 'press-banca',       'Press banca',                  '',       3, 5, 5,  150, false, 'engine', 'banca',      null,          ''),
  (3, 'remo-barra',        'Remo con barra o polea',       '',       3, 8, 8,  120, false, 'fixed',  null,         null,          ''),
  (4, 'hip-thrust',        'Hip thrust',                   '',       2, 8, 8,  120, false, 'engine', 'hipthrust',  null,          'Pausa arriba.'),
  (5, 'calf-raise',        'Tibialis + calf raise',        '',       2, 15, 15, 60, false, 'bodyweight', null,     null,          'Superserie.')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f0, 'B', 'strength', 'FUERZA B', 'Fuerza B', 'Corta · bisagra y empuje vertical', 2)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes
from (values
  (1, 'rdl',                 'RDL',            'BÁSICO', 3, 5, 5, 150, true,  'engine',              'rdl',     null::numeric, 'Sin buscar progresión.'),
  (2, 'press-militar',       'Press militar',  '',       3, 5, 5, 150, false, 'engine',              'militar', null,          ''),
  (3, 'dominadas',           'Dominadas',      '',       3, 6, 8, 120, false, 'bodyweight',          null,      null,          ''),
  (4, 'split-bulgaro',       'Split búlgaro',  '',       2, 8, 8, 120, false, 'fixed',               null,      null,          'Ligero, por pierna.'),
  (5, 'farmer-carry',        'Farmer carry',   '',       2, 1, 1,  90, false, 'fixed',               null,      null,          '30-40 m por serie.')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
  (v_f0, 'run',  'run_easy',  'CARRERA',   'Carrera',           'Z1-Z2 estricto · madruga, hace calor', 3),
  (v_f0, 'long', 'run_long',  'CAMINATA',  'Caminata larga',    'Con la mochila del Camino', 4),
  (v_f0, 'mov',  'mobility',  'MOVILIDAD', 'Descanso',          'Movilidad y correctivos 20′', 5),
  (v_f0, 'off',  'rest',      'DESCANSO',  'Descanso',          'Libre', 6);

insert into public.program_days (phase_id, day_index, slot_id)
select v_f0, d.day_index, sl.id
from (values (0,'A'), (1,'run'), (2,'mov'), (3,'B'), (4,'off'), (5,'long'), (6,'off'))
     as d(day_index, key)
join public.program_slots sl on sl.phase_id = v_f0 and sl.key = d.key;

insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes)
select v_f0, sl.id, r.week, r.prescription, r.minutes, r.notes
from (values
  ('run',  1, '45'' Z2 por sensación',                        45, 'Con el calor la FC está inflada y no significa nada.'),
  ('run',  2, '50'' Z2',                                      50, ''),
  ('run',  3, '50'' Z2',                                      50, 'Las caminatas tienen prioridad sobre la 3ª carrera.'),
  ('run',  4, '45'' Z2',                                      45, ''),
  ('long', 1, 'Caminata 90'' con mochila',                    90, ''),
  ('long', 2, 'Caminata 2 h con mochila',                    120, ''),
  ('long', 3, 'Caminata 3 h con mochila',                    180, 'Prueba definitiva de calzado y calcetines.'),
  ('long', 4, 'Caminata 3-4 h con mochila',                  210, 'Ensayo final antes del Camino.')
) as r(key, week, prescription, minutes, notes)
join public.program_slots sl on sl.phase_id = v_f0 and sl.key = r.key;

-- ═══ F1 — Camino Primitivo ═════════════════════════════════════

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f1, 'camino', 'run_long', 'CAMINO', 'Etapa del Camino', 'Caminar es el entreno', 1);

insert into public.program_days (phase_id, day_index, slot_id)
select v_f1, gs.i, sl.id
from generate_series(0, 6) as gs(i)
join public.program_slots sl on sl.phase_id = v_f1 and sl.key = 'camino';

insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes)
select v_f1, sl.id, r.week, r.prescription, r.minutes, r.notes
from (values
  (1, 'Etapas de 20-25 km', 330, 'Sin reloj. Come para caminar, no para perder.'),
  (2, 'Etapas de 20-30 km', 360, 'Cuida los pies antes de que duelan.'),
  (3, 'Etapas finales hasta Santiago', 330, 'La báscula de la semana de vuelta no significa nada.')
) as r(week, prescription, minutes, notes)
join public.program_slots sl on sl.phase_id = v_f1 and sl.key = 'camino';

-- ═══ F2 — Hipertrofia / Fuerza ═════════════════════════════════

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f2, 'A', 'strength', 'FUERZA A', 'Fuerza A', 'Pierna bilateral + empuje · sentadilla', 1)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes
from (values
  (1, 'sentadilla',      'Sentadilla',            'BÁSICO', 4, 5,  6,  180, true,  'engine',     'sentadilla', null::numeric, 'Básico del día — olas de %. Frontal o trasera.'),
  (2, 'press-banca',     'Press banca',           '',       4, 6,  8,  150, false, 'engine',     'banca',      null,          ''),
  (3, 'remo-barra',      'Remo con barra',        '',       3, 8,  10, 120, false, 'fixed',      null,         null,          'Pendlay: desde el suelo cada rep.'),
  (4, 'hip-thrust',      'Hip thrust',            '',       3, 8,  10, 120, false, 'engine',     'hipthrust',  null,          'Pausa 1″ arriba.'),
  (5, 'copenhagen-plank','Copenhagen plank',      '',       2, 20, 30,  60, false, 'bodyweight', null,         null,          'Segundos por lado.'),
  (6, 'calf-raise',      'Calf raise',            '',       3, 12, 15,  60, false, 'fixed',      null,         null,          '')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f2, 'B', 'strength', 'FUERZA B', 'Fuerza B', 'Torso + glúteo pesado · hip thrust', 2)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes
from (values
  (1, 'hip-thrust',                 'Hip thrust pesado',           'BÁSICO', 4, 5,  6,  180, true,  'engine',              'hipthrust', null::numeric, 'Básico del día · pausa 1″ arriba · RIR 1-3'),
  (2, 'press-militar',              'Press militar',               '',       4, 6,  8,  150, false, 'engine',              'militar',   null,          'De pie · doble progresión'),
  (3, 'dominadas-lastradas',        'Dominadas lastradas',         '',       4, 6,  8,  150, false, 'weighted_bodyweight', null,        12.5,          'Si no llegas: 4 × AMRAP−1'),
  (4, 'press-inclinado-mancuernas', 'Press inclinado mancuernas',  '',       3, 8,  10, 120, false, 'fixed',               null,        26,            'Estímulo extra de pecho'),
  (5, 'face-pull',                  'Face pull',                   '',       3, 15, 15,  60, false, 'fixed',               null,        27.5,          'Codos altos, sin encogerse'),
  (6, 'curl-triceps',               'Curl bíceps + tríceps polea', '',       2, 10, 12,  60, false, 'rpe',                 null,        null,          'Superserie, sin descanso entre los dos')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f2, 'C', 'strength', 'FUERZA C', 'Fuerza C', 'Cadena posterior + unilateral · RDL', 3)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes
from (values
  (1, 'rdl',            'RDL con barra',                     'BÁSICO', 4, 6,  8,  180, true,  'engine',              'rdl', null::numeric, 'Básico del día — olas de %.'),
  (2, 'split-bulgaro',  'Split búlgaro',                     '',       3, 8,  10, 120, false, 'fixed',               null,  22,            'Mancuernas, por pierna.'),
  (3, 'jalon-al-pecho', 'Jalón al pecho o dominadas supinas','',       3, 8,  10, 120, false, 'fixed',               null,  60,            ''),
  (4, 'fondos',         'Fondos o press banca ligero',       '',       3, 8,  12, 120, false, 'weighted_bodyweight', null,  0,             '3er estímulo semanal de empuje'),
  (5, 'single-leg-rdl', 'Single-leg RDL',                    '',       2, 8,  8,   90, false, 'fixed',               null,  16,            'KB contralateral, por pierna.'),
  (6, 'tibialis-raise', 'Tibialis raise',                    '',       3, 15, 20,  60, false, 'bodyweight',          null,  null,          ''),
  (7, 'pallof-press',   'Pallof press',                      '',       2, 10, 12,  60, false, 'fixed',               null,  20,            'Por lado.')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
  (v_f2, 'run',  'run_quality', 'CARRERA',   'Carrera',        'Calidad · según la semana', 4),
  (v_f2, 'long', 'run_long',    'LARGA',     'Carrera larga',  'Rodaje continuo en Z2', 5),
  (v_f2, 'mov',  'mobility',    'MOVILIDAD', 'Descanso',       'Movilidad y correctivos 20′', 6),
  (v_f2, 'off',  'rest',        'DESCANSO',  'Descanso',       'Opcional: Z1 30-40′ muy suave', 7);

insert into public.program_days (phase_id, day_index, slot_id)
select v_f2, d.day_index, sl.id
from (values (0,'A'), (1,'run'), (2,'B'), (3,'mov'), (4,'C'), (5,'long'), (6,'off'))
     as d(day_index, key)
join public.program_slots sl on sl.phase_id = v_f2 and sl.key = d.key;

insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes)
select v_f2, sl.id, r.week, r.prescription, r.minutes, r.notes
from (values
  ('run',   1, '35'' Z2 por sensación',                       35, 'Sin reloj. Vuelves del Camino: 6 semanas sin correr.'),
  ('run',   2, '40'' Z2 + 4 strides 20"',                     46, ''),
  ('run',   3, '45'' Z2 + 6 strides',                         51, ''),
  ('run',   4, 'Test LTHR 30''',                              55, 'Semana de descarga: llegas fresco. Aquí salen las zonas.'),
  ('run',   5, '40'' Z2 + 6 cuestas 20"',                     50, 'Recuperación bajando andando.'),
  ('run',   6, '45'' Z2 + 8 cuestas 20"',                     55, ''),
  ('run',   7, '45'' Z2 + 6 strides',                         51, ''),
  ('run',   8, 'Descarga · 35'' Z1-Z2',                       35, ''),
  ('run',   9, '10'' Z2 + 2×8'' Z4 (rec 3'') + 10'' Z2',      42, 'Primer tempo del bloque.'),
  ('run',  10, '45'' Z2 + 6 cuestas',                         55, ''),
  ('run',  11, '10'' Z2 + 3×8'' Z4 (rec 3'') + 10'' Z2',      50, ''),
  ('run',  12, 'Descarga · 40'' Z2 + 4 strides',              46, ''),
  ('long',  1, '45'' Z2',                                     45, ''),
  ('long',  2, '55'' Z2',                                     55, ''),
  ('long',  3, '65'' Z2',                                     65, ''),
  ('long',  4, '45'' Z2',                                     45, ''),
  ('long',  5, '70'' Z2',                                     70, ''),
  ('long',  6, '75'' Z2',                                     75, ''),
  ('long',  7, '80'' Z2',                                     80, ''),
  ('long',  8, '50'' Z2',                                     50, ''),
  ('long',  9, '80'' Z2',                                     80, ''),
  ('long', 10, '85'' Z2',                                     85, ''),
  ('long', 11, '90'' Z2, últimos 10'' progresivos',           90, ''),
  ('long', 12, '60'' Z2',                                     60, '')
) as r(key, week, prescription, minutes, notes)
join public.program_slots sl on sl.phase_id = v_f2 and sl.key = r.key;

-- ═══ F3 — Base híbrida ═════════════════════════════════════════

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f3, 'A', 'strength', 'FUERZA A', 'Fuerza A', 'Mantenimiento-plus · sentadilla y banca', 1)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes
from (values
  (1, 'sentadilla',          'Sentadilla',            'BÁSICO', 3, 5,  5,  180, true,  'engine',              'sentadilla', null::numeric, 'RIR 2. Micro-cargas, sin prisa.'),
  (2, 'press-banca',         'Press banca',           '',       3, 5,  5,  150, false, 'engine',              'banca',      null,          'RIR 2.'),
  (3, 'dominadas-lastradas', 'Dominadas lastradas',   '',       3, 5,  6,  150, false, 'weighted_bodyweight', null,         12.5,          ''),
  (4, 'hip-thrust',          'Hip thrust',            '',       3, 8,  8,  120, false, 'engine',              'hipthrust',  null,          ''),
  (5, 'curl-triceps',        'Curl + tríceps',        '',       2, 10, 12,  60, false, 'rpe',                 null,         null,          'Superserie — mantiene el brazo.')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f3, 'B', 'strength', 'FUERZA B', 'Fuerza B', 'Mantenimiento-plus · RDL y militar', 2)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes
from (values
  (1, 'rdl',           'RDL',            'BÁSICO', 3, 5,  5,  180, true,  'engine',     'rdl',     null::numeric, 'RIR 2.'),
  (2, 'press-militar', 'Press militar',  '',       3, 5,  5,  150, false, 'engine',     'militar', null,          'RIR 2.'),
  (3, 'remo-barra',    'Remo con barra', '',       3, 8,  8,  120, false, 'fixed',      null,      70,            ''),
  (4, 'split-bulgaro', 'Split búlgaro',  '',       2, 8,  8,  120, false, 'fixed',      null,      22,            'Por pierna.'),
  (5, 'calf-raise',    'Tibialis + calf','',       2, 15, 15,  60, false, 'bodyweight', null,      null,          'Superserie.')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
  (v_f3, 'run',  'run_quality', 'CALIDAD',   'Carrera de calidad', 'Tempo y cruise intervals', 3),
  (v_f3, 'easy', 'run_easy',    'CARRERA',   'Carrera Z2',         'Rodaje suelto', 4),
  (v_f3, 'long', 'run_long',    'LARGA',     'Carrera larga',      'Rodaje continuo en Z2', 5),
  (v_f3, 'mov',  'mobility',    'MOVILIDAD', 'Descanso',           'Movilidad y correctivos 20′', 6),
  (v_f3, 'off',  'rest',        'DESCANSO',  'Descanso',           'Opcional: Z1 30′', 7);

insert into public.program_days (phase_id, day_index, slot_id)
select v_f3, d.day_index, sl.id
from (values (0,'A'), (1,'run'), (2,'easy'), (3,'B'), (4,'mov'), (5,'long'), (6,'off'))
     as d(day_index, key)
join public.program_slots sl on sl.phase_id = v_f3 and sl.key = d.key;

insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes)
select v_f3, sl.id, r.week, r.prescription, r.minutes, r.notes
from (values
  ('run',  1, '3×8'' Z4 (rec 3'')',                         44, ''),
  ('run',  2, '20'' Z4 continuo',                           45, ''),
  ('run',  3, 'Navidad · flexible: Z2 con strides',         45, 'Mínimo 2 salidas Z2. Cumplirlo es éxito.'),
  ('run',  4, 'Reyes · flexible/descarga: Z2 con strides',  45, ''),
  ('run',  5, '4×8'' Z4 (rec 3'')',                         52, ''),
  ('run',  6, '25'' Z4 continuo',                           50, ''),
  ('run',  7, '3×10'' Z4 (rec 3'')',                        50, ''),
  ('run',  8, 'Descarga + re-test LTHR 30''',               55, 'Zonas recalibradas para F4.'),
  ('easy', 1, '40'' Z2',                                    40, ''),
  ('easy', 2, '45'' Z2',                                    45, ''),
  ('easy', 3, 'Flexible · Z2 suave si encaja',              40, ''),
  ('easy', 4, 'Flexible · Z2 suave si encaja',              40, ''),
  ('easy', 5, '45'' Z2',                                    45, ''),
  ('easy', 6, '50'' Z2',                                    50, ''),
  ('easy', 7, '50'' Z2',                                    50, ''),
  ('easy', 8, '40'' Z2',                                    40, ''),
  ('long', 1, '75'' Z2',                                    75, ''),
  ('long', 2, '80'' Z2',                                    80, ''),
  ('long', 3, '60-75'' Z2 cuando encaje',                   70, ''),
  ('long', 4, '60'' Z2',                                    60, ''),
  ('long', 5, '90'' Z2',                                    90, ''),
  ('long', 6, '95'' Z2',                                    95, ''),
  ('long', 7, '100'' Z2, últimos 15'' progresivos',        100, ''),
  ('long', 8, '70'' Z2',                                    70, '')
) as r(key, week, prescription, minutes, notes)
join public.program_slots sl on sl.phase_id = v_f3 and sl.key = r.key;

-- ═══ F4 — Específico media maratón ═════════════════════════════

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f4, 'A', 'strength', 'FUERZA A', 'Fuerza A', 'Mantenimiento 40-45′ · sentadilla', 1)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes
from (values
  (1, 'sentadilla',          'Sentadilla',          'BÁSICO', 3, 5, 5, 180, true,  'engine',              'sentadilla', null::numeric, 'Mantener carga, sin progresar. La fuerza aquí es un seguro.'),
  (2, 'press-banca',         'Press banca',         '',       3, 5, 5, 150, false, 'engine',              'banca',      null,          ''),
  (3, 'dominadas-lastradas', 'Dominadas lastradas', '',       2, 5, 6, 150, false, 'weighted_bodyweight', null,         12.5,          ''),
  (4, 'hip-thrust',          'Hip thrust',          '',       2, 8, 8, 120, false, 'engine',              'hipthrust',  null,          '')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
values (v_f4, 'B', 'strength', 'FUERZA B', 'Fuerza B', 'Mantenimiento 40-45′ · RDL', 2)
returning id into s;

insert into public.program_exercises
  (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds, is_primary, load_mode, lift_key, fixed_weight_kg, notes)
select s, x.position, e.id, x.name, x.tag, x.sets, x.rep_min, x.rep_max, x.rest, x.is_primary, x.mode::public.load_mode, x.lift_key, x.fixed, x.notes
from (values
  (1, 'rdl',            'RDL',            'BÁSICO', 3, 5,  5,  180, true,  'engine',     'rdl',     null::numeric, 'Mantener carga, sin progresar.'),
  (2, 'press-militar',  'Press militar',  '',       3, 5,  5,  150, false, 'engine',     'militar', null,          ''),
  (3, 'remo-barra',     'Remo con barra', '',       2, 8,  8,  120, false, 'fixed',      null,      70,            ''),
  (4, 'soleo-excentrico','Sóleo excéntrico','',     2, 12, 12,  60, false, 'bodyweight', null,      null,          'Seguro anti-aquíleo con el volumen alto.')
) as x(position, slug, name, tag, sets, rep_min, rep_max, rest, is_primary, mode, lift_key, fixed, notes)
left join public.exercises e on e.slug = x.slug and e.owner_id is null;

insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
  (v_f4, 'run',  'run_quality', 'CALIDAD',  'Carrera de calidad', 'Cruise intervals, tempo, ritmo de media', 3),
  (v_f4, 'easy', 'run_easy',    'CARRERA',  'Carrera Z2',         'Z2 + 4-6 strides de 20″', 4),
  (v_f4, 'long', 'run_long',    'TIRADA',   'Tirada larga',       'Con segmentos a ritmo objetivo', 5),
  (v_f4, 'z1',   'run_easy',    'Z1',       'Z1 opcional',        '30-40′ muy suave o descanso', 6),
  (v_f4, 'off',  'rest',        'DESCANSO', 'Descanso',           'Libre', 7);

insert into public.program_days (phase_id, day_index, slot_id)
select v_f4, d.day_index, sl.id
from (values (0,'A'), (1,'run'), (2,'easy'), (3,'B'), (4,'off'), (5,'long'), (6,'z1'))
     as d(day_index, key)
join public.program_slots sl on sl.phase_id = v_f4 and sl.key = d.key;

insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes)
select v_f4, sl.id, r.week, r.prescription, r.minutes, r.notes
from (values
  ('run',   1, '5×5'' Z4 (rec 90")',                            50, ''),
  ('run',   2, '6×3'' Z5 (rec 2''30")',                         50, 'Toque de VO2max.'),
  ('run',   3, '25'' tempo Z4',                                 50, ''),
  ('run',   4, 'Descarga · 40'' Z2 + strides',                  46, ''),
  ('run',   5, '4×10'' Z4 (rec 3'')',                           60, ''),
  ('run',   6, '2×15'' Z4 (rec 3'')',                           55, ''),
  ('run',   7, '10K test o carrera real',                       60, 'De aquí sale el ritmo objetivo de media: +15-20 s/km.'),
  ('run',   8, 'Descarga · 45'' Z2 + 4 strides',                51, ''),
  ('run',   9, '3×3 km a RM (rec 3'')',                         70, ''),
  ('run',  10, '30'' tempo, últimos 10'' a RM',                 55, ''),
  ('run',  11, 'Taper · 2×10'' a RM',                           45, ''),
  ('run',  12, '20'' Z2 con 3×3'' a RM',                        35, 'Activación de la semana de carrera.'),
  ('easy',  1, '45'' Z2 + 6 strides 20"',                       51, 'Los strides son innegociables todas las semanas.'),
  ('easy',  2, '45'' Z2 + 6 strides 20"',                       51, ''),
  ('easy',  3, '50'' Z2 + 6 strides 20"',                       56, ''),
  ('easy',  4, '40'' Z2 + 4 strides 20"',                       46, ''),
  ('easy',  5, '50'' Z2 + 6 strides 20"',                       56, ''),
  ('easy',  6, '50'' Z2 + 6 strides 20"',                       56, ''),
  ('easy',  7, '40'' Z2 + 4 strides 20"',                       46, ''),
  ('easy',  8, '45'' Z2 + 4 strides 20"',                       51, ''),
  ('easy',  9, '50'' Z2 + 6 strides 20"',                       56, ''),
  ('easy', 10, '50'' Z2 + 6 strides 20"',                       56, ''),
  ('easy', 11, '40'' Z2 + 4 strides 20"',                       46, ''),
  ('easy', 12, '30'' Z2 + 4 strides 20"',                       36, ''),
  ('long',  1, '12 km Z2',                                      66, ''),
  ('long',  2, '13 km Z2',                                      72, ''),
  ('long',  3, '14 km, últimos 3 km a RM',                      77, '40-60 g de carbohidrato por hora desde aquí.'),
  ('long',  4, '10 km Z2',                                      55, ''),
  ('long',  5, '15 km, 4 km a RM intercalados',                 83, ''),
  ('long',  6, '16 km, últimos 5 km a RM',                      88, ''),
  ('long',  7, '13 km fáciles Z2',                              72, ''),
  ('long',  8, '12 km Z2',                                      66, ''),
  ('long',  9, '18 km, 6 km a RM al final',                     99, 'Ensaya desayuno, gel y zapatillas de carrera.'),
  ('long', 10, '19-20 km Z2 — pico',                           110, 'La tirada más larga del plan.'),
  ('long', 11, '13 km Z2',                                      72, ''),
  ('long', 12, 'MEDIA MARATÓN',                                 95, 'Primeros 5 km ligeramente por debajo de RM. Negativo si puedes.'),
  ('z1',    1, 'Z1 30-40'' opcional',                            35, ''),
  ('z1',    2, 'Z1 30-40'' opcional',                            35, ''),
  ('z1',    3, 'Z1 30-40'' opcional',                            35, ''),
  ('z1',    4, 'Descanso',                                        0, ''),
  ('z1',    5, 'Z1 30-40'' opcional',                            35, ''),
  ('z1',    6, 'Z1 30-40'' opcional',                            35, ''),
  ('z1',    7, 'Z1 30'' muy suave',                              30, ''),
  ('z1',    8, 'Descanso',                                        0, ''),
  ('z1',    9, 'Z1 30-40'' opcional',                            35, ''),
  ('z1',   10, 'Z1 30'' muy suave',                              30, ''),
  ('z1',   11, 'Descanso',                                        0, ''),
  ('z1',   12, 'Descanso',                                        0, '')
) as r(key, week, prescription, minutes, notes)
join public.program_slots sl on sl.phase_id = v_f4 and sl.key = r.key;

-- ── starting RMs ───────────────────────────────────────────────

insert into public.program_lift_defaults (program_id, lift_key, name, kind, exercise_slug, default_e1rm_kg, position)
values
  (v_prog, 'sentadilla', 'Sentadilla',    'lower', 'sentadilla',    120,  1),
  (v_prog, 'banca',      'Press banca',   'upper', 'press-banca',    92.5, 2),
  (v_prog, 'hipthrust',  'Hip thrust',    'lower', 'hip-thrust',    150,  3),
  (v_prog, 'militar',    'Press militar', 'upper', 'press-militar',  60,  4),
  (v_prog, 'rdl',        'RDL',           'lower', 'rdl',           110,  5);

end
$seed$;
