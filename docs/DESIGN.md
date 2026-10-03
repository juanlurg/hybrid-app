# Bloques — design spec

**The notebook.** Warm paper, clay for strength, slate for running, and one
dark panel per screen for the thing that matters right now — the basic's
weight on Hoy, the rest clock in the runner, adherence on Progreso.
Everything else is a light card floating on a soft warm shadow. The engine's
reasoning folds behind a single line. Light is the designed theme; dark is a
warm mirror of it: the palette flips, and the panel inverts — paper is the one
light thing on a dark screen.

**Plain words by default, the mechanism on demand.** A screen says what the
athlete does and what changed — "80 % de tu RM", "peso congelado", "sin
hacer" — and links to `/motor` for the why. Training vocabulary the athlete
already uses (RM, RIR, Z2, LTHR) stays; the engine's own words (ola, bump,
en espera, phase keys like F2) stay out of Hoy, Semana and the day screens.
One week number per screen: the week of the phase.

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

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#f2e9e3` | `#1c1917` | the paper |
| `surface` | `#fdfaf7` | `#27221f` | cards, sheets, the tab bar |
| `soft` | `#f2e9e3` | `#322c28` | wells inside cards: inputs, number badges, chips |
| `quiet` | `#e7dad1` | `#3a332f` | inert fills: rest days, tracks, sets still to do |
| `panel` / `on-panel` | `#3d3e40` / white | `#f2e9e3` / `#1f1d1b` | the one featured panel per screen — dark on paper, paper on dark |
| `edge` / `line` / `hairline` | `#e7dad1` / `#efe6df` / `#d9c8bc` | | dividers and dashed outlines — cards have no border |
| `ink` / `body` / `mid` / `faint` | `#1f1d1b` / `#4a423c` / `#6b6058` / `#75685f` | | title, prose, secondary, tertiary |
| `ghost` | `#b9a597` | `#6e625a` | decoration only, never information |
| `strength` / `on-strength` | `#c25e33` / white | same | the clay **fill**: actions, today, done sets |
| `clay` | `#b4522b` | `#e8936b` | clay as **ink**: eyebrows, active labels, records |
| `clay-soft` / `clay-edge` / `clay-dim` | `#fbefe8` / `#efc3ae` / `#92411f` | | today's row, partial cells, frozen-weight ink |
| `run` / `run-soft` / `run-mist` | `#3f6e86` / `#e3ecf0` / `#a9c3cf` | | **carrera** — slate; Z2 / tiles / Z1 |
| `ok` / `ok-soft` | `#4e7a52` / `#e7efe4` | | done |
| `warn` / `warn-soft` / `warn-dot` | `#92411f` / `#fdf0dc` / `#e88c22` | | partial, engine hold |
| `fail` / `fail-soft` | `#b23a2b` / `#f8e3df` | | skipped, below range, RM cut |
| `panel-soft` / `panel-well` / `panel-line` | white 70 % / 8 % / 10 % | `#4a423c` / `#e7dad1` / ink 8 % | secondary text, chips and dividers **on** the panel |
| `clay-panel` / `warn-panel` / `fail-panel` / `ok-panel` | `#e39b78` / `#f8c07a` / `#f0a08f` / `#8dbf8f` | `#b4522b` / `#92411f` / `#b23a2b` / `#4e7a52` | eyebrows and figures **on** the panel |

Accents by session group live in `src/components/day-accents.ts` — always use
`accentFor(group)`; the glyph for a kind of day is `DayIcon`.

## Type

Plus Jakarta Sans, 400–800, everywhere (`font-sans` and `font-display` are the
same face). Weight carries hierarchy; uppercase is for eyebrows only.

| Role | Class |
|---|---|
| Eyebrow | `text-[11px] font-bold tracking-[0.13em] uppercase text-clay` |
| Screen title | `text-[32px]–[34px] leading-[1.1] font-extrabold tracking-[-0.02em]` |
| Section label | `text-[17px] font-extrabold tracking-[-0.01em]` + 13px `mid` note on the right |
| Hero number | `num text-[88px]–[96px] leading-[0.9] font-extrabold tracking-[-0.04em]` |
| KPI number | `num text-[26px] leading-none font-extrabold` |
| Row title | `text-[15px] leading-[1.25] font-bold` |
| Row subtitle | `text-[12.5px] leading-[1.35] font-medium text-mid` |
| Action | `h-14 rounded-xl text-[16px] font-bold`, sentence case, with an icon |

Put `num` on anything numeric — tabular figures. Nothing smaller than 11px.

## Layout idioms

- **Radii**: `sm` 10, `md` 12, `lg` 14, `xl` 18, `2xl` 20, `3xl` 24. Cards
  `rounded-2xl`, hero cards and panels `rounded-3xl`, chips and nav pills
  `rounded-full`.
- **Shadows** (tokens, warm in light): `shadow-card` for cards, `shadow-raised`
  for small floating buttons and tiles, `shadow-panel` for the dark panel,
  `shadow-cta` / `shadow-cta-run` under the primary action, `shadow-float` for
  the tab bar and sheets.
- **Card**: `rounded-3xl bg-surface shadow-card`, no border. `Card` in the kit.
- **Panel**: `bg-panel text-on-panel shadow-panel rounded-3xl`, a `clay-panel`
  eyebrow, the hero number in `on-panel`, `panel-well` chips, a `panel-line` divider and
  one line of engine reasoning. `Callout` is the text-only variant.
- **Note**: a card with a tinted 36px icon tile, a bold line and one sentence —
  frozen weight, deload, missed session. `Note` in the kit.
- **Row stacks**: `RowStack` is one card with `p-1.5`; each `Row` inside is a
  padded `rounded-lg` hit area. Lists of days and exercises lead with a 36px
  icon tile or a numbered badge.
- **Steppers**: one `bg-soft` pill, − / + icons either side of the figure.
- **Action**: pinned at the bottom, `px-4`, 56px (64px in the runner), clay with
  `shadow-cta`; a white secondary ("Hoy no entreno", "Otras", "Saltar") sits
  beside it.
- **Tab bar**: floating, `inset-x-4 bottom-4`, 68px, icon in a 46×30 pill that
  fills clay when active. Hidden in the runner.
- **Sheet**: the runner's "Otras" and session list rise from the bottom over a
  scrim; tapping the scrim closes them.
- **Language**: Spanish, sentence case, decimal comma (`formatWeight`).

## Copy voice

Direct, second person, no exclamation marks, no emoji. State the mechanism, not
the encouragement: *"Se repite 127,5 kg en la próxima sesión. Otro fallo y la RM
baja un 5 %."* — never *"¡Buen trabajo!"*.

## Screen inventory

Four tabs, one question each — **Hoy** (what now) · **Semana** (what's
coming) · **Progreso** (how am I doing) · **Plan** (how it's built). Every
other screen belongs to one of them and keeps that tab lit (`PRIMARY.owns`
in `app-shell.tsx`); pushed screens carry a `TopBar` back arrow. The desktop
rail adds Plan's own screens under it. A day looks the same wherever it is
opened: `StrengthDay` renders Hoy's session and `/fuerza/[fecha]` alike.

| Route | Tab | Screen |
|---|---|---|
| `/` | Hoy | Today's session, week strip, what to recover, big weight, start bar |
| `/movilidad` | Hoy | Guided / list mobility block |
| `/sesion/[id]` | — | Live runner — set pills, weight stepper, rest timer, regression banner |
| `/sesion/[id]/resumen` | — | Summary — KPIs and which weights changed |
| `/semana` | Semana | The 7 days + season phase bar |
| `/fuerza/[fecha]` | Semana | A strength day by date; train or skip it within its week |
| `/carrera/[fecha]` | Semana | Run blocks, zone ruler, watch data, mark done, skip |
| `/progreso` | Progreso | Adherence, records, the log, running trend (Pa:HR, km) |
| `/programa` | Plan | Phases and what each is for, links, RMs, calculadora |
| `/editor` | Plan | Semana tipo — weekly template editor + AI refinement |
| `/motor` | Plan | Where each weight comes from, season projection, regression rule, engine timeline |
| `/ajustes` | Plan | Every knob, grouped; the engine's folded |
| `/generar` | Plan | AI program builder — brief in, preview, explicit activation |

`/historial` redirects to `/progreso`, and `/progreso?lift=` to `/motor`.
`scripts/walkthrough.ts` holds each screen to a density budget — controls and
words in the first viewport. A change that adds to a screen takes something
away or raises its budget in the same diff.

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
   once its week ends — inside the current week any day can be trained
   early or late from `/fuerza/[fecha]`, and the session fulfils its plan
   day (`scheduled_on`; the real timing lives in `started_at`/`completed_at`).
   Training before the season starts files under the real date and marks
   no plan day. Moving the season is a bulk shift (`shift_program`,
   Ajustes → Zona de peligro): phases move together, logged sessions keep
   their real dates, the race does not move.
6. **The engine speaks phase-local weeks.** Every phase starts at wave[0]
   with its own progression (`program_phases.progression_mode`): F2 waves,
   F3/F4 hold a fixed %RM. A wave step can carry the basic's rep range
   (`wave_reps`, read through `repRangeFor`): F2's 85 % week is 4×3-4, so
   a 4 there is not a miss. Never feed `absoluteWeek` to the engine.
7. **One write path for the session.** The runner writes to the local
   queue (IndexedDB) and `/api/sync` replays the engine idempotently
   (`engine_events.dedup_key`). No per-set server actions — ever again.
8. **The export is the backup.** Free tier, no snapshots: the JSON from
   Ajustes → Datos is the only copy of the only irreplaceable thing.
   `scripts/restore.ts` replays it into a fresh project (catalogue ids
   re-linked by slug); Ajustes shows the age of the last copy and warns
   past 14 days; a daily `vercel.json` cron pings `/api/keepalive` so
   the free project never pauses for inactivity (holidays, layoffs).
