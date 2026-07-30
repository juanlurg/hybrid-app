"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { SecondaryNav } from "@/components/app-shell";
import { Chip, RuleNote, SectionLabel, Segmented, Stepper } from "@/components/ui/kit";
import { accentFor, TONE } from "@/components/day-accents";
import { cn } from "@/lib/cn";
import { formatWeight } from "@/lib/engine";
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
  dateLabel: string;
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

type Tab = "semana" | "ejercicios" | "motor";

const RULE_LABEL: Record<string, string> = {
  conservative: "CONSERVADORA",
  standard: "ESTÁNDAR",
  aggressive: "AGRESIVA",
};

export function ProgramEditor({
  programName,
  phase,
  week,
  isDeload,
  cycle,
  waveIndex,
  wave,
  waveScope,
  pctOfRm,
  params,
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
  programName: string;
  phase: { id: string; key: string; name: string; weeks: number };
  week: number;
  absoluteWeek: number;
  isDeload: boolean;
  cycle: number;
  waveIndex: number;
  wave: number[];
  /** Which wave the steppers edit — or none at all in a fixed-% phase. */
  waveScope: "phase" | "program" | "fixed";
  pctOfRm: number | null;
  params: {
    incLowerKg: number;
    incUpperKg: number;
    roundingKg: number;
    targetRir: string;
    regressionRule: string;
  };
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
  const [tab, setTab] = useState<Tab>("semana");
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strengthSlots = slots.filter((s) => s.group === "strength");
  const [slotId, setSlotId] = useState(strengthSlots[0]?.id ?? "");
  const activeSlot = strengthSlots.find((s) => s.id === slotId) ?? strengthSlots[0];
  const slotExercises = exercises.filter((e) => e.slotId === activeSlot?.id);
  const slotSets = slotExercises.reduce((acc, e) => acc + e.sets, 0);

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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex-none bg-ink px-4 pt-4 pb-4 text-paper">
        <div className="flex items-baseline gap-3">
          <span className="flex-1 text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase">
            Editar programa
          </span>
          <span className="text-[11px] leading-none font-medium opacity-55">
            SEM {week}/{phase.weeks}
          </span>
        </div>
        <h1 className="mt-3 text-[26px] leading-[1.02] font-black tracking-[-0.03em]">
          {programName}
        </h1>
        <p className="mt-2 text-[11.5px] leading-none font-medium opacity-55 uppercase">
          {phase.key} {phase.name} · plantilla semanal
        </p>
      </header>

      <SecondaryNav />

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "semana", label: "Semana" },
          { value: "ejercicios", label: "Ejercicios" },
          { value: "motor", label: "Motor" },
        ]}
        className="flex-none"
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="mx-4 mt-3 border-l-[6px] border-fail py-1 pl-3 text-[12px] leading-[1.5]">
            {error}
          </div>
        ) : null}

        {tab === "semana" ? (
          <>
            <div className="flex flex-col gap-px border-b-2 border-ink bg-line">
              {days.map((d) => (
                <div key={d.dayIndex} className="bg-paper">
                  <div className="flex items-center gap-2.5 px-4 py-3">
                    <div className="w-8 flex-none">
                      <div className="text-[11px] leading-none font-extrabold">
                        {d.dayLabel}
                      </div>
                      <div className="mt-1 text-[9.5px] leading-none font-medium text-faint">
                        {d.dateLabel}
                      </div>
                    </div>
                    <div
                      className="h-9 w-1.5 flex-none"
                      style={{ background: accentFor(d.group) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] leading-[1.2] font-bold">
                        {d.title}
                      </div>
                      <div className="mt-1 truncate text-[11px] leading-[1.3] text-mid">
                        {d.subtitle || d.load}
                      </div>
                    </div>
                    <div className="flex-none text-right">
                      <div className="text-[11px] leading-none font-bold text-mid">
                        {d.group === "strength" ? d.load : ""}
                      </div>
                      {d.minutes ? (
                        <div className="num mt-1 text-[9.5px] leading-none font-medium text-faint">
                          ~{d.minutes}′
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label={`Cambiar el ${d.dayLabel}`}
                      onClick={() =>
                        setPickerFor(pickerFor === d.dayIndex ? null : d.dayIndex)
                      }
                      className="flex h-8 w-8 flex-none items-center justify-center bg-ink text-[14px] leading-none font-bold text-paper"
                    >
                      {pickerFor === d.dayIndex ? "×" : "···"}
                    </button>
                  </div>
                  {pickerFor === d.dayIndex ? (
                    <div className="flex flex-wrap gap-0.5 px-4 pb-3.5">
                      {slots.map((s) => (
                        <Chip
                          key={s.id}
                          active={s.id === d.slotId}
                          disabled={pending}
                          onClick={() =>
                            run(async () => {
                              const res = await setDaySlot(
                                phase.id,
                                d.dayIndex,
                                s.id,
                              );
                              setPickerFor(null);
                              return res;
                            })
                          }
                        >
                          {s.label}
                        </Chip>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {warnings.length > 0 ? (
              <div className="flex flex-col gap-3.5 px-4 pt-3.5">
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
              <p className="px-4 pt-4 text-[11.5px] leading-[1.5] text-mid">
                La semana pasa las comprobaciones: hay bloque de movilidad, cada
                sesión de fuerza tiene su básico y no hay pierna pesada pegada a
                la tirada larga.
              </p>
            )}
            <div className="h-5" />
          </>
        ) : null}

        {tab === "ejercicios" && activeSlot ? (
          <>
            <div className="flex gap-px bg-line py-px">
              {strengthSlots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSlotId(s.id)}
                  className={cn(
                    "flex-1 px-1 py-3 text-center text-[11px] leading-[1.2] font-bold tracking-[0.06em] uppercase",
                    s.id === activeSlot.id
                      ? "bg-ink text-paper"
                      : "bg-paper text-mid",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <SectionLabel
              right={`${slotSets} series · ~${Math.round(slotSets * 3.1 + 12)}′`}
            >
              Ejercicios · {activeSlot.label}
            </SectionLabel>

            <div className="mt-3 flex flex-col gap-px border-y-2 border-ink bg-line">
              {slotExercises.map((e, i) => {
                const diff = pendingByExercise.get(e.id);
                return (
                  <div
                    key={e.id}
                    className={cn("px-4 py-3", diff ? "bg-tint" : "bg-paper")}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-[13.5px] leading-[1.2] font-bold">
                            {e.name}
                          </span>
                          {e.isPrimary ? (
                            <span className="flex-none text-[9px] leading-none font-extrabold tracking-[0.1em] text-strength uppercase">
                              Básico
                            </span>
                          ) : null}
                        </div>
                        <div className="num mt-1 text-[10.5px] leading-none font-medium tracking-[0.05em] text-mid">
                          {e.sets} ×{" "}
                          {e.repMin === e.repMax
                            ? e.repMin
                            : `${e.repMin}-${e.repMax}`}{" "}
                          · DESC. {formatRest(e.restSeconds)}
                        </div>
                      </div>
                      <Stepper
                        compact
                        label="series"
                        value={e.sets}
                        onDecrement={() => run(() => setExerciseSets(e.id, -1))}
                        onIncrement={() => run(() => setExerciseSets(e.id, 1))}
                      />
                      <div className="flex flex-none flex-col gap-px">
                        <button
                          type="button"
                          aria-label="Subir"
                          disabled={i === 0 || pending}
                          onClick={() => run(() => moveExercise(e.id, -1))}
                          className="flex h-[15px] w-[22px] items-center justify-center bg-quiet text-[9px] leading-none font-bold disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label="Bajar"
                          disabled={i === slotExercises.length - 1 || pending}
                          onClick={() => run(() => moveExercise(e.id, 1))}
                          className="flex h-[15px] w-[22px] items-center justify-center bg-quiet text-[9px] leading-none font-bold disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label={`Quitar ${e.name}`}
                        disabled={e.isPrimary || pending}
                        onClick={() => run(() => deleteExercise(e.id))}
                        className="flex h-8 w-8 flex-none items-center justify-center bg-soft text-[15px] leading-none font-semibold disabled:opacity-30"
                      >
                        ×
                      </button>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <span className="text-[9.5px] leading-none font-semibold tracking-[0.1em] text-faint uppercase">
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
                          run(() => updateExercise(e.id, { repMax: e.repMax + 1 }))
                        }
                      />
                      <span className="text-[9.5px] leading-none font-semibold tracking-[0.1em] text-faint uppercase">
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

                    {diff ? (
                      <div className="mt-2.5 flex items-center gap-2 text-[10.5px] leading-none font-semibold">
                        <span className="text-[9px] font-extrabold tracking-[0.1em] text-strength">
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

            <button
              type="button"
              disabled={pending}
              onClick={() => setAddOpen((v) => !v)}
              className="mx-4 mt-3.5 block w-[calc(100%-2rem)] border-2 border-dashed border-hairline px-3 py-3.5 text-center text-[11.5px] leading-none font-bold tracking-[0.08em] text-mid uppercase"
            >
              + Añadir ejercicio
            </button>

            {addOpen ? (
              <div className="mx-4 mt-2 border-2 border-ink">
                <div className="bg-ink px-3 py-2 text-[10px] leading-none font-extrabold tracking-[0.12em] text-paper uppercase">
                  Del catálogo · según tu material
                </div>
                <div className="flex max-h-64 flex-col gap-px overflow-auto bg-line">
                  {catalog.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setAddOpen(false);
                        run(() =>
                          addExercise(activeSlot.id, {
                            exerciseId: c.id,
                            name: c.name,
                          }),
                        );
                      }}
                      className="flex items-baseline gap-2.5 bg-paper px-3 py-2.5 text-left"
                    >
                      <span className="flex-1 text-[13px] leading-[1.2] font-semibold">
                        {c.name}
                      </span>
                      <span className="text-[9.5px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                        {c.pattern ?? c.equipment}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setAddOpen(false);
                      run(() => addExercise(activeSlot.id));
                    }}
                    className="bg-paper px-3 py-2.5 text-left text-[13px] leading-[1.2] font-semibold text-mid"
                  >
                    Ejercicio libre…
                  </button>
                </div>
              </div>
            ) : null}

            <p className="px-4 py-4 text-[11px] leading-[1.5] text-faint">
              El básico del día manda: su rango de reps es lo que dispara la
              regla de regresión. Los accesorios no tocan el motor de pesos.
            </p>
          </>
        ) : null}

        {tab === "motor" ? (
          <>
            {waveScope === "fixed" ? (
              <>
                <SectionLabel>Progresión de la fase</SectionLabel>
                <div className="mx-4 mt-3 border-2 border-ink px-4 py-4">
                  <div className="num text-[30px] leading-none font-black tracking-[-0.035em]">
                    {Math.round((pctOfRm ?? 0.8) * 100)} %
                  </div>
                  <p className="mt-2 text-[11px] leading-[1.5] text-mid">
                    {phase.key} va a porcentaje fijo de la RM: sin olas, sin
                    bumps y sin descargas automáticas. No hay ola que editar en
                    esta fase.
                  </p>
                </div>
              </>
            ) : null}

            {waveScope !== "fixed" ? (
            <>
            <SectionLabel>
              Ola de {wave.length} semanas ·{" "}
              {waveScope === "phase" ? `de esta fase (${phase.key})` : "del programa"}
            </SectionLabel>
            <div className="mx-4 mt-3 flex h-[104px] items-end gap-0.5">
              {wave.map((w, i) => {
                const max = Math.max(...wave);
                return (
                  <div
                    key={i}
                    className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                  >
                    <span
                      className={cn(
                        "num text-[11px] leading-none font-extrabold",
                        i === waveIndex ? "text-strength" : "text-ink",
                      )}
                    >
                      {Math.round(w * 100)} %
                    </span>
                    <div
                      className={cn(
                        "w-full",
                        i === waveIndex ? "bg-strength" : "bg-ink",
                      )}
                      style={{ height: `${Math.round((w / max) * 100)}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mx-4 mt-0.5 flex gap-0.5">
              {wave.map((_, i) => (
                <div key={i} className="flex flex-1 flex-col gap-0.5">
                  <div className="pt-1.5 pb-1 text-center text-[9.5px] leading-none font-semibold text-faint">
                    S{i + 1}
                    {i === wave.length - 1 ? "·D" : ""}
                  </div>
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      aria-label={`Bajar la semana ${i + 1} de la ola`}
                      disabled={pending}
                      onClick={() => run(() => setWaveStep(i, -0.01))}
                      className="flex h-[30px] flex-1 items-center justify-center bg-ink text-[15px] leading-none font-bold text-paper"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label={`Subir la semana ${i + 1} de la ola`}
                      disabled={pending}
                      onClick={() => run(() => setWaveStep(i, 0.01))}
                      className="flex h-[30px] flex-1 items-center justify-center bg-ink text-[15px] leading-none font-bold text-paper"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="mx-4 mt-3.5 text-[11px] leading-[1.5] text-faint">
              La semana {wave.length} es la descarga: mismos pesos al{" "}
              {Math.round(wave[wave.length - 1] * 100)} %, mitad de series.
              Cambiar el pico cambia todos los pesos calculados de ese ciclo
              {waveScope === "phase"
                ? " — solo en esta fase; las demás siguen con su propia ola."
                : "."}
              {isDeload ? " Estás en ella ahora mismo." : ""}
            </p>
            </>
            ) : null}

            <SectionLabel className="mt-5">
              Parámetros del motor
            </SectionLabel>
            <div className="mt-3 flex flex-col gap-px border-y-2 border-ink bg-line">
              <EngineRow
                name="Ciclo actual"
                sub={`Semana ${week} de ${phase.weeks} · ciclo ${cycle}`}
                value={`${Math.round(
                  (waveScope === "fixed" ? (pctOfRm ?? 0.8) : wave[waveIndex]) *
                    100,
                )} %`}
              />
              <EngineRow
                name="Incremento por ciclo · piernas"
                sub="Sentadilla, hip thrust, RDL"
                value={`+${formatWeight(params.incLowerKg)} kg`}
              />
              <EngineRow
                name="Incremento por ciclo · torso"
                sub="Banca, militar"
                value={`+${formatWeight(params.incUpperKg)} kg`}
              />
              <EngineRow
                name="Redondeo del peso"
                sub="Según los discos que tengas"
                value={`${formatWeight(params.roundingKg)} kg`}
              />
              <EngineRow
                name="RIR objetivo del básico"
                sub="Repeticiones en reserva"
                value={params.targetRir}
              />
              <EngineRow
                name="Regla de regresión"
                sub="Qué pasa al fallar el rango"
                value={RULE_LABEL[params.regressionRule] ?? params.regressionRule}
              />
            </div>
            <p className="px-4 py-4 text-[11px] leading-[1.5] text-faint">
              Estos parámetros se cambian en Ajustes. La IA no puede tocarlos:
              propone cambios al programa, nunca al motor de pesos.
            </p>

            <Link
              href="/generar"
              className="mx-4 mb-5 flex items-center gap-3 border-2 border-ink px-3.5 py-3"
            >
              <span className="h-[30px] w-[30px] flex-none bg-strength" />
              <span className="flex-1">
                <span className="block text-[13.5px] leading-[1.2] font-bold">
                  Generar un programa nuevo
                </span>
                <span className="mt-1 block text-[11px] leading-none font-medium text-mid">
                  OTRA TEMPORADA, OTRO OBJETIVO · TUS RM SE CONSERVAN
                </span>
              </span>
              <span aria-hidden className="text-[16px] leading-none font-bold">
                →
              </span>
            </Link>
          </>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setAiOpen(true)}
        className="flex h-[58px] flex-none items-center gap-3 bg-ink px-4 text-paper active:opacity-85"
      >
        <span className="h-5 w-5 flex-none bg-strength" />
        <span className="flex-1 text-left text-[12px] leading-none font-extrabold tracking-[0.1em] uppercase">
          Refinar con IA
        </span>
        <span className="text-[11px] leading-none font-medium opacity-50">
          {pendingProposal
            ? `${pendingProposal.changes.length} propuestos`
            : appliedTotal
              ? `${appliedTotal} aplicados`
              : "tiempo · molestias · objetivos"}
        </span>
        <span aria-hidden className="text-[14px] leading-none font-bold">
          ↑
        </span>
      </button>

      <AiPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        hasApiKey={hasApiKey}
        initialMessages={thread.messages.filter((m) => m.role !== "system")}
        initialThreadId={thread.id}
        initialProposal={pendingProposal}
        lastApplied={lastApplied}
      />
    </div>
  );
}

function EngineRow({
  name,
  sub,
  value,
}: {
  name: string;
  sub: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 bg-paper px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-[1.2] font-bold">{name}</div>
        <div className="mt-1 text-[10.5px] leading-[1.3] text-faint">{sub}</div>
      </div>
      <div className="num flex h-8 min-w-[58px] items-center justify-center bg-soft px-1.5 text-[13px] leading-none font-extrabold">
        {value}
      </div>
    </div>
  );
}

function formatRest(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}′`;
  if (seconds > 60) return `${Math.floor(seconds / 60)}′${seconds % 60}″`;
  return `${seconds}″`;
}
