# Bloques — design spec

**Foco.** One thing is lit per screen — the lime number — and everything else
recedes into cards on the page colour. The engine's reasoning folds behind a
single line. Dark and light are peers: the palette flips, the hierarchy does not.

## Themes

Light lives on `:root`, dark on `[data-theme="dark"]`. `THEME_SCRIPT` (from
`src/lib/theme.ts`, inlined at the top of the body) resolves the athlete's
preference against `prefers-color-scheme` and stamps `data-theme` before the
first paint, so the CSS only ever knows two themes. `ThemeToggle` in Ajustes
writes the override to `localStorage`; "sistema" removes the key.

## Palette (Tailwind tokens, defined in `src/app/globals.css`)

Every token is a CSS custom property, so inline styles follow the theme too —
use `var(--…)`, never a literal. `@theme inline` is what keeps the utilities
pointing at the variable instead of copying its value at build time.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#0f1210` | `#f2f4ef` | the page |
| `surface` | `#171b18` | `#ffffff` | cards and rows |
| `soft` | `#22271f` | `#eef2e8` | chips, wells, tracks inside cards |
| `sunk` | `#131711` | `#f7f9f3` | today / expanded row |
| `chrome` | `#131714` | `#ffffff` | desktop rail, mobile tab bar |
| `panel` / `on-panel` | `#171b18` | `#171b16` | the engine's box — light inverts, dark just cards |
| `edge` | `#262b27` | `#dde3da` | card border |
| `line` | `#232824` | `#e2e7df` | row border, dividers |
| `hairline` | `#3a403b` | `#cfd8ca` | dashed borders, inert spines |
| `ink` | `#eef2ec` | `#171b16` | primary text |
| `mid` | `#9aa39b` | `#5f6a60` | secondary text |
| `faint` / `ghost` | `#5d665e` | `#98a299` | tertiary text |
| `strength` / `on-strength` | `#b8ee3c` | `#b8ee3c` | the lime **fill** — same in both themes |
| `lime` | `#b8ee3c` | `#4c7d1a` | lime as **ink**: eyebrows, hero numbers |
| `lime-line` | `#b8ee3c` | `#6cb520` | lime as a **stroke**: spines, progress, selection |
| `lime-soft` / `lime-edge` | `#1c2b12` | `#e9f5d6` | the "done" pill, the active rail item |
| `lime-dim` | `#7fa14a` | `#6f994a` | lime turned down — a sub-label beside a lime figure (`/15`, `EPLEY`) |
| `run` | `#6fd3e8` | `#1f7f96` | **carrera** — the cyan |
| `quiet` | `#2b302c` | `#dde3d2` | mobility accent, inert chips |
| `ok` / `ok-bright` | = `lime` / `lime-line` | | done, rest timer |
| `warn` | `#e8c65a` | `#8a5d00` | partial, engine hold |
| `fail` | `#f08a7a` | `#b4382a` | skipped, RM cut |
| `tint` | `#241f14` | `#f8f1e2` | "touched by AI" wash |
| `ink-2` / `ink-3` | fixed | fixed | tracks and inactive text **inside** a panel |

`strength` is the lit surface and never moves; `lime` is that same green used as
ink, which light has to darken to stay legible. Text on a `strength` fill is
always `on-strength`. Accents by session group live in
`src/components/day-accents.ts` — always use `accentFor(group)`.

## Type

Chakra Petch (`font-display`, 500/600/700) carries labels, actions and numbers.
Barlow (`font-sans`, 400–700) carries prose and is the body default. Neither
face ships 800 or 900, so `font-extrabold` and `font-black` are banned — the
browser would fake them.

| Role | Class |
|---|---|
| Section label | `font-display text-[12px] font-semibold tracking-[0.12em] text-mid uppercase` |
| Header eyebrow | `font-display text-[12px] font-semibold tracking-[0.12em] uppercase` |
| Card eyebrow | `font-display text-[11px] font-semibold tracking-[0.14em] text-lime uppercase` |
| Screen title | `font-display text-[26px] leading-[1.1] font-bold` |
| Hero number | `num text-[88px] sm:text-[108px] leading-[0.95] font-bold tracking-[-0.02em] text-lime` |
| KPI number | `num text-[28px] leading-none font-bold tracking-[-0.02em]` |
| Row title | `text-[15px] leading-[1.2] font-semibold` |
| Row subtitle | `text-[12.5px] leading-[1.35] text-mid` |
| Right-hand figure | `num text-[14px] font-semibold` |
| Action | `font-display h-15 rounded-xl text-[16px] font-bold tracking-[0.06em] uppercase` |

Put `num` on anything numeric — it turns on tabular figures **and** the display
face. That one class is what makes numbers read as Chakra Petch app-wide.

## Layout idioms

- **Radii**: `sm` 8, `md` 10, `lg` 12, `xl` 14, `2xl` 18, `3xl` 22. Cards are
  `rounded-2xl`, rows `rounded-lg`/`rounded-xl`, chips `rounded-sm`, actions
  `rounded-xl`. Nothing is square any more, and nothing has a shadow.
- **Header**: on the page, no band. Eyebrow + title + subtitle. `ScreenHeader`.
- **Card**: `rounded-2xl border border-edge bg-surface`. `Card` in the kit. The
  lit card carries a lime eyebrow, the hero number, `Tag` chips for the
  prescription, then a divider and one line of engine reasoning.
- **Row stacks**: `RowStack` is a `gap-1.5` column; each `Row` is its own
  bordered rounded surface. The page shows through the gap.
- **Grouped list card**: one card, internal dividers — `<Card className="divide-y
  divide-line px-4 py-1">` with plain `py-[11px]` rows inside. Ajustes' groups,
  Editar's exercise list, the engine breakdown. Use `divide-y`, not hand-rolled
  borders. A `SectionLabel` sits above it.
- **Coloured spine**: `<div className="h-8 w-[3px] rounded-full" style={{background: accent}} />`
  at the left of a row. `SessionRow` does this.
- **Steppers**: `−` / value / `+`, 32px `rounded-sm border-edge bg-surface`.
- **Chips**: `rounded-sm border-edge bg-soft`, filled `bg-strength
  text-on-strength` when active. `Tag` is the read-only variant.
- **Action**: inset `px-5`, 60px, `rounded-xl`, lime. Pinned at the bottom.
- **Callout**: `bg-panel text-on-panel`, coloured eyebrow. The engine speaking —
  a dark box in the light theme, an ordinary card in the dark one.
- **Language**: Spanish, lower-case sentences, decimal comma (`formatWeight`).

## Copy voice

Direct, second person, no exclamation marks, no emoji. State the mechanism, not
the encouragement: *"Se repite 127,5 kg en la próxima sesión. Otro fallo y la RM
baja un 5 %."* — never *"¡Buen trabajo!"*.

## Screen inventory

Bottom nav (mobile): **Hoy · Semana · Progreso · Programa**.
Desktop rail adds **Historial · Editar · Ajustes**; on mobile they hang off
Programa via `SecondaryNav` — three pills, the active one filled lime, rendered
on Programa, Historial, Editar and Ajustes.

| Route | Screen |
|---|---|
| `/` | Hoy — today's session, big weight, start bar |
| `/sesion/[id]` | Live runner — set pills, weight stepper, rest timer, regression banner |
| `/sesion/[id]/resumen` | Summary — KPIs and what the engine changed |
| `/semana` | The 7 days + season phase bar |
| `/progreso` | Per-lift chart, engine breakdown, Pa:HR |
| `/programa` | RMs, calculadora de RM (Epley), regression rule |
| `/carrera/[fecha]` | Run blocks, HR zones, mark done |
| `/fuerza/[fecha]` | Strength day read-only, any date + within-week catch-up |
| `/movilidad` | Guided / list mobility block |
| `/historial` | Consistency grid, records, log, engine timeline |
| `/editor` | Weekly template editor + AI refinement |
| `/generar` | AI program builder — brief in, preview, explicit activation |
| `/ajustes` | Every knob, grouped |

Session notifications are client-side only: one tray card per session
(`tag`), the rest line carries an absolute end time so a frozen tab still
tells the truth; no push server, no background countdown, iOS only as an
installed PWA.

## Non-negotiables

1. **Only the engine invents weights.** UI reads `ResolvedExercise.weightKg`.
   Never compute a load in a component. The athlete may still log a
   different one: the runner's stepper moves it with `nextLoadableWeight()`
   and the load travels with the set (`set_logs.weight_kg`), so the
   regression holds at the weight actually missed — and only a clean
   session at (or above) the held weight releases the hold.
2. **Only the basic of the day moves the engine.** Accessories never trigger
   a regression — say so in the UI where it matters.
3. **The AI proposes, the athlete disposes.** Changes are a diff to tick.
   The AI never edits `lifts`. It picks exercises from the catalogue by
   slug — it never invents a name.
4. **Every engine action is undoable and logged** in `engine_events`.
5. **The calendar rules.** The plan lives on dates; a missed day is lost
   once its week ends — inside the current week it can still be trained
   late from `/fuerza/[fecha]`, and the late session fulfils its plan day
   (`scheduled_on`; the real timing lives in `started_at`/`completed_at`).
   Training before the season starts files under the real date and marks
   no plan day. Moving the season is a bulk shift (`shift_program`,
   Ajustes → Zona de peligro): phases move together, logged sessions keep
   their real dates, the race does not move.
6. **The engine speaks phase-local weeks.** Every phase starts at wave[0]
   with its own progression (`program_phases.progression_mode`): F2 waves,
   F3/F4 hold a fixed %RM. Never feed `absoluteWeek` to the engine.
7. **One write path for the session.** The runner writes to the local
   queue (IndexedDB) and `/api/sync` replays the engine idempotently
   (`engine_events.dedup_key`). No per-set server actions — ever again.
8. **The export is the backup.** Free tier, no snapshots: the JSON from
   Ajustes → Datos is the only copy of the only irreplaceable thing.
   `scripts/restore.ts` replays it into a fresh project (catalogue ids
   re-linked by slug); Ajustes shows the age of the last copy and warns
   past 14 days; a daily `vercel.json` cron pings `/api/keepalive` so
   the free project never pauses for inactivity (holidays, layoffs).
