@AGENTS.md

# Bloques — working agreement

Single-athlete hybrid training PWA (fuerza + carrera). Next 16 App Router,
React 19, Supabase (local via the CLI), Gemini for plan proposals, Tailwind v4.
UI copy is Spanish, lower-case, decimal comma (`formatWeight`); code and
comments are English.

## Where things live

| Path | What |
|---|---|
| `src/lib/engine/` | progression, `loadableWeight`, `replay` — the only place a load is ever computed |
| `src/lib/domain/` | `plan.ts` (`phaseEngineConfig`), `plan-rules.ts` (AI blocking rules), `calendar.ts`, `catalog.ts`, `summary.ts` |
| `src/lib/offline/` | IndexedDB queue, snapshot, syncer, local session |
| `src/lib/actions/` | server actions — `program`, `session`, `ai`, `profile`, `onboarding`, `auth` |
| `src/app/api/sync/` | the single write path for session data; replays the engine idempotently |
| `src/app/(app)/…` | one folder per screen; route table in `docs/DESIGN.md` |
| `src/components/ui/` | the kit — `ScreenHeader`, `RowStack`, `Row`, `SessionRow`, steppers, chips |
| `supabase/migrations/` | ordered SQL, timestamp-prefixed |
| `docs/DESIGN.md` | design spec + the eight non-negotiables |
| `docs/PROGRAMA-*.md` | one per athlete — the programme each template seeds (`*-juanlu.md` also splits out strength and running) |

## Read before you write

- **Next 16 breaks your priors.** Before touching routing, caching, server actions, or `params`/`searchParams`, read the matching guide under `node_modules/next/dist/docs/`.
- **UI work → `docs/DESIGN.md` first.** Reuse the kit and `accentFor(group)`. No border radius, no shadows, no gradients, no new colour literals, `num` on anything numeric.
- **Plan / engine / AI / sync work → `docs/DESIGN.md` § Non-negotiables.** Those eight rules are binding; if the code seems to disagree, the code is the bug.

## Commands

```
npm run check        # typecheck + lint + vitest — the gate for every change
npm run test:smoke   # end-to-end; needs npm run db:start first
npm run db:reset     # re-apply migrations and seed
npm run db:types     # after ANY migration — regenerates src/lib/supabase/database.types.ts
```

## Shape of a change

Match the file you are already in. This is a one-user app with RLS at the
boundary, so:

- No new abstraction layers, helper modules, or config knobs unless asked. A bug fix does not need surrounding cleanup.
- No defensive validation, fallbacks, or error handling for states that cannot happen on internal calls. Validate at boundaries only: user input, `/api/*`, AI output.
- No feature flags or back-compat shims — change the code and the migration.
- Loads, RM changes, and regressions come from the engine. A component reads `ResolvedExercise.weightKg`; it never computes one.
- New DB column or table → migration + `npm run db:types` in the same change, never a hand-edited `database.types.ts`.

Written output follows the repo's own terseness: `docs/DESIGN.md` states the
mechanism in one line and moves on. Match that. Edit an existing doc rather than
adding a new one, and don't pad Markdown with summary or overview sections
nobody asked for.

## Verification

The gate is `npm run check`, plus `npm run test:smoke` when the change touches
sync, the engine, or migrations. Run it and report what it actually printed — if
tests fail, show the failure; if local Supabase was not running, say the smoke
test was skipped. A self-review pass is not verification and neither is a second
opinion from a subagent; the commands are.
