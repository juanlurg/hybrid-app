import {
  BatteryLow,
  CalendarClock,
  ChevronRight,
  HeartPulse,
  History,
  Info,
  Snowflake,
} from "lucide-react";
import Link from "next/link";

import { requireAthlete } from "@/lib/data/athlete";
import {
  DAY_INITIALS,
  formatDayFull,
  formatDayShort,
  type IsoDate,
} from "@/lib/domain/calendar";
import {
  priorityRank,
  resolveDay,
  resolveWeek,
  type ResolvedDay,
  type SessionStatus,
} from "@/lib/domain/plan";
import { createClient } from "@/lib/supabase/server";
import { formatWeight } from "@/lib/engine";
import { cn } from "@/lib/cn";
import { Note } from "@/components/ui/kit";
import { DayIcon } from "@/components/day-icon";
import {
  SkipDayButton,
  StartSessionButton,
} from "@/components/session/start-session-button";
import { StrengthDay } from "@/components/strength-day";
import { SyncStatus } from "@/components/sync-status";
import { accentFor, GROUP_LABEL } from "@/components/day-accents";

const WEEKDAY = [
  "el lunes",
  "el martes",
  "el miércoles",
  "el jueves",
  "el viernes",
  "el sábado",
  "el domingo",
];

/** Where a day of the week strip leads: its own screen, like in Semana. */
function dayHref(day: ResolvedDay): string {
  if (day.group === "run") return `/carrera/${day.date}`;
  if (day.group === "strength") return `/fuerza/${day.date}`;
  return "/semana";
}

/** An LTHR test is a prescription in the plan, never a fixed week. */
function isTest(day: ResolvedDay): boolean {
  return (
    day.sessionType === "run_test" ||
    day.runBlocks.some((b) => b.title === "Test de umbral") ||
    /lthr/i.test(day.prescription)
  );
}

export default async function HoyPage() {
  const athlete = await requireAthlete();
  const { ctx, config, placement, today } = athlete;
  const phase = ctx.phases.find((p) => p.id === placement.phase.id)!;
  // Out of season, placeDate clamps: Hoy previews the clamped plan day,
  // but anything trained lands on the REAL date and the plan day stays
  // unmarked — the athlete decided pre-season work is history, not plan.
  const clamped = placement.date !== today;
  const preSeason = clamped && today < (ctx.program.starts_on as IsoDate);

  const opts = {
    ctx,
    config,
    phase,
    week: placement.week,
    absoluteWeek: placement.absoluteWeek,
  };
  const day = resolveDay(opts, placement.dayIndex);
  // The week around today — only meaningful inside the season.
  const week = clamped ? [] : resolveWeek(opts);

  // The date a session started today files under — and is looked up by.
  // Only strength files under the REAL date out of season: runs and
  // mobility navigate to their own screens, which are plan-date
  // addressed, so the clamped plan date keeps those links resolving.
  const effectiveOn =
    clamped && day.group === "strength" ? today : day.date;

  const supabase = await createClient();
  const [{ data: sessions }, { data: heldLifts }, { count: loggedEver }] =
    await Promise.all([
      supabase
        .from("sessions")
        .select("id, slot_id, status, scheduled_on")
        .eq("user_id", athlete.userId)
        .in(
          "scheduled_on",
          week.length > 0 ? week.map((d) => d.date) : [effectiveOn],
        ),
      supabase
        .from("lifts")
        .select("id, key, name, hold, hold_at_kg, fail_count, penalty")
        .eq("user_id", athlete.userId)
        .or("hold.eq.true,fail_count.gt.0"),
      supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", athlete.userId)
        .in("status", ["done", "partial"]),
    ]);

  const statusOf = (d: ResolvedDay): SessionStatus | null => {
    if (!d.slot) return null;
    return (
      (sessions ?? []).find(
        (s) => s.scheduled_on === d.date && s.slot_id === d.slot?.id,
      )?.status ?? "planned"
    );
  };

  const todaySession = (sessions ?? []).find(
    (s) => s.scheduled_on === effectiveOn && s.slot_id === day.slot?.id,
  );
  const held = (heldLifts ?? []).filter((l) => l.hold && l.hold_at_kg);

  /* ── the week around today ───────────────────────────────────── */

  const trains = (d: ResolvedDay) =>
    d.slot != null && (d.group === "strength" || d.group === "run");
  const missed = week.filter(
    (d) => trains(d) && d.date < today && statusOf(d) === "planned",
  );
  // The plan's own order for a broken week decides what to recover: only
  // suggest a missed day when it outranks what today already holds.
  const rank = (d: ResolvedDay) =>
    phase.priority ? priorityRank(phase.priority, d) : Number.MAX_SAFE_INTEGER;
  const recover = [...missed].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  const todayRank =
    trains(day) && statusOf(day) === "planned"
      ? rank(day)
      : Number.MAX_SAFE_INTEGER;
  const suggestRecover =
    recover != null && phase.priority !== "" && rank(recover) < todayRank;
  const test = week.find(
    (d) => d.group === "run" && isTest(d) && d.date >= today &&
      statusOf(d) === "planned",
  );

  /* ── the header ──────────────────────────────────────────────── */

  const heading =
    day.group === "mobility"
      ? { title: "Movilidad y correctivos", subtitle: "20′ · diaria" }
      : day.group === "rest"
        ? { title: "Hoy no toca", subtitle: day.subtitle }
        : { title: day.title, subtitle: day.subtitle };

  const quiet = day.group === "mobility" || day.group === "rest";
  const dayNote =
    day.group === "mobility"
      ? "20′ de activación glútea, psoas y tobillo. Innegociables, pero no cuentan como entrenamiento."
      : day.group === "rest"
        ? "Descansar es parte del plan."
        : null;

  /* ── what the athlete should know before starting ────────────── */

  const notes = (
    <>
      {day.isDeload ? (
        <Note
          className="mx-5 mt-3"
          tone="quiet"
          icon={<BatteryLow size={18} />}
          title="Semana de descarga"
        >
          Mitad de series y pesos más bajos, a propósito. La carrera también
          baja. El objetivo es llegar fresco a la semana que viene.
        </Note>
      ) : null}

      {held.map((lift) => (
        <Note
          key={lift.id}
          className="mx-5 mt-3"
          icon={<Snowflake size={18} />}
          title={`${lift.name} · peso congelado en ${formatWeight(Number(lift.hold_at_kg))} kg`}
        >
          La última vez no llegaste al mínimo del rango, así que el peso no
          sube hasta una sesión limpia. Otro fallo y la RM baja.
        </Note>
      ))}

      {test && test.date !== day.date ? (
        <Note
          className="mx-5 mt-3"
          tone="run"
          icon={<HeartPulse size={18} />}
          title="Esta semana hay test"
        >
          Test de umbral {WEEKDAY[test.dayIndex]}: de él salen tus zonas de
          pulso. Llega descansado.
        </Note>
      ) : null}

      {loggedEver === 0 && !preSeason ? (
        <Note
          className="mx-5 mt-3"
          tone="clay"
          icon={<Info size={18} />}
          title="Cómo funciona"
        >
          El motor calcula cada peso a partir de tus RM; tú solo marcas lo que
          haces. Si una serie del básico se queda por debajo del rango, el peso
          se congela en vez de subir. Los accesorios suben solos cuando haces
          el tope del rango en todas las series.
        </Note>
      ) : null}
    </>
  );

  const skipTarget =
    day.slot && !clamped && trains(day) && statusOf(day) === "planned"
      ? {
          phaseId: phase.id,
          slotId: day.slot.id,
          scheduledOn: day.date,
          week: placement.week,
          dayIndex: day.dayIndex,
          sessionType: day.sessionType,
          title: day.title,
          group: day.group,
        }
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none px-5 pt-6">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[14px] leading-none font-semibold text-mid">
            {formatDayFull(today)}
          </span>
          {clamped ? null : (
            <Link
              href="/semana"
              className="flex h-[30px] flex-none items-center gap-1.5 rounded-full bg-surface px-3 text-[12px] leading-none font-bold text-ink shadow-raised"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: accentFor("strength") }}
              />
              {phase.key} · semana {placement.week} de {phase.weeks}
            </Link>
          )}
        </div>
        <h1 className="mt-2.5 text-[34px] leading-[1.1] font-extrabold tracking-[-0.02em]">
          {heading.title}
        </h1>
        {heading.subtitle ? (
          <p className="mt-1.5 text-[14px] leading-[1.45] font-medium text-body">
            {heading.subtitle}
          </p>
        ) : null}
      </header>

      <div className="no-scrollbar flex-1 overflow-auto pt-5 pb-6">
        <SyncStatus />

        {week.length > 0 ? (
          <Link
            href="/semana"
            aria-label={`${phase.name} · semana ${placement.week} de ${phase.weeks}`}
            className="mb-5 grid grid-cols-7 gap-1 px-5"
          >
            {week.map((d) => {
              const status = statusOf(d);
              const isToday = d.date === today;
              const done = status === "done";
              const partial = status === "partial";
              const lost =
                trains(d) &&
                !isToday &&
                d.date < today &&
                (status === "planned" || status === "skipped");
              const quietDay = d.group === "rest" || d.group === "mobility";
              return (
                <div
                  key={d.date}
                  aria-label={`${d.dayLabel} · ${d.title}`}
                  className="flex flex-col items-center gap-1.5"
                >
                  <span
                    className={cn(
                      "text-[11px] leading-none",
                      isToday ? "font-extrabold text-clay" : "font-bold text-mid",
                    )}
                  >
                    {DAY_INITIALS[d.dayIndex]}
                  </span>
                  <span
                    className={cn(
                      "flex h-[38px] w-[38px] items-center justify-center rounded-full",
                      isToday
                        ? "bg-surface text-clay-line shadow-[inset_0_0_0_2px_var(--clay-line)]"
                        : done
                          ? "text-white"
                          : partial
                            ? "bg-clay-soft text-clay-dim"
                            : lost
                              ? "bg-fail-soft text-fail"
                              : quietDay
                                ? "bg-quiet text-mid"
                                : "bg-surface text-mid",
                    )}
                    style={
                      done && !isToday
                        ? { background: accentFor(d.group) }
                        : undefined
                    }
                  >
                    <DayIcon group={d.group} />
                  </span>
                  <span
                    className={cn(
                      "num text-[12px] leading-none",
                      isToday ? "font-extrabold text-clay" : "font-bold text-body",
                    )}
                  >
                    {Number(d.date.slice(8))}
                  </span>
                </div>
              );
            })}
          </Link>
        ) : null}

        {preSeason ? (
          <Note
            className="mx-5 mb-3"
            tone="clay"
            icon={<CalendarClock size={18} />}
            title="El plan aún no ha empezado"
          >
            Empieza el lunes{" "}
            {formatDayShort(ctx.program.starts_on as IsoDate)}. Esto es un
            adelanto de ese día: lo que entrenes antes se guarda en tu progreso
            con su fecha real y no marca ningún día del plan.
          </Note>
        ) : null}

        {suggestRecover && recover ? (
          <Note
            className="mx-5 mb-3"
            tone="warn"
            icon={<History size={18} />}
            title={
              missed.length === 1
                ? "Te falta una sesión"
                : `Te faltan ${missed.length} sesiones`
            }
            action={
              <Link
                href={dayHref(recover)}
                className="-my-2 py-2 text-[13px] leading-none font-bold text-clay"
              >
                Ver
              </Link>
            }
          >
            {recover.title} ({WEEKDAY[recover.dayIndex]}) va antes que{" "}
            {trains(day) ? day.title : "el resto"}. Si hoy solo entrenas una,
            que sea esa.
          </Note>
        ) : null}

        {day.group === "strength" ? (
          <StrengthDay
            day={day}
            eyebrow="Básico del día"
            targetRir={ctx.profile.target_rir}
            showPlates={ctx.profile.show_plate_breakdown}
          >
            {notes}
          </StrengthDay>
        ) : (
          <>
            <div className="px-5">
              <div
                className={cn(
                  "rounded-3xl p-5",
                  quiet
                    ? "bg-surface shadow-card"
                    : "bg-panel text-on-panel shadow-panel",
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "text-[11px] leading-none font-bold tracking-[0.13em] uppercase",
                      quiet ? "text-mid" : "text-run-mist",
                    )}
                  >
                    {day.label}
                  </span>
                </div>
                {quiet ? null : (
                  <>
                    <div className="mt-2 text-[20px] leading-[1.25] font-bold">
                      {day.prescription || day.title}
                    </div>
                    {day.estimatedMinutes ? (
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span className="num text-[88px] leading-[0.9] font-extrabold tracking-[-0.04em]">
                          {day.estimatedMinutes}
                        </span>
                        <span className="text-[20px] leading-none font-bold text-panel-soft">
                          min aprox
                        </span>
                      </div>
                    ) : null}
                  </>
                )}
                {dayNote ? (
                  <p className="mt-2 text-[13px] leading-[1.55] font-medium text-mid">
                    {dayNote}
                  </p>
                ) : null}
              </div>
            </div>
            {notes}
          </>
        )}

        {day.group !== "mobility" ? (
          <Link
            href="/movilidad"
            className="mx-5 mt-3 flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 shadow-card"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-quiet text-mid">
              <DayIcon group="mobility" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] leading-[1.3] font-bold">
                Movilidad y correctivos
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-[1.35] font-medium text-mid">
                20′ · diaria · no cuenta como entrenamiento
              </span>
            </span>
            <ChevronRight aria-hidden size={18} className="flex-none text-faint" />
          </Link>
        ) : null}
      </div>

      {day.slot ? (
        <div className="flex flex-none gap-2.5 px-4 pt-3 pb-3">
          {skipTarget ? (
            <SkipDayButton day={skipTarget} label="Hoy no entreno" pill />
          ) : null}
          <StartSessionButton
            className="min-w-0 flex-1 p-0"
            day={{
              phaseId: phase.id,
              slotId: day.slot.id,
              scheduledOn: effectiveOn,
              week: placement.week,
              dayIndex: day.dayIndex,
              sessionType: day.sessionType,
              title: day.title,
              group: day.group,
            }}
            existingSessionId={todaySession?.id ?? null}
            existingStatus={todaySession?.status ?? null}
            groupLabel={GROUP_LABEL[day.group]}
          />
        </div>
      ) : null}
    </div>
  );
}
