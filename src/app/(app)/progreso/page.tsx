import {
  TONE,
  accentFor,
  cellColour,
  STATUS_LABEL,
  statusTone,
} from "@/components/day-accents";
import { Footnote, Framed, Row, RowStack, SectionLabel } from "@/components/ui/kit";
import { requireAthlete } from "@/lib/data/athlete";
import { formatDayShort, placeDate, type IsoDate } from "@/lib/domain/calendar";
import {
  groupOf,
  phaseEngineConfig,
  phaseSpans,
  resolveWeek,
  type LiftRow,
  type ResolvedDay,
  type SessionRow,
  type SessionStatus,
} from "@/lib/domain/plan";
import {
  epley1RM,
  formatTonnage,
  formatWeight,
  isDeloadWeek,
} from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";

import { HistoryLog, type HistoryEntry } from "./history-log";
import { HistoryTabs } from "./history-tabs";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Pa:HR only means something on the long, steady stuff. */
const DECOUPLING_LIMIT = 5;

/**
 * Every fill `cellColour` can return, in its own words. No `colour` is the
 * dashed outline the grid draws for a day still ahead.
 */
const LEGEND: Array<{ label: string; colour?: string }> = [
  { label: "fuerza", colour: accentFor("strength") },
  { label: "carrera", colour: accentFor("run") },
  { label: "movilidad", colour: accentFor("mobility") },
  { label: "descanso", colour: accentFor("rest") },
  { label: "parcial", colour: TONE.warn },
  { label: "sin registrar", colour: TONE.soft },
  { label: "por venir" },
];

const dayKey = (date: string, slotId: string | null) =>
  `${date}|${slotId ?? ""}`;

/** "52′", "1 h 05′". Never a bare number of seconds. */
function formatMinutes(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total}′`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")}′`;
}

interface BestSet {
  weightKg: number;
  reps: number;
  sessionId: string;
  loggedAt: string;
}

/**
 * The heaviest set ever logged for each basic.
 *
 * One query per lift, one row each: a single ordered query over every set
 * would need a cap, and the cap would silently drop the lighter lifts —
 * a press record buried under hundreds of heavier squat sets would read
 * as "no hay récord" when there is one.
 */
async function bestSetPerLift(
  supabase: Supabase,
  userId: string,
  lifts: LiftRow[],
): Promise<Map<string, BestSet>> {
  const rows = await Promise.all(
    lifts.map(async (lift) => {
      const { data } = await supabase
        .from("set_logs")
        .select("weight_kg, reps, session_id, logged_at")
        .eq("user_id", userId)
        .eq("lift_key", lift.key)
        .not("weight_kg", "is", null)
        .not("reps", "is", null)
        .order("weight_kg", { ascending: false })
        .order("reps", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data || data.weight_kg == null || data.reps == null) return null;
      return [
        lift.key,
        {
          weightKg: Number(data.weight_kg),
          reps: data.reps,
          sessionId: data.session_id,
          loggedAt: data.logged_at,
        },
      ] as const;
    }),
  );
  return new Map(
    rows.filter((row): row is NonNullable<typeof row> => row !== null),
  );
}

interface LiftRecord {
  lift: LiftRow;
  best: {
    weightKg: number;
    reps: number;
    date: IsoDate;
    epleyKg: number;
  } | null;
}

/**
 * Progreso: what has actually happened — adherence, records, the log and
 * the running trend. What the engine will do lives in /motor.
 */
export default async function ProgresoPage() {
  const athlete = await requireAthlete();
  const { ctx, config, placement, today, userId, seasonWeeks } = athlete;
  const { program } = ctx;
  const phase = ctx.phases.find((p) => p.id === placement.phase.id)!;
  const phases = [...ctx.phases].sort((a, b) => a.position - b.position);

  const supabase = await createClient();
  const [
    { data: sessionRows },
    { data: runRows },
    { data: mobilityRows },
    bestByLift,
  ] = await Promise.all([
    supabase
      .from("sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("program_id", program.id)
      .order("scheduled_on", { ascending: false }),
    supabase.from("run_logs").select("*").eq("user_id", userId),
    supabase.from("mobility_logs").select("*").eq("user_id", userId),
    bestSetPerLift(supabase, userId, ctx.lifts),
  ]);

  const sessions: SessionRow[] = sessionRows ?? [];
  const sessionById = new Map(sessions.map((s) => [s.id, s] as const));
  const recent = sessions.slice(0, 30);
  const recentIds = recent.map((s) => s.id);

  // Records can point at a session from an earlier program, which the query
  // above does not cover. Only ask for the ones actually missing.
  const recordSessionIds = [...bestByLift.values()]
    .map((b) => b.sessionId)
    .filter((id) => id && !sessionById.has(id));

  const [recentSetsRes, recordSessionsRes] = await Promise.all([
    recentIds.length
      ? supabase
          .from("set_logs")
          .select("*")
          .eq("user_id", userId)
          .in("session_id", recentIds)
      : null,
    recordSessionIds.length
      ? supabase
          .from("sessions")
          .select("id, scheduled_on")
          .eq("user_id", userId)
          .in("id", recordSessionIds)
      : null,
  ]);
  const recentSets = recentSetsRes?.data ?? [];
  const recordDates = new Map<string, IsoDate>([
    ...sessions.map((s) => [s.id, s.scheduled_on as IsoDate] as const),
    ...(recordSessionsRes?.data ?? []).map(
      (s) => [s.id, s.scheduled_on as IsoDate] as const,
    ),
  ]);

  /* ── the season as planned, week by week ─────────────────────── */

  const seasonDays: ResolvedDay[] = [];
  let absoluteWeek = 0;
  for (const p of phases) {
    for (let w = 1; w <= p.weeks; w++) {
      absoluteWeek += 1;
      for (const d of resolveWeek({
        ctx,
        config,
        phase: p,
        week: w,
        absoluteWeek,
      })) {
        seasonDays.push(d);
      }
    }
  }

  const dayByKey = new Map(
    seasonDays.map((d) => [dayKey(d.date, d.slot?.id ?? null), d] as const),
  );
  const sessionByKey = new Map(
    sessions.map((s) => [dayKey(s.scheduled_on, s.slot_id), s] as const),
  );
  const runBySession = new Map(
    (runRows ?? []).map((r) => [r.session_id, r] as const),
  );
  const mobilityBySession = new Map(
    (mobilityRows ?? [])
      .filter((m) => m.session_id)
      .map((m) => [m.session_id as string, m] as const),
  );
  const mobilityByDate = new Map(
    (mobilityRows ?? []).map((m) => [m.performed_on, m] as const),
  );

  /**
   * What happened on a planned day. Mobility never opens a `sessions` row —
   * it is logged item by item in `mobility_logs` — so its state comes from
   * the block itself, not from the absence of a session.
   */
  const statusForDay = (d: ResolvedDay): SessionStatus | null => {
    if (!d.slot) return null;
    const row = sessionByKey.get(dayKey(d.date, d.slot.id));
    if (row) return row.status;
    if (d.group !== "mobility") return null;
    const log = mobilityByDate.get(d.date);
    if (!log) return null;
    const done = log.completed_slugs.length;
    if (done === 0) return null;
    return log.total_items > 0 && done < log.total_items ? "partial" : "done";
  };

  /**
   * Adherence over a set of days. Only strength and running count: the
   * mobility block is daily and explicitly not training, and rest days are
   * not something to comply with. Today only counts once it is closed —
   * a session still pending at nine in the morning is not a miss.
   */
  const tally = (days: ResolvedDay[]) => {
    let elapsed = 0;
    let credit = 0;
    for (const d of days) {
      if (!d.slot || (d.group !== "strength" && d.group !== "run")) continue;
      if (d.date > today) continue;
      const status = statusForDay(d);
      const closed =
        status === "done" || status === "partial" || status === "skipped";
      if (d.date === today && !closed) continue;
      elapsed += 1;
      if (status === "done") credit += 1;
      else if (status === "partial") credit += 0.5;
    }
    return {
      elapsed,
      pct: elapsed === 0 ? null : Math.round((credit / elapsed) * 100),
    };
  };

  /* ── KPIs ────────────────────────────────────────────────────── */

  const adherence = tally(seasonDays).pct;

  const registered = sessions.filter(
    (s) => s.status === "done" || s.status === "partial",
  ).length;

  const totalTonnage = sessions.reduce(
    (acc, s) => acc + Number(s.tonnage_kg ?? 0),
    0,
  );

  let runSeconds = 0;
  for (const s of sessions) {
    if (groupOf(s.session_type) !== "run") continue;
    if (s.status !== "done" && s.status !== "partial") continue;
    const logged =
      s.duration_seconds ?? runBySession.get(s.id)?.duration_seconds ?? null;
    if (logged && logged > 0) {
      runSeconds += logged;
      continue;
    }
    // Marked done without a stopwatch: the prescription's own target stands
    // in, and the footnote says so.
    const day = dayByKey.get(dayKey(s.scheduled_on, s.slot_id));
    runSeconds += (day?.estimatedMinutes ?? 0) * 60;
  }
  const runHours = Math.round((runSeconds / 3600) * 10) / 10;

  /* ── the running trend ───────────────────────────────────────── */

  // CARRERA-juanlu.md calls Pa:HR drift THE progress metric, so it gets a
  // trend, not a strip. Two runs can share a date: the session is the id.
  const spans = phaseSpans(ctx.phases);
  const decouplingSeries = sessions
    .flatMap((s) => {
      const log = runBySession.get(s.id);
      if (!log || log.decoupling_pct == null) return [];
      return [
        {
          id: s.id,
          date: s.scheduled_on as IsoDate,
          pct: Number(log.decoupling_pct),
        },
      ];
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const decouplings = decouplingSeries.slice(-4); // newest last

  // Weekly volume across the season, from the logged distances.
  const kmByWeek = new Map<number, number>();
  for (const s of sessions) {
    const log = runBySession.get(s.id);
    if (!log || log.distance_km == null) continue;
    const week = placeDate(spans, s.scheduled_on as IsoDate)?.absoluteWeek;
    if (week == null) continue;
    kmByWeek.set(week, (kmByWeek.get(week) ?? 0) + Number(log.distance_km));
  }
  const maxWeekKm = Math.max(0, ...kmByWeek.values());

  // One tick per cycle on the season axis, thinned further on long seasons:
  // with 39 semanas cada celda mide ~7 px y un número de dos cifras no cabe.
  const tickEvery = Math.max(1, config.cycleWeeks, Math.ceil(seasonWeeks / 10));
  const tickWeeks: number[] = [];
  for (let w = 1; w <= seasonWeeks; w += tickEvery) tickWeeks.push(w);
  const lastTick = tickWeeks[tickWeeks.length - 1] ?? 0;
  if (seasonWeeks - lastTick >= 2) tickWeeks.push(seasonWeeks);
  const ticks = new Set(tickWeeks);

  /* ── consistency grid, current phase ─────────────────────────── */

  const phaseConfig = phaseEngineConfig(config, phase);
  const gridWeeks = Array.from({ length: phase.weeks }, (_, i) => {
    const week = i + 1;
    const days = seasonDays.filter(
      (d) => d.phaseId === phase.id && d.week === week,
    );
    return {
      week,
      label: `S${week}`,
      deload: isDeloadWeek(week, phaseConfig),
      days,
      pct: tally(days).pct,
    };
  });

  /* ── records ─────────────────────────────────────────────────── */

  const records: LiftRecord[] = ctx.lifts.map((lift) => {
    const best = bestByLift.get(lift.key);
    if (!best) return { lift, best: null };
    const date = (recordDates.get(best.sessionId) ??
      best.loggedAt.slice(0, 10)) as IsoDate;
    return {
      lift,
      best: {
        weightKg: best.weightKg,
        reps: best.reps,
        date,
        epleyKg: epley1RM(best.weightKg, best.reps),
      },
    };
  });

  /* ── the log ─────────────────────────────────────────────────── */

  const entries: HistoryEntry[] = recent.map((s) => {
    const group = groupOf(s.session_type);
    const day = dayByKey.get(dayKey(s.scheduled_on, s.slot_id)) ?? null;
    const logs = recentSets
      .filter((l) => l.session_id === s.id)
      .sort((a, b) => a.position - b.position || a.set_index - b.set_index);
    const runLog = runBySession.get(s.id) ?? null;
    const loggedSeconds =
      s.duration_seconds ?? runLog?.duration_seconds ?? null;

    const details: Array<{ label: string; value: string }> = [];
    let subtitle = day?.subtitle ?? "";
    let headline = "—";

    if (group === "strength") {
      const primary = day?.primary ?? null;
      const planned = day?.totalSets ?? 0;
      const tonnageKg = Number(s.tonnage_kg ?? 0);
      headline =
        tonnageKg > 0 ? formatTonnage(tonnageKg) : `${logs.length} ser.`;

      // The basic as it was actually lifted that day. Never the weight the
      // engine would prescribe for it today — the RM has moved since.
      const primaryLogs = primary
        ? logs.filter(
            (l) =>
              l.program_exercise_id === primary.id ||
              (primary.liftKey != null && l.lift_key === primary.liftKey),
          )
        : logs.filter((l) => l.position === logs[0]?.position);
      const basicName = primary?.name ?? primaryLogs[0]?.exercise_name ?? null;
      const basicWeight = primaryLogs.find(
        (l) => l.weight_kg != null,
      )?.weight_kg;
      const basicReps = primaryLogs.map((l) => l.reps ?? 0).join("·");
      const basic =
        primaryLogs.length === 0
          ? null
          : basicWeight != null
            ? `${formatWeight(Number(basicWeight))} kg × ${basicReps}`
            : `${basicReps} reps`;

      subtitle = basicName
        ? `${basicName} · ${basic ?? "sin series registradas"}`
        : subtitle || s.title;

      details.push(
        {
          label: "Series",
          value: planned ? `${logs.length}/${planned}` : String(logs.length),
        },
        { label: "Básico", value: basic ?? "—" },
        {
          label: "Tonelaje",
          value: tonnageKg > 0 ? formatTonnage(tonnageKg) : "—",
        },
        { label: "Duración", value: formatMinutes(loggedSeconds) },
      );
    } else if (group === "run") {
      const targetMinutes = day?.estimatedMinutes ?? 0;
      subtitle =
        runLog?.prescription || day?.prescription || subtitle || s.title;
      headline = loggedSeconds
        ? formatMinutes(loggedSeconds)
        : targetMinutes > 0
          ? `${targetMinutes}′`
          : "—";
      details.push(
        { label: "Duración", value: formatMinutes(loggedSeconds) },
        {
          label: "Previsto",
          value: targetMinutes > 0 ? `${targetMinutes}′` : "—",
        },
        {
          label: "Distancia",
          value:
            runLog?.distance_km == null
              ? "—"
              : `${formatWeight(Number(runLog.distance_km))} km`,
        },
        { label: "Zona dominante", value: runLog?.dominant_zone || "—" },
        {
          label: "Desacople",
          value:
            runLog?.decoupling_pct == null
              ? "—"
              : `${formatWeight(Number(runLog.decoupling_pct))} %`,
        },
        {
          label: "RPE",
          value:
            runLog?.perceived_effort == null
              ? "—"
              : String(runLog.perceived_effort),
        },
      );
    } else {
      const mob =
        mobilityBySession.get(s.id) ??
        mobilityByDate.get(s.scheduled_on) ??
        null;
      const total = mob?.total_items ?? 0;
      const done = mob?.completed_slugs.length ?? 0;
      subtitle = subtitle || "Movilidad y correctivos";
      headline = total > 0 ? `${done}/${total}` : formatMinutes(loggedSeconds);
      details.push(
        { label: "Ejercicios", value: total > 0 ? `${done}/${total}` : "—" },
        { label: "Duración", value: formatMinutes(loggedSeconds) },
      );
    }

    // The expanded panel links out to the session's own screen: the log
    // is the index, the resumen (or the run page) is the record.
    const href =
      group === "strength" && (s.status === "done" || s.status === "partial")
        ? `/sesion/${s.id}/resumen`
        : group === "run" && s.status !== "skipped"
          ? `/carrera/${s.scheduled_on}`
          : null;

    return {
      id: s.id,
      group,
      accent: accentFor(group),
      title: s.title || day?.title || "Sesión",
      status: s.status,
      statusLabel: STATUS_LABEL[s.status],
      statusTone: statusTone(s.status),
      subtitle,
      headline,
      dateLabel: formatDayShort(s.scheduled_on),
      incomplete: s.status === "partial" || s.status === "skipped",
      details,
      href,
    };
  });

  /* ── header copy ─────────────────────────────────────────────── */

  // `formatTonnage` hands back "9,7 t"; the tile draws the unit smaller.
  const [tonnage, tonnageUnit] = formatTonnage(totalTonnage).split(" ");

  const kpis: Array<{
    label: string;
    value: string | number;
    unit?: string;
    tone?: string;
  }> = [
    {
      label: "adherencia",
      value: adherence ?? "—",
      unit: adherence == null ? undefined : "%",
      // A bad week must not be painted the same green as a good one.
      tone:
        adherence == null
          ? "text-faint"
          : adherence >= 90
            ? "text-lime"
            : adherence < 70
              ? "text-warn"
              : "text-ink",
    },
    { label: "sesiones registradas", value: registered },
    { label: "tonelaje acumulado", value: tonnage, unit: tonnageUnit },
    { label: "horas de carrera", value: formatWeight(runHours), unit: "h" },
  ];


  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none px-5 pt-6">
        <h1 className="font-display text-[26px] leading-[1.1] font-bold">
          Progreso
        </h1>
      </header>

      <div className="flex-1 overflow-auto pb-6">
        <div className="grid grid-cols-2 gap-1.5 px-5 pt-3.5">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-line bg-surface px-4 py-3.5"
            >
              <div
                className={cn(
                  "num flex items-baseline gap-1 text-[26px] leading-none font-bold tracking-[-0.02em]",
                  k.tone,
                )}
              >
                <span>{k.value}</span>
                {k.unit ? <span className="text-[14px]">{k.unit}</span> : null}
              </div>
              <div className="mt-1.5 text-[12px] leading-[1.25] text-mid">
                {k.label}
              </div>
            </div>
          ))}
        </div>

        <HistoryTabs
          constancia={
            <>
              <SectionLabel
                className="pt-4"
                right={<span className="text-[12px]">L M X J V S D</span>}
              >
                {phase.name} · {phase.weeks} semanas
              </SectionLabel>

              <div className="mt-2.5 flex flex-col gap-[5px] pb-1">
                {gridWeeks.map((row) => {
                  // Weeks the athlete has not reached yet read as a plan, not a score.
                  const ahead = row.week > placement.week;
                  return (
                    <div
                      key={row.week}
                      className="flex items-center gap-2 px-5"
                    >
                      <span
                        className={cn(
                          "font-display w-[30px] flex-none text-[11px] leading-none font-semibold",
                          ahead ? "text-faint" : "text-mid",
                        )}
                        title={row.deload ? "Semana de descarga" : undefined}
                      >
                        {row.label}
                        {row.deload ? (
                          <span className="text-faint">↓</span>
                        ) : null}
                      </span>
                      <div className="flex flex-1 gap-1">
                        {row.days.map((d) => {
                          const colour = cellColour(
                            d.group,
                            statusForDay(d),
                            d.date > today,
                          );
                          return (
                            <div
                              key={d.date}
                              title={`${d.dateLabel} · ${d.title}`}
                              className={cn(
                                "h-4 flex-1 rounded-[4px] border",
                                // No fill is how `cellColour` says "still ahead".
                                colour.background === "transparent" &&
                                  "border-dashed",
                              )}
                              style={{
                                background: colour.background,
                                borderColor: colour.border,
                              }}
                            />
                          );
                        })}
                      </div>
                      <span
                        className={cn(
                          "num w-[36px] flex-none text-right text-[11px] leading-none font-semibold",
                          ahead ? "text-faint" : "text-mid",
                        )}
                      >
                        {row.pct == null ? "—" : `${row.pct}%`}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-3">
                {LEGEND.map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5">
                    {l.colour ? (
                      /* The hairline outline is what makes the palest fills —
                         "sin registrar" against the page — visible at 10px. */
                      <span
                        className="h-[10px] w-[10px] flex-none rounded-[3px] border border-hairline"
                        style={{ background: l.colour }}
                      />
                    ) : (
                      <span className="h-[10px] w-[10px] flex-none rounded-[3px] border border-dashed border-hairline" />
                    )}
                    <span className="text-[12px] leading-none text-mid">
                      {l.label}
                    </span>
                  </span>
                ))}
                <span className="text-[12px] leading-none text-mid">
                  ↓ descarga
                </span>
              </div>

              <Footnote>
                La adherencia cuenta los días de fuerza y carrera ya pasados;
                una sesión parcial suma media. La movilidad y el descanso no
                cuentan.
              </Footnote>
            </>
          }
          records={
            <>
              <SectionLabel className="pt-4">Tu mejor serie</SectionLabel>

              <RowStack className="mt-2.5">
                {records.length === 0 ? (
                  <Row>
                    <p className="text-[13px] leading-[1.55] text-mid">
                      Este programa no tiene básicos con RM asociada, así que no
                      hay récords que seguir.
                    </p>
                  </Row>
                ) : (
                  records.map(({ lift, best }) => (
                    <Row key={lift.id} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] leading-[1.2] font-semibold">
                          {lift.name}
                        </div>
                        <div className="mt-0.5 truncate text-[12.5px] leading-[1.35] text-mid">
                          {best
                            ? `${formatDayShort(best.date)} · ${formatWeight(best.weightKg)} kg × ${best.reps}`
                            : "sin series todavía"}
                        </div>
                      </div>
                      {best ? (
                        <span className="flex-none text-right">
                          <span className="num block text-[16px] leading-none font-bold text-lime">
                            {formatWeight(best.epleyKg)} kg
                          </span>
                          <span className="mt-1 block text-[11px] leading-none text-mid">
                            RM que sale
                          </span>
                        </span>
                      ) : null}
                    </Row>
                  ))
                )}
              </RowStack>
              <Footnote>
                La RM que sale de tu mejor serie (fórmula de Epley). La que usa
                el motor para tus pesos está en Plan.
              </Footnote>
            </>
          }
          registro={
            <>
              <SectionLabel
                className="pt-4"
                right={
                  entries.length > 0 ? (
                    <span className="text-[12px]">
                      últimas {entries.length}
                    </span>
                  ) : undefined
                }
              >
                Sesiones
              </SectionLabel>
              <HistoryLog entries={entries} />
            </>
          }
          carrera={
            <div className="px-5 pt-4">
              <Framed>
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-run uppercase">
                    Desacople Pa:HR
                  </span>
                  <span className="ml-auto text-[12px] leading-none text-mid">
                    últimas tiradas
                  </span>
                </div>

                {decouplings.length > 0 ? (
                  <>
                    <div className="mt-3.5 flex gap-1.5">
                      {decouplings.map((d) => (
                        <div
                          key={d.id}
                          className="min-w-0 flex-1 rounded-lg bg-soft px-2.5 py-2.5"
                        >
                          <div
                            className={cn(
                              "num text-[21px] leading-none font-bold tracking-[-0.02em]",
                              d.pct < DECOUPLING_LIMIT ? "text-ok" : "text-warn",
                            )}
                          >
                            {formatWeight(d.pct)}
                            <span className="text-[12px] font-semibold"> %</span>
                          </div>
                          <div className="num mt-2 text-[11.5px] leading-none text-mid">
                            {formatDayShort(d.date)}
                          </div>
                        </div>
                      ))}
                    </div>
                    {decouplingSeries.length > 4 ? (
                      <div className="mt-3.5 flex h-[54px] items-end gap-0.5 border-b border-edge">
                        {decouplingSeries.map((d) => (
                          <div
                            key={d.id}
                            className="min-w-0 flex-1 rounded-t-[2px]"
                            style={{
                              height: `${Math.max(8, Math.min(100, Math.round((d.pct / 10) * 100)))}%`,
                              background:
                                d.pct < DECOUPLING_LIMIT ? TONE.ok : TONE.warn,
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-3 text-[12.5px] leading-[1.5] text-mid">
                      Por debajo del {DECOUPLING_LIMIT} % la base aeróbica
                      aguanta la tirada: tu pulso no se dispara en la segunda
                      mitad.
                    </p>
                  </>
                ) : (
                  <p className="mt-2.5 text-[13px] leading-[1.55] text-mid">
                    Todavía no hay ninguna tirada con desacople anotado. Anótalo
                    al marcar una tirada larga (60′ o más) y aparecerá aquí: por
                    debajo del {DECOUPLING_LIMIT} % la base aeróbica aguanta.
                  </p>
                )}
              </Framed>

              <Framed className="mt-3.5">
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-run uppercase">
                    Kilómetros por semana
                  </span>
                  {maxWeekKm > 0 ? (
                    <span className="num ml-auto text-[12px] leading-none text-mid">
                      máx {formatWeight(maxWeekKm)} km
                    </span>
                  ) : null}
                </div>
                {maxWeekKm > 0 ? (
                  <>
                    <div className="mt-3.5 flex h-[54px] items-end gap-0.5 border-b border-edge">
                      {Array.from({ length: seasonWeeks }, (_, i) => {
                        const km = kmByWeek.get(i + 1) ?? 0;
                        return (
                          <div
                            key={i}
                            className="min-w-0 flex-1 rounded-t-[2px]"
                            style={{
                              height: `${km > 0 ? Math.max(6, Math.round((km / maxWeekKm) * 100)) : 2}%`,
                              background:
                                km > 0 ? accentFor("run") : TONE.hairline,
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="mt-1.5 flex gap-0.5">
                      {Array.from({ length: seasonWeeks }, (_, i) => (
                        <div
                          key={i}
                          className="num min-w-0 flex-1 text-center text-[11px] leading-none text-mid"
                        >
                          {ticks.has(i + 1) ? i + 1 : ""}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="mt-2.5 text-[13px] leading-[1.55] text-mid">
                    Anota la distancia al marcar cada carrera y aquí verás el
                    volumen de cada semana.
                  </p>
                )}
                <p className="mt-3 text-[12.5px] leading-[1.5] text-mid">
                  {runHours > 0
                    ? `${formatWeight(runHours)} h de carrera esta temporada.`
                    : "Sin horas de carrera todavía."}
                </p>
              </Framed>
            </div>
          }
        />
      </div>
    </div>
  );
}
