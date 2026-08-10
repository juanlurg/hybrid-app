import { requireAthlete } from "@/lib/data/athlete";
import { liftStateFrom, phaseEngineConfig, phaseSpans } from "@/lib/domain/plan";
import { formatDayShort, placeDate, type IsoDate } from "@/lib/domain/calendar";
import {
  formatWeight,
  isDeloadWeek,
  regressionLadder,
  round2,
  roundToStep,
  weekInCycle,
  workingWeight,
  workingWeightKg,
} from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";
import { accentFor, TONE } from "@/components/day-accents";
import { Card, Framed } from "@/components/ui/kit";
import { cn } from "@/lib/cn";

import { LiftPicker } from "./lift-picker";

/** Pa:HR only means something on the long, steady stuff. */
const DECOUPLING_LIMIT = 5;

/** No eyebrow on this screen: the title is one word and carries it. */
function Header({ week, seasonWeeks }: { week: number; seasonWeeks: number }) {
  return (
    <header className="flex flex-none items-baseline gap-2.5 px-5 pt-6">
      <h1 className="font-display flex-1 text-[22px] leading-[1.1] font-bold">
        Progreso
      </h1>
      <span className="num flex-none text-[12px] leading-none text-faint">
        SEM {week}/{seasonWeeks}
      </span>
    </header>
  );
}

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
        <Header week={placement.absoluteWeek} seasonWeeks={seasonWeeks} />
        <p className="px-5 pt-5 text-[12px] leading-[1.55] text-mid">
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

  // Project the season phase by phase: each phase runs its own
  // progression on its own local weeks (F2's wave, F3/F4's fixed %).
  const orderedPhases = [...ctx.phases].sort((a, b) => a.position - b.position);
  const currentPhase =
    ctx.phases.find((p) => p.id === placement.phase.id) ?? orderedPhases[0];
  const phaseConfig = phaseEngineConfig(config, currentPhase);

  const cleanLift = { ...lift, hold: false, holdAtKg: null };
  const series: number[] = [];
  const deloadFlags: boolean[] = [];
  for (const p of orderedPhases) {
    const pc = phaseEngineConfig(config, p);
    for (let w = 1; w <= p.weeks; w++) {
      series.push(workingWeightKg(cleanLift, w, pc));
      deloadFlags.push(isDeloadWeek(w, pc));
    }
  }

  const breakdown = workingWeight(lift, placement.week, phaseConfig);
  const currentKg = breakdown.workingKg;

  // Same wave step, first cycle of THIS phase: what this week would
  // have weighed before any cycle bumps.
  const phaseBase = orderedPhases
    .slice(0, orderedPhases.findIndex((p) => p.id === currentPhase.id))
    .reduce((acc, p) => acc + p.weeks, 0);
  const cycleOneWeek = weekInCycle(placement.week, phaseConfig.cycleWeeks) + 1;
  const baselineKg = series[phaseBase + cycleOneWeek - 1] ?? currentKg;
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
    // The season charts below claim "lo no anotado no existe", so the
    // window has to hold a whole season: ~4 runs × 39 weeks ≪ 400.
    supabase
      .from("sessions")
      .select("id, scheduled_on")
      .eq("user_id", athlete.userId)
      .in("session_type", ["run_easy", "run_long", "run_quality", "run_test"])
      .order("scheduled_on", { ascending: false })
      .limit(400),
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
          .select("session_id, decoupling_pct, distance_km")
          .eq("user_id", athlete.userId)
          .in("session_id", runSessionIds)
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
  // Every logged decoupling, oldest first — CARRERA-juanlu.md calls
  // Pa:HR drift THE progress metric, so it gets a trend, not a strip.
  const decouplingSeries = (runLogRes?.data ?? [])
    .flatMap((log) => {
      const date = runDates.get(log.session_id);
      if (!date || log.decoupling_pct == null) return [];
      // Two runs can share a date, so the session is the identity.
      return [{ id: log.session_id, date, pct: Number(log.decoupling_pct) }];
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const decouplings = decouplingSeries.slice(-4); // newest last

  // Weekly volume across the season, from the logged distances.
  const kmByWeek = new Map<number, number>();
  for (const log of runLogRes?.data ?? []) {
    const date = runDates.get(log.session_id);
    if (!date || log.distance_km == null) continue;
    const week = placeDate(spans, date)?.absoluteWeek;
    if (week == null) continue;
    kmByWeek.set(week, (kmByWeek.get(week) ?? 0) + Number(log.distance_km));
  }
  const maxWeekKm = Math.max(0, ...kmByWeek.values());

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
    : lift.hold && lift.holdAtKg != null
      ? `Hay un fallo abierto: la ola no pasará de ` +
        `${formatWeight(Number(lift.holdAtKg))} kg hasta una sesión limpia a ` +
        `ese peso. Esta semana la ola pide menos ` +
        `(${formatWeight(currentKg)} kg), así que el tope no toca — pero ` +
        `sigue ahí.`
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
  const deltaGlyph = deltaKg === 0 ? "=" : deltaKg > 0 ? "↑" : "↓";
  const deltaText =
    deltaKg === 0
      ? "vs ciclo 1"
      : `${deltaKg > 0 ? "+" : "−"}${formatWeight(Math.abs(deltaKg))} kg vs ciclo 1`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header week={placement.absoluteWeek} seasonWeeks={seasonWeeks} />

      <LiftPicker
        lifts={lifts.map((l) => ({ key: l.key, name: l.name }))}
        active={liftRow.key}
      />

      <div className="flex-1 overflow-auto px-5 pt-4 pb-6">
        {/* ── the lit number, over its own projection ──────────── */}
        <Card>
          <div className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
            {liftRow.name} ·{" "}
            {liftRow.kind === "lower" ? "tren inferior" : "tren superior"}
          </div>

          <div className="mt-2 flex items-end gap-3">
            <span className="num text-[64px] leading-[0.95] font-bold tracking-[-0.02em] text-lime">
              {formatWeight(currentKg)}
            </span>
            <span className="font-display pb-1.5 text-[12px] leading-[1.3] font-semibold whitespace-nowrap text-mid">
              KG
              <br />
              ESTA SEMANA
            </span>

            <span className="ml-auto pb-1 text-right">
              <span
                className={cn(
                  "font-display block text-[20px] leading-none font-bold",
                  deltaTone,
                )}
              >
                {deltaGlyph}
              </span>
              {/* The magnitude rides in the caption: the glyph carries the
                  direction, the line under it the size and the comparison. */}
              <span className="mt-1 block text-[11px] leading-[1.4] text-faint">
                {deltaText}
                <br />
                mismo paso de ola
              </span>
            </span>
          </div>

          <div
            className="mt-4 flex h-[88px] items-end gap-0.5 border-b border-edge"
            role="img"
            aria-label={`Peso de trabajo de ${liftRow.name} por semana, de la 1 a la ${seasonWeeks}`}
          >
            {series.map((value, i) => {
              const week = i + 1;
              const failed = failWeeks.has(week);
              const isNow = week === placement.absoluteWeek;
              return (
                <div
                  key={week}
                  className={cn(
                    "min-w-0 flex-1 rounded-t-[2px]",
                    failed
                      ? "bg-fail"
                      : isNow
                        ? "bg-lime-line"
                        : deloadFlags[i]
                          ? // `soft` is white-on-white against the card in
                            // the light theme; `quiet` still reads as dimmer.
                            "bg-quiet"
                          : "bg-hairline",
                  )}
                  style={{
                    height: `${maxKg > 0 ? Math.max(4, (value / maxKg) * 100) : 4}%`,
                  }}
                  title={`Semana ${week} · ${formatWeight(value)} kg`}
                />
              );
            })}
          </div>

          <p className="mt-2 text-[11px] leading-[1.5] text-faint">
            Proyección de la ola, {seasonWeeks} semanas · máx{" "}
            {formatWeight(maxKg)} kg · verde = semana actual · tenue = descargas
            {failWeeks.size > 0 ? " · rojo = fallo de rango" : ""}
          </p>
        </Card>

        {/* ── the audit ────────────────────────────────────────── */}
        <Card className="mt-3.5">
          <div className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-lime uppercase">
            Cómo sale el peso de hoy
          </div>

          <dl className="mt-3 flex flex-col gap-[9px]">
            {terms.map((term) => (
              <div key={term.label} className="flex items-baseline gap-2.5">
                <dt className="flex-1 text-[13px] leading-[1.3] text-mid">
                  {term.label}
                </dt>
                <dd className="num flex-none text-[13.5px] leading-none font-semibold">
                  {term.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-3.5 flex items-baseline gap-2.5 border-t border-edge pt-3">
            <span className="font-display flex-1 text-[12px] leading-none font-semibold tracking-[0.1em] uppercase">
              Peso de trabajo
            </span>
            <span className="num flex-none text-[24px] leading-none font-bold tracking-[-0.02em] text-lime">
              {formatWeight(currentKg)}
              <span className="text-[13px] font-semibold uppercase"> kg</span>
            </span>
          </div>

          <p className="mt-3 text-[12px] leading-[1.55] text-faint">
            {stateText}
          </p>
        </Card>

        {/* ── Pa:HR ────────────────────────────────────────────── */}
        <Framed className="mt-3.5">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-run uppercase">
              Desacople Pa:HR
            </span>
            <span className="ml-auto text-[11px] leading-none text-faint">
              ÚLTIMAS TIRADAS
            </span>
          </div>

          {decouplings.length > 0 ? (
            <>
              <div className="mt-3.5 flex gap-1.5">
                {decouplings.map((d) => (
                  <div
                    key={d.id}
                    className="min-w-0 flex-1 rounded-lg bg-soft px-2.5 py-2.5"
                  >
                    <div
                      className={cn(
                        "num text-[21px] leading-none font-bold tracking-[-0.02em]",
                        d.pct < DECOUPLING_LIMIT ? "text-ok" : "text-warn",
                      )}
                    >
                      {formatWeight(d.pct)}
                      <span className="text-[11px] font-semibold"> %</span>
                    </div>
                    <div className="font-display mt-2 text-[10px] leading-none font-semibold tracking-[0.08em] text-mid uppercase">
                      {formatDayShort(d.date)}
                    </div>
                  </div>
                ))}
              </div>
              {decouplingSeries.length > 4 ? (
                <>
                  <div className="mt-3.5 flex h-[54px] items-end gap-0.5 border-b border-edge">
                    {decouplingSeries.map((d) => (
                      <div
                        key={d.id}
                        className="min-w-0 flex-1 rounded-t-[2px]"
                        style={{
                          height: `${Math.max(8, Math.min(100, Math.round((d.pct / 10) * 100)))}%`,
                          background:
                            d.pct < DECOUPLING_LIMIT ? TONE.ok : TONE.warn,
                        }}
                      />
                    ))}
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="num text-[10px] leading-none font-semibold tracking-[0.06em] text-faint uppercase">
                      {formatDayShort(decouplingSeries[0].date)}
                    </span>
                    <span className="num text-[10px] leading-none font-semibold tracking-[0.06em] text-faint uppercase">
                      {formatDayShort(
                        decouplingSeries[decouplingSeries.length - 1].date,
                      )}
                    </span>
                  </div>
                </>
              ) : null}
              <p className="mt-3 text-[11px] leading-[1.5] text-faint">
                Ritmo por pulsación, segunda mitad contra primera; solo dice algo
                en tiradas largas a ritmo constante. Por debajo del{" "}
                {DECOUPLING_LIMIT} % la base aeróbica aguanta el rodaje
                {decouplingSeries.length > 4
                  ? " — la serie completa de la temporada, abajo."
                  : "."}
              </p>
            </>
          ) : (
            <p className="mt-2.5 text-[12px] leading-[1.55] text-mid">
              Todavía no hay ninguna tirada con desacople anotado. Se calcula
              comparando el ritmo por pulsación de la primera y la segunda mitad
              de una tirada de 60′ o más: por debajo del {DECOUPLING_LIMIT} % la
              base aeróbica aguanta, por encima estás corriendo por encima de tu
              aeróbico. Anótalo al marcar una tirada larga y aparecerá aquí.
            </p>
          )}
        </Framed>

        {/* ── weekly km ────────────────────────────────────────── */}
        {maxWeekKm > 0 ? (
          <Framed className="mt-3.5">
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-run uppercase">
                Kilómetros por semana
              </span>
              <span className="num ml-auto text-[11px] leading-none text-faint uppercase">
                MÁX {formatWeight(maxWeekKm)} km
              </span>
            </div>
            <div className="mt-3.5 flex h-[54px] items-end gap-0.5 border-b border-edge">
              {Array.from({ length: seasonWeeks }, (_, i) => {
                const km = kmByWeek.get(i + 1) ?? 0;
                return (
                  <div
                    key={i}
                    className="min-w-0 flex-1 rounded-t-[2px]"
                    style={{
                      height: `${km > 0 ? Math.max(6, Math.round((km / maxWeekKm) * 100)) : 2}%`,
                      background: km > 0 ? accentFor("run") : TONE.hairline,
                    }}
                  />
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-0.5">
              {Array.from({ length: seasonWeeks }, (_, i) => (
                <div
                  key={i}
                  className="num min-w-0 flex-1 text-center text-[9px] leading-none font-semibold text-faint"
                >
                  {ticks.has(i + 1) ? i + 1 : ""}
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-[1.5] text-faint">
              Suma de las distancias anotadas al marcar cada carrera. Las semanas
              sin kilómetros son huecos de verdad: lo no anotado no existe.
            </p>
          </Framed>
        ) : null}
      </div>
    </div>
  );
}
