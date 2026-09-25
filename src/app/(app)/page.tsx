import Link from "next/link";

import { requireAthlete } from "@/lib/data/athlete";
import {
  DAY_INITIALS,
  formatDayLong,
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
import { Callout, Card, ScreenHeader } from "@/components/ui/kit";
import {
  SkipDayButton,
  StartSessionButton,
} from "@/components/session/start-session-button";
import { StrengthDay } from "@/components/strength-day";
import { SyncStatus } from "@/components/sync-status";
import { accentFor, GROUP_LABEL, TONE } from "@/components/day-accents";

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
  const accent = accentFor(day.group);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        eyebrow={formatDayLong(today)}
        title={heading.title}
        subtitle={heading.subtitle}
      />

      <div className="flex-1 overflow-auto pt-3 pb-6">
        <SyncStatus />

        {week.length > 0 ? (
          <Link href="/semana" className="mb-3.5 block px-5">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] leading-none text-mid">
                {phase.name} · semana {placement.week} de {phase.weeks}
              </span>
              <span aria-hidden className="text-[13px] leading-none text-mid">
                ›
              </span>
            </div>
            <div className="mt-2 flex gap-1">
              {week.map((d) => {
                const status = statusOf(d);
                const isToday = d.date === today;
                const done = status === "done" || status === "partial";
                const lost =
                  trains(d) &&
                  !isToday &&
                  d.date < today &&
                  (status === "planned" || status === "skipped");
                return (
                  <div
                    key={d.date}
                    aria-label={`${d.dayLabel} · ${d.title}`}
                    className={cn(
                      "flex h-9 flex-1 flex-col items-center justify-center gap-[3px] rounded-md border",
                      isToday
                        ? "border-[1.5px] border-lime-line bg-sunk"
                        : trains(d)
                          ? "border-line bg-surface"
                          : "border-dashed border-hairline",
                    )}
                  >
                    <span
                      className={cn(
                        "font-display text-[11px] leading-none font-semibold",
                        isToday ? "text-lime" : "text-mid",
                      )}
                    >
                      {DAY_INITIALS[d.dayIndex]}
                    </span>
                    <span
                      aria-hidden
                      className="h-[4px] w-3 rounded-full"
                      style={{
                        background: done
                          ? accentFor(d.group)
                          : lost
                            ? TONE.warn
                            : "transparent",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </Link>
        ) : null}

        {preSeason ? (
          <div className="mb-3.5 px-5">
            <Callout eyebrow="El plan aún no ha empezado">
              Empieza el lunes{" "}
              {formatDayShort(ctx.program.starts_on as IsoDate)}. Esto es un
              adelanto de ese día: lo que entrenes antes se guarda en tu
              progreso con su fecha real y no marca ningún día del plan.
            </Callout>
          </div>
        ) : null}

        {suggestRecover && recover ? (
          <div className="mb-3.5 px-5">
            <Callout
              eyebrow={
                missed.length === 1
                  ? "Te falta una sesión"
                  : `Te faltan ${missed.length} sesiones`
              }
              action={
                <Link
                  href={dayHref(recover)}
                  className="font-display -my-2 py-2 text-[12px] leading-none font-semibold tracking-[0.08em] text-lime uppercase"
                >
                  ver ›
                </Link>
              }
            >
              {recover.title} ({WEEKDAY[recover.dayIndex]}) va antes que{" "}
              {trains(day) ? day.title : "el resto"} en esta fase. Si hoy solo
              entrenas una, que sea esa: se puede recuperar hasta el domingo.
            </Callout>
          </div>
        ) : null}

        {day.group === "strength" ? (
          <StrengthDay
            day={day}
            eyebrow="Básico del día"
            targetRir={ctx.profile.target_rir}
            showPlates={ctx.profile.show_plate_breakdown}
          />
        ) : (
          <div className="px-5">
            <Card className="flex gap-4">
              <span
                aria-hidden
                className="w-[3px] flex-none rounded-full"
                style={{ background: accent }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
                    {day.label}
                  </span>
                  {day.group === "run" && day.estimatedMinutes ? (
                    <span className="num ml-auto text-[12px] leading-none text-mid">
                      {day.estimatedMinutes}′ aprox
                    </span>
                  ) : null}
                </div>
                {quiet ? null : (
                  <div className="mt-2 text-[18px] leading-[1.25] font-semibold">
                    {day.prescription || day.title}
                  </div>
                )}
                {dayNote ? (
                  <p className="mt-2 text-[13px] leading-[1.55] text-mid">
                    {dayNote}
                  </p>
                ) : null}
              </div>
            </Card>
          </div>
        )}

        {day.isDeload ? (
          <div className="mt-3.5 px-5">
            <Callout eyebrow="Semana de descarga">
              Mitad de series y pesos más bajos, a propósito. La carrera también
              baja. El objetivo es llegar fresco a la semana que viene.
            </Callout>
          </div>
        ) : null}

        {held.map((lift) => (
          <div key={lift.id} className="mt-3.5 px-5">
            <Callout
              eyebrow={`${lift.name} · peso congelado en ${formatWeight(Number(lift.hold_at_kg))} kg`}
            >
              La última vez no llegaste al mínimo del rango, así que el peso no
              sube hasta una sesión limpia. Otro fallo y la RM baja.
            </Callout>
          </div>
        ))}

        {test && test.date !== day.date ? (
          <div className="mt-3.5 px-5">
            <Callout eyebrow="Esta semana hay test" eyebrowTone="text-run">
              Test de umbral {WEEKDAY[test.dayIndex]}: de él salen tus zonas de
              pulso. Llega descansado.
            </Callout>
          </div>
        ) : null}

        {loggedEver === 0 && !preSeason ? (
          <div className="mt-3.5 px-5">
            <Callout eyebrow="Cómo funciona" eyebrowTone="text-lime">
              El motor calcula cada peso a partir de tus RM; tú solo marcas lo
              que haces. Si una serie del básico se queda por debajo del
              rango, el peso se congela en vez de subir. Los accesorios suben
              solos cuando haces el tope del rango en todas las series.
            </Callout>
          </div>
        ) : null}

        {day.group !== "mobility" ? (
          <Link
            href="/movilidad"
            className="mt-3.5 flex items-center gap-2.5 px-6 py-2"
          >
            <span
              aria-hidden
              className="h-2 w-2 flex-none rounded-full"
              style={{ background: accentFor("mobility") }}
            />
            <span className="flex-1 text-[13px] leading-[1.4] text-mid">
              Movilidad 20′ · diaria
            </span>
            <span aria-hidden className="text-[13px] leading-none text-mid">
              ›
            </span>
          </Link>
        ) : null}
      </div>

      {day.slot && !clamped && trains(day) && statusOf(day) === "planned" ? (
        <div className="flex flex-none justify-center">
          <SkipDayButton
            day={{
              phaseId: phase.id,
              slotId: day.slot.id,
              scheduledOn: day.date,
              week: placement.week,
              dayIndex: day.dayIndex,
              sessionType: day.sessionType,
              title: day.title,
              group: day.group,
            }}
            label="Hoy no entreno · saltar"
          />
        </div>
      ) : null}

      {day.slot ? (
        <StartSessionButton
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
      ) : null}
    </div>
  );
}
