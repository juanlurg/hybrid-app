"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { SecondaryNav } from "@/components/app-shell";
import {
  Card,
  Chip,
  RowStack,
  RuleNote,
  SectionLabel,
  Stepper,
} from "@/components/ui/kit";
import { accentFor, TONE } from "@/components/day-accents";
import { cn } from "@/lib/cn";
import { DAY_INITIALS } from "@/lib/domain/calendar";
import type { SessionGroup } from "@/lib/domain/plan";
import {
  addExercise,
  deleteExercise,
  moveExercise,
  setDaySlot,
  setExerciseSets,
  setWaveStep,
  updateExercise,
} from "@/lib/actions/program";
import type { ProposalView } from "@/lib/actions/ai";

import { AiPanel, type ThreadMessage } from "./ai-panel";
import type { EditorWarning } from "./page";

interface DayView {
  dayIndex: number;
  dayLabel: string;
  slotId: string | null;
  title: string;
  subtitle: string;
  group: SessionGroup;
  load: string;
  minutes: number;
}

interface SlotView {
  id: string;
  key: string;
  label: string;
  title: string;
  group: SessionGroup;
}

interface ExerciseView {
  id: string;
  slotId: string;
  name: string;
  tag: string;
  sets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  isPrimary: boolean;
}

export interface CatalogEntry {
  id: string;
  name: string;
  equipment: string;
  pattern: string | null;
}

const ICON_BUTTON =
  "flex h-8 w-8 flex-none items-center justify-center rounded-sm border border-edge bg-soft text-[13px] leading-none font-semibold text-mid disabled:opacity-30";

/** The right-hand line of a day row: what the day costs, not what it is. */
function metaFor(day: DayView): string {
  if (day.group === "rest") return "";
  if (day.group === "mobility" && day.minutes) {
    return `${day.load} · ${day.minutes}′`;
  }
  return day.load;
}

export function ProgramEditor({
  phase,
  week,
  isDeload,
  waveIndex,
  wave,
  waveScope,
  pctOfRm,
  days,
  slots,
  exercises,
  catalog,
  warnings,
  hasApiKey,
  thread,
  pendingProposal,
  lastApplied,
  appliedTotal,
}: {
  phase: { id: string; key: string; name: string; weeks: number };
  week: number;
  absoluteWeek: number;
  isDeload: boolean;
  waveIndex: number;
  wave: number[];
  /** Which wave the steppers edit — or none at all in a fixed-% phase. */
  waveScope: "phase" | "program" | "fixed";
  pctOfRm: number | null;
  days: DayView[];
  slots: SlotView[];
  exercises: ExerciseView[];
  /** Global catalogue, already filtered by the athlete's equipment. */
  catalog: CatalogEntry[];
  warnings: EditorWarning[];
  hasApiKey: boolean;
  thread: { id: string | null; messages: ThreadMessage[] };
  pendingProposal: ProposalView | null;
  lastApplied: { id: string; count: number } | null;
  appliedTotal: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The day list is the selector: one day is open below it at a time.
  const [selected, setSelected] = useState(() => {
    const i = days.findIndex((d) => d.slotId);
    return i === -1 ? 0 : i;
  });
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const day = days[selected] ?? days[0];
  /* A strength slot that no day points at is still real and still
     editable — reassigning a day is enough to strand one. */
  const orphanSlots = slots.filter(
    (s) => s.group === "strength" && !days.some((d) => d.slotId === s.id),
  );
  const [orphanSlotId, setOrphanSlotId] = useState<string | null>(null);
  const activeSlotId = orphanSlotId ?? day.slotId;
  const slot = slots.find((s) => s.id === activeSlotId) ?? null;
  const slotExercises = exercises.filter((e) => e.slotId === activeSlotId);
  // Only strength slots keep their prescription in `program_exercises`;
  // a run day's structure is not editable from here.
  const editableSlot = slot?.group === "strength" ? slot : null;

  /** Names touched by the pending proposal get the tint + a diff line. */
  const pendingByExercise = new Map<
    string,
    { from: string; to: string; title: string }
  >();
  for (const c of pendingProposal?.changes ?? []) {
    if (c.exerciseId) {
      pendingByExercise.set(c.exerciseId, {
        from: c.from,
        to: c.to,
        title: c.title,
      });
    }
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "No se ha podido guardar.");
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  const heading = editableSlot
    ? `${editableSlot.label} · ${slotExercises.length} ${slotExercises.length === 1 ? "ejercicio" : "ejercicios"}`
    : slot
      ? `${slot.label} · ${day.subtitle || day.load}`
      : `${day.title} · sin sesión`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none px-5 pt-6">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display min-w-0 flex-1 text-[22px] leading-[1.15] font-bold">
            Plantilla semanal
          </h1>
          <span className="num flex-none text-[11px] leading-none text-faint">
            {phase.key} · SEM {week}/{phase.weeks}
          </span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-[1.45] text-mid">
          {slot
            ? `Editar ${slot.label} la cambia en toda la fase.`
            : "Editar una sesión la cambia en toda la fase."}
        </p>
      </header>

      <SecondaryNav />

      <div className="min-h-0 flex-1 overflow-auto pb-6">
        {error ? (
          <div className="mx-5 mt-3 rounded-r-sm border-l-[4px] border-fail py-1 pl-3 text-[12.5px] leading-[1.5]">
            {error}
          </div>
        ) : null}

        <RowStack className="gap-[5px] pt-3.5">
          {days.map((d, i) => {
            const rest = d.group === "rest";
            const active = i === selected;
            const meta = metaFor(d);
            return (
              <button
                key={d.dayIndex}
                type="button"
                // The letter is a glyph; the day name is what gets read.
                aria-label={`${d.dayLabel} · ${d.title}`}
                aria-pressed={active}
                onClick={() => {
                  setSelected(i);
                  setOrphanSlotId(null);
                  setEditing(false);
                  setAddOpen(false);
                }}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left",
                  rest
                    ? "border-dashed border-hairline opacity-60"
                    : "border-line bg-surface",
                  // Selected is sunk, not lit: the card below is the lit thing.
                  active && "bg-sunk opacity-100",
                )}
              >
                <span
                  className={cn(
                    "font-display w-[22px] flex-none text-[11px] leading-none font-bold",
                    d.group === "mobility" && "text-mid",
                    rest && "text-faint",
                  )}
                  style={
                    d.group === "strength" || d.group === "run"
                      ? { color: accentFor(d.group) }
                      : undefined
                  }
                >
                  {DAY_INITIALS[d.dayIndex]}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13.5px] leading-[1.3] font-medium",
                    rest && "text-mid",
                  )}
                >
                  {d.title}
                </span>
                {meta ? (
                  <span className="max-w-[46%] flex-none truncate text-[12px] leading-[1.2] text-faint">
                    {meta}
                  </span>
                ) : null}
                <span
                  aria-hidden
                  className="flex-none text-[13px] leading-none text-faint"
                >
                  ›
                </span>
              </button>
            );
          })}
        </RowStack>

        {orphanSlots.length > 0 ? (
          <>
            <SectionLabel>Sin día asignado</SectionLabel>
            <RowStack className="gap-[5px] pt-2.5">
              {orphanSlots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={orphanSlotId === s.id}
                  onClick={() => {
                    setOrphanSlotId(s.id);
                    setEditing(false);
                    setAddOpen(false);
                  }}
                  className={cn(
                    "flex min-h-11 items-center gap-2.5 rounded-lg border border-dashed border-hairline px-3.5 py-2.5 text-left",
                    orphanSlotId === s.id && "bg-sunk",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[13.5px] leading-[1.3] font-medium">
                    {s.label}
                  </span>
                  <span
                    aria-hidden
                    className="flex-none text-[13px] leading-none text-faint"
                  >
                    ›
                  </span>
                </button>
              ))}
            </RowStack>
          </>
        ) : null}

        <div className="mt-3.5 px-5">
          <Card className="px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="font-display min-w-0 flex-1 truncate text-[12px] leading-none font-semibold tracking-[0.1em] uppercase">
                {heading}
              </span>
              <button
                type="button"
                aria-expanded={editing}
                onClick={() => {
                  setEditing((v) => !v);
                  setAddOpen(false);
                }}
                className="-my-3 flex h-11 flex-none items-center text-[11px] leading-none text-faint"
              >
                {editing ? "listo ›" : "editar ›"}
              </button>
            </div>

            {editing ? (
              <div className="mt-3">
                <div className="font-display text-[9.5px] leading-none font-semibold tracking-[0.1em] text-faint uppercase">
                  Sesión de este día
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {slots.map((s) => (
                    <Chip
                      key={s.id}
                      active={s.id === day.slotId}
                      disabled={pending}
                      onClick={() =>
                        run(() => setDaySlot(phase.id, day.dayIndex, s.id))
                      }
                    >
                      {s.label}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : null}

            {slotExercises.length > 0 ? (
              <div className="mt-2.5 divide-y divide-line">
                {slotExercises.map((e, i) => {
                  const diff = pendingByExercise.get(e.id);
                  return (
                    <div key={e.id} className={editing ? "py-2.5" : "py-2"}>
                      <div
                        className={cn(
                          "flex items-center gap-2.5",
                          diff && "-mx-2 rounded-sm bg-tint px-2 py-1",
                        )}
                      >
                        <span className="min-w-0 flex-1 text-[13px] leading-[1.35] font-medium">
                          {e.name}
                          {e.isPrimary ? (
                            <span className="font-display ml-1 rounded-[5px] bg-lime-soft px-1.5 py-0.5 text-[9px] font-bold text-lime-dim">
                              BÁSICO
                            </span>
                          ) : null}
                        </span>
                        {editing ? (
                          <div className="flex flex-none items-center gap-1">
                            <button
                              type="button"
                              aria-label="Subir"
                              disabled={i === 0 || pending}
                              onClick={() => run(() => moveExercise(e.id, -1))}
                              className={ICON_BUTTON}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label="Bajar"
                              disabled={
                                i === slotExercises.length - 1 || pending
                              }
                              onClick={() => run(() => moveExercise(e.id, 1))}
                              className={ICON_BUTTON}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              aria-label={`Quitar ${e.name}`}
                              disabled={e.isPrimary || pending}
                              onClick={() => run(() => deleteExercise(e.id))}
                              className={ICON_BUTTON}
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <span className="font-display flex-none text-[12px] leading-none text-mid">
                            {schemeOf(e)}
                          </span>
                        )}
                      </div>

                      {editing ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="font-display text-[9.5px] leading-none font-semibold tracking-[0.1em] text-faint uppercase">
                            Series
                          </span>
                          <Stepper
                            compact
                            label="series"
                            value={e.sets}
                            onDecrement={() =>
                              run(() => setExerciseSets(e.id, -1))
                            }
                            onIncrement={() =>
                              run(() => setExerciseSets(e.id, 1))
                            }
                          />
                          <span className="font-display text-[9.5px] leading-none font-semibold tracking-[0.1em] text-faint uppercase">
                            Reps
                          </span>
                          <Stepper
                            compact
                            label="mínimo de reps"
                            value={e.repMin}
                            onDecrement={() =>
                              run(() =>
                                updateExercise(e.id, {
                                  repMin: Math.max(1, e.repMin - 1),
                                }),
                              )
                            }
                            onIncrement={() =>
                              run(() =>
                                updateExercise(e.id, {
                                  repMin: Math.min(e.repMax, e.repMin + 1),
                                }),
                              )
                            }
                          />
                          <Stepper
                            compact
                            label="máximo de reps"
                            value={e.repMax}
                            onDecrement={() =>
                              run(() =>
                                updateExercise(e.id, {
                                  repMax: Math.max(e.repMin, e.repMax - 1),
                                }),
                              )
                            }
                            onIncrement={() =>
                              run(() =>
                                updateExercise(e.id, { repMax: e.repMax + 1 }),
                              )
                            }
                          />
                          <span className="font-display text-[9.5px] leading-none font-semibold tracking-[0.1em] text-faint uppercase">
                            Desc.
                          </span>
                          <Stepper
                            compact
                            label="descanso"
                            value={formatRest(e.restSeconds)}
                            onDecrement={() =>
                              run(() =>
                                updateExercise(e.id, {
                                  restSeconds: Math.max(0, e.restSeconds - 15),
                                }),
                              )
                            }
                            onIncrement={() =>
                              run(() =>
                                updateExercise(e.id, {
                                  restSeconds: e.restSeconds + 15,
                                }),
                              )
                            }
                          />
                        </div>
                      ) : null}

                      {diff ? (
                        <div className="mt-2 flex items-center gap-2 text-[10.5px] leading-none font-semibold">
                          <span className="font-display text-[9px] font-semibold tracking-[0.1em] text-lime">
                            IA
                          </span>
                          <span className="text-faint line-through">
                            {diff.from}
                          </span>
                          <span className="text-faint">→</span>
                          <span>{diff.to}</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2.5 text-[12.5px] leading-[1.5] text-mid">
                {slot
                  ? day.subtitle || day.load
                  : "Este día no tiene sesión asignada. Elige una en «editar»."}
              </p>
            )}

            {editing && editableSlot ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setAddOpen((v) => !v)}
                  className="font-display mt-3 block h-11 w-full rounded-md border border-dashed border-hairline text-center text-[11.5px] leading-none font-bold tracking-[0.08em] text-mid uppercase"
                >
                  + Añadir ejercicio
                </button>

                {addOpen ? (
                  <div className="mt-2 rounded-lg border border-edge bg-soft p-1.5">
                    <div className="font-display px-2 py-2 text-[10px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
                      Del catálogo · según tu material
                    </div>
                    <div className="flex max-h-64 flex-col gap-1 overflow-auto">
                      {catalog.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setAddOpen(false);
                            run(() =>
                              addExercise(editableSlot.id, {
                                exerciseId: c.id,
                                name: c.name,
                              }),
                            );
                          }}
                          className="flex min-h-11 items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-left"
                        >
                          <span className="min-w-0 flex-1 text-[13px] leading-[1.3] font-medium">
                            {c.name}
                          </span>
                          <span className="font-display flex-none text-[9.5px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                            {c.pattern ?? c.equipment}
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setAddOpen(false);
                          run(() => addExercise(editableSlot.id));
                        }}
                        className="min-h-11 rounded-md border border-line bg-surface px-3 py-2.5 text-left text-[13px] leading-[1.3] font-medium text-mid"
                      >
                        Ejercicio libre…
                      </button>
                    </div>
                  </div>
                ) : null}

                <p className="mt-3 text-[11.5px] leading-[1.5] text-faint">
                  El básico del día manda: su rango de reps es lo que dispara la
                  regla de regresión. Los accesorios no tocan el motor de pesos.
                </p>
              </>
            ) : null}
          </Card>
        </div>

        {warnings.length > 0 ? (
          <div className="flex flex-col gap-3.5 px-5 pt-4">
            {warnings.map((w, i) => (
              <RuleNote
                key={i}
                tone={w.tone === "fail" ? TONE.fail : TONE.warn}
                title={w.title}
              >
                {w.detail}
              </RuleNote>
            ))}
          </div>
        ) : (
          <p className="px-5 pt-4 text-[12.5px] leading-[1.5] text-faint">
            La semana pasa las comprobaciones: hay bloque de movilidad, cada
            sesión de fuerza tiene su básico y no hay pierna pesada pegada a la
            tirada larga.
          </p>
        )}

        <div className="mt-3.5 px-5">
          <AiPanel
            hasApiKey={hasApiKey}
            initialMessages={thread.messages.filter((m) => m.role !== "system")}
            initialThreadId={thread.id}
            initialProposal={pendingProposal}
            lastApplied={lastApplied}
            appliedTotal={appliedTotal}
          />
        </div>

        {/* The motor folded behind a line: it sets every weight on the
            screen above, and is read a tenth as often. */}
        <details className="group mt-3.5">
          <summary className="mx-5 flex min-h-11 list-none items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 [&::-webkit-details-marker]:hidden">
            <span className="font-display min-w-0 flex-1 text-[12px] leading-none font-semibold tracking-[0.1em] uppercase">
              Motor de pesos
            </span>
            <span className="num flex-none text-[12px] leading-none text-faint">
              {waveScope === "fixed"
                ? `${Math.round((pctOfRm ?? 0.8) * 100)} % fijo`
                : `ola ${wave.length} sem · ${Math.round(wave[waveIndex] * 100)} %`}
            </span>
            <span
              aria-hidden
              className="font-display flex-none text-[13px] leading-none text-faint transition-transform group-open:rotate-45"
            >
              ＋
            </span>
          </summary>

          {waveScope === "fixed" ? (
            <Card className="mx-5 mt-2.5 px-4 py-4">
              <div className="num text-[30px] leading-none font-bold tracking-[-0.035em] text-lime">
                {Math.round((pctOfRm ?? 0.8) * 100)} %
              </div>
              <p className="mt-2 text-[12.5px] leading-[1.5] text-mid">
                {phase.key} va a porcentaje fijo de la RM: sin olas, sin bumps y
                sin descargas automáticas. No hay ola que editar en esta fase.
              </p>
            </Card>
          ) : (
            <>
              <SectionLabel>
                Ola de {wave.length} semanas ·{" "}
                {waveScope === "phase"
                  ? `de esta fase (${phase.key})`
                  : "del programa"}
              </SectionLabel>
              <div className="mx-5 mt-3 flex h-[104px] items-end gap-1">
                {wave.map((w, i) => {
                  const max = Math.max(...wave);
                  return (
                    <div
                      key={i}
                      className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                    >
                      <span
                        className={cn(
                          "num text-[11px] leading-none font-bold",
                          i === waveIndex ? "text-lime" : "text-mid",
                        )}
                      >
                        {Math.round(w * 100)} %
                      </span>
                      <div
                        className={cn(
                          "w-full rounded-sm",
                          i === waveIndex ? "bg-strength" : "bg-hairline",
                        )}
                        style={{ height: `${Math.round((w / max) * 100)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mx-5 mt-1 flex gap-1">
                {wave.map((_, i) => (
                  <div key={i} className="flex flex-1 flex-col gap-1">
                    <div className="font-display pt-1.5 pb-1 text-center text-[9.5px] leading-none font-semibold text-faint">
                      S{i + 1}
                      {i === wave.length - 1 ? "·D" : ""}
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label={`Bajar la semana ${i + 1} de la ola`}
                        disabled={pending}
                        onClick={() => run(() => setWaveStep(i, -0.01))}
                        className="flex h-[30px] flex-1 items-center justify-center rounded-sm border border-edge bg-soft text-[15px] leading-none font-bold text-mid disabled:opacity-40"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        aria-label={`Subir la semana ${i + 1} de la ola`}
                        disabled={pending}
                        onClick={() => run(() => setWaveStep(i, 0.01))}
                        className="flex h-[30px] flex-1 items-center justify-center rounded-sm border border-edge bg-soft text-[15px] leading-none font-bold text-mid disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mx-5 mt-3.5 text-[12.5px] leading-[1.5] text-faint">
                La semana {wave.length} es la descarga: mismos pesos al{" "}
                {Math.round(wave[wave.length - 1] * 100)} %, mitad de series.
                Cambiar el pico cambia todos los pesos calculados de ese ciclo
                {waveScope === "phase"
                  ? " — solo en esta fase; las demás siguen con su propia ola."
                  : "."}
                {isDeload ? " Estás en ella ahora mismo." : ""}
              </p>
            </>
          )}

          {/* One home for the engine parameters: Ajustes owns them, and
              this screen keeps only what it can actually edit (the wave).
              The AI cannot touch them either way. */}
          <Link
            href="/ajustes"
            className="mt-2 flex items-center gap-2.5 px-6 py-2"
          >
            <span className="flex-1 text-[13px] leading-[1.4] text-mid">
              Parámetros del motor · se cambian en ajustes
            </span>
            <span aria-hidden className="text-[13px] leading-none text-faint">
              ›
            </span>
          </Link>
        </details>

        <Link
          href="/generar"
          className="mx-5 mt-3.5 flex items-center gap-3 rounded-lg border border-edge bg-surface px-3.5 py-3"
        >
          <span className="h-[30px] w-[30px] flex-none rounded-sm bg-strength" />
          <span className="flex-1">
            <span className="block text-[13.5px] leading-[1.2] font-semibold">
              Generar un programa nuevo
            </span>
            <span className="font-display mt-1 block text-[10px] leading-none font-semibold tracking-[0.08em] text-faint">
              OTRA TEMPORADA, OTRO OBJETIVO · TUS RM SE CONSERVAN
            </span>
          </span>
          <span aria-hidden className="text-[16px] leading-none text-mid">
            →
          </span>
        </Link>
      </div>
    </div>
  );
}

function schemeOf(e: ExerciseView): string {
  const reps = e.repMin === e.repMax ? `${e.repMin}` : `${e.repMin}-${e.repMax}`;
  return `${e.sets} × ${reps} · ${formatRest(e.restSeconds)}`;
}

function formatRest(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}′`;
  if (seconds > 60) return `${Math.floor(seconds / 60)}′${seconds % 60}″`;
  return `${seconds}″`;
}
