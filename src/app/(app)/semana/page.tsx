import { Check, ChevronRight, Flag } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAthlete, weekContext } from "@/lib/data/athlete";
import {
  phaseEngineConfig,
  resolveWeek,
  type ResolvedDay,
  type SessionStatus,
} from "@/lib/domain/plan";
import { createClient } from "@/lib/supabase/server";
import {
  addDays,
  DAY_LABELS,
  daysBetween,
  formatDayShort,
  formatSeasonRange,
  phaseEnd,
  type IsoDate,
} from "@/lib/domain/calendar";
import { isDeloadWeek, waveFactor, weekInCycle } from "@/lib/engine";
import { Footnote, SectionLabel } from "@/components/ui/kit";
import { DayIcon } from "@/components/day-icon";
import { STATUS_LABEL } from "@/components/day-accents";
import { cn } from "@/lib/cn";

import { PhaseBar, type PhaseInfo } from "./phase-bar";
import { WeekNav } from "./week-nav";

/** The bit of a `sessions` row this screen needs. */
interface WeekSession {
  id: string;
  status: SessionStatus;
}

/**
 * Where a row leads. A session that exists goes to its own screen; any
 * other strength day — future, past, skipped — opens read-only by date.
 */
function hrefFor(
  day: ResolvedDay,
  session: WeekSession | null,
  today: IsoDate,
): string | undefined {
  if (day.group === "run") return `/carrera/${day.date}`;
  if (day.group === "mobility") return "/movilidad";
  if (day.group !== "strength") return undefined;
  if (session?.status === "done" || session?.status === "partial") {
    return `/sesion/${session.id}/resumen`;
  }
  if (session?.status === "in_progress") return `/sesion/${session.id}`;
  return day.date === today ? "/" : `/fuerza/${day.date}`;
}

/**
 * The line under the title. Weights come from the resolved exercise — the
 * engine is the only thing allowed to invent a load, so this only ever
 * reads `weightLabel`, which already carries the unit and the sign.
 */
function subtitleFor(day: ResolvedDay): string {
  if (day.group === "strength" && day.primary) {
    return `${day.primary.name} · ${day.primary.weightLabel}`;
  }
  if (day.group === "run" || day.group === "mobility") {
    const what = day.group === "run" ? day.prescription || day.subtitle : day.subtitle;
    return day.estimatedMinutes > 0 && !what.includes("′")
      ? `${what} · ${day.estimatedMinutes}′`
      : what;
  }
  return day.subtitle;
}

/** The icon tile's colours for a kind of day — tinted, or filled for today. */
function tileFor(day: ResolvedDay, isToday: boolean): string {
  if (day.group === "strength") {
    return isToday ? "bg-strength text-on-strength" : "bg-clay-soft text-clay";
  }
  if (day.group === "run") {
    return isToday ? "bg-run text-on-run" : "bg-run-soft text-run";
  }
  return "bg-soft text-mid";
}

export default async function SemanaPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string | string[] }>;
}) {
  const athlete = await requireAthlete();
  const { ctx, config, today, seasonWeeks } = athlete;
  const { program } = ctx;

  const params = await searchParams;
  const raw = Array.isArray(params.semana) ? params.semana[0] : params.semana;
  const asked = Number.parseInt(raw ?? "", 10);
  const lastWeek = Math.max(1, seasonWeeks);
  const absoluteWeek = Number.isFinite(asked)
    ? Math.min(Math.max(1, asked), lastWeek)
    : athlete.placement.absoluteWeek;

  const context = weekContext(athlete, absoluteWeek);
  if (!context) notFound();
  const { phase, week } = context;

  const days = resolveWeek({ ctx, config, phase, week, absoluteWeek });

  const supabase = await createClient();
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, slot_id, status, scheduled_on")
    .eq("user_id", athlete.userId)
    .in(
      "scheduled_on",
      days.map((d) => d.date),
    );

  const sessionFor = (day: ResolvedDay): WeekSession | null => {
    const slot = day.slot;
    if (!slot) return null;
    return (
      (sessions ?? []).find(
        (s) => s.scheduled_on === day.date && s.slot_id === slot.id,
      ) ?? null
    );
  };

  /** No row yet means the day is still ahead of the athlete, not missing. */
  const statusFor = (
    day: ResolvedDay,
    session: WeekSession | null,
  ): SessionStatus | null => {
    if (!day.slot) return null;
    return session?.status ?? "planned";
  };

  /* ── the note under the title ─────────────────────────────── */
  // The engine reads the phase's own progression and the week inside it;
  // the athlete reads what that means for the bar.
  const phaseConfig = phaseEngineConfig(config, phase);
  const deload = isDeloadWeek(week, phaseConfig);
  const cycleWeek = weekInCycle(week, phaseConfig.cycleWeeks) + 1;
  const wavePct = Math.round(waveFactor(week, phaseConfig) * 100);
  const nextDeload =
    week - cycleWeek + phaseConfig.cycleWeeks;
  const fixed = phaseConfig.progressionMode === "fixed_pct";
  const noteTitle = deload
    ? `Descarga: básicos al ${wavePct} % de la RM`
    : `Básicos al ${wavePct} % de la RM`;
  const note = fixed
    ? "El mismo porcentaje todas las semanas de esta fase."
    : deload
      ? phaseConfig.autoDeload
        ? "La mitad de series y pesos más bajos, a propósito."
        : `Semana ${cycleWeek} de ${phaseConfig.cycleWeeks} del ciclo.`
      : `Semana ${cycleWeek} de ${phaseConfig.cycleWeeks} del ciclo.` +
        (nextDeload <= phase.weeks
          ? ` Descarga en la semana ${nextDeload}.`
          : "");
  // The cycle drawn as bars: what each of its weeks asks of the RM.
  const cycleStart = week - cycleWeek + 1;
  const cycle = fixed
    ? []
    : Array.from({ length: phaseConfig.cycleWeeks }, (_, i) => ({
        week: cycleStart + i,
        pct: Math.round(waveFactor(cycleStart + i, phaseConfig) * 100),
      }));
  const cycleMax = Math.max(...cycle.map((c) => c.pct), 1);
  const cycleMin = Math.min(...cycle.map((c) => c.pct), cycleMax);

  /* ── the season bar ───────────────────────────────────────── */
  const phases = [...ctx.phases].sort((a, b) => a.position - b.position);
  const seasonStart = program.starts_on as IsoDate;
  const seasonEnd = (program.ends_on ??
    addDays(seasonStart, lastWeek * 7 - 1)) as IsoDate;

  const barPhases: PhaseInfo[] = phases.map((p, i) => {
    const firstAbsoluteWeek =
      1 + phases.slice(0, i).reduce((n, q) => n + q.weeks, 0);
    const startsOn = p.starts_on as IsoDate | null;
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      emphasis: p.emphasis,
      notes: p.notes,
      priority: p.priority,
      weeks: p.weeks,
      rangeLabel: startsOn
        ? formatSeasonRange(
            startsOn,
            phaseEnd({
              id: p.id,
              key: p.key,
              name: p.name,
              position: p.position,
              weeks: p.weeks,
              startsOn,
            }),
          )
        : null,
      firstAbsoluteWeek,
      current: p.id === phase.id,
    };
  });

  const planned = days.filter((d) => d.slot).length;
  const weeksToRace = program.race_on
    ? Math.ceil(daysBetween(today, program.race_on as IsoDate) / 7)
    : null;

  // The broken-week note only makes sense on the week being lived now.
  const viewingCurrentWeek = absoluteWeek === athlete.placement.absoluteWeek;
  const missedDays = viewingCurrentWeek
    ? days.filter((d) => {
        if (!d.slot || (d.group !== "strength" && d.group !== "run")) {
          return false;
        }
        if (d.date >= today) return false;
        const s = sessionFor(d);
        return (s?.status ?? "planned") === "planned";
      }).length
    : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-none items-start gap-3 px-5 pt-6">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] leading-none font-bold tracking-[0.13em] text-clay uppercase">
            {phase.name}
          </div>
          <h1 className="mt-2 text-[32px] leading-[1.1] font-extrabold tracking-[-0.02em]">
            Semana {week} de {phase.weeks}
          </h1>
          <div className="num mt-1 text-[14px] leading-none font-medium text-body">
            {formatDayShort(days[0].date)} – {formatDayShort(days[6].date)}
          </div>
        </div>
        <WeekNav
          absoluteWeek={absoluteWeek}
          seasonWeeks={seasonWeeks}
          currentWeek={athlete.placement.absoluteWeek}
        />
      </header>

      <div className="no-scrollbar flex-1 overflow-auto pb-6">
        <div className="mx-5 mt-4.5 flex items-center gap-4 rounded-2xl bg-surface px-4.5 py-4 shadow-card">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] leading-[1.3] font-bold">{noteTitle}</div>
            <div className="mt-1 text-[13px] leading-[1.45] font-medium text-mid">
              {note}
            </div>
          </div>
          {cycle.length > 1 ? (
            <div aria-hidden className="flex flex-none items-end gap-1.5">
              {cycle.map((c) => {
                const current = c.week === week;
                // Lowest week 22px, highest 40px: the shape of the wave.
                const h =
                  cycleMax === cycleMin
                    ? 32
                    : 22 + ((c.pct - cycleMin) / (cycleMax - cycleMin)) * 18;
                return (
                  <div key={c.week} className="flex flex-col items-center gap-1.5">
                    <span
                      className={cn(
                        "w-4 rounded-[5px]",
                        current ? "bg-strength" : "bg-quiet",
                      )}
                      style={{ height: h }}
                    />
                    <span
                      className={cn(
                        "num text-[11px] leading-none",
                        current ? "font-extrabold text-clay" : "font-bold text-mid",
                      )}
                    >
                      {c.pct}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        {planned === 0 ? (
          <Footnote>
            Esta fase todavía no tiene días asignados, así que la semana está
            vacía. Se rellenan al clonar un programa o desde el editor.
          </Footnote>
        ) : (
          <div className="mx-5 mt-3 flex flex-col gap-0.5 rounded-2xl bg-surface p-1.5 shadow-card">
            {days.map((day) => {
              const session = sessionFor(day);
              const status = statusFor(day, session);
              const href = hrefFor(day, session, today);
              const isToday = day.date === today;
              const quietDay = day.group === "rest" || day.group === "mobility";
              // Only training days carry a status, and "sin hacer" only
              // means something once the day has gone by.
              const trains = day.group === "strength" || day.group === "run";
              const pill = !trains || !status
                ? null
                : isToday && status === "planned"
                  ? { label: "Hoy", tone: "bg-strength text-on-strength" }
                  : status === "done"
                    ? { label: STATUS_LABEL.done, tone: "bg-ok-soft text-ok", check: true }
                    : status === "partial"
                      ? { label: STATUS_LABEL.partial, tone: "bg-warn-soft text-ink", dot: true }
                      : status === "in_progress"
                        ? { label: STATUS_LABEL.in_progress, tone: "bg-clay-soft text-clay" }
                        : status === "skipped"
                          ? { label: STATUS_LABEL.skipped, tone: "bg-fail-soft text-fail" }
                          : day.date < today
                            ? { label: "Sin hacer", tone: "bg-fail-soft text-fail" }
                            : null;

              const body = (
                <>
                  <div className="w-[34px] flex-none text-center">
                    <div
                      className={cn(
                        "text-[11px] leading-none",
                        isToday ? "font-extrabold text-clay" : "font-bold text-mid",
                      )}
                    >
                      {DAY_LABELS[day.dayIndex]}
                    </div>
                    <div
                      className={cn(
                        "num mt-0.5 text-[18px] leading-none font-extrabold",
                        isToday ? "text-clay" : quietDay ? "text-mid" : "text-ink",
                      )}
                    >
                      {Number(day.date.slice(8))}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "flex h-9 w-9 flex-none items-center justify-center rounded-md",
                      tileFor(day, isToday),
                    )}
                  >
                    <DayIcon group={day.group} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "truncate text-[15px] leading-[1.25]",
                        quietDay ? "font-semibold text-mid" : "font-bold",
                      )}
                    >
                      {day.title}
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] leading-[1.35] font-medium text-mid">
                      {subtitleFor(day) || "libre"}
                    </div>
                  </div>
                  {pill ? (
                    <span
                      className={cn(
                        "flex h-6 flex-none items-center gap-1 rounded-full px-2.5 text-[11px] leading-none font-bold",
                        pill.tone,
                      )}
                    >
                      {"check" in pill ? (
                        <Check aria-hidden size={12} strokeWidth={3} />
                      ) : null}
                      {"dot" in pill ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-warn-dot" />
                      ) : null}
                      {pill.label}
                    </span>
                  ) : href ? (
                    <ChevronRight aria-hidden size={18} className="flex-none text-faint" />
                  ) : null}
                </>
              );

              const classes = cn(
                "flex items-center gap-3 rounded-lg p-2.5",
                isToday && "bg-clay-soft",
              );

              return href ? (
                <Link
                  key={day.date}
                  id={`dia-${day.dayIndex}`}
                  href={href}
                  aria-current={isToday ? "date" : undefined}
                  className={classes}
                >
                  {body}
                </Link>
              ) : (
                <div
                  key={day.date}
                  id={`dia-${day.dayIndex}`}
                  aria-current={isToday ? "date" : undefined}
                  className={classes}
                >
                  {body}
                </div>
              );
            })}
          </div>
        )}

        {missedDays > 0 && phase.priority ? (
          <Footnote>
            Si no llegas a todo esta semana, este es el orden: {phase.priority}.
            Lo que falte se puede recuperar hasta el domingo desde su día.
          </Footnote>
        ) : null}

        <SectionLabel
          className="pb-2.5"
          right={
            <span className="num">
              {formatSeasonRange(seasonStart, seasonEnd)}
            </span>
          }
        >
          La temporada
        </SectionLabel>

        <div className="mx-5 rounded-2xl bg-surface p-4 shadow-card">
          <PhaseBar
            phases={barPhases}
            activeAbsoluteWeek={absoluteWeek}
            currentWeekOfPhase={week}
          />
          {program.race_on ? (
            <div className="mt-3.5 flex items-center gap-3 border-t border-line pt-3.5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-run-soft text-run">
                <Flag aria-hidden size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] leading-[1.3] font-bold">
                  {program.race_name ?? "Objetivo"}
                </div>
                <div className="num mt-0.5 text-[12.5px] leading-[1.35] font-medium text-mid">
                  {formatDayShort(program.race_on)}
                  {weeksToRace != null && weeksToRace > 0
                    ? ` · faltan ${weeksToRace} semanas`
                    : ""}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
