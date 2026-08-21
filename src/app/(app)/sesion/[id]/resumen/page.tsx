import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TONE } from "@/components/day-accents";
import {
  Callout,
  Card,
  Footnote,
  LinkBar,
  Row,
  RowStack,
  RuleNote,
  SectionLabel,
  TopBar,
} from "@/components/ui/kit";
import { requireAthlete } from "@/lib/data/athlete";
import { formatDayLong } from "@/lib/domain/calendar";
import {
  groupOf,
  liftStateFrom,
  phaseEngineConfig,
  resolveExercise,
  type SessionStatus,
} from "@/lib/domain/plan";
import {
  formatMinutes,
  summarise,
  type ExerciseSummary,
} from "@/lib/domain/summary";
import { formatTonnage, formatWeight, regressionLadder } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";

/** Left-rule colour per engine event kind — same mapping as Historial. */
const EVENT_TONE: Record<string, string> = {
  fail_hold: TONE.warn,
  fail_penalty: TONE.fail,
  clean_reset: TONE.ok,
  cycle_bump: TONE.ink,
  ai_change: TONE.ink,
};

/** The eyebrow states what the session actually is, not what we hoped. */
const STATUS_EYEBROW: Record<SessionStatus, string> = {
  done: "Sesión completa",
  partial: "Sesión parcial",
  skipped: "Sesión saltada",
  in_progress: "Sesión sin cerrar",
  planned: "Sesión sin empezar",
};

/* Read on the page, not on a dark band: `lime-dim`/`warn`/`fail` rather
   than the stroke and fill greens, which wash out on light. */
const STATUS_TONE: Record<SessionStatus, string> = {
  done: "text-lime-dim",
  partial: "text-warn",
  skipped: "text-fail",
  in_progress: "text-lime",
  planned: "text-faint",
};

/* A KPI tile. Inline rather than `StatGrid`: series is the headline and
   carries a lime figure with a dimmed `/n` suffix, which the grid has no
   slot for. */
function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="num text-[26px] leading-none font-bold tracking-[-0.02em]">
        {children}
      </div>
      <div className="font-display mt-1.5 text-[11px] leading-none font-semibold tracking-[0.06em] text-faint uppercase">
        {label}
      </div>
    </div>
  );
}

/** One logged set of the básico. Same colouring as the runner's pills. */
function SetPill({ value, missed }: { value: string | null; missed: boolean }) {
  return (
    <div
      className={cn(
        "num flex h-12 w-12 items-center justify-center rounded-lg border-[1.5px] text-[18px] leading-none font-bold",
        value == null
          ? "border-edge bg-surface text-faint opacity-55"
          : missed
            ? "border-fail bg-fail/10 text-fail"
            : "border-lime-edge bg-lime-soft text-lime",
      )}
    >
      {value ?? "—"}
    </div>
  );
}

export default async function ResumenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const athlete = await requireAthlete();
  const { ctx, config } = athlete;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", athlete.userId)
    .maybeSingle();

  if (!session) notFound();

  const [{ data: setLogs }, { data: events }] = await Promise.all([
    supabase
      .from("set_logs")
      .select("*")
      .eq("session_id", session.id)
      .eq("user_id", athlete.userId)
      .order("position")
      .order("set_index"),
    supabase
      .from("engine_events")
      .select("*")
      .eq("session_id", session.id)
      .eq("user_id", athlete.userId)
      .order("created_at"),
  ]);

  const logs = setLogs ?? [];
  const engineEvents = events ?? [];

  const slot = ctx.slots.find((s) => s.id === session.slot_id) ?? null;
  const title = slot?.label || session.title.toUpperCase() || "SESIÓN";
  const group = groupOf(session.session_type);

  const duration = formatMinutes(session.duration_seconds);

  // The engine runs on the week inside the phase, with that phase's config.
  const sessionPhase = ctx.phases.find((p) => p.id === session.phase_id) ?? null;
  const phaseConfig = sessionPhase
    ? phaseEngineConfig(config, sessionPhase)
    : config;

  const liftsByKey = new Map(
    ctx.lifts.map((l) => [l.key, liftStateFrom(l)] as const),
  );
  const slotExercises = ctx.exercises
    .filter((e) => e.slot_id === session.slot_id)
    .sort((a, b) => a.position - b.position);
  const planned = slotExercises.map((e) =>
    resolveExercise(e, session.week, phaseConfig, liftsByKey),
  );
  const plannedSets = planned.reduce((acc, e) => acc + e.sets, 0);

  /* What was actually logged, exercise by exercise. */
  const logsFor = (exerciseId: string) =>
    logs.filter((l) => l.program_exercise_id === exerciseId);

  const summaries: ExerciseSummary[] = planned.map((ex) =>
    summarise(
      ex.id,
      ex.name,
      ex.isPrimary,
      ex.sets,
      ex.loadMode,
      logsFor(ex.id),
    ),
  );

  // Sets logged against an exercise that is no longer in the plan still count.
  const offPlan = logs.filter(
    (l) => !planned.some((p) => p.id === l.program_exercise_id),
  );
  for (const name of new Set(offPlan.map((l) => l.exercise_name))) {
    summaries.push(
      summarise(
        `off-plan:${name}`,
        name,
        false,
        null,
        null,
        offPlan.filter((l) => l.exercise_name === name),
      ),
    );
  }

  /* The básico gets a pill per prescribed set; everything else folds
     behind the "accesorios" line. */
  const primaryEx = planned.find((p) => p.isPrimary) ?? null;
  const primarySummary = summaries.find((s) => s.isPrimary) ?? null;
  const accessories = summaries.filter((s) => !s.isPrimary);
  const primaryLogs = primaryEx ? logsFor(primaryEx.id) : [];
  const primarySets = primaryEx
    ? Array.from(
        { length: Math.max(primaryEx.sets, primaryLogs.length) },
        (_, i) => {
          const log = primaryLogs.find((l) => l.set_index === i) ?? null;
          const value = log ? (log.reps ?? log.seconds) : null;
          return {
            key: log?.id ?? `pending:${i}`,
            label:
              value == null
                ? null
                : log?.reps == null
                  ? `${value}″`
                  : String(value),
            missed: log?.missed_range ?? false,
          };
        },
      )
    : [];

  const missed = logs
    .filter((l) => l.missed_range)
    .map((l) => {
      const ex = planned.find((p) => p.id === l.program_exercise_id) ?? null;
      return {
        id: l.id,
        name: l.exercise_name,
        setNumber: l.set_index + 1,
        reps: l.reps,
        repMin: ex?.repMin ?? null,
        isPrimary: ex?.isPrimary ?? false,
        weightLabel:
          l.weight_kg == null
            ? null
            : `${formatWeight(Number(l.weight_kg))} kg`,
      };
    });

  /* The engine's word on the next session of this same slot. The number is
     read off ResolvedExercise — no load is ever computed in a screen.
     Week+1 only exists INSIDE the phase: at the boundary the next phase
     has its own slots and progression, and extrapolating here announced
     weights the engine would never prescribe. */
  const primaryRow = slotExercises.find((e) => e.is_primary);
  const inPhase = sessionPhase == null || session.week + 1 <= sessionPhase.weeks;
  const next =
    primaryRow && inPhase
      ? resolveExercise(primaryRow, session.week + 1, phaseConfig, liftsByKey)
      : null;
  const nextPhase =
    !inPhase && sessionPhase
      ? (ctx.phases.find((p) => p.position === sessionPhase.position + 1) ??
        null)
      : null;
  const nextLift = next?.liftKey
    ? (ctx.lifts.find((l) => l.key === next.liftKey) ?? null)
    : null;
  const nextPenaltyPct = nextLift
    ? Math.round(
        regressionLadder(config.regressionRule)[
          Math.min(nextLift.fail_count ?? 0, 2)
        ] * 100,
      )
    : 0;

  const reverted = engineEvents.filter((e) => e.reverted_at);
  const standing = engineEvents.length - reverted.length;
  const [tonnageValue, tonnageUnit] = formatTonnage(
    Number(session.tonnage_kg),
  ).split(" ");

  /* RIR is optional per set, so the fourth tile falls back to what the
     engine did when nobody logged one. */
  const rirLogs = logs.filter((l) => l.rir != null);
  const avgRir =
    rirLogs.length > 0
      ? formatWeight(
          Math.round(
            (rirLogs.reduce((acc, l) => acc + Number(l.rir), 0) /
              rirLogs.length) *
              10,
          ) / 10,
        )
      : null;

  const clean =
    session.status === "done" && logs.length > 0 && missed.length === 0;
  const verdict =
    logs.length === 0
      ? "Sin series registradas"
      : missed.length > 0
        ? missed.length === 1
          ? "Una serie por debajo del rango"
          : `${missed.length} series por debajo del rango`
        : plannedSets > 0 && logs.length < plannedSets
          ? "Series de menos, todas en rango"
          : "Todo dentro del rango";
  const engineLine =
    standing === 0
      ? "el motor no toca nada"
      : standing === 1
        ? "1 ajuste del motor"
        : `${standing} ajustes del motor`;

  const accessoryList =
    accessories.length > 0 ? (
      <div className="mt-1 divide-y divide-line border-t border-line">
        {accessories.map((s) => (
          <div key={s.key} className="flex items-center gap-3 py-[11px]">
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "truncate text-[13.5px] leading-[1.2] font-semibold",
                  s.doneSets === 0 && "text-ghost",
                )}
              >
                {s.name}
              </div>
              <div
                className={cn(
                  "mt-1 truncate text-[11px] leading-[1.35]",
                  s.doneSets === 0 ? "text-ghost" : "text-mid",
                )}
              >
                {s.doneSets === 0 ? (
                  "sin registrar"
                ) : (
                  <>
                    <span className="num">{s.repsLabel}</span> reps
                  </>
                )}
              </div>
            </div>
            <div className="flex-none text-right">
              <div
                className={cn(
                  "num text-[12.5px] leading-none font-semibold",
                  s.doneSets === 0 && "text-ghost",
                )}
              >
                {s.weightLabel}
              </div>
              <div
                className={cn(
                  "font-display mt-1 text-[9.5px] leading-none font-semibold tracking-[0.08em]",
                  s.missedSets > 0 ? "text-fail" : "text-mid",
                )}
              >
                <span className="num">
                  {s.doneSets}
                  {s.plannedSets == null ? "" : `/${s.plannedSets}`}
                </span>{" "}
                SERIES
              </div>
            </div>
          </div>
        ))}
      </div>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        title="Resumen"
        href="/"
        right={
          <span className="uppercase">
            {title} · {formatDayLong(session.scheduled_on)}
          </span>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="px-5 pt-3">
          <div
            className={cn(
              "font-display text-[11px] leading-none font-semibold tracking-[0.14em] uppercase",
              STATUS_TONE[session.status],
            )}
          >
            {clean ? "Sesión limpia" : STATUS_EYEBROW[session.status]}
          </div>
          <h1 className="font-display mt-2 text-[27px] leading-[1.1] font-bold">
            {verdict}
          </h1>
          <p className="mt-1.5 text-[13.5px] leading-[1.45] text-mid">
            <span className="num">{logs.length}</span>
            {plannedSets > 0 ? (
              <>
                {" de "}
                <span className="num">{plannedSets}</span>
              </>
            ) : null}{" "}
            series · {engineLine}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-1.5">
            <Kpi label="Series">
              <span className="text-lime">{logs.length}</span>
              {plannedSets > 0 ? (
                <span className="text-[14px] text-lime-dim">
                  /{plannedSets}
                </span>
              ) : null}
            </Kpi>
            <Kpi label="Tonelaje">
              {tonnageValue} <span className="text-[14px]">{tonnageUnit}</span>
            </Kpi>
            <Kpi label="Duración">{duration ?? "—"}</Kpi>
            {avgRir ? (
              <Kpi label="RIR medio">{avgRir}</Kpi>
            ) : (
              <Kpi label="Ajustes">
                <span className={standing > 0 ? "text-warn" : undefined}>
                  {standing}
                </span>
              </Kpi>
            )}
          </div>
        </div>

        {session.notes ? (
          <p className="mx-5 mt-3.5 rounded-r-sm border-l-[4px] border-hairline py-1 pl-3 text-[12px] leading-[1.5] text-mid">
            {session.notes}
          </p>
        ) : null}

        {primarySummary && primaryEx ? (
          <div className="mt-3.5 px-5">
            <Card className="px-4 py-4">
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 text-[15px] leading-[1.25] font-semibold">
                  {primarySummary.name}
                </span>
                <span className="num flex-none text-[14px] leading-none font-semibold">
                  {primarySummary.weightLabel}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {primarySets.map((s) => (
                  <SetPill key={s.key} value={s.label} missed={s.missed} />
                ))}
              </div>

              {accessoryList ? (
                <details className="group mt-1">
                  {/* The mock hangs this off the end of the pill row; it gets
                      its own line here so the tap target clears 44px. */}
                  <summary className="flex min-h-11 list-none cursor-pointer items-center justify-end gap-1.5 text-[11.5px] leading-none text-faint [&::-webkit-details-marker]:hidden">
                    accesorios
                    <span
                      aria-hidden
                      className="transition-transform group-open:rotate-90"
                    >
                      ›
                    </span>
                  </summary>
                  {accessoryList}
                </details>
              ) : null}
            </Card>
          </div>
        ) : accessoryList ? (
          <div className="mt-3.5 px-5">
            <Card className="px-4 py-4">
              <div className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
                Registrado
              </div>
              {accessoryList}
            </Card>
          </div>
        ) : group === "strength" ? (
          <div className="mt-3.5 px-5">
            <Card className="px-4 py-4">
              <div className="text-[13px] leading-[1.2] font-semibold">
                Nada registrado
              </div>
              <p className="mt-1.5 text-[12.5px] leading-[1.5] text-mid">
                Esta sesión no tiene series guardadas y el bloque ya no tiene
                ejercicios asignados.
              </p>
            </Card>
          </div>
        ) : null}

        {missed.length > 0 ? (
          <>
            <SectionLabel right={`${missed.length} de ${logs.length}`}>
              Series fuera de rango
            </SectionLabel>
            <RowStack className="mt-2.5">
              {missed.map((m) => (
                <Row key={m.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] leading-[1.2] font-semibold">
                      {m.name}
                    </div>
                    <div className="mt-1 truncate text-[11px] leading-[1.35] text-mid">
                      serie <span className="num">{m.setNumber}</span>
                      {m.weightLabel ? (
                        <>
                          {" · "}
                          <span className="num">{m.weightLabel}</span>
                        </>
                      ) : null}
                      {m.isPrimary ? " · básico del día" : " · accesorio"}
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <div className="text-[12.5px] leading-none font-semibold text-fail">
                      <span className="num">{m.reps ?? "—"}</span> reps
                    </div>
                    <div className="font-display mt-1 text-[9.5px] leading-none font-semibold tracking-[0.08em] text-mid">
                      MÍN. <span className="num">{m.repMin ?? "—"}</span>
                    </div>
                  </div>
                </Row>
              ))}
            </RowStack>
            <Footnote>
              Solo el básico del día mueve el motor. Los accesorios fuera de
              rango quedan registrados y nada más.
            </Footnote>
          </>
        ) : null}

        <div className="mt-3.5 px-5">
          <Card className="px-4 py-4">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-lime uppercase">
                El motor
              </span>
              {reverted.length > 0 ? (
                <span className="ml-auto text-[11px] leading-none text-faint">
                  {reverted.length}{" "}
                  {reverted.length === 1 ? "deshecho" : "deshechos"}
                </span>
              ) : null}
            </div>

            {engineEvents.length === 0 ? (
              <p className="mt-2 text-[12.5px] leading-[1.55] text-mid">
                {logs.length === 0
                  ? "Esta sesión se cerró sin ninguna serie registrada, así que ni la RM ni los pesos han cambiado."
                  : "Ninguna serie del básico del día cayó por debajo del rango, así que la ola sigue su curso."}
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {engineEvents.map((event) => (
                  <RuleNote
                    key={event.id}
                    tone={
                      event.reverted_at
                        ? TONE.line
                        : (EVENT_TONE[event.kind] ?? TONE.ink)
                    }
                    title={event.title}
                  >
                    {event.detail}
                    {event.reverted_at ? (
                      <span className="mt-1.5 block text-[10px] leading-none font-semibold tracking-[0.1em] text-ghost uppercase">
                        Deshecho — el motor volvió atrás
                      </span>
                    ) : null}
                  </RuleNote>
                ))}
              </div>
            )}
          </Card>
        </div>

        {next?.breakdown ? (
          <div className="mx-5 mt-3.5">
            <Callout
              eyebrow="La próxima vez"
              eyebrowTone={
                next.breakdown.isHeld ? "text-warn-panel" : "text-ok-bright"
              }
            >
              {next.breakdown.isHeld ? (
                <>
                  Se repite <span className="num">{next.weightLabel}</span> en{" "}
                  {next.name.toLowerCase()}, {next.schemeLabel}.{" "}
                  {nextPenaltyPct > 0 ? (
                    <>
                      Otro fallo y la RM estimada baja un{" "}
                      <span className="num">{nextPenaltyPct}</span> %.
                    </>
                  ) : (
                    "Otro fallo y el peso se queda congelado otra vez."
                  )}
                </>
              ) : (
                <>
                  {next.name}: {next.schemeLabel} a{" "}
                  <span className="num">{next.weightLabel}</span>, el{" "}
                  <span className="num">
                    {Math.round(next.breakdown.waveFactor * 100)}
                  </span>{" "}
                  % de una RM estimada de{" "}
                  <span className="num">
                    {formatWeight(next.breakdown.e1rmKg)}
                  </span>{" "}
                  kg.
                  {next.breakdown.isDeload ? " Es semana de descarga." : ""}
                </>
              )}
            </Callout>
          </div>
        ) : null}

        {!inPhase && sessionPhase ? (
          <div className="mx-5 mt-3.5">
            <Callout eyebrow="La próxima vez" eyebrowTone="text-ok-bright">
              {nextPhase ? (
                <>
                  Última semana de {sessionPhase.name.toLowerCase()}. La semana
                  que viene empieza {nextPhase.key} —{" "}
                  {nextPhase.name.toLowerCase()} — y los pesos se recalculan con
                  su progresión.
                </>
              ) : (
                <>Última semana del plan.</>
              )}
            </Callout>
          </div>
        ) : null}

        {/* Runs have had «editar datos» all along; strength catches up.
            The runner reopens on the same idempotent ops and the finish
            re-grades the session. */}
        <Link
          href={`/sesion/${session.id}?corregir=1`}
          className="mt-3.5 flex items-center gap-2.5 px-6 py-1"
        >
          <span className="flex-1 text-[13px] leading-[1.4] text-mid">
            Corregir la sesión · series, pesos, reps
          </span>
          <span aria-hidden className="text-[13px] leading-none text-faint">
            ›
          </span>
        </Link>

        <div className="min-h-5 flex-1" />
      </div>

      {/* Nothing here competes with the numbers: the kit's bar has no
          outline tone, so the neutral skin is overridden on the anchor. */}
      <LinkBar
        href="/"
        tone="ink"
        className="[&>a]:border-[1.5px] [&>a]:border-edge [&>a]:bg-surface [&>a]:text-ink"
      >
        Volver a hoy
      </LinkBar>
    </div>
  );
}
