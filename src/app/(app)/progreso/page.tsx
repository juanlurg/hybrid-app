import { requireAthlete } from "@/lib/data/athlete";
import { liftStateFrom, phaseSpans } from "@/lib/domain/plan";
import { formatDayShort, placeDate, type IsoDate } from "@/lib/domain/calendar";
import {
  formatWeight,
  isDeloadWeek,
  projectLift,
  regressionLadder,
  round2,
  roundToStep,
  weekInCycle,
  workingWeight,
} from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";
import { accentFor, TONE } from "@/components/day-accents";
import { Framed, ScreenHeader, SectionLabel } from "@/components/ui/kit";
import { cn } from "@/lib/cn";

import { LiftPicker } from "./lift-picker";

/** Height of the season chart, in px. */
const CHART_H = 118;

/** Pa:HR only means something on the long, steady stuff. */
const DECOUPLING_LIMIT = 5;

export default async function ProgresoPage({
  searchParams,
}: {
  searchParams: Promise<{ lift?: string | string[] }>;
}) {
  const athlete = await requireAthlete();
  const { ctx, config, placement, seasonWeeks } = athlete;

  const lifts = [...ctx.lifts].sort((a, b) => a.key.localeCompare(b.key));

  if (lifts.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ScreenHeader eyebrow="PROGRESO" title="Sin básicos que seguir" />
        <p className="px-4 py-6 text-[12px] leading-[1.5] text-mid">
          Este programa no tiene básicos con RM asociada, así que el motor no
          calcula ningún peso. Añade tus RM en Programa y esta pantalla empieza
          a tener números.
        </p>
      </div>
    );
  }

  const raw = (await searchParams).lift;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const liftRow = lifts.find((l) => l.key === requested) ?? lifts[0];
  const lift = liftStateFrom(liftRow);

  /* ── the numbers ─────────────────────────────────────────────── */

  const series = projectLift(lift, seasonWeeks, config);
  const breakdown = workingWeight(lift, placement.absoluteWeek, config);
  const currentKg = breakdown.workingKg;

  // Same wave step, first cycle: what this week would have weighed in cycle 1.
  const cycleOneWeek = weekInCycle(placement.absoluteWeek, config.cycleWeeks) + 1;
  const baselineKg = series[cycleOneWeek - 1] ?? currentKg;
  const deltaKg = round2(currentKg - baselineKg);

  const maxKg = series.reduce((acc, v) => Math.max(acc, v), 0);
  const incKg = lift.kind === "lower" ? config.incLowerKg : config.incUpperKg;
  const penalisedRmKg = roundToStep(
    lift.e1rmKg * (1 - lift.penalty),
    config.roundingKg,
  );

  // What the *next* miss does. Under the conservative rule that is another
  // hold, not a cut — promising "la RM baja un 0 %" would be a lie.
  const ladder = regressionLadder(config.regressionRule);
  const nextPenalty = ladder[Math.min(lift.failCount, 2)];
  const firstCutStrike = ladder.findIndex((p) => p > 0) + 1;
  const nextStepText =
    nextPenalty > 0
      ? `Otro fallo y la RM baja un ${Math.round(nextPenalty * 100)} %.`
      : firstCutStrike > 0
        ? `Otro fallo y el peso se vuelve a repetir: con esta regla la RM no ` +
          `baja hasta el fallo ${firstCutStrike}.`
        : `Otro fallo y el peso se vuelve a repetir: con esta regla la RM no ` +
          `baja nunca por fallos de rango.`;

  // One tick per cycle on the season axis, thinned further on long seasons:
  // with 39 semanas cada celda mide ~7 px y un número de dos cifras no cabe.
  const tickEvery = Math.max(1, config.cycleWeeks, Math.ceil(seasonWeeks / 10));
  const tickWeeks: number[] = [];
  for (let w = 1; w <= seasonWeeks; w += tickEvery) tickWeeks.push(w);
  const lastTick = tickWeeks[tickWeeks.length - 1] ?? 0;
  if (seasonWeeks - lastTick >= 2) tickWeeks.push(seasonWeeks);
  const ticks = new Set(tickWeeks);

  /* ── failures on this lift, and the Pa:HR history ────────────── */

  const supabase = await createClient();

  const [failRes, runSessionRes] = await Promise.all([
    supabase
      .from("engine_events")
      .select("session_id")
      .eq("user_id", athlete.userId)
      .eq("lift_id", liftRow.id)
      .in("kind", ["fail_hold", "fail_penalty"])
      .is("reverted_at", null),
    supabase
      .from("sessions")
      .select("id, scheduled_on")
      .eq("user_id", athlete.userId)
      .in("session_type", ["run_easy", "run_long", "run_quality", "run_test"])
      .order("scheduled_on", { ascending: false })
      .limit(60),
  ]);

  const failEvents = failRes.data ?? [];
  const runSessions = runSessionRes.data ?? [];
  const failSessionIds = failEvents
    .map((e) => e.session_id)
    .filter((id): id is string => Boolean(id));
  const runSessionIds = runSessions.map((s) => s.id);

  const [failSessionRes, runLogRes] = await Promise.all([
    failSessionIds.length
      ? supabase
          .from("sessions")
          .select("id, scheduled_on")
          .eq("user_id", athlete.userId)
          .in("id", failSessionIds)
      : null,
    runSessionIds.length
      ? supabase
          .from("run_logs")
          .select("session_id, decoupling_pct")
          .eq("user_id", athlete.userId)
          .in("session_id", runSessionIds)
          .not("decoupling_pct", "is", null)
      : null,
  ]);

  // `engine_events.week` is the week inside its phase, not the season week the
  // chart runs on, so the session's own date is the only thing that can place a
  // failure. An event we cannot place stays off the chart instead of staining
  // whichever bar happens to carry that number.
  const spans = phaseSpans(ctx.phases);
  const failDates = new Map<string, IsoDate>(
    (failSessionRes?.data ?? []).map((s) => [s.id, s.scheduled_on as IsoDate]),
  );
  const failWeeks = new Set<number>();
  for (const event of failEvents) {
    const iso = event.session_id ? failDates.get(event.session_id) : undefined;
    if (!iso) continue;
    const week = placeDate(spans, iso)?.absoluteWeek;
    if (week != null && week >= 1) failWeeks.add(week);
  }

  const runDates = new Map<string, IsoDate>(
    runSessions.map((s) => [s.id, s.scheduled_on as IsoDate]),
  );
  const decouplings = (runLogRes?.data ?? [])
    .flatMap((log) => {
      const date = runDates.get(log.session_id);
      if (!date || log.decoupling_pct == null) return [];
      // Two runs can share a date, so the session is the identity.
      return [{ id: log.session_id, date, pct: Number(log.decoupling_pct) }];
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 4)
    .reverse(); // newest last

  /* ── the audit ───────────────────────────────────────────────── */

  const terms: Array<{ label: string; value: string }> = [
    { label: "RM estimada", value: `${formatWeight(breakdown.e1rmKg)} kg` },
    {
      label: "Penalización por fallos",
      value:
        breakdown.penalty > 0
          ? `−${Math.round(breakdown.penalty * 100)} %`
          : "ninguna",
    },
    {
      label: `Ciclo ${breakdown.cycle} · incremento`,
      value:
        breakdown.cycleBumpKg > 0
          ? `+${formatWeight(breakdown.cycleBumpKg)} kg`
          : "sin ciclos cerrados",
    },
    {
      label: `Ola · semana ${cycleOneWeek} de ${config.cycleWeeks}`,
      value: `${Math.round(breakdown.waveFactor * 100)} %${
        breakdown.isDeload ? " · descarga" : ""
      }`,
    },
    { label: "Redondeo", value: `${formatWeight(breakdown.roundingKg)} kg` },
  ];

  if (breakdown.isHeld) {
    terms.push({
      label: "Peso en espera",
      value: `repite ${formatWeight(currentKg)} kg`,
    });
  }

  const stateText = breakdown.isHeld
    ? `Se repite ${formatWeight(currentKg)} kg en la próxima sesión de ` +
      `${liftRow.name.toLowerCase()}. La ola habría pedido ` +
      `${formatWeight(breakdown.uncappedKg)} kg, pero fallaste el mínimo del ` +
      `rango y el motor congela el peso en vez de subir. ${nextStepText}`
    : lift.penalty > 0
      ? `RM estimada a ${formatWeight(penalisedRmKg)} kg tras un recorte del ` +
        `${Math.round(lift.penalty * 100)} %. La ola se recalcula sobre ese ` +
        `número: ${formatWeight(currentKg)} kg. Una sesión con todas las ` +
        `series dentro del rango pone el contador de fallos a cero; la RM ` +
        `vuelve a subir por el incremento de ciclo, no de golpe.`
      : `Sin fallos abiertos. El peso sale entero de la ola sobre una RM de ` +
        `${formatWeight(breakdown.e1rmKg)} kg, y cada ciclo cerrado le suma ` +
        `${formatWeight(incKg)} kg. Solo el básico del día mueve el motor: ` +
        `los accesorios no cuentan.`;

  const deltaTone =
    deltaKg > 0 ? "text-ok" : deltaKg < 0 ? "text-fail" : "text-mid";
  const deltaLabel =
    deltaKg === 0
      ? "="
      : `${deltaKg > 0 ? "+" : "−"}${formatWeight(Math.abs(deltaKg))}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        eyebrow="PROGRESO"
        right={
          <span className="num text-[11px] leading-none font-medium opacity-60">
            SEM {placement.absoluteWeek}/{seasonWeeks}
          </span>
        }
      />

      <LiftPicker
        lifts={lifts.map((l) => ({ key: l.key, name: l.name }))}
        active={liftRow.key}
      />

      <div className="flex-1 overflow-auto">
        {/* ── headline ─────────────────────────────────────────── */}
        <section className="border-b-2 border-ink px-4 pt-5 pb-4">
          <div className="text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
            {liftRow.name} · {liftRow.kind === "lower" ? "tren inferior" : "tren superior"}
          </div>

          <div className="mt-2.5 flex items-start gap-3">
            <div className="flex items-start gap-2.5">
              <span className="num text-[46px] leading-[0.82] font-black tracking-[-0.045em]">
                {formatWeight(currentKg)}
              </span>
              <span className="pt-1 text-[11px] leading-[1.15] font-extrabold tracking-[0.1em] uppercase">
                KG
                <br />
                ESTA
                <br />
                SEMANA
              </span>
            </div>

            <div className="ml-auto text-right">
              <div
                className={cn(
                  "num text-[21px] leading-none font-black tracking-[-0.03em]",
                  deltaTone,
                )}
              >
                {deltaLabel}
                {deltaKg === 0 ? "" : " kg"}
              </div>
              <div className="mt-2 text-[9.5px] leading-[1.3] font-semibold tracking-[0.1em] text-mid uppercase">
                vs ciclo 1<br />
                mismo paso de ola
              </div>
            </div>
          </div>
        </section>

        {/* ── season chart ─────────────────────────────────────── */}
        <SectionLabel
          right={<span className="num">MÁX {formatWeight(maxKg)} KG</span>}
        >
          Proyección de la ola
        </SectionLabel>

        <div className="px-4 pt-3 pb-4">
          <div
            className="flex items-end gap-px"
            style={{ height: CHART_H }}
            role="img"
            aria-label={`Peso de trabajo de ${liftRow.name} por semana, de la 1 a la ${seasonWeeks}`}
          >
            {series.map((value, i) => {
              const week = i + 1;
              const failed = failWeeks.has(week);
              const isNow = week === placement.absoluteWeek;
              const deload = isDeloadWeek(week, config);
              const background = failed
                ? TONE.fail
                : isNow
                  ? accentFor("strength")
                  : deload
                    ? TONE.mid
                    : TONE.ink;
              return (
                <div
                  key={week}
                  className="min-w-0 flex-1"
                  style={{
                    height: maxKg > 0 ? Math.max(2, (value / maxKg) * CHART_H) : 2,
                    background,
                  }}
                  title={`Semana ${week} · ${formatWeight(value)} kg`}
                />
              );
            })}
          </div>

          {/* One cell per bar so the axis stays aligned, but only the tick
              weeks carry a number — at 39 semanas cada celda mide ~7 px. */}
          <div className="flex gap-px border-t-2 border-ink pt-1.5">
            {series.map((_, i) => {
              const week = i + 1;
              if (!ticks.has(week)) {
                return <span key={week} className="min-w-0 flex-1" />;
              }
              const failed = failWeeks.has(week);
              const isNow = week === placement.absoluteWeek;
              return (
                <span
                  key={week}
                  className={cn(
                    "num min-w-0 flex-1 text-center text-[9px] leading-none whitespace-nowrap",
                    isNow
                      ? "font-black text-strength"
                      : failed
                        ? "font-bold text-fail"
                        : "font-semibold text-faint",
                  )}
                >
                  {week}
                </span>
              );
            })}
          </div>

          <p className="mt-3 text-[10.5px] leading-[1.45] text-faint">
            Una barra por semana de temporada; la escala numera una de cada{" "}
            {tickEvery}. En gris, las descargas; en naranja, la semana en curso.
            {failWeeks.size > 0
              ? " En rojo, las semanas con un fallo de rango registrado en este básico."
              : ""}
          </p>
        </div>

        {/* ── the audit ────────────────────────────────────────── */}
        <div className="bg-ink px-4 pt-4 pb-4 text-paper">
          <div className="text-[10px] leading-none font-extrabold tracking-[0.12em] text-strength uppercase">
            Cómo sale el peso de hoy
          </div>

          <dl className="mt-3.5 flex flex-col gap-2.5">
            {terms.map((term) => (
              <div key={term.label} className="flex items-baseline gap-3">
                <dt className="flex-1 text-[11.5px] leading-none font-normal opacity-70">
                  {term.label}
                </dt>
                <dd className="num flex-none text-[12.5px] leading-none font-extrabold">
                  {term.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-3.5 flex items-baseline gap-3 border-t-2 border-paper pt-3">
            <span className="flex-1 text-[11px] leading-none font-extrabold tracking-[0.1em] uppercase">
              Peso de trabajo
            </span>
            <span className="num flex-none text-[22px] leading-none font-black tracking-[-0.03em] text-strength">
              {formatWeight(currentKg)}
              <span className="text-[12px] font-extrabold"> kg</span>
            </span>
          </div>
        </div>

        <p className="px-4 pt-3.5 text-[11.5px] leading-[1.55] text-mid">
          {stateText}
        </p>

        {/* ── Pa:HR ────────────────────────────────────────────── */}
        <div className="px-4 pt-4 pb-6">
          <Framed>
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] leading-none font-extrabold tracking-[0.12em] text-run uppercase">
                Desacople Pa:HR
              </span>
              <span className="ml-auto text-[9.5px] leading-none font-semibold tracking-[0.1em] text-faint uppercase">
                ÚLTIMAS TIRADAS
              </span>
            </div>

            {decouplings.length > 0 ? (
              <>
                <div className="mt-3.5 flex gap-px bg-line">
                  {decouplings.map((d) => (
                    <div
                      key={d.id}
                      className="min-w-0 flex-1 bg-paper py-1 pr-2 pl-2 first:pl-0 last:pr-0"
                    >
                      <div
                        className={cn(
                          "num text-[21px] leading-none font-black tracking-[-0.03em]",
                          d.pct < DECOUPLING_LIMIT ? "text-ok" : "text-warn",
                        )}
                      >
                        {formatWeight(d.pct)}
                        <span className="text-[11px] font-extrabold"> %</span>
                      </div>
                      <div className="mt-2 text-[9.5px] leading-none font-semibold tracking-[0.08em] text-mid uppercase">
                        {formatDayShort(d.date)}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10.5px] leading-[1.45] text-faint">
                  Ritmo por pulsación, segunda mitad contra primera; solo dice
                  algo en tiradas largas a ritmo constante. Por debajo del{" "}
                  {DECOUPLING_LIMIT} % la base aeróbica aguanta el rodaje.
                </p>
              </>
            ) : (
              <p className="mt-2.5 text-[11.5px] leading-[1.5] text-mid">
                Todavía no hay ninguna tirada con desacople anotado. Se calcula
                comparando el ritmo por pulsación de la primera y la segunda
                mitad de una tirada de 60′ o más: por debajo del{" "}
                {DECOUPLING_LIMIT} % la base aeróbica aguanta, por encima estás
                corriendo por encima de tu aeróbico. Anótalo al marcar una
                tirada larga y aparecerá aquí.
              </p>
            )}
          </Framed>
        </div>
      </div>
    </div>
  );
}
