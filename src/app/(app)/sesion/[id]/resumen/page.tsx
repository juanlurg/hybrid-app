import { notFound } from "next/navigation";

import { accentFor, TONE } from "@/components/day-accents";
import {
  Callout,
  Footnote,
  LinkBar,
  Row,
  RowStack,
  RuleNote,
  SectionLabel,
  StatGrid,
} from "@/components/ui/kit";
import { requireAthlete } from "@/lib/data/athlete";
import { formatDayLong, placeDate } from "@/lib/domain/calendar";
import {
  groupOf,
  liftStateFrom,
  phaseSpans,
  resolveExercise,
  weightLabelFor,
  type LoadMode,
  type SessionStatus,
  type SetLogRow,
} from "@/lib/domain/plan";
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

const STATUS_TONE: Record<SessionStatus, string> = {
  done: "text-ok-bright",
  partial: "text-warn",
  skipped: "text-fail",
  in_progress: "text-strength",
  planned: "text-quiet",
};

/** "52′", "1 h 05′". Never a bare number of seconds. */
function formatMinutes(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total}′`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")}′`;
}

interface ExerciseSummary {
  key: string;
  name: string;
  isPrimary: boolean;
  /** Sets the plan asked for, deload included. Null when off-plan. */
  plannedSets: number | null;
  doneSets: number;
  missedSets: number;
  /** "5 · 5 · 4" — what was actually logged. */
  repsLabel: string;
  weightLabel: string;
}

/** Everything here comes off `set_logs`; nothing is estimated. */
function summarise(
  key: string,
  name: string,
  isPrimary: boolean,
  plannedSets: number | null,
  loadMode: LoadMode | null,
  rows: SetLogRow[],
): ExerciseSummary {
  const raw = rows.find((r) => r.weight_kg != null)?.weight_kg;
  const loggedKg = raw == null ? null : Number(raw);
  return {
    key,
    name,
    isPrimary,
    plannedSets,
    doneSets: rows.length,
    missedSets: rows.filter((r) => r.missed_range).length,
    repsLabel: rows
      .map((r) => (r.reps == null ? "—" : String(r.reps)))
      .join(" · "),
    weightLabel: loadMode
      ? weightLabelFor(loadMode, loggedKg)
      : loggedKg == null
        ? "—"
        : `${formatWeight(loggedKg)} kg`,
  };
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
  const accent = accentFor(group);

  const duration = formatMinutes(session.duration_seconds);
  const subtitle = [formatDayLong(session.scheduled_on), duration]
    .filter(Boolean)
    .join(" · ");

  // The wave runs on the absolute program week, not the week inside the phase.
  const absoluteWeek =
    placeDate(phaseSpans(ctx.phases), session.scheduled_on)?.absoluteWeek ??
    session.week;

  const liftsByKey = new Map(
    ctx.lifts.map((l) => [l.key, liftStateFrom(l)] as const),
  );
  const slotExercises = ctx.exercises
    .filter((e) => e.slot_id === session.slot_id)
    .sort((a, b) => a.position - b.position);
  const planned = slotExercises.map((e) =>
    resolveExercise(e, absoluteWeek, config, liftsByKey),
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
     read off ResolvedExercise — no load is ever computed in a screen. */
  const primaryRow = slotExercises.find((e) => e.is_primary);
  const next = primaryRow
    ? resolveExercise(primaryRow, absoluteWeek + 1, config, liftsByKey)
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none bg-ink px-4 pt-5 pb-5 text-paper">
        <div
          className={cn(
            "text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase",
            STATUS_TONE[session.status],
          )}
        >
          {STATUS_EYEBROW[session.status]}
        </div>
        <h1 className="mt-3 text-[40px] leading-[1.02] font-black tracking-[-0.035em] uppercase">
          {title}
        </h1>
        <p className="mt-3 text-[12px] leading-none font-medium opacity-60">
          {subtitle}
        </p>
      </header>
      <div className="h-2 flex-none" style={{ background: accent }} />

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <StatGrid
          columns={3}
          items={[
            {
              value: logs.length,
              unit: plannedSets > 0 ? `de ${plannedSets}` : undefined,
              label: "Series",
            },
            { value: tonnageValue, unit: tonnageUnit, label: "Tonelaje" },
            {
              value: standing,
              label: "Ajustes",
              tone: standing > 0 ? "text-warn" : undefined,
            },
          ]}
        />

        <SectionLabel
          right={
            reverted.length > 0
              ? `${reverted.length} ${reverted.length === 1 ? "deshecho" : "deshechos"}`
              : undefined
          }
        >
          Cambios del motor
        </SectionLabel>
        <RowStack className="mt-2.5">
          {engineEvents.length === 0 ? (
            <Row>
              <RuleNote
                tone={logs.length === 0 ? TONE.line : TONE.ok}
                title={
                  logs.length === 0
                    ? "Sin datos que procesar"
                    : "El motor no ha tocado nada"
                }
              >
                {logs.length === 0
                  ? "Esta sesión se cerró sin ninguna serie registrada, así que ni la RM ni los pesos han cambiado."
                  : "Ninguna serie del básico del día cayó por debajo del rango, así que la ola sigue su curso."}
              </RuleNote>
            </Row>
          ) : (
            engineEvents.map((event) => (
              <Row key={event.id}>
                <RuleNote
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
              </Row>
            ))
          )}
        </RowStack>

        {next?.breakdown ? (
          <div className="mx-4 mt-3.5">
            <Callout
              eyebrow="La próxima vez"
              eyebrowTone={
                next.breakdown.isHeld ? "text-warn" : "text-ok-bright"
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

        {missed.length > 0 ? (
          <>
            <SectionLabel right={`${missed.length} de ${logs.length}`}>
              Series fuera de rango
            </SectionLabel>
            <RowStack className="mt-2.5">
              {missed.map((m) => (
                <Row key={m.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] leading-[1.2] font-bold">
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
                    <div className="text-[12.5px] leading-none font-extrabold text-fail">
                      <span className="num">{m.reps ?? "—"}</span> reps
                    </div>
                    <div className="mt-1 text-[9.5px] leading-none font-medium text-mid">
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

        {group === "strength" || summaries.length > 0 ? (
          <>
            <SectionLabel>Series registradas</SectionLabel>
            <RowStack className="mt-2.5">
              {summaries.length === 0 ? (
                <Row>
                  <div className="text-[13px] leading-[1.2] font-bold">
                    Nada registrado
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-[1.5] text-mid">
                    Esta sesión no tiene series guardadas y el bloque ya no
                    tiene ejercicios asignados.
                  </p>
                </Row>
              ) : (
                summaries.map((s) => (
                  <Row key={s.key} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "truncate text-[13.5px] leading-[1.2] font-bold",
                            s.doneSets === 0 && "text-ghost",
                          )}
                        >
                          {s.name}
                        </span>
                        {s.isPrimary ? (
                          <span className="flex-none text-[9.5px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                            Básico
                          </span>
                        ) : null}
                      </div>
                      <div
                        className={cn(
                          "mt-1 truncate text-[11px] leading-[1.35]",
                          s.doneSets === 0 ? "text-hairline" : "text-mid",
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
                          "num text-[12.5px] leading-none font-extrabold",
                          s.doneSets === 0 && "text-ghost",
                        )}
                      >
                        {s.weightLabel}
                      </div>
                      <div
                        className={cn(
                          "mt-1 text-[9.5px] leading-none font-medium",
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
                  </Row>
                ))
              )}
            </RowStack>
          </>
        ) : null}

        <div className="min-h-5 flex-1" />
      </div>

      <LinkBar href="/" tone="ink">
        Cerrar
      </LinkBar>
    </div>
  );
}
