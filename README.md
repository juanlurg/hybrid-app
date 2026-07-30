# Bloques

Hybrid-training app: barbell strength and road running in one plan, with a
weight engine that decides every working load and an AI that can restructure
the programme without ever touching that engine.

Built from the [Hybrid Training App](https://claude.ai/design/p/c0efe7ca-e66a-45f7-bab0-37b03188542c)
design ("Bloques" direction) and the *Plan Maestro — Atleta Híbrido* source plan.

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript | Server Components for the first paint, Server Actions for every mutation, one codebase for phone and desktop |
| Styling | Tailwind v4 with a custom `@theme` | The Bloques palette lives in CSS variables; no component library to fight |
| Data | Supabase (Postgres + Auth + RLS), local via Docker | Row-level security means multi-athlete isolation is enforced by the database, not by app code |
| AI | Gemini (`@google/genai`) with structured output | The model returns a typed diff; the server validates and applies it |
| Tests | Vitest | The engine and the calendar are pure and fully covered |

## Getting started

```bash
npm install
npx supabase start          # first run pulls ~2 GB of Docker images
npm run db:reset            # migrations + the Plan Maestro template
cp .env.example .env.local  # then paste the keys from `npx supabase status`
npm run dev
```

Open http://localhost:3000, create an account, and onboarding will clone the
starter plan into a private programme.

Add a `GEMINI_API_KEY` from [AI Studio](https://aistudio.google.com/apikey) to
`.env.local` to enable "Refinar con IA" and programme generation. Everything
else works without it.

Supabase Studio runs at http://127.0.0.1:54323 and the local inbox (for
confirmation emails) at http://127.0.0.1:54324.

## How the weight engine works

Every working load comes out of `src/lib/engine`. Nothing else is allowed to
invent a number — not the UI, not the AI.

```
peso = redondear( (RM × (1 − penalización) + incremento_de_ciclo) × ola[semana] )
```

- **Ola** — four multipliers per cycle, `75 / 80 / 85 / 70 %`. The last week is
  the deload: same weights, half the sets.
- **Incremento de ciclo** — +5 kg lower body, +2.5 kg upper, once per completed
  cycle.
- **Regresión** — a set under the prescribed minimum on the *basic of the day*
  (and only that lift) walks a ladder. Under the default rule: freeze the
  weight, then −5 % on the RM, then −10 % plus a forced deload. A clean session
  resets the counter.
- **Redondeo** — to the smallest step the athlete can actually load. The plate
  breakdown reports a remainder when the kit cannot reach the number.

`Progreso` shows the full derivation for the current week, term by term.

## Data model

`profiles` hold the engine knobs. `programs → program_phases → program_slots →
program_exercises` are the plan: a phase owns reusable *slots* (Fuerza A, la
larga, movilidad) and a 7-row weekly template that points at them, so retyping a
day is a pointer change and editing Fuerza A edits it everywhere.
`program_run_sessions` carry the running prescription week by week.

Training lives in `sessions → set_logs / run_logs / mobility_logs`, engine
state in `lifts`, and every automatic decision in `engine_events` — which is
what makes the timeline in Historial and the undo on the session banner exact.

A template programme (`user_id is null`, `is_template`) is readable by everyone
and cloned per athlete by the `clone_program` RPC. RLS on every table scopes
rows to `auth.uid()`.

## The AI contract

`src/lib/ai/schema.ts` is the whole surface. The model can add, remove, move,
rename, resize and re-rest exercises, repoint a weekday, and nudge the wave.
It **cannot** write to `lifts` — there is no operation for it. Proposals are
stored in `ai_proposals` with a full snapshot of the plan, so "deshacer"
restores byte-for-byte rather than replaying inverse edits.

`rebuildProgram` generates a whole season from a brief and carries the
athlete's existing RMs across.

## Layout

```
src/
  app/(auth)/          sign in, sign up, recover
  app/(app)/           the app behind the nav shell
  app/onboarding/      clone a template into a private programme
  components/ui/kit    the Bloques component kit
  lib/engine/          the weight engine and running maths (pure, tested)
  lib/domain/          calendar and plan resolution (pure)
  lib/data/            request-scoped loaders
  lib/actions/         server actions — the only writers
  lib/ai/              prompt, schema, Gemini client
supabase/migrations/   schema, RLS, reference data
docs/DESIGN.md         the visual spec
```

## Commands

```bash
npm run dev        # dev server
npm run check      # typecheck + lint + tests
npm run db:reset   # rebuild the local database from migrations
npm run db:types   # regenerate src/lib/supabase/database.types.ts
```

## Moving to Supabase Cloud

The schema and all reference data ship as migrations, so:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Then point `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` at the cloud project. Enable email confirmation
there and set the redirect URL to `<site>/auth/callback`.
