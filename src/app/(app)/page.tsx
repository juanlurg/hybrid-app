import Link from "next/link";

import { requireAthlete } from "@/lib/data/athlete";
import { resolveWeek, type ResolvedDay } from "@/lib/domain/plan";
import { createClient } from "@/lib/supabase/server";
import { formatWeight } from "@/lib/engine";
import { DAY_INITIALS } from "@/lib/domain/calendar";
import { Callout, PlateChips } from "@/components/ui/kit";
import { StartSessionButton } from "@/components/session/start-session-button";
import { accentFor, GROUP_LABEL } from "@/components/day-accents";

export default async function HoyPage() {
  const athlete = await requireAthlete();
  const { ctx, config, placement } = athlete;
  const phase = ctx.phases.find((p) => p.id === placement.phase.id)!;

  const week = resolveWeek({
    ctx,
    config,
    phase,
    week: placement.week,
    absoluteWeek: placement.absoluteWeek,
  });
  const day = week[placement.dayIndex];

  const supabase = await createClient();
  const [{ data: sessions }, { data: heldLifts }] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, slot_id, status, scheduled_on")
      .eq("user_id", athlete.userId)
      .in(
        "scheduled_on",
        week.map((d) => d.date),
      ),
    supabase
      .from("lifts")
      .select("id, key, name, hold, hold_at_kg, fail_count, penalty")
      .eq("user_id", athlete.userId)
      .or("hold.eq.true,fail_count.gt.0"),
  ]);

  const sessionFor = (d: ResolvedDay) =>
    (sessions ?? []).find(
      (s) => s.scheduled_on === d.date && s.slot_id === d.slot?.id,
    );
  const todaySession = sessionFor(day);
  const accent = accentFor(day.group);
  const held = (heldLifts ?? []).filter((l) => l.hold && l.hold_at_kg);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between bg-ink px-4 py-3 text-paper">
        <span className="text-[11px] leading-none font-extrabold tracking-[0.1em]">
          {phase.key} · SEM {placement.week}/{phase.weeks}
        </span>
        <span className="text-[11px] leading-none font-medium opacity-60">
          {day.dateLabel}
        </span>
      </div>

      {/* Week strip: today is wide, the rest are stubs coloured by type. */}
      <div className="flex flex-none gap-0.5 bg-ink py-0.5">
        {week.map((d, i) => {
          const isToday = i === placement.dayIndex;
          const done = sessionFor(d)?.status === "done";
          return (
            <Link
              key={d.date}
              href={`/semana#dia-${i}`}
              className="flex h-7 items-center justify-center text-[10px] leading-none font-extrabold tracking-[0.06em]"
              style={{
                flex: isToday ? 2.4 : 1,
                background: isToday ? accentFor(d.group) : "transparent",
                color: isToday ? "#111110" : done ? "#ecebe6" : "#7d7c76",
              }}
            >
              {isToday ? d.dayLabel : DAY_INITIALS[i]}
              {!isToday && done ? "·" : ""}
            </Link>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto">
        {day.group === "strength" && day.primary ? (
          <>
            <section
              className="px-4 pt-5 pb-4 text-ink"
              style={{ background: accent }}
            >
              <div className="text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase">
                {day.label} — {day.subtitle}
              </div>
              <div className="mt-2 flex items-start gap-2.5">
                <div className="num text-[86px] leading-[0.76] font-black tracking-[-0.055em] sm:text-[106px]">
                  {day.primary.weightKg == null
                    ? "—"
                    : formatWeight(day.primary.weightKg)}
                </div>
                <div className="pt-2">
                  <div className="text-[20px] leading-none font-extrabold">
                    KG
                  </div>
                  <div className="mt-2 text-[13px] leading-[1.25] font-semibold opacity-75">
                    {day.primary.schemeLabel}
                    <br />
                    RIR {ctx.profile.target_rir} ·{" "}
                    {day.primary.restLabel}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-baseline gap-2 border-t-2 border-ink pt-2.5">
                <div className="text-[17px] leading-[1.1] font-bold">
                  {day.primary.name}
                </div>
                {ctx.profile.show_plate_breakdown && day.primary.plates ? (
                  <div className="ml-auto">
                    <PlateChips
                      plates={day.primary.plates.perSide}
                      remainder={day.primary.plates.remainderKg}
                    />
                  </div>
                ) : null}
              </div>
              {day.primary.breakdown ? (
                <div className="mt-2 text-[10.5px] leading-none font-medium tracking-[0.08em] uppercase opacity-70">
                  RM {formatWeight(day.primary.breakdown.e1rmKg)} · ola{" "}
                  {Math.round(day.primary.breakdown.waveFactor * 100)} %
                  {day.primary.breakdown.isHeld ? " · en espera" : ""}
                  {day.primary.plates && !day.primary.plates.barOnly
                    ? " · por lado"
                    : ""}
                </div>
              ) : null}
            </section>

            <div className="mt-px flex flex-col gap-px bg-line">
              {day.exercises
                .filter((e) => !e.isPrimary)
                .map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2.5 bg-paper px-4 py-2.5"
                  >
                    <span className="flex-1 text-[13px] leading-[1.2] font-semibold">
                      {e.name}
                    </span>
                    <span className="text-[11px] leading-none font-medium text-mid">
                      {e.schemeLabel}
                    </span>
                    <span className="num min-w-[66px] text-right text-[13px] leading-none font-extrabold">
                      {e.weightLabel}
                    </span>
                  </div>
                ))}
            </div>
          </>
        ) : day.group === "run" ? (
          <section className="bg-run px-4 pt-5 pb-4 text-paper">
            <div className="text-[11px] leading-none font-extrabold tracking-[0.14em] opacity-80 uppercase">
              {day.label} · {day.estimatedMinutes}′ APROX
            </div>
            <h1 className="mt-2.5 text-[31px] leading-[1.02] font-black tracking-[-0.03em]">
              {day.prescription || day.title}
            </h1>
            <p className="mt-3 text-[12px] leading-[1.5] opacity-75">
              {day.subtitle}
            </p>
          </section>
        ) : day.group === "mobility" ? (
          <section className="bg-quiet px-4 pt-5 pb-4">
            <div className="text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase">
              DESCANSO
            </div>
            <h1 className="mt-2.5 text-[31px] leading-[1.02] font-black tracking-[-0.03em]">
              Movilidad y correctivos
            </h1>
            <p className="mt-3 text-[12px] leading-[1.5] text-ink/70">
              20′ de activación glútea, psoas y tobillo. Innegociables, pero no
              cuentan como entrenamiento.
            </p>
          </section>
        ) : (
          <section className="bg-soft px-4 pt-5 pb-4">
            <div className="text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase">
              DESCANSO
            </div>
            <h1 className="mt-2.5 text-[31px] leading-[1.02] font-black tracking-[-0.03em]">
              Hoy no toca
            </h1>
            <p className="mt-3 text-[12px] leading-[1.5] text-mid">
              {day.subtitle || "Descansar es parte del plan."}
            </p>
          </section>
        )}

        {day.isDeload ? (
          <div className="mx-4 mt-3.5">
            <Callout eyebrow="Semana de descarga">
              Mitad de series, mismos pesos. La carrera baja un 40 %. Llegar
              fresco a la semana que viene es el objetivo de esta.
            </Callout>
          </div>
        ) : null}

        {held.map((lift) => (
          <div key={lift.id} className="mx-4 mt-3.5">
            <Callout
              eyebrow={`${lift.name} en espera · ${formatWeight(Number(lift.hold_at_kg))} kg`}
            >
              Fallaste el mínimo del rango la última vez, así que el motor
              repite el mismo peso en vez de subir. Otro fallo y la RM baja.
            </Callout>
          </div>
        ))}

        <Link
          href="/movilidad"
          className="mx-4 mt-3.5 mb-5 flex items-center gap-3 border-2 border-ink px-3.5 py-3"
        >
          <span className="h-[30px] w-[30px] flex-none bg-run" />
          <span className="flex-1">
            <span className="block text-[13.5px] leading-[1.2] font-bold">
              Movilidad y correctivos
            </span>
            <span className="mt-1 block text-[11px] leading-none font-medium text-mid">
              20′ · DIARIO · INNEGOCIABLE
            </span>
          </span>
          <span aria-hidden className="text-[16px] leading-none font-bold">
            →
          </span>
        </Link>
      </div>

      {day.slot ? (
        <StartSessionButton
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
          existingSessionId={todaySession?.id ?? null}
          existingStatus={todaySession?.status ?? null}
          groupLabel={GROUP_LABEL[day.group]}
        />
      ) : null}
    </div>
  );
}
