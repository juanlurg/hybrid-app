-- ═══════════════════════════════════════════════════════════════
-- "Tríceps en polea" gets its own catalogue entry. When
-- 20260730001000_structured_plan split the fused "Curl + tríceps"
-- rows, the triceps half kept curl-triceps' exercise_id, so anything
-- keyed off the catalogue (the technique GIF) showed it a curl.
-- Template and clones alike; idempotent.
-- ═══════════════════════════════════════════════════════════════

insert into public.exercises
  (slug, name, modality, pattern, is_unilateral, default_rest_seconds, cues, equipment)
values
  ('triceps-polea', 'Tríceps en polea', 'fixed', 'arm', false, 60, 'Codos pegados, extensión completa abajo.', 'pulley')
on conflict (slug) where owner_id is null do nothing;

update public.program_exercises e
set exercise_id = (select x.id from public.exercises x
                    where x.slug = 'triceps-polea' and x.owner_id is null)
from public.exercises c
where e.exercise_id = c.id
  and c.slug = 'curl-triceps' and c.owner_id is null
  and e.name = 'Tríceps en polea';
