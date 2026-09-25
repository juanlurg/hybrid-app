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
  formatDayShort,
  formatSeasonRange,
  phaseEnd,
  type IsoDate,
} from "@/lib/domain/calendar";
import { isDeloadWeek, waveFactor, weekInCycle } from "@/lib/engine";
import {
  Footnote,
  RowStack,
  ScreenHeader,
  SectionLabel,
} from "@/components/ui/kit";
import { accentFor, STATUS_LABEL, statusTone } from "@/components/day-accents";
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
 * The right-hand figure. Weights come from the resolved exercise — the
 * engine is the only thing allowed to invent a load, so this only ever
 * reads `weightLabel`, which already carries the unit and the sign.
 */
function figureFor(day: ResolvedDay): string | null {
  if (day.group === "strength") return day.primary?.weightLabel ?? null;
  if (day.group === "run" || day.group === "mobility") {
    return day.estimatedMinutes > 0 ? `${day.estimatedMinutes}′` : null;
  }
  return null;
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
  const note =
    phaseConfig.progressionMode === "fixed_pct"
      ? `Básicos al ${wavePct} % de la RM todas las semanas de esta fase.`
      : deload
        ? phaseConfig.autoDeload
          ? `Semana de descarga: básicos al ${wavePct} % de la RM y la mitad de series. Los pesos bajan a propósito.`
          : `Semana de descarga: básicos al ${wavePct} % de la RM.`
        : `Básicos al ${wavePct} % de la RM, semana ${cycleWeek} de ${phaseConfig.cycleWeeks} del ciclo.` +
          (nextDeload <= phase.weeks
            ? ` Descarga en la semana ${nextDeload}.`
            : "");

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
      <ScreenHeader
        eyebrow={phase.name}
        title={`Semana ${week} de ${phase.weeks}`}
        subtitle={note}
        right={
          <WeekNav
            absoluteWeek={absoluteWeek}
            seasonWeeks={seasonWeeks}
            currentWeek={athlete.placement.absoluteWeek}
          />
        }
      />

      <div className="flex-1 overflow-auto">
        {planned === 0 ? (
          <Footnote>
            Esta fase todavía no tiene días asignados, así que la semana está
            vacía. Se rellenan al clonar un programa o desde el editor.
          </Footnote>
        ) : (
          <RowStack className="pt-3">
            {days.map((day) => {
              const session = sessionFor(day);
              const status = statusFor(day, session);
              const href = hrefFor(day, session, today);
              const figure = figureFor(day);
              const isToday = day.date === today;
              const rest = day.group === "rest";
              // Only training days carry a status, and "pendiente" only
              // means something once the day has gone by.
              const trains = day.group === "strength" || day.group === "run";
              const statusText = !trains || !status
                ? null
                : status !== "planned"
                  ? STATUS_LABEL[status]
                  : isToday
                    ? "HOY"
                    : day.date < today
                      ? "SIN HACER"
                      : null;
              const subtitle =
                day.group === "run"
                  ? day.prescription || day.subtitle
                  : day.subtitle;

              const body = (
                <div className="flex w-full items-center gap-3 text-left">
                  <div className="w-9 flex-none">
                    <div
                      className={cn(
                        "font-display text-[11px] leading-none",
                        isToday
                          ? "font-bold text-lime"
                          : rest
                            ? "font-semibold text-faint"
                            : "font-semibold text-mid",
                      )}
                    >
                      {DAY_LABELS[day.dayIndex]}
                    </div>
                    <div className="num mt-[3px] truncate text-[11px] leading-none text-faint">
                      {formatDayShort(day.date)}
                    </div>
                  </div>

                  {/* Today is already marked by the lime border — a spine
                      would light the same row twice. */}
                  {rest || isToday ? null : (
                    <div
                      className="h-8 w-[3px] flex-none rounded-full"
                      style={{ background: accentFor(day.group) }}
                    />
                  )}

                  {rest ? (
                    <div className="min-w-0 flex-1 truncate text-[14px] leading-[1.2] font-medium text-mid">
                      {day.title} · {day.subtitle || "libre"}
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] leading-[1.2] font-semibold">
                        {day.title}
                      </div>
                      {subtitle ? (
                        <div className="mt-0.5 truncate text-[12.5px] leading-[1.35] text-mid">
                          {subtitle}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {!rest && (figure || statusText) ? (
                    <div className="flex-none pl-1 text-right">
                      {figure ? (
                        <div className="num text-[14px] leading-none font-semibold">
                          {figure}
                        </div>
                      ) : null}
                      {statusText ? (
                        <div
                          className={cn(
                            "font-display mt-[5px] text-[11px] leading-none font-semibold tracking-[0.08em]",
                            isToday
                              ? "text-lime"
                              : status === "planned"
                                ? "text-warn"
                                : statusTone(status),
                          )}
                        >
                          {statusText}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );

              const classes = cn(
                "flex items-center gap-3 rounded-xl px-3.5",
                rest
                  ? "border border-dashed border-hairline py-2.5 opacity-60"
                  : isToday
                    ? "border-[1.5px] border-lime-line bg-sunk py-3"
                    : "border border-line bg-surface py-3",
              );

              return (
                <div
                  key={day.date}
                  id={`dia-${day.dayIndex}`}
                  aria-current={isToday ? "date" : undefined}
                  className={classes}
                >
                  {href ? (
                    <Link href={href} className="block min-w-0 flex-1">
                      {body}
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1">{body}</div>
                  )}
                </div>
              );
            })}
          </RowStack>
        )}

        {missedDays > 0 && phase.priority ? (
          <Footnote>
            Si no llegas a todo esta semana, este es el orden: {phase.priority}.
            Lo que falte se puede recuperar hasta el domingo desde su día.
          </Footnote>
        ) : null}

        <SectionLabel
          right={
            <span className="num">
              {formatSeasonRange(seasonStart, seasonEnd)}
            </span>
          }
        >
          La temporada
        </SectionLabel>

        <PhaseBar phases={barPhases} activeAbsoluteWeek={absoluteWeek} />

        {program.race_on ? (
          <div className="px-5 pt-2.5 pb-6 text-[12.5px] leading-none text-mid">
            {program.race_name ?? "Objetivo"} ·{" "}
            <span className="num">{formatDayShort(program.race_on)}</span>
          </div>
        ) : (
          <div className="pb-6" />
        )}
      </div>
    </div>
  );
}
