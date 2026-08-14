-- The truncated F0 kept its Saturday caminata slot, so the week of
-- 10-16 ago still showed "Caminata 3 h con mochila" — a walk that
-- fell with the Camino. Point that day at rest and drop the slot;
-- logged sessions keep their own title and survive (slot_id is
-- on delete set null). Scoped to clones the F0-bis migration
-- truncated; idempotent — a second run finds no 'long' slot.

do $fix$
declare
  r record;
begin
  for r in
    select ph.id as phase_id,
           (select s.id from public.program_slots s
             where s.phase_id = ph.id and s.session_type = 'rest'
             order by s.position limit 1) as off_slot,
           (select s.id from public.program_slots s
             where s.phase_id = ph.id and s.key = 'long') as long_slot
    from public.program_phases ph
    where ph.key = 'F0' and ph.name = 'Puente verano'
      and ph.notes like '%el Camino se cayó%'
  loop
    if r.long_slot is null or r.off_slot is null then
      continue;
    end if;
    update public.program_days set slot_id = r.off_slot
    where phase_id = r.phase_id and slot_id = r.long_slot;
    delete from public.program_slots where id = r.long_slot;
  end loop;
end
$fix$;
