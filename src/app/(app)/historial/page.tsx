import {
  TONE,
  accentFor,
  cellColour,
  STATUS_LABEL,
  statusTone,
} from "@/components/day-accents";
import {
  Footnote,
  Row,
  RowStack,
  ScreenHeader,
  SectionLabel,
  StatGrid,
} from "@/components/ui/kit";
import { requireAthlete } from "@/lib/data/athlete";
import {
  formatDayShort,
  formatSeasonRange,
  phaseEnd,
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
  cycleOf,
  epley1RM,
  formatTonnage,
  formatWeight,
  isDeloadWeek,
} from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";

import { HistoryLog, type HistoryEntry } from "./history-log";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Coloured left rule per engine event kind. */
const EVENT_TONE: Record<string, string> = {
  fail_hold: TONE.warn,
  fail_penalty: TONE.fail,
  clean_reset: TONE.ok,
  lthr_test: accentFor("run"),
  ai_change: accentFor("strength"),
  cycle_bump: accentFor("strength"),
};

const LEGEND: Array<{ label: string; background: string; border: string }> = [
  { label: "Fuerza", background: accentFor("strength"), border: "transparent" },
  { label: "Carrera", background: accentFor("run"), border: "transparent" },
  {
    label: "Movilidad",
    background: accentFor("mobility"),
    border: "transparent",
  },
  { label: "Parcial", background: TONE.warn, border: "transparent" },
  { label: "Sin registrar", background: TONE.ink, border: "transparent" },
  { label: "Por venir", background: "transparent", border: "#cdcac1" },
];

const dayKey = (date: string, slotId: string | null) => `${date}|${slotId ?? ""}`;

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
  return new Map(rows.filter((row): row is NonNullable<typeof row> => row !== null));
}

interface LiftRecord {
  lift: LiftRow;
  best: { weightKg: number; reps: number; date: IsoDate; epleyKg: number } | null;
}

export default async function HistorialPage() {
  const athlete = await requireAthlete();
  const { ctx, config, placement, today, userId } = athlete;
  const { program } = ctx;
  const phase = ctx.phases.find((p) => p.id === placement.phase.id)!;
  const phases = [...ctx.phases].sort((a, b) => a.position - b.position);

  const supabase = await createClient();
  const [
    { data: sessionRows },
    { data: eventRows },
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
    supabase
      .from("engine_events")
      .select("*")
      .eq("user_id", userId)
      .or(`program_id.eq.${program.id},program_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(40),
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
  const runBySession = new Map((runRows ?? []).map((r) => [r.session_id, r] as const));
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

  const totalTonnage = sessions.reduce((acc, s) => acc + Number(s.tonnage_kg ?? 0), 0);

  let runSeconds = 0;
  for (const s of sessions) {
    if (groupOf(s.session_type) !== "run") continue;
    if (s.status !== "done" && s.status !== "partial") continue;
    const logged = s.duration_seconds ?? runBySession.get(s.id)?.duration_seconds ?? null;
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

  /* ── consistency grid, current phase ─────────────────────────── */

  const phaseConfig = phaseEngineConfig(config, phase);
  const gridWeeks = Array.from({ length: phase.weeks }, (_, i) => {
    const week = i + 1;
    const days = seasonDays.filter(
      (d) => d.phaseId === phase.id && d.week === week,
    );
    return {
      week,
      label: `S${week}${isDeloadWeek(week, phaseConfig) ? "D" : ""}`,
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
    const loggedSeconds = s.duration_seconds ?? runLog?.duration_seconds ?? null;

    const details: Array<{ label: string; value: string }> = [];
    let subtitle = day?.subtitle ?? "";
    let headline = "—";

    if (group === "strength") {
      const primary = day?.primary ?? null;
      const planned = day?.totalSets ?? 0;
      const tonnageKg = Number(s.tonnage_kg ?? 0);
      headline = tonnageKg > 0 ? formatTonnage(tonnageKg) : `${logs.length} ser.`;

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
      const basicWeight = primaryLogs.find((l) => l.weight_kg != null)?.weight_kg;
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
      );
    } else {
      const mob =
        mobilityBySession.get(s.id) ?? mobilityByDate.get(s.scheduled_on) ?? null;
      const total = mob?.total_items ?? 0;
      const done = mob?.completed_slugs.length ?? 0;
      subtitle = subtitle || "Movilidad y correctivos";
      headline = total > 0 ? `${done}/${total}` : formatMinutes(loggedSeconds);
      details.push(
        { label: "Ejercicios", value: total > 0 ? `${done}/${total}` : "—" },
        { label: "Duración", value: formatMinutes(loggedSeconds) },
      );
    }

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
    };
  });

  /* ── header copy ─────────────────────────────────────────────── */

  const spans = phaseSpans(ctx.phases);
  const lastSpan = [...spans].sort((a, b) => a.position - b.position).at(-1);
  const seasonEnd = program.ends_on ?? (lastSpan ? phaseEnd(lastSpan) : program.starts_on);
  const season = formatSeasonRange(program.starts_on, seasonEnd).toUpperCase();
  const cycle = cycleOf(placement.week, phaseConfig.cycleWeeks);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        eyebrow="HISTORIAL"
        right={
          <span className="text-[11px] leading-none font-medium opacity-60">
            TEMPORADA {season}
          </span>
        }
        title={`${phase.key} ${phase.name.toUpperCase()}`}
        subtitle={`SEMANA ${placement.week} DE ${phase.weeks} · CICLO ${cycle}`}
      />

      <div className="flex-1 overflow-auto">
        <StatGrid
          columns={2}
          items={[
            {
              value: adherence == null ? "—" : adherence,
              unit: adherence == null ? undefined : "%",
              label: "Adherencia",
              tone:
                adherence == null
                  ? "text-ghost"
                  : adherence >= 90
                    ? "text-ok"
                    : adherence < 70
                      ? "text-warn"
                      : undefined,
            },
            { value: registered, label: "Sesiones registradas" },
            { value: formatTonnage(totalTonnage), label: "Tonelaje acumulado" },
            { value: formatWeight(runHours), unit: "h", label: "Horas de carrera" },
          ]}
        />

        {/* ── consistency ─────────────────────────────────────── */}

        <SectionLabel right="L M X J V S D">
          CONSTANCIA · {phase.weeks} SEMANAS
        </SectionLabel>

        <div className="mt-2.5 flex flex-col gap-1 pb-1">
          {gridWeeks.map((row) => (
            <div key={row.week} className="flex items-center gap-1.5 px-4">
              <span className="num w-[26px] flex-none text-[9.5px] leading-none font-extrabold tracking-[0.04em] text-mid">
                {row.label}
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
                      className="h-[15px] flex-1 border"
                      style={{
                        background: colour.background,
                        borderColor: colour.border,
                      }}
                    />
                  );
                })}
              </div>
              <span className="num w-8 flex-none text-right text-[9.5px] leading-none font-semibold text-faint">
                {row.pct == null ? "—" : `${row.pct}%`}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 flex-none border"
                style={{ background: l.background, borderColor: l.border }}
              />
              <span className="text-[9px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                {l.label}
              </span>
            </span>
          ))}
        </div>

        {/* ── records ─────────────────────────────────────────── */}

        <SectionLabel>RÉCORDS · MEJOR SERIE REGISTRADA</SectionLabel>

        <RowStack className="mt-2.5">
          {records.length === 0 ? (
            <Row>
              <p className="text-[11.5px] leading-[1.5] text-faint">
                Este programa no tiene básicos con RM asociada, así que no hay
                récords que seguir.
              </p>
            </Row>
          ) : (
            records.map(({ lift, best }) => (
              <Row key={lift.id} className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] leading-[1.2] font-bold">
                    {lift.name}
                  </div>
                  <div className="mt-1 text-[10px] leading-none text-faint">
                    {best ? formatDayShort(best.date) : "sin series registradas"}
                  </div>
                  <div className="num mt-2 text-[17px] leading-none font-black tracking-[-0.02em]">
                    {best ? `${formatWeight(best.weightKg)} × ${best.reps}` : "—"}
                  </div>
                  <div className="num mt-1.5 text-[10px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                    RM EST. {formatWeight(Number(lift.e1rm_kg))} kg
                  </div>
                </div>
                {best ? (
                  <div className="flex-none text-right">
                    <div className="num text-[17px] leading-none font-black tracking-[-0.02em] text-ok">
                      {formatWeight(best.epleyKg)}
                    </div>
                    <div className="mt-1.5 text-[9.5px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                      kg epley
                    </div>
                  </div>
                ) : null}
              </Row>
            ))
          )}
        </RowStack>

        {/* ── log ─────────────────────────────────────────────── */}

        <SectionLabel right={entries.length > 0 ? `${entries.length} SESIONES` : undefined}>
          REGISTRO
        </SectionLabel>
        <HistoryLog entries={entries} />

        {/* ── engine timeline ─────────────────────────────────── */}

        <SectionLabel>LÍNEA DE TIEMPO DEL MOTOR</SectionLabel>

        <RowStack className="mt-2.5">
          {(eventRows ?? []).length === 0 ? (
            <Row>
              <p className="text-[11.5px] leading-[1.5] text-faint">
                El motor no ha tocado nada todavía. Cada ajuste queda aquí, con
                su semana y su detalle.
              </p>
            </Row>
          ) : (
            (eventRows ?? []).map((e) => {
              const reverted = Boolean(e.reverted_at);
              return (
                <Row key={e.id}>
                  <div
                    className="border-l-[6px] py-0.5 pl-3"
                    style={{ borderColor: EVENT_TONE[e.kind] ?? TONE.ink }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="num text-[9.5px] leading-none font-semibold tracking-[0.1em] text-faint uppercase">
                        SEM {e.week ?? "—"}
                      </span>
                      {reverted ? (
                        <span className="text-[9.5px] leading-none font-semibold tracking-[0.1em] text-ghost uppercase">
                          deshecho
                        </span>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        "mt-1.5 text-[12.5px] leading-[1.2] font-bold",
                        reverted && "text-ghost line-through",
                      )}
                    >
                      {e.title}
                    </div>
                    {e.detail ? (
                      <div className="mt-1.5 text-[11.5px] leading-[1.5] text-mid">
                        {e.detail}
                      </div>
                    ) : null}
                  </div>
                </Row>
              );
            })
          )}
        </RowStack>

        <Footnote>
          La adherencia cuenta los días de fuerza y carrera ya pasados; el día
          en curso entra cuando lo cierras y una sesión parcial suma media. La
          movilidad se registra aparte y no cuenta como entrenamiento, el
          descanso tampoco. Las horas de carrera usan la duración registrada; si
          marcaste la sesión sin cronómetro, cuenta el objetivo previsto.
        </Footnote>
      </div>
    </div>
  );
}
