# Bloques — design spec

Swiss sport poster. Full-bleed colour panels, heavy type, hard 2px rules,
**no border radius, no shadows, no gradients**. Session type readable from a
metre away.

## Palette (Tailwind tokens, defined in `src/app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `ink` | `#111110` | headers, bars, text |
| `paper` | `#ecebe6` | page background, rows |
| `mid` | `#6e6d67` | secondary text |
| `faint` | `#8e8c85` | tertiary text, footnotes |
| `line` | `#d7d5cd` | the 1px gap between rows (as a background) |
| `quiet` | `#c9c6bc` | mobility accent, inert chips |
| `soft` | `#e0ded7` | rest accent, stepper wells |
| `hairline` | `#b6b3aa` | dashed borders, off knobs |
| `ghost` | `#a9a7a0` | disabled text |
| `ink-2` | `#2c2c29` | tracks inside black panels |
| `ink-3` | `#7d7c76` | inactive nav text |
| `sunk` | `#e4e2db` | expanded row background |
| `strength` | `oklch(0.62 0.19 32)` | **fuerza** — the orange |
| `run` | `oklch(0.62 0.19 250)` | **carrera** — the blue |
| `ok` | `oklch(0.55 0.14 145)` | done |
| `ok-bright` | `oklch(0.72 0.19 130)` | rest timer, registered |
| `warn` | `oklch(0.72 0.16 75)` | partial, engine hold |
| `fail` | `oklch(0.55 0.21 25)` | skipped, RM cut |
| `tint` | `#f2e6cf` | "touched by AI" wash |

Accents by session group live in `src/components/day-accents.ts` — always use
`accentFor(group)`, never a literal.

## Type scale (Archivo, `font-display`)

| Role | Class |
|---|---|
| Section label | `text-[10px] font-extrabold tracking-[0.14em] text-mid uppercase` |
| Header eyebrow | `text-[11px] font-extrabold tracking-[0.14em] uppercase` |
| Screen title | `text-[26px] leading-[1.02] font-black tracking-[-0.03em]` |
| Panel headline | `text-[31px] leading-[1.02] font-black tracking-[-0.03em]` |
| Hero number | `text-[86px] sm:text-[106px] leading-[0.76] font-black tracking-[-0.055em]` |
| KPI number | `text-[30px] leading-none font-black tracking-[-0.035em]` |
| Row title | `text-[13.5px] leading-[1.2] font-bold` |
| Row subtitle | `text-[11px] leading-[1.35] text-mid` |
| Right-hand figure | `text-[12.5px] font-extrabold` + `num` |
| Action bar | `h-16 text-[16px] font-extrabold tracking-[0.1em] uppercase` |

Put `num` on anything numeric — it turns on tabular figures.

## Layout idioms

- **Header**: black band, eyebrow + title + subtitle. `ScreenHeader` in the kit.
- **Hairline stacks**: `flex flex-col gap-px bg-line`, children `bg-paper`. The
  background shows through the gap — that *is* the rule. `RowStack` + `Row`.
- **Coloured spine**: `<div className="h-9 w-1.5" style={{background: accent}} />`
  at the left of a row. `SessionRow` does this.
- **Steppers**: `−` / value / `+`, 32px black squares with a `bg-soft` well.
- **Chips**: `border-2 border-ink`, filled `bg-ink text-paper` when active.
- **Segmented tabs**: flush, `gap-px bg-line`, active is `bg-ink text-paper`.
- **Action bar**: full-bleed, 64px, pinned at the bottom of the screen.
- **Callout**: black box, coloured eyebrow. This is the engine speaking.
- **Language**: Spanish, lower-case sentences, decimal comma (`formatWeight`).

## Copy voice

Direct, second person, no exclamation marks, no emoji. State the mechanism, not
the encouragement: *"Se repite 127,5 kg en la próxima sesión. Otro fallo y la RM
baja un 5 %."* — never *"¡Buen trabajo!"*.

## Screen inventory

Bottom nav (mobile): **Hoy · Semana · Progreso · Programa**.
Desktop rail adds **Historial · Editar · Ajustes**; on mobile they hang off
Programa via `SecondaryNav`.

| Route | Screen |
|---|---|
| `/` | Hoy — today's session, big weight, start bar |
| `/sesion/[id]` | Live runner — set pills, rest timer, regression banner |
| `/sesion/[id]/resumen` | Summary — KPIs and what the engine changed |
| `/semana` | The 7 days + season phase bar |
| `/progreso` | Per-lift chart, engine breakdown, Pa:HR |
| `/programa` | RMs, calculadora de RM (Epley), regression rule, engine parameters |
| `/carrera/[fecha]` | Run blocks, HR zones, mark done |
| `/movilidad` | Guided / list mobility block |
| `/historial` | Consistency grid, records, log, engine timeline |
| `/editor` | Weekly template editor + AI refinement |
| `/generar` | AI program builder — brief in, preview, explicit activation |
| `/ajustes` | Every knob, grouped |

## Non-negotiables

1. **Only the engine invents weights.** UI reads `ResolvedExercise.weightKg`.
   Never compute a load in a component.
2. **Only the basic of the day moves the engine.** Accessories never trigger
   a regression — say so in the UI where it matters.
3. **The AI proposes, the athlete disposes.** Changes are a diff to tick.
   The AI never edits `lifts`. It picks exercises from the catalogue by
   slug — it never invents a name.
4. **Every engine action is undoable and logged** in `engine_events`.
5. **The calendar rules.** The plan lives on dates; a missed day is lost,
   never re-queued. Moving the season is a bulk shift (`shift_program`,
   Ajustes → Datos): phases move together, logged sessions keep their real
   dates, the race does not move.
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
   the free project never pauses for inactivity (the Camino weeks).
