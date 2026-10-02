"use client";

import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Minus,
  Plus,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  Card,
  Chip,
  Fold,
  Footnote,
  Note,
  SectionLabel,
  Stepper,
  TopBar,
} from "@/components/ui/kit";
import { DayIcon } from "@/components/day-icon";
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
  "flex h-9 w-9 flex-none items-center justify-center rounded-full bg-soft text-body disabled:opacity-30";

const STEP_LABEL = "text-[11px] leading-none font-bold text-mid";

/** What a day costs, not what it is. */
function metaFor(day: DayView): string {
  if (day.group === "rest") return "";
  if (day.group === "mobility" && day.minutes) {
    return `${day.load} · ${day.minutes}′`;
  }
  return day.load;
}

export function ProgramEditor({
  phase,
  phaseOptions,
  isCurrentPhase,
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
  /** Every phase of the season; `active` is the one on screen. */
  phaseOptions: Array<{ key: string; name: string; active: boolean; current: boolean }>;
  /** False when looking at a phase other than today's. */
  isCurrentPhase: boolean;
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
  // One exercise's controls at a time: five rows of steppers all at once
  // were ~55 tap targets, and none of them the one being changed.
  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);
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

  const cardTitle = slot?.label ?? day.title;
  const cardWeekday = orphanSlotId ? "Sin día asignado" : day.dayLabel;
  const cardMeta = editableSlot
    ? [
        `${slotExercises.length} ${slotExercises.length === 1 ? "ejercicio" : "ejercicios"}`,
        orphanSlotId ? "" : metaFor(day),
      ]
        .filter(Boolean)
        .join(" · ")
    : slot
      ? day.subtitle || day.load
      : metaFor(day);

  const failures = warnings.filter((w) => w.tone === "fail");
  const advisories = warnings.filter((w) => w.tone !== "fail");
  const waveMax = Math.max(...wave);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="Semana tipo" href="/programa" />

      <div className="min-h-0 flex-1 overflow-auto pb-6">
        {/* Any phase is editable, not just the one being lived. */}
        {phaseOptions.length > 1 ? (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-5 pt-3.5 pb-0.5">
            {phaseOptions.map((p) => (
              <Link
                key={p.key}
                href={p.current ? "/editor" : `/editor?fase=${p.key}`}
                aria-current={p.active ? "page" : undefined}
                className={cn(
                  "flex h-9 flex-none items-center rounded-full px-3.5 text-[13px] leading-none font-bold",
                  p.active
                    ? "bg-strength text-on-strength"
                    : "bg-surface text-body shadow-raised",
                )}
              >
                {p.name}
                {p.current ? <span className="ml-1 opacity-70">· ahora</span> : null}
              </Link>
            ))}
          </div>
        ) : null}
        {error ? (
          <div className="mx-5 mt-3 rounded-xl bg-fail-soft px-4 py-3 text-[13px] leading-[1.45] font-medium text-fail">
            {error}
          </div>
        ) : null}

        <div className="mx-5 mt-3.5 grid grid-cols-7 gap-[5px]">
          {days.map((d, i) => {
            const rest = d.group === "rest";
            const active = i === selected && !orphanSlotId;
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
                  setOpenExerciseId(null);
                  setAddOpen(false);
                }}
                className={cn(
                  "flex h-[62px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl",
                  active
                    ? "bg-clay-soft text-clay ring-2 ring-strength ring-inset"
                    : rest
                      ? "bg-sunk text-faint"
                      : "bg-surface text-body shadow-raised",
                )}
              >
                <span
                  className={cn(
                    "num text-[11px] leading-none",
                    active ? "font-extrabold" : "font-bold text-mid",
                  )}
                >
                  {DAY_INITIALS[d.dayIndex]}
                </span>
                <DayIcon group={d.group} size={16} />
              </button>
            );
          })}
        </div>

        {orphanSlots.length > 0 ? (
          <>
            <SectionLabel>Sin día asignado</SectionLabel>
            <div className="mx-5 mt-2.5 flex flex-wrap gap-1.5">
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
                    "flex h-9 items-center rounded-full px-3.5 text-[13px] leading-none font-bold",
                    orphanSlotId === s.id
                      ? "bg-clay-soft text-clay ring-2 ring-strength ring-inset"
                      : "bg-surface text-body shadow-raised",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <div className="mt-3 px-5">
          <Card className="rounded-2xl px-1.5 pt-4 pb-2.5">
            <div className="flex items-center gap-2.5 px-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] leading-tight font-semibold text-mid">
                  {cardWeekday}
                </div>
                <div className="mt-0.5 truncate text-[19px] leading-[1.2] font-extrabold tracking-[-0.01em]">
                  {cardTitle}
                </div>
                {cardMeta ? (
                  <div className="num mt-0.5 truncate text-[12.5px] leading-[1.35] font-medium text-mid">
                    {cardMeta}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                aria-expanded={editing}
                onClick={() => {
                  setEditing((v) => !v);
                  setAddOpen(false);
                }}
                className="flex h-9 flex-none items-center rounded-full bg-soft px-3.5 text-[13px] leading-none font-bold"
              >
                {editing ? "Listo" : "Editar"}
              </button>
            </div>

            {editing ? (
              <div className="mt-3 px-2.5">
                <div className={STEP_LABEL}>Sesión de este día</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
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
              <div className="mt-2.5 flex flex-col gap-0.5">
                {slotExercises.map((e, i) => {
                  const diff = pendingByExercise.get(e.id);
                  const open = editing && openExerciseId === e.id;
                  const head = (
                    <>
                      <span className="num flex h-[26px] w-[26px] flex-none items-center justify-center rounded-sm bg-soft text-[12px] leading-none font-extrabold text-mid">
                        {i + 1}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        <span className="text-[14.5px] leading-[1.3] font-semibold">
                          {e.name}
                        </span>
                        {e.isPrimary ? (
                          <span className="flex h-5 items-center rounded-full bg-clay-soft px-[7px] text-[11px] leading-none font-extrabold text-clay">
                            Básico
                          </span>
                        ) : null}
                      </span>
                      <span className="num flex-none text-[12.5px] leading-none font-semibold text-body">
                        {schemeOf(e)}
                      </span>
                      {editing ? (
                        <ChevronDown
                          aria-hidden
                          size={16}
                          className={cn(
                            "flex-none text-faint transition-transform",
                            open && "rotate-180",
                          )}
                        />
                      ) : null}
                    </>
                  );
                  return (
                    <div
                      key={e.id}
                      className={cn(
                        "rounded-xl p-2.5",
                        diff ? "bg-tint" : open && "bg-sunk",
                      )}
                    >
                      {editing ? (
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={`Ajustar ${e.name}`}
                          onClick={() =>
                            setOpenExerciseId((v) => (v === e.id ? null : e.id))
                          }
                          className="flex w-full items-center gap-2.5 text-left"
                        >
                          {head}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2.5">{head}</div>
                      )}

                      {diff ? (
                        <div className="num mt-2 ml-9 flex flex-wrap items-center gap-1.5 text-[12px] leading-[1.3] font-semibold">
                          <Sparkles
                            aria-hidden
                            size={14}
                            className="flex-none text-clay"
                          />
                          <span className="sr-only">IA</span>
                          <span className="text-faint line-through">
                            {diff.from}
                          </span>
                          <ArrowRight aria-hidden size={12} className="flex-none text-faint" />
                          <span className="font-bold">{diff.to}</span>
                        </div>
                      ) : null}

                      {open ? (
                        <div className="mt-3 mb-0.5 ml-9 flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className={STEP_LABEL}>Series</span>
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
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={STEP_LABEL}>Reps</span>
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
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={STEP_LABEL}>Desc.</span>
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
                          <div className="ml-auto flex flex-none items-center gap-1">
                            <button
                              type="button"
                              aria-label="Subir"
                              disabled={i === 0 || pending}
                              onClick={() => run(() => moveExercise(e.id, -1))}
                              className={ICON_BUTTON}
                            >
                              <ArrowUp aria-hidden size={16} />
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
                              <ArrowDown aria-hidden size={16} />
                            </button>
                            <button
                              type="button"
                              aria-label={`Quitar ${e.name}`}
                              disabled={e.isPrimary || pending}
                              onClick={() => run(() => deleteExercise(e.id))}
                              className={cn(
                                ICON_BUTTON,
                                "bg-fail-soft text-fail",
                              )}
                            >
                              <X aria-hidden size={16} />
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2.5 px-2.5 text-[12.5px] leading-[1.5] font-medium text-mid">
                {slot
                  ? day.subtitle || day.load
                  : "Este día no tiene sesión asignada. Elige una con «editar»."}
              </p>
            )}

            {editing && editableSlot ? (
              <>
                <div className="mt-2 px-2.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setAddOpen((v) => !v)}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-soft text-[13.5px] leading-none font-bold disabled:opacity-40"
                  >
                    <Plus aria-hidden size={16} />
                    Añadir ejercicio
                  </button>
                </div>

                {addOpen ? (
                  <div className="mx-2.5 mt-2 rounded-xl bg-sunk p-1.5">
                    <div className="px-2 py-2 text-[12px] leading-none font-semibold text-mid">
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
                          className="flex min-h-11 items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5 text-left shadow-raised"
                        >
                          <span className="min-w-0 flex-1 text-[13.5px] leading-[1.3] font-semibold">
                            {c.name}
                          </span>
                          <span className="flex-none text-[11px] leading-none font-semibold text-mid">
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
                        className="min-h-11 rounded-xl bg-surface px-3 py-2.5 text-left text-[13.5px] leading-[1.3] font-semibold text-mid shadow-raised"
                      >
                        Ejercicio libre…
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            <p className="mx-2.5 mt-3 mb-1 text-[12.5px] leading-[1.5] font-medium text-mid">
              {slot
                ? `Editar ${slot.label} la cambia en todas las semanas de la fase.`
                : "Editar una sesión la cambia en todas las semanas de la fase."}
              {editableSlot
                ? " El básico del día manda: su rango de reps es lo que dispara la regla de regresión. Los accesorios no tocan el motor de pesos."
                : ""}
            </p>
          </Card>
        </div>

        {warnings.length > 0 ? (
          // Blocking problems stay in view; advisories fold behind one line,
          // or a plan that trips them every week turns them into wallpaper.
          <div className="mx-5 mt-3 flex flex-col gap-3">
            {failures.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-2xl bg-surface px-4 py-3.5 shadow-card"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-fail-soft text-fail">
                  <TriangleAlert aria-hidden size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] leading-[1.3] font-bold">
                    {w.title}
                  </div>
                  {w.detail ? (
                    <div className="mt-1 text-[13px] leading-[1.45] font-medium text-mid">
                      {w.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {advisories.length > 0 ? (
              <details className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-card [&::-webkit-details-marker]:hidden">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-warn-soft text-clay-dim">
                    <TriangleAlert aria-hidden size={18} />
                  </span>
                  <span className="min-w-0 flex-1 text-[14px] leading-[1.3] font-bold">
                    {advisories.length === 1
                      ? "1 aviso sobre esta semana"
                      : `${advisories.length} avisos sobre esta semana`}
                  </span>
                  <ChevronDown
                    aria-hidden
                    size={18}
                    className="flex-none text-faint transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  {advisories.map((w, i) => (
                    <Note
                      key={i}
                      tone="warn"
                      icon={<TriangleAlert aria-hidden size={18} />}
                      title={w.title}
                    >
                      {w.detail}
                    </Note>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : (
          <div className="mx-5 mt-3 flex items-start gap-3 rounded-2xl bg-surface px-4 py-3.5 shadow-card">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-ok-soft text-ok">
              <Check aria-hidden size={18} strokeWidth={2.5} />
            </span>
            <p className="min-w-0 flex-1 text-[13px] leading-[1.5] font-medium text-body">
              La semana pasa las comprobaciones: hay bloque de movilidad, cada
              sesión de fuerza tiene su básico y no hay pierna pesada pegada a
              la tirada larga.
            </p>
          </div>
        )}

        {/* proposeChanges is pinned to today's phase server-side, so the
            panel only appears there — a proposal drafted while looking at
            F4 must not land on F2. */}
        {isCurrentPhase ? (
          <div className="mt-3 px-5">
            <AiPanel
              hasApiKey={hasApiKey}
              initialMessages={thread.messages.filter((m) => m.role !== "system")}
              initialThreadId={thread.id}
              initialProposal={pendingProposal}
              lastApplied={lastApplied}
              appliedTotal={appliedTotal}
            />
          </div>
        ) : (
          <Footnote>
            La IA propone solo sobre la fase en curso. Esta la editas a mano.
          </Footnote>
        )}

        {/* The motor folded behind a line: it sets every weight on the
            screen above, and is read a tenth as often. */}
        <Fold
          className="mt-3"
          title="% de la RM por semana"
          summary={
            waveScope === "fixed"
              ? `${Math.round((pctOfRm ?? 0.8) * 100)} % fijo`
              : `ciclo de ${wave.length} · esta ${Math.round(wave[waveIndex] * 100)} %`
          }
        >
          {waveScope === "fixed" ? (
            <>
              <div className="num text-[30px] leading-none font-extrabold tracking-[-0.035em] text-clay">
                {Math.round((pctOfRm ?? 0.8) * 100)} %
              </div>
              <p className="mt-2 text-[12.5px] leading-[1.5] font-medium text-mid">
                Esta fase va a porcentaje fijo de la RM: el mismo cada semana,
                sin subidas por ciclo ni descargas automáticas.
              </p>
            </>
          ) : (
            <>
              <div className="text-[12px] leading-none font-semibold text-mid">
                Ciclo de {wave.length} semanas ·{" "}
                {waveScope === "phase" ? "de esta fase" : "de todo el programa"}
              </div>
              <div className="mt-3.5 flex gap-1.5">
                {wave.map((w, i) => {
                  const current = i === waveIndex;
                  return (
                    <div
                      key={i}
                      className="flex min-w-0 flex-1 flex-col items-stretch gap-1.5"
                    >
                      <div className="flex h-[88px] flex-col items-center justify-end gap-1">
                        <span
                          className={cn(
                            "num text-[12px] leading-none font-extrabold whitespace-nowrap",
                            current ? "text-clay" : "text-body",
                          )}
                        >
                          {Math.round(w * 100)} %
                        </span>
                        <span
                          className={cn(
                            "w-full self-stretch rounded-sm",
                            current ? "bg-strength" : "bg-quiet",
                          )}
                          style={{ height: Math.round((w / waveMax) * 70) }}
                        />
                      </div>
                      <span
                        className={cn(
                          "num flex items-center justify-center gap-0.5 text-[11px] leading-none",
                          current ? "font-extrabold text-clay" : "font-bold text-mid",
                        )}
                      >
                        S{i + 1}
                        {i === wave.length - 1 ? (
                          <ArrowDown aria-hidden size={11} />
                        ) : null}
                      </span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          aria-label={`Bajar la semana ${i + 1} del ciclo`}
                          disabled={pending}
                          onClick={() => run(() => setWaveStep(i, -0.01, phase.id))}
                          className="flex h-[30px] flex-1 items-center justify-center rounded-full bg-soft text-body disabled:opacity-40"
                        >
                          <Minus aria-hidden size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Subir la semana ${i + 1} del ciclo`}
                          disabled={pending}
                          onClick={() => run(() => setWaveStep(i, 0.01, phase.id))}
                          className="flex h-[30px] flex-1 items-center justify-center rounded-full bg-soft text-body disabled:opacity-40"
                        >
                          <Plus aria-hidden size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3.5 text-[12.5px] leading-[1.5] font-medium text-mid">
                La semana {wave.length} es la descarga: los básicos al{" "}
                {Math.round(wave[wave.length - 1] * 100)} % de la RM y la mitad
                de series. Cambiar un porcentaje cambia los pesos de esa semana
                en cada ciclo
                {waveScope === "phase"
                  ? " — solo en esta fase; las demás tienen el suyo."
                  : "."}
                {isDeload ? " Estás en ella ahora mismo." : ""}
              </p>
            </>
          )}

          {/* One home for the engine parameters: Ajustes owns them, and
              this screen keeps only what it can actually edit (the wave).
              The AI cannot touch them either way. */}
          <Link
            href="/motor"
            className="mt-2 -mb-2 flex min-h-11 items-center gap-2.5"
          >
            <span className="flex-1 text-[13px] leading-[1.4] font-medium text-mid">
              Cómo calcula el motor cada peso
            </span>
            <ChevronRight aria-hidden size={16} className="flex-none text-faint" />
          </Link>
        </Fold>
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
