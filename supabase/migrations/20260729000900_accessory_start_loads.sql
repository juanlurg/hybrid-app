-- ═══════════════════════════════════════════════════════════════
-- Starting loads for the accessories that shipped without one.
--
-- A fixed-load exercise with a null weight renders as "—" in the
-- session runner, which leaves the athlete with no number to put on
-- the bar. Give every accessory a sensible starting point; the
-- athlete corrects it from the editor after the first session.
--
-- Applied to cloned programmes too, but only where the value is
-- still null — never overwrite a weight someone has already set.
-- ═══════════════════════════════════════════════════════════════

update public.program_exercises e
set fixed_weight_kg = v.kg
from (values
  ('A', 'Remo con barra o polea', 55.0),
  ('B', 'Split búlgaro',          16.0),
  ('B', 'Farmer carry',           24.0),
  ('A', 'Remo con barra',         70.0),
  ('A', 'Calf raise',             40.0)
) as v(slot_key, name, kg)
where e.fixed_weight_kg is null
  and e.load_mode = 'fixed'
  and e.name = v.name
  and exists (
    select 1 from public.program_slots s
    where s.id = e.slot_id and s.key = v.slot_key
  );

-- Anything still null would show "—": fall back to the bar so the
-- number on screen is at least loadable.
update public.program_exercises
set fixed_weight_kg = 20
where fixed_weight_kg is null and load_mode = 'fixed';

update public.program_exercises
set fixed_weight_kg = 0
where fixed_weight_kg is null and load_mode = 'weighted_bodyweight';
