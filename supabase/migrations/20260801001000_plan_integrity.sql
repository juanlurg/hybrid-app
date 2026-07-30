-- Plan integrity fixes from the 2026-07-30 audit.
--
--  1) F4 of the master template shipped without a mobility slot: its
--     Friday mapped to plain rest, which the app's own blocking rule
--     ("Sin bloque de movilidad") treats as invalid — every AI batch
--     during the 12-week race block was applied and then rolled back.
--     Seed the mov slot and repoint Friday, mirroring F2/F3. In-place
--     over the template AND template-sourced clones, like the
--     structured_plan backfills.
--  2) The master's race_on (2027-04-25, a Sunday) pointed one day past
--     the MEDIA MARATÓN session the plan actually schedules (Saturday
--     day_index 5 of F4's last week). Recompute it from the phase.
--  3) Belt-and-braces floors the zod schema already enforces at the
--     boundary, so a hand-run script or a botched restore can never
--     feed negative loads into the engine replay or the tonnage math.
--  4) ai_proposals.dropped — ops the ownership/catalogue filter removed
--     from a proposal, kept so the editor can show WHY a change the
--     rationale narrates has no card.

-- 1) F4 mobility slot + Friday repoint ------------------------------
do $$
declare
  ph record;
  v_slot uuid;
begin
  for ph in
    select p.id as phase_id
    from public.program_phases p
    join public.programs pr on pr.id = p.program_id
    where p.key = 'F4'
      and (pr.is_template or pr.source = 'template')
      and not exists (
        select 1 from public.program_slots s
        where s.phase_id = p.id and s.session_type = 'mobility'
      )
  loop
    insert into public.program_slots
      (phase_id, key, session_type, label, title, subtitle, position)
    values
      (ph.phase_id, 'mov', 'mobility', 'MOVILIDAD', 'Descanso',
       'Movilidad y correctivos 20′', 8)
    returning id into v_slot;

    update public.program_days
    set slot_id = v_slot
    where phase_id = ph.phase_id and day_index = 4;
  end loop;
end $$;

-- 2) race_on = the Saturday of F4's final week -----------------------
update public.programs pr
set race_on = p.starts_on + ((p.weeks - 1) * 7 + 5)
from public.program_phases p
where p.program_id = pr.id
  and p.key = 'F4'
  and (pr.is_template or pr.source = 'template')
  and pr.race_on is not null;

-- 3) DB floors mirroring the sync schema -----------------------------
alter table public.set_logs
  add constraint set_logs_weight_kg_floor
    check (weight_kg is null or weight_kg >= 0),
  add constraint set_logs_seconds_floor
    check (seconds is null or seconds >= 0),
  add constraint set_logs_rir_range
    check (rir is null or (rir >= 0 and rir <= 10));

alter table public.sessions
  add constraint sessions_tonnage_floor check (tonnage_kg >= 0);

-- 4) Dropped proposal ops --------------------------------------------
alter table public.ai_proposals
  add column dropped jsonb not null default '[]'::jsonb;
