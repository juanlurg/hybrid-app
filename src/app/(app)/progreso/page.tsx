import {
  TONE,
  accentFor,
  cellColour,
  STATUS_LABEL,
  statusTone,
} from "@/components/day-accents";
import { Footnote, Row, RowStack } from "@/components/ui/kit";
import { requireAthlete } from "@/lib/data/athlete";
import {
  formatDayShort,
  formatSeasonRange,
  placeDate,
  type IsoDate,
} from "@/lib/domain/calendar";
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
  { label: "parcial", colour: "var(--clay-edge)" },
  { label: "sin registrar", colour: TONE.hairline },
  { label: "descanso", colour: TONE.soft },
  { label: "por venir" },
];

/** The panes' own heading: big, sentence case, a quiet note on the right. */
function PaneLabel({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 px-5 pt-5 pb-2.5">
      <span className="flex-1 text-[17px] leading-tight font-extrabold tracking-[-0.01em]">
        {children}
      </span>
      {right ? (
        <span className="text-[13px] leading-none font-semibold text-mid">
          {right}
        </span>
      ) : null}
    </div>
  );
}

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
            ? "text-clay"
            : adherence < 70
              ? "text-warn"
              : "text-ink",
    },
    { label: "sesiones", value: registered },
    { label: "tonelaje", value: tonnage, unit: tonnageUnit },
    { label: "de carrera", value: formatWeight(runHours), unit: "h" },
  ];


  const seasonWeek = Math.min(placement.absoluteWeek, seasonWeeks);
  const seasonLabel = ctx.program.starts_on
    ? formatSeasonRange(
        ctx.program.starts_on as IsoDate,
        (ctx.program.ends_on ?? ctx.program.starts_on) as IsoDate,
      )
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none px-5 pt-6">
        <h1 className="text-[34px] leading-[1.1] font-extrabold tracking-[-0.02em]">
          Progreso
        </h1>
        <p className="mt-1.5 text-[14px] leading-[1.45] font-medium text-body">
          {seasonLabel ? `Temporada ${seasonLabel} · ` : ""}semana{" "}
          <span className="num">{seasonWeek}</span> de{" "}
          <span className="num">{seasonWeeks}</span>
        </p>
      </header>

      <div className="no-scrollbar flex-1 overflow-auto pb-6">
        <div className="mx-5 mt-4.5 flex items-center gap-4 rounded-3xl bg-panel px-5 py-4.5 text-on-panel shadow-panel">
          <div className="flex-none">
            <div className="flex items-baseline gap-1">
              <span
                className={cn(
                  "num text-[64px] leading-[0.95] font-extrabold tracking-[-0.04em]",
                  adherence != null && adherence < 70 && "text-warn-panel",
                )}
              >
                {adherence ?? "—"}
              </span>
              {adherence == null ? null : (
                <span className="text-[22px] leading-none font-bold text-white/70">
                  %
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[11px] leading-none font-bold tracking-[0.13em] text-clay-panel uppercase">
              Adherencia
            </div>
          </div>
          <div className="flex-1 text-[13px] leading-[1.5] font-medium text-white/70">
            Días de fuerza y carrera ya pasados. Una sesión parcial suma media.
          </div>
        </div>
        <div className="mx-5 mt-2.5 grid grid-cols-3 gap-2">
          {kpis.slice(1).map((k) => (
            <div key={k.label} className="rounded-xl bg-surface p-3.5 shadow-raised">
              <div className="flex items-baseline gap-[3px]">
                <span className="num text-[26px] leading-none font-extrabold tracking-[-0.02em]">
                  {k.value}
                </span>
                {k.unit ? (
                  <span className="text-[13px] leading-none font-bold text-mid">
                    {k.unit}
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 text-[12px] leading-[1.3] font-semibold text-mid">
                {k.label}
              </div>
            </div>
          ))}
        </div>

        <HistoryTabs
          constancia={
            <>
              <PaneLabel right={phase.name}>Constancia</PaneLabel>
              <div className="mx-5 rounded-2xl bg-surface px-3.5 pt-3.5 pb-4 shadow-card">
                <div className="flex items-center gap-2 pb-2">
                  <span className="w-[30px] flex-none" />
                  <div className="grid flex-1 grid-cols-7 gap-1 text-center text-[11px] leading-none font-bold text-mid">
                    {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                  <span className="w-[38px] flex-none" />
                </div>
                <div className="flex flex-col gap-1">
                  {gridWeeks.map((row) => {
                    // Weeks the athlete has not reached yet read as a plan, not a score.
                    const ahead = row.week > placement.week;
                    return (
                      <div key={row.week} className="flex items-center gap-2">
                        <span
                          className={cn(
                            "num w-[30px] flex-none text-[11px] leading-none font-bold",
                            ahead ? "text-faint" : "text-body",
                          )}
                          title={row.deload ? "Semana de descarga" : undefined}
                        >
                          {row.label}
                          {row.deload ? "↓" : null}
                        </span>
                        <div className="grid flex-1 grid-cols-7 gap-1">
                          {row.days.map((d) => {
                            const colour = cellColour(
                              d.group,
                              statusForDay(d),
                              d.date > today,
                            );
                            const isToday = d.date === today;
                            return (
                              <div
                                key={d.date}
                                title={`${d.dateLabel} · ${d.title}`}
                                className={cn(
                                  "box-border h-4 rounded-[5px]",
                                  // No fill is how `cellColour` says "still ahead".
                                  colour.background === "transparent" &&
                                    "border border-dashed",
                                  isToday && "border-2 border-solid",
                                )}
                                style={{
                                  background: isToday
                                    ? "var(--surface)"
                                    : colour.background,
                                  borderColor: isToday
                                    ? "var(--clay-line)"
                                    : colour.border,
                                }}
                              />
                            );
                          })}
                        </div>
                        <span
                          className={cn(
                            "num w-[38px] flex-none text-right text-[11px] leading-none font-bold",
                            ahead ? "text-faint" : "text-body",
                          )}
                        >
                          {row.pct == null ? "—" : `${row.pct} %`}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2">
                  {LEGEND.map((l) => (
                    <span key={l.label} className="flex items-center gap-1.5">
                      {l.colour ? (
                        <span
                          className="h-2.5 w-2.5 flex-none rounded-[3px]"
                          style={{ background: l.colour }}
                        />
                      ) : (
                        <span className="h-2.5 w-2.5 flex-none rounded-[3px] border border-dashed border-hairline" />
                      )}
                      <span className="text-[12px] leading-none font-semibold text-body">
                        {l.label}
                      </span>
                    </span>
                  ))}
                  <span className="text-[12px] leading-none font-semibold text-body">
                    ↓ descarga
                  </span>
                </div>
              </div>

              <Footnote>
                La movilidad y el descanso no cuentan para la adherencia.
              </Footnote>
            </>
          }
          records={
            <>
              <PaneLabel right="RM que sale">Tu mejor serie</PaneLabel>

              <RowStack>
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
                        <div className="truncate text-[15px] leading-[1.25] font-bold">
                          {lift.name}
                        </div>
                        <div className="num mt-0.5 truncate text-[12.5px] leading-[1.35] font-medium text-mid">
                          {best
                            ? `${formatWeight(best.weightKg)} kg × ${best.reps} · ${formatDayShort(best.date)}`
                            : "sin series todavía"}
                        </div>
                      </div>
                      {best ? (
                        <span className="num flex-none text-[17px] leading-none font-extrabold text-clay">
                          {formatWeight(best.epleyKg)} kg
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
              <PaneLabel
                right={
                  entries.length > 0 ? `últimas ${entries.length}` : undefined
                }
              >
                Sesiones
              </PaneLabel>
              <HistoryLog entries={entries} />
            </>
          }
          carrera={
            <>
              <PaneLabel right="tiradas largas">Carrera</PaneLabel>
              <div className="mx-5 rounded-2xl bg-surface p-4 shadow-card">
                <div className="text-[15px] leading-tight font-bold">
                  Desacople Pa:HR
                </div>

                {decouplings.length > 0 ? (
                  <>
                    <div className="mt-3 grid grid-cols-4 gap-1.5">
                      {decouplings.map((d) => {
                        const ok = d.pct < DECOUPLING_LIMIT;
                        return (
                          <div
                            key={d.id}
                            className={cn(
                              "min-w-0 rounded-lg p-2.5",
                              ok ? "bg-soft" : "bg-warn-soft",
                            )}
                          >
                            <div
                              className={cn(
                                "num text-[20px] leading-none font-extrabold",
                                ok ? "text-ok" : "text-warn",
                              )}
                            >
                              {formatWeight(d.pct)}
                              <span className="text-[12px]"> %</span>
                            </div>
                            <div className="num mt-1.5 text-[11.5px] leading-none font-semibold text-mid">
                              {formatDayShort(d.date)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {decouplingSeries.length > 4 ? (
                      <div className="mt-3.5 flex h-[54px] items-end gap-0.5">
                        {decouplingSeries.map((d) => (
                          <div
                            key={d.id}
                            className="min-w-0 flex-1 rounded-t-[3px] rounded-b-[1px]"
                            style={{
                              height: `${Math.max(8, Math.min(100, Math.round((d.pct / 10) * 100)))}%`,
                              background:
                                d.pct < DECOUPLING_LIMIT ? TONE.ok : "var(--warn-dot)",
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-3 text-[12.5px] leading-[1.5] font-medium text-mid">
                      Por debajo del {DECOUPLING_LIMIT} % la base aeróbica
                      aguanta la tirada: tu pulso no se dispara en la segunda
                      mitad.
                    </p>
                  </>
                ) : (
                  <p className="mt-2.5 text-[13px] leading-[1.55] font-medium text-mid">
                    Todavía no hay ninguna tirada con desacople anotado. Anótalo
                    al marcar una tirada larga (60′ o más) y aparecerá aquí: por
                    debajo del {DECOUPLING_LIMIT} % la base aeróbica aguanta.
                  </p>
                )}

                <div className="mt-4.5 flex items-baseline gap-2">
                  <span className="flex-1 text-[15px] leading-tight font-bold">
                    Kilómetros por semana
                  </span>
                  {maxWeekKm > 0 ? (
                    <span className="num text-[12.5px] leading-none font-semibold text-mid">
                      máx {formatWeight(maxWeekKm)} km
                    </span>
                  ) : null}
                </div>
                {maxWeekKm > 0 ? (
                  <>
                    <div className="mt-3 flex h-16 items-end gap-0.5">
                      {Array.from({ length: seasonWeeks }, (_, i) => {
                        const km = kmByWeek.get(i + 1) ?? 0;
                        return (
                          <div
                            key={i}
                            className="min-w-0 flex-1 rounded-t-[3px] rounded-b-[1px]"
                            style={{
                              height: `${km > 0 ? Math.max(8, Math.round((km / maxWeekKm) * 100)) : 6}%`,
                              background: km > 0 ? accentFor("run") : TONE.quiet,
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="mt-1.5 flex gap-0.5">
                      {Array.from({ length: seasonWeeks }, (_, i) => (
                        <div
                          key={i}
                          className="num min-w-0 flex-1 text-center text-[11px] leading-none font-semibold text-mid"
                        >
                          {ticks.has(i + 1) ? i + 1 : ""}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="mt-2.5 text-[13px] leading-[1.55] font-medium text-mid">
                    Anota la distancia al marcar cada carrera y aquí verás el
                    volumen de cada semana.
                  </p>
                )}
              </div>
            </>
          }
        />
      </div>
    </div>
  );
}
