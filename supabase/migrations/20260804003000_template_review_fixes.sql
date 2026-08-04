-- ═══════════════════════════════════════════════════════════════
-- Review fixes, data half: the Plan Maestro template and its clones.
--
--  · Non-primary strength rows stop riding the primary's %RM wave:
--    they become fixed at their double-progression start (Epley for
--    top-of-range with one rep in reserve), per FUERZA:57-58.
--  · F0's goblet squat fits the 16 kg kettlebell instead of asking
--    the engine for a 90 kg goblet the bells cannot express.
--  · F3 becomes mantenimiento-plus: an 80/82.5/85/70 wave with the
--    cycle bump encoding the doc's micro-loads; deloads land on
--    Navidad and Reyes.
--  · F4 splits into F4 (10 weeks, run-deloads halve strength sets)
--    plus an F4T taper (2 weeks, solo día A at 70 %) that carries
--    the race week; race_on/ends_on move to its final Saturday.
--  · Quality runs move 48 h from heavy legs in F3/F4 (principle 6):
--    Tuesday Z2, Wednesday quality. F2 keeps its layout; its week
--    9/11 tempos gain a "move it to Thursday" note instead.
--  · F4 sessions become F3 recortadas (FUERZA:93): A gains the arm
--    superset, B gains split búlgaro and closes with tibialis +
--    sóleo. Updates in place, no deletes — set_logs keep their rows.
--  · F2/F3 gain the optional Sunday Z1 (F4 already had one).
--  · Every phase carries its priority ladder in notes.
--
-- Scope: the template by slug plus source='template' clones still
-- named after it, per the 20260729000900 precedent. The 10K plan is
-- untouched.
-- ═══════════════════════════════════════════════════════════════

do $fix$
declare
  prog record;
  z record;
  v_f3a uuid; v_f3b uuid; v_f4a uuid; v_f4b uuid;
  v_f4 uuid; v_f4_pos integer; v_f4_starts date;
  v_f4t uuid;
  v_slot uuid;
begin

for prog in
  select p.id, p.user_id
  from public.programs p
  where (p.is_template and p.slug = 'plan-maestro-hibrido')
     or (not p.is_template and p.source = 'template'
         and p.name = (select t.name from public.programs t
                       where t.is_template and t.slug = 'plan-maestro-hibrido'))
loop

  -- ── 1) accessories off the wave: fixed double-progression start ──
  -- Epley for the top of the range with one rep in reserve, snapped
  -- to 2.5. Template weights come from program_lift_defaults; clones
  -- from the owner's current lift. lift_key stays: harmless on fixed
  -- rows, and the editor still knows which lift the row grew out of.
  update public.program_exercises pe
  set load_mode = 'fixed',
      fixed_weight_kg = round((
        coalesce(
          (select l.e1rm_kg from public.lifts l
            where l.user_id = prog.user_id and l.key = pe.lift_key),
          (select d.default_e1rm_kg from public.program_lift_defaults d
            where d.program_id = prog.id and d.lift_key = pe.lift_key)
        ) / (1 + (pe.rep_max + 1) / 30.0)
      ) / 2.5) * 2.5
  from public.program_slots s
  join public.program_phases f on f.id = s.phase_id
  where pe.slot_id = s.id
    and f.program_id = prog.id
    and pe.load_mode = 'engine'
    and not pe.is_primary;

  -- ── 2) F0 goblet: the kettlebell the athlete actually owns ──────
  update public.program_exercises pe
  set load_mode = 'fixed',
      fixed_weight_kg = 16,
      equipment = 'kettlebell',
      lift_key = null,
      notes = case when pe.notes = '' then
          'con la kettlebell de 16; si se queda corta, frontal con barra al 75-80 % de lo último.'
        else pe.notes ||
          ' con la kettlebell de 16; si se queda corta, frontal con barra al 75-80 % de lo último.'
        end
  from public.program_slots s
  join public.program_phases f on f.id = s.phase_id
  where pe.slot_id = s.id
    and f.program_id = prog.id
    and f.key = 'F0' and s.key = 'A' and pe.is_primary;

  -- ── 3) F3 mantenimiento-plus: 80-85 % wave, deload on Reyes ─────
  update public.program_phases
  set progression_mode = 'wave',
      wave = array[0.80, 0.825, 0.85, 0.70]::numeric(4, 3)[],
      pct_of_rm = null,
      cycle_weeks = 4,
      auto_deload = null
  where program_id = prog.id and key = 'F3';

  -- ── 7) F4 sessions = F3 recortadas ──────────────────────────────
  select s.id into v_f3a from public.program_slots s
    join public.program_phases f on f.id = s.phase_id
    where f.program_id = prog.id and f.key = 'F3' and s.key = 'A';
  select s.id into v_f3b from public.program_slots s
    join public.program_phases f on f.id = s.phase_id
    where f.program_id = prog.id and f.key = 'F3' and s.key = 'B';
  select s.id into v_f4a from public.program_slots s
    join public.program_phases f on f.id = s.phase_id
    where f.program_id = prog.id and f.key = 'F4' and s.key = 'A';
  select s.id into v_f4b from public.program_slots s
    join public.program_phases f on f.id = s.phase_id
    where f.program_id = prog.id and f.key = 'F4' and s.key = 'B';

  -- A keeps its rows and gains F3-A's arm superset at 2 sets.
  insert into public.program_exercises
    (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds,
     is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
  select v_f4a,
         (select coalesce(max(x.position), 0) from public.program_exercises x
           where x.slot_id = v_f4a) + row_number() over (order by src.position),
         src.exercise_id, src.name, src.tag, 2, src.rep_min, src.rep_max, src.rest_seconds,
         false, src.load_mode, src.lift_key, src.fixed_weight_kg, src.notes,
         src.effort, src.superset_group, src.equipment
  from public.program_exercises src
  where src.slot_id = v_f3a and src.superset_group is not null
    and not exists (select 1 from public.program_exercises x
                    where x.slot_id = v_f4a and x.name = src.name);

  -- B: the sóleo closes a superset with the tibialis; split búlgaro
  -- comes back. Existing rows move, nothing is deleted.
  update public.program_exercises
  set position = 6, sets = 2, superset_group = 1,
      notes = 'Superserie con el anterior. Seguro anti-aquíleo con el volumen alto.'
  where slot_id = v_f4b and name = 'Sóleo excéntrico';

  insert into public.program_exercises
    (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds,
     is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
  select v_f4b, 4, src.exercise_id, src.name, src.tag, 2, src.rep_min, src.rep_max,
         src.rest_seconds, false, src.load_mode, src.lift_key, src.fixed_weight_kg,
         src.notes, src.effort, null, src.equipment
  from public.program_exercises src
  where src.slot_id = v_f3b and src.name = 'Split búlgaro'
    and not exists (select 1 from public.program_exercises x
                    where x.slot_id = v_f4b and x.name = src.name);

  insert into public.program_exercises
    (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds,
     is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
  select v_f4b, 5, src.exercise_id, src.name, src.tag, 2, src.rep_min, src.rep_max,
         src.rest_seconds, false, src.load_mode, src.lift_key, src.fixed_weight_kg,
         src.notes, src.effort, src.superset_group, src.equipment
  from public.program_exercises src
  where src.slot_id = v_f3b and src.name = 'Tibialis raise'
    and not exists (select 1 from public.program_exercises x
                    where x.slot_id = v_f4b and x.name = src.name);

  -- ── 4) F4 → 10 weeks + F4T taper carrying the race week ─────────
  select f.id, f.position, f.starts_on into v_f4, v_f4_pos, v_f4_starts
  from public.program_phases f
  where f.program_id = prog.id and f.key = 'F4';

  insert into public.program_phases
    (program_id, key, name, emphasis, position, weeks, starts_on, notes,
     progression_mode, pct_of_rm, auto_deload)
  values
    (prog.id, 'F4T', 'Taper', 'llegar fino: la media se gana descansando',
     v_f4_pos + 1, 2, v_f4_starts + 70, '',
     'fixed_pct', 0.70, null)
  returning id into v_f4t;

  insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position) values
    (v_f4t, 'A',       'strength',    'FUERZA A', 'Fuerza A · taper',   'Solo día A · 2 series al 70 %', 1),
    (v_f4t, 'z2',      'run_easy',    'CARRERA',  'Carrera Z2',         'Z2 corto con strides', 2),
    (v_f4t, 'quality', 'run_quality', 'CALIDAD',  'Carrera de calidad', 'Toques a ritmo de media, nada que canse', 3),
    (v_f4t, 'long',    'run_long',    'TIRADA',   'Tirada larga',       'Semana 1 corta · semana 2: MEDIA MARATÓN', 4),
    (v_f4t, 'off',     'rest',        'DESCANSO', 'Descanso',           'Libre', 5);

  insert into public.program_days (phase_id, day_index, slot_id)
  select v_f4t, d.day_index, sl.id
  from (values (0,'A'), (1,'z2'), (2,'quality'), (3,'off'), (4,'off'), (5,'long'), (6,'off'))
       as d(day_index, key)
  join public.program_slots sl on sl.phase_id = v_f4t and sl.key = d.key;

  -- Solo día A: F4-A at 2 sets of 5 (the rpe superset keeps its reps).
  insert into public.program_exercises
    (slot_id, position, exercise_id, name, tag, sets, rep_min, rep_max, rest_seconds,
     is_primary, load_mode, lift_key, fixed_weight_kg, notes, effort, superset_group, equipment)
  select sl.id, src.position, src.exercise_id, src.name, src.tag, 2,
         case when src.load_mode = 'rpe' then src.rep_min else 5 end,
         case when src.load_mode = 'rpe' then src.rep_max else 5 end,
         src.rest_seconds, src.is_primary, src.load_mode, src.lift_key, src.fixed_weight_kg,
         case when src.is_primary
           then 'Taper: nada cerca del fallo. Última barra 8-10 días antes de la media.'
           else src.notes end,
         src.effort, src.superset_group, src.equipment
  from public.program_exercises src, public.program_slots sl
  where src.slot_id = v_f4a and sl.phase_id = v_f4t and sl.key = 'A';

  -- The last two F4 run weeks move over verbatim (quality/long both
  -- weeks, z2 only week 1 — race week Tuesday is a rest row).
  insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes, structure)
  select v_f4t, tgt.id, r.week - 10, r.prescription, r.target_minutes, r.notes, r.structure
  from public.program_run_sessions r
  join public.program_slots src_s on src_s.id = r.slot_id
  join public.program_slots tgt on tgt.phase_id = v_f4t
    and tgt.key = case src_s.key when 'run' then 'quality'
                                 when 'easy' then 'z2'
                                 when 'long' then 'long' end
  where r.phase_id = v_f4 and r.week in (11, 12)
    and (src_s.key in ('run', 'long') or (src_s.key = 'easy' and r.week = 11));

  insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes, structure)
  select v_f4t, sl.id, 2, 'Descanso', 0, '', '[{"kind":"rest"}]'::jsonb
  from public.program_slots sl
  where sl.phase_id = v_f4t and sl.key = 'z2';

  delete from public.program_run_sessions where phase_id = v_f4 and week > 10;

  update public.program_phases
  set weeks = 10, auto_deload = true
  where id = v_f4;

  -- ── 5) quality runs 48 h from heavy legs (F3/F4) ─────────────────
  update public.program_days d
  set slot_id = s.id
  from public.program_phases f
  join public.program_slots s on s.phase_id = f.id
  where d.phase_id = f.id
    and f.program_id = prog.id and f.key in ('F3', 'F4')
    and ((d.day_index = 1 and s.key = 'easy')
      or (d.day_index = 2 and s.key = 'run'));

  -- ── 6) F2 keeps its layout; the tempos learn to dodge ────────────
  update public.program_run_sessions r
  set notes = case when r.notes = '' then
      'si las piernas vienen cargadas del lunes, muévela al jueves.'
    else r.notes || ' si las piernas vienen cargadas del lunes, muévela al jueves.' end
  from public.program_phases f
  join public.program_slots s on s.phase_id = f.id
  where r.phase_id = f.id and r.slot_id = s.id
    and f.program_id = prog.id and f.key = 'F2' and s.key = 'run'
    and r.week in (9, 11);

  -- ── 8) the race lands where the plan schedules it ────────────────
  update public.programs
  set race_on = v_f4_starts + 82,   -- F4T week 2, Saturday
      ends_on = v_f4_starts + 82
  where id = prog.id;

  -- ── 9) optional Sunday Z1 for F2/F3, mirroring F4's ──────────────
  for z in
    select f.id, f.key, f.weeks from public.program_phases f
    where f.program_id = prog.id and f.key in ('F2', 'F3')
  loop
    continue when exists (select 1 from public.program_slots s
                          where s.phase_id = z.id and s.key = 'z1');

    insert into public.program_slots (phase_id, key, session_type, label, title, subtitle, position)
    values (z.id, 'z1', 'run_easy', 'Z1', 'Z1 opcional',
            'opcional: protege la base del Camino; lo primero que se cae.',
            (select coalesce(max(position), 0) + 1 from public.program_slots
              where phase_id = z.id))
    returning id into v_slot;

    update public.program_days d
    set slot_id = v_slot
    from public.program_slots cur
    where d.phase_id = z.id and d.day_index = 6
      and cur.id = d.slot_id and cur.session_type = 'rest';

    -- Deload weeks (4/8/12) rest instead: the Z1 is the first thing
    -- that falls, so on descarga it never existed.
    insert into public.program_run_sessions (phase_id, slot_id, week, prescription, target_minutes, notes, structure)
    select z.id, v_slot, w,
      case when w % 4 = 0 then 'Descanso' else 'Z1 30-40'' opcional' end,
      case when w % 4 = 0 then 0 else 35 end,
      '',
      case when w % 4 = 0 then '[{"kind":"rest"}]'::jsonb
           else '[{"kind":"steady","workMin":35,"zone":"Z1","note":"Opcional."}]'::jsonb end
    from generate_series(1, z.weeks) as w;
  end loop;

  -- ── 10) priority ladders into phase notes ────────────────────────
  update public.program_phases f
  set notes = case when f.notes = '' then v.ladder
                   else f.notes || ' ' || v.ladder end
  from (values
    ('F0',  'si la semana se rompe: fuerza 1 > caminata > fuerza 2 > carrera'),
    ('F2',  'si la semana se rompe: fuerza A > fuerza B > Z2 sábado > fuerza C > Z2 martes'),
    ('F3',  'si la semana se rompe: fuerza A > larga > calidad > fuerza B > Z2 suelta'),
    ('F4',  'si la semana se rompe: tirada larga > calidad > fuerza A > Z2 > fuerza B'),
    ('F4T', 'si solo cabe una sesión: la carrera es la sesión.')
  ) as v(key, ladder)
  where f.program_id = prog.id and f.key = v.key
    and position(v.ladder in f.notes) = 0;

end loop;

end
$fix$;
