<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- Anything below the marker is hand-written. Keep it out of the block above:
     create-next-app regenerates that block and will drop whatever is inside it. -->

# Domain conventions

`docs/DESIGN.md` § Non-negotiables is the binding list — it beats anything you
infer from the code. The traps that come up most often:

- The weight engine runs on **phase-local weeks** with `phaseEngineConfig(config, phase)` — never `absoluteWeek`.
- Strength prescription is structured: `program_exercises.effort` (reps/seconds/amrap), `superset_group`, `equipment`. Run sessions carry a typed `program_run_sessions.structure` jsonb; the free-text `prescription` is only the label (legacy regex parser is the fallback).
- Loads snap to what the equipment can rack via `loadableWeight()` — kettlebells are a discrete set, not a step.
- The session runner is **local-first**: writes go to the IndexedDB queue (`src/lib/offline/`) and flush to `/api/sync`, which replays the engine idempotently via `engine_events.dedup_key`. Do not add per-set server actions.
- The AI only picks exercises from the catalogue by slug; `applyProposal` enforces the blocking rules in `src/lib/domain/plan-rules.ts` and rolls back whole batches.
- After any migration: `npm run db:types` regenerates `src/lib/supabase/database.types.ts`. Verify with `npm run check` and `npm run test:smoke` (needs `npm run db:start`).
