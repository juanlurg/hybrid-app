-- The broken-week priority order, until now prose in docs/PROGRAMA-*.md,
-- becomes phase data so the app can show it when a week loses days.

alter table public.program_phases
  add column priority text not null default '';

comment on column public.program_phases.priority is
  'Order to keep sessions in when the week breaks ("Fuerza A > Larga > …"). '
  'Empty when the programme gives no order (readaptación bridges).';

-- Seed templates AND every clone in one pass: phases copy key + name
-- verbatim from their template, and the (key, name) pair is unique across
-- the two templates, so a broad match is safe in this single-athlete DB.
update public.program_phases p
set priority = v.priority
from (values
  ('F2', 'Hipertrofia / Fuerza',     'Fuerza A > Fuerza B > Z2 sábado > Fuerza C > Z2 martes'),
  ('F3', 'Base híbrida',             'Fuerza A > Larga > Calidad > Fuerza B > Z2 suelta'),
  ('F4', 'Específico media maratón', 'Tirada larga > Calidad > Fuerza A > Z2 miércoles > Fuerza B'),
  ('F0', 'Reinicio',                 'Larga > Fuerza A > Jueves > Fuerza B > Martes'),
  ('F1', 'Base',                     'Larga > Fuerza A > Jueves > Fuerza B > Martes'),
  ('F2', 'Específico 10k',           'Larga > Calidad (jueves) > Fuerza A > Fuerza B > Martes'),
  ('F3', '10K',                      'Larga > Calidad (jueves) > Fuerza A > Fuerza B > Martes')
) as v(key, name, priority)
where p.key = v.key and p.name = v.name;

-- ── clone_program: carry the new column ────────────────────────
-- Full body from 20260730001000, with priority added to the phase copy.

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
      wave, cycle_weeks, progression_mode, pct_of_rm, priority
    )
    values (
      v_new_id, v_phase.key, v_phase.name, v_phase.emphasis,
      v_phase.position, v_phase.weeks,
      v_starts + (v_offset_weeks * 7),
      v_phase.notes,
      v_phase.wave, v_phase.cycle_weeks,
      v_phase.progression_mode, v_phase.pct_of_rm, v_phase.priority
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
