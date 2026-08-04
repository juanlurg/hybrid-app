-- ═══════════════════════════════════════════════════════════════
-- Knee-friendly regressions the substitution list promised but the
-- catalogue never carried. The athlete has patellofemoral history;
-- when the squat pattern flares, "si algo molesta" needs seed rows
-- to point at. Equipment set by update, like 20260730001000.
-- ═══════════════════════════════════════════════════════════════

insert into public.exercises (slug, name, modality, pattern, is_unilateral, default_rest_seconds, cues)
values
  ('sentadilla-espanola', 'Sentadilla española',              'bodyweight', 'squat', false,  60, 'Banda detrás de las rodillas, espinilla vertical. Isométrico: aguanta 45″ por serie.'),
  ('sentadilla-caja',     'Sentadilla a caja',                'fixed',      'squat', false, 150, 'Al cajón o pines altos: profundidad limitada, espinilla más vertical.'),
  ('step-down',           'Step-down lateral',                'bodyweight', 'squat', true,   60, 'Bajada lateral del escalón en 3″, pelvis nivelada todo el rango.'),
  ('femoral-banda',       'Femoral con banda o deslizantes',  'bodyweight', 'hinge', false,  90, 'Curl de femoral tumbado: cadera extendida mientras flexionas la rodilla, bajada controlada.');

update public.exercises set equipment = v.eq::public.equipment_kind
from (values
  ('sentadilla-espanola', 'band'),
  ('sentadilla-caja',     'barbell'),
  ('step-down',           'bodyweight'),
  ('femoral-banda',       'band')
) as v(slug, eq)
where exercises.slug = v.slug and exercises.owner_id is null;

-- Substitutions the plan calls out ("si algo molesta"): the new
-- regressions, plus the heavy split squat the doc already lists as a
-- squat substitution — only sentadilla-goblet carried that link.
update public.exercises e
set substitution_for = s.id
from public.exercises s
where e.owner_id is null and s.owner_id is null
  and (e.slug, s.slug) in (
    ('sentadilla-espanola', 'sentadilla'),
    ('sentadilla-caja',     'sentadilla'),
    ('step-down',           'split-bulgaro'),
    ('femoral-banda',       'rdl'),
    ('split-bulgaro',       'sentadilla')
  );
