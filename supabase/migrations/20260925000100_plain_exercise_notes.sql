-- The basic's notes opened with "Básico del día — olas de %.", which the
-- screen already says in its own eyebrow and which reads as engine jargon
-- mid-set. Strip that lead-in everywhere — templates and every clone — keep
-- the coaching cue that follows it ("Frontal o trasera."), and capitalise
-- what is left, since it now starts mid-sentence ("pausa 1″ arriba").

update program_exercises pe
set notes = upper(left(s.rest, 1)) || substr(s.rest, 2)
from (
  select
    id,
    btrim(
      regexp_replace(
        notes,
        '^Básico del día(\s*—\s*olas de %\.?|\s*[.·])?\s*',
        ''
      )
    ) as rest
  from program_exercises
  where notes ~ '^Básico del día'
) s
where pe.id = s.id;
