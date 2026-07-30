-- ═══════════════════════════════════════════════════════════════
-- Shared catalogues: exercises and the daily mobility block.
-- Reference data, so it lives in a migration rather than seed.sql.
-- ═══════════════════════════════════════════════════════════════

insert into public.exercises (slug, name, modality, pattern, is_unilateral, default_rest_seconds, cues)
values
  ('sentadilla',              'Sentadilla',                        'engine',              'squat',   false, 180, 'Frontal o trasera. Rodilla sigue al pie, torso firme.'),
  ('sentadilla-goblet',       'Sentadilla goblet',                 'fixed',               'squat',   false, 120, 'Profunda, codos dentro de las rodillas.'),
  ('press-banca',             'Press banca',                       'engine',              'push_h',  false, 150, 'Escápulas retraídas, barra al esternón.'),
  ('press-banca-ligero',      'Press banca ligero',                'fixed',               'push_h',  false, 120, 'Tercer estímulo semanal de empuje.'),
  ('press-militar',           'Press militar',                     'engine',              'push_v',  false, 150, 'De pie. Costillas abajo, glúteo apretado.'),
  ('press-militar-landmine',  'Press militar en landmine',         'fixed',               'push_v',  true,  120, 'Menos rotación externa forzada, mismo patrón vertical.'),
  ('press-inclinado-mancuernas','Press inclinado mancuernas',      'fixed',               'push_h',  false, 120, 'Estímulo extra de pecho.'),
  ('remo-barra',              'Remo con barra (Pendlay)',          'engine',              'pull_h',  false, 120, 'Desde el suelo cada rep, torso paralelo.'),
  ('remo-polea',              'Remo en polea',                     'fixed',               'pull_h',  false, 120, ''),
  ('dominadas',               'Dominadas',                         'bodyweight',          'pull_v',  false, 150, ''),
  ('dominadas-lastradas',     'Dominadas lastradas',               'weighted_bodyweight', 'pull_v',  false, 150, 'Si no llegas al rango: AMRAP−1.'),
  ('dominadas-supinas',       'Dominadas supinas',                 'weighted_bodyweight', 'pull_v',  false, 120, ''),
  ('jalon-al-pecho',          'Jalón al pecho',                    'fixed',               'pull_v',  false, 120, ''),
  ('rdl',                     'RDL con barra',                     'engine',              'hinge',   false, 180, 'Cadera atrás, barra pegada. Rango sin perder lumbar.'),
  ('single-leg-rdl',          'Single-leg RDL',                    'fixed',               'hinge',   true,  90,  'KB contralateral.'),
  ('hip-thrust',              'Hip thrust',                        'engine',              'hinge',   false, 150, 'Pausa 1″ arriba, costillas abajo.'),
  ('hip-thrust-ligero',       'Hip thrust ligero',                 'fixed',               'hinge',   false, 90,  ''),
  ('split-bulgaro',           'Split búlgaro',                     'fixed',               'squat',   true,  120, 'Mancuernas. Rodilla trasera baja controlada.'),
  ('zancada-bulgara',         'Zancada búlgara',                   'fixed',               'squat',   true,  120, ''),
  ('fondos',                  'Fondos',                            'weighted_bodyweight', 'push_h',  false, 120, ''),
  ('face-pull',               'Face pull',                         'fixed',               'pull_h',  false, 60,  'Codos altos, sin encogerse.'),
  ('rotacion-externa-banda',  'Rotación externa con banda',        'fixed',               'pull_h',  true,  45,  'Codo pegado al costado.'),
  ('curl-triceps',            'Curl bíceps + tríceps polea',       'rpe',                 'arm',     false, 60,  'Superserie, sin descanso entre los dos.'),
  ('elevaciones-laterales',   'Elevaciones laterales',             'fixed',               'push_v',  false, 60,  ''),
  ('copenhagen-plank',        'Copenhagen plank',                  'bodyweight',          'core',    true,  60,  'Cadera alta, sin rotar.'),
  ('plancha-lateral',         'Plancha lateral',                   'bodyweight',          'core',    true,  45,  'Cadera alta, sin rotar.'),
  ('pallof-press',            'Pallof press',                      'fixed',               'core',    true,  60,  'Anti-rotación: costillas abajo.'),
  ('nordico-excentrico',      'Nórdico excéntrico',                'bodyweight',          'hinge',   false, 90,  'Bajada de 3-5″, frenar todo lo posible.'),
  ('calf-raise',              'Calf raise',                        'fixed',               'calf',    false, 60,  ''),
  ('soleo-excentrico',        'Sóleo excéntrico',                  'fixed',               'calf',    true,  60,  'Bajada de 3″. Seguro anti-aquíleo.'),
  ('tibialis-raise',          'Tibialis raise',                    'bodyweight',          'calf',    false, 60,  'Protege la espinilla del volumen de carrera.'),
  ('farmer-carry',            'Farmer carry',                      'fixed',               'carry',   false, 90,  '30-40 m por serie.');

-- Substitutions the plan calls out ("si algo molesta").
update public.exercises e
set substitution_for = s.id
from public.exercises s
where e.owner_id is null and s.owner_id is null
  and (e.slug, s.slug) in (
    ('sentadilla-goblet', 'sentadilla'),
    ('hip-thrust', 'rdl'),
    ('jalon-al-pecho', 'dominadas-lastradas'),
    ('press-militar-landmine', 'press-militar'),
    ('press-banca-ligero', 'fondos')
  );

-- The daily 20′ block. Innegociable, and not counted as training.
insert into public.mobility_items (slug, group_name, name, dose, dose_unit, note, position)
values
  ('clamshells',      'Activación glútea', 'Clamshells con banda',   '2 × 15', 'por lado',            'Pelvis quieta, no rueda hacia atrás.', 1),
  ('monster-walk',    'Activación glútea', 'Monster walk',           '2 × 10', 'pasos ida/vuelta',    'Banda por encima de rodilla, rodillas fuera.', 2),
  ('puente-gluteo',   'Activación glútea', 'Puente de glúteo',       '2 × 12', 'reps',                'Pausa 1″ arriba, costillas abajo.', 3),
  ('psoas-stretch',   'Psoas y core',      'Estiramiento de psoas',  '45',     'segundos por lado',   'Media rodilla, glúteo activo del lado estirado.', 4),
  ('dead-bug',        'Psoas y core',      'Dead bug',               '2 × 8',  'por lado',            'Lumbar pegada al suelo todo el rato.', 5),
  ('plancha-lateral', 'Psoas y core',      'Plancha lateral',        '30',     'segundos por lado',   'Cadera alta, sin rotar.', 6),
  ('knee-to-wall',    'Tobillo y cadera',  'Knee-to-wall',           '2 × 10', 'por lado',            'Talón pegado al suelo. Mide los cm.', 7),
  ('cadera-90-90',    'Tobillo y cadera',  '90/90 de cadera',        '45',     'segundos por lado',   'Tronco erguido, rotación activa.', 8),
  ('soleo-excentrico','Tobillo y cadera',  'Sóleo excéntrico',       '2 × 12', 'por lado',            'Bajada de 3″. Seguro anti-aquíleo.', 9);
