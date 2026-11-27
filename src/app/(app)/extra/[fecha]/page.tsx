import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, SectionLabel, TopBar } from "@/components/ui/kit";
import { requireAthlete } from "@/lib/data/athlete";
import {
  addDays,
  DAY_INITIALS,
  formatDayFull,
  placeDate,
  startOfWeek,
  type IsoDate,
} from "@/lib/domain/calendar";
import { phaseSpans } from "@/lib/domain/plan";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";

import { ExtraForm, type LoggedExtra } from "./extra-form";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A session outside the plan, by date: 30′ de rodillo on an easy day, a
 * walk, a second run. It is logged after the fact, so only today and
 * days already gone can hold one.
 */
export default async function ExtraPage({
  params,
  searchParams,
}: {
  params: Promise<{ fecha: string }>;
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { fecha } = await params;
  const { id: rawId } = await searchParams;
  const athlete = await requireAthlete();
  const { ctx, today } = athlete;

  if (!ISO_DATE.test(fecha) || fecha > today) redirect(`/extra/${today}`);
  const date = fecha as IsoDate;

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("sessions")
    .select(
      "id, session_type, title, run_logs(duration_seconds, distance_km, avg_hr, perceived_effort, notes)",
    )
    .eq("user_id", athlete.userId)
    .eq("scheduled_on", date)
    .is("slot_id", null)
    .order("created_at");

  const logged: LoggedExtra[] = (rows ?? []).map((s) => {
    const log = s.run_logs;
    return {
      id: s.id,
      sessionType: s.session_type === "cross" ? "cross" : "run_easy",
      title: s.title,
      durationMinutes:
        log?.duration_seconds == null
          ? null
          : Math.round(log.duration_seconds / 60),
      distanceKm: log?.distance_km == null ? null : Number(log.distance_km),
      avgHr: log?.avg_hr ?? null,
      perceivedEffort: log?.perceived_effort ?? null,
      notes: log?.notes ?? "",
    };
  });

  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const editing = logged.find((l) => l.id === id) ?? null;

  // Back to the week this date belongs to, when it is a week of the plan.
  const placement = placeDate(phaseSpans(ctx.phases), date);
  const back =
    date === today
      ? "/"
      : placement?.date === date
        ? `/semana?semana=${placement.absoluteWeek}`
        : "/semana";

  const monday = startOfWeek(date);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title={formatDayFull(date)} href={back} />

      <div className="no-scrollbar flex-1 overflow-auto">
        <div className="px-5 pt-3.5">
          <Card>
            <div className="text-[11px] leading-none font-bold tracking-[0.13em] text-run uppercase">
              Fuera del plan
            </div>
            <h1 className="mt-2 text-[22px] leading-[1.25] font-extrabold tracking-[-0.01em]">
              {editing ? editing.title : "Sesión extra"}
            </h1>
            <p className="mt-2 text-[13px] leading-[1.5] font-medium text-mid">
              Suma a tus horas aeróbicas y la ve tu entrenador. No cuenta para
              la adherencia: ni suma ni resta.
            </p>
            {editing ? null : (
              <div className="mt-4 grid grid-cols-7 gap-1">
                {week.map((d, i) => {
                  const cell = cn(
                    "num flex h-11 flex-col items-center justify-center gap-1 rounded-lg text-[11px] leading-none font-bold",
                    d === date
                      ? "bg-run text-on-run"
                      : d > today
                        ? "bg-quiet text-faint"
                        : "bg-soft text-ink",
                  );
                  const body = (
                    <>
                      <span>{DAY_INITIALS[i]}</span>
                      <span>{Number(d.slice(8))}</span>
                    </>
                  );
                  return d > today ? (
                    <span key={d} className={cell}>
                      {body}
                    </span>
                  ) : (
                    <Link
                      key={d}
                      href={`/extra/${d}`}
                      aria-current={d === date ? "date" : undefined}
                      className={cell}
                    >
                      {body}
                    </Link>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {!editing && logged.length > 0 ? (
          <>
            <SectionLabel className="pb-2.5">Ya registradas</SectionLabel>
            <div className="mx-5 flex flex-col rounded-2xl bg-surface p-1.5 shadow-card">
              {logged.map((l) => (
                <Link
                  key={l.id}
                  href={`/extra/${date}?id=${l.id}`}
                  className="flex items-baseline gap-3 rounded-lg p-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[15px] leading-[1.25] font-bold">
                    {l.title}
                  </span>
                  <span className="num flex-none text-[13px] leading-none font-semibold text-mid">
                    {l.durationMinutes == null ? "—" : `${l.durationMinutes}′`}
                  </span>
                  <span className="flex-none text-[13px] leading-none font-bold text-clay">
                    Editar
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : null}

        {/* Keyed so switching day or opening another one resets the form. */}
        <ExtraForm
          key={editing?.id ?? date}
          date={date}
          editing={editing}
          back={back}
        />
      </div>
    </div>
  );
}
