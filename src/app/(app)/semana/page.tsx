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
  type IsoDate,
} from "@/lib/domain/calendar";
import { cycleOf, isDeloadWeek, waveFactor } from "@/lib/engine";
import {
  Footnote,
  RowStack,
  ScreenHeader,
  SectionLabel,
} from "@/components/ui/kit";
import { accentFor, STATUS_LABEL, statusTone } from "@/components/day-accents";
import { SkipDayButton } from "@/components/session/start-session-button";
import { cn } from "@/lib/cn";

import { WeekNav } from "./week-nav";

/** The bit of a `sessions` row this screen needs. */
interface WeekSession {
  id: string;
  status: SessionStatus;
}

/**
 * Where a row leads. Only real destinations get a link: a session that
 * exists goes to its own screen, everything else to the screen that owns
 * that kind of day.
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
  return day.date === today ? "/" : undefined;
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
  // The engine reads the phase's own progression and the week inside it.
  const phaseConfig = phaseEngineConfig(config, phase);
  const deload = isDeloadWeek(week, phaseConfig);
  const cycle = cycleOf(week, phaseConfig.cycleWeeks);
  const cycles = Math.max(1, Math.ceil(phase.weeks / phaseConfig.cycleWeeks));
  const wavePct = Math.round(waveFactor(week, phaseConfig) * 100);
  const nextDeload = cycle * phaseConfig.cycleWeeks;
  const note =
    phaseConfig.progressionMode === "fixed_pct"
      ? `Fase a porcentaje fijo · básicos al ${wavePct} % de la RM, sin olas ni descargas automáticas.`
      : deload
        ? phaseConfig.autoDeload
          ? `Semana de descarga · ola al ${wavePct} % y mitad de series. Los pesos bajan a propósito.`
          : `Semana de descarga · ola al ${wavePct} %. El auto-descarga está apagado, así que las series no se recortan.`
        : `Ciclo ${cycle} de ${cycles} · ola al ${wavePct} %.` +
          (nextDeload <= phase.weeks
            ? ` Descarga en la semana ${nextDeload} de la fase.`
            : "");

  /* ── the season bar ───────────────────────────────────────── */
  const phases = [...ctx.phases].sort((a, b) => a.position - b.position);
  const seasonStart = program.starts_on as IsoDate;
  const seasonEnd = (program.ends_on ??
    addDays(seasonStart, lastWeek * 7 - 1)) as IsoDate;

  const planned = days.filter((d) => d.slot).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        eyebrow={`SEMANA ${week} DE ${phase.weeks}`}
        title={phase.name}
        right={<WeekNav absoluteWeek={absoluteWeek} seasonWeeks={seasonWeeks} />}
      >
        <p className="num mt-2.5 text-[12px] leading-[1.45] font-medium opacity-65">
          {note}
        </p>
      </ScreenHeader>

      <div className="flex-1 overflow-auto">
        {planned === 0 ? (
          <Footnote>
            Esta fase todavía no tiene días asignados, así que la semana está
            vacía. Se rellenan al clonar un programa o desde el editor.
          </Footnote>
        ) : (
          <RowStack>
            {days.map((day) => {
              const session = sessionFor(day);
              const status = statusFor(day, session);
              const href = hrefFor(day, session, today);
              const figure = figureFor(day);
              const isToday = day.date === today;
              const rest = day.group === "rest";
              const subtitle =
                day.group === "run"
                  ? day.prescription || day.subtitle
                  : day.subtitle;

              const body = (
                <div className="flex w-full items-center gap-2.5 text-left">
                  <div className="w-[34px] flex-none">
                    <div
                      className={cn(
                        "text-[10.5px] leading-none font-extrabold tracking-[0.06em]",
                        rest && "text-ghost",
                      )}
                    >
                      {DAY_LABELS[day.dayIndex]}
                    </div>
                    <div className="num mt-1.5 text-[10px] leading-none font-medium text-faint">
                      {formatDayShort(day.date)}
                    </div>
                  </div>

                  <div
                    className="h-9 w-1.5 flex-none"
                    style={{ background: accentFor(day.group) }}
                  />

                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "truncate text-[13.5px] leading-[1.2] font-bold",
                        rest && "text-ghost",
                      )}
                    >
                      {day.title}
                    </div>
                    {subtitle ? (
                      <div
                        className={cn(
                          "mt-1 truncate text-[11px] leading-[1.35] font-normal",
                          rest ? "text-hairline" : "text-mid",
                        )}
                      >
                        {subtitle}
                      </div>
                    ) : null}
                  </div>

                  {figure || status ? (
                    <div className="flex-none pl-1 text-right">
                      {figure ? (
                        <div className="num text-[12.5px] leading-none font-extrabold">
                          {figure}
                        </div>
                      ) : null}
                      {status ? (
                        <div
                          className={cn(
                            "mt-1.5 text-[9.5px] leading-none font-semibold tracking-[0.1em]",
                            statusTone(status),
                          )}
                        >
                          {STATUS_LABEL[status]}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );

              const classes = cn(
                "flex items-center gap-3 px-4 py-3",
                isToday ? "bg-sunk" : "bg-paper",
              );

              // "Hoy no entreno" is a decision, not an omission: a
              // deliberate skip closes the day as SALTADA instead of
              // leaving it pending forever.
              const skippable =
                (day.group === "strength" || day.group === "run") &&
                day.slot != null &&
                day.date >= today &&
                status === "planned";

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
                  {skippable && day.slot ? (
                    <SkipDayButton
                      day={{
                        phaseId: day.phaseId,
                        slotId: day.slot.id,
                        scheduledOn: day.date,
                        week: day.week,
                        dayIndex: day.dayIndex,
                        sessionType: day.sessionType,
                        title: day.title,
                        group: day.group,
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </RowStack>
        )}

        <SectionLabel>
          TEMPORADA · {formatSeasonRange(seasonStart, seasonEnd).toUpperCase()}
        </SectionLabel>

        <div className="mx-4 mt-2.5 flex h-[42px] gap-px border-2 border-ink bg-ink">
          {phases.map((p) => {
            const current = p.id === phase.id;
            return (
              <div
                key={p.id}
                style={{ flex: p.weeks }}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-1 px-1",
                  current ? "bg-strength text-ink" : "bg-soft text-mid",
                )}
              >
                <span className="truncate text-[10px] leading-none font-extrabold tracking-[0.08em] uppercase">
                  {p.key}
                </span>
                <span className="num text-[9.5px] leading-none font-semibold opacity-70">
                  {p.weeks}s
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-baseline gap-3 px-4 pt-3 pb-6">
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[1.2] font-bold">
            {phase.name}
          </span>
          {program.race_on ? (
            <span className="num flex-none text-[11px] leading-none font-semibold text-mid">
              {program.race_name ?? "Objetivo"} ·{" "}
              {formatDayShort(program.race_on)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
