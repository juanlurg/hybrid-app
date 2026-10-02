import Link from "next/link";

import { requireAthlete } from "@/lib/data/athlete";
import { liftStateFrom, phaseEngineConfig, phaseSpans } from "@/lib/domain/plan";
import { formatDayShort, placeDate, type IsoDate } from "@/lib/domain/calendar";
import {
  formatWeight,
  isDeloadWeek,
  regressionLadder,
  roundToStep,
  weekInCycle,
  workingWeight,
  workingWeightKg,
  type RegressionRule,
} from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";
import { accentFor, TONE } from "@/components/day-accents";
import { Card, Fold, Row, RowStack, SectionLabel, TopBar } from "@/components/ui/kit";
import { cn } from "@/lib/cn";

import { LiftPicker } from "./lift-picker";

/** Coloured left rule per engine event kind. */
const EVENT_TONE: Record<string, string> = {
  fail_hold: TONE.warn,
  fail_penalty: TONE.fail,
  clean_reset: TONE.ok,
  lthr_test: accentFor("run"),
  ai_change: accentFor("strength"),
  cycle_bump: accentFor("strength"),
};

const RULE_LABEL: Record<RegressionRule, string> = {
  conservative: "conservadora",
  standard: "estándar",
  aggressive: "agresiva",
};

/**
 * A rung is coloured by what it actually costs, not by its position: a rule
 * that only freezes the weight twice stays amber twice. Outlined rather than
 * filled — `warn` and `fail` swap lightness between themes, so nothing sits
 * legibly on top of them in both.
 */
function rungTone(cut: number, isLast: boolean) {
  if (cut === 0) return { borderColor: TONE.warn, color: TONE.warn };
  if (isLast) return { borderColor: TONE.fail, color: TONE.fail };
  return { borderColor: accentFor("strength"), color: TONE.ok };
}

/**
 * The one place the engine explains itself: where this week's weight comes
 * from, what the season looks like, what a miss does, and everything it has
 * done so far. Every other screen states the result and links here.
 */
export default async function MotorPage({
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
        <TopBar title="Cómo calcula el motor" href="/programa" />
        <p className="px-5 pt-5 text-[13px] leading-[1.55] text-mid">
          Este programa no tiene básicos con RM asociada, así que el motor no
          calcula ningún peso. Añade tus RM en Plan y esta pantalla empieza a
          tener números.
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
  const cycleWeek = weekInCycle(placement.week, phaseConfig.cycleWeeks) + 1;

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

  /* ── failures on this lift, and the engine's log ─────────────── */

  const supabase = await createClient();

  const [failRes, { data: eventRows }] = await Promise.all([
    supabase
      .from("engine_events")
      .select("session_id")
      .eq("user_id", athlete.userId)
      .eq("lift_id", liftRow.id)
      .in("kind", ["fail_hold", "fail_penalty"])
      .is("reverted_at", null),
    supabase
      .from("engine_events")
      .select("*")
      .eq("user_id", athlete.userId)
      .or(`program_id.eq.${ctx.program.id},program_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const failEvents = failRes.data ?? [];
  const failSessionIds = failEvents
    .map((e) => e.session_id)
    .filter((id): id is string => Boolean(id));
  const failSessionRes = failSessionIds.length
    ? await supabase
        .from("sessions")
        .select("id, scheduled_on")
        .eq("user_id", athlete.userId)
        .in("id", failSessionIds)
    : null;

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

  /* ── the breakdown, term by term ─────────────────────────────── */

  const terms: Array<{ label: string; value: string }> = [
    { label: "RM estimada", value: `${formatWeight(breakdown.e1rmKg)} kg` },
    {
      label: "Recorte por fallos",
      value:
        breakdown.penalty > 0
          ? `−${Math.round(breakdown.penalty * 100)} %`
          : "ninguno",
    },
    {
      label: "Subida por ciclos cerrados",
      value:
        breakdown.cycleBumpKg > 0
          ? `+${formatWeight(breakdown.cycleBumpKg)} kg`
          : "todavía ninguna",
    },
    {
      label:
        phaseConfig.progressionMode === "fixed_pct"
          ? "Porcentaje fijo de la fase"
          : `Semana ${cycleWeek} de ${phaseConfig.cycleWeeks} del ciclo`,
      value: `${Math.round(breakdown.waveFactor * 100)} % de la RM${
        breakdown.isDeload ? " · descarga" : ""
      }`,
    },
    {
      label: "Redondeo a lo que puedes cargar",
      value: `${formatWeight(breakdown.roundingKg)} kg`,
    },
  ];

  if (breakdown.isHeld) {
    terms.push({
      label: "Peso congelado",
      value: `repite ${formatWeight(currentKg)} kg`,
    });
  }

  const stateText = breakdown.isHeld
    ? `Se repite ${formatWeight(currentKg)} kg en la próxima sesión de ` +
      `${liftRow.name.toLowerCase()}. Tocaba subir a ` +
      `${formatWeight(breakdown.uncappedKg)} kg, pero fallaste el mínimo del ` +
      `rango y el motor congela el peso en vez de subir. ${nextStepText}`
    : lift.hold && lift.holdAtKg != null
      ? `Hay un fallo abierto: el peso no pasará de ` +
        `${formatWeight(Number(lift.holdAtKg))} kg hasta una sesión limpia a ` +
        `ese peso. Esta semana toca menos ` +
        `(${formatWeight(currentKg)} kg), así que el tope no se nota — pero ` +
        `sigue ahí.`
      : lift.penalty > 0
        ? `RM estimada a ${formatWeight(penalisedRmKg)} kg tras un recorte del ` +
          `${Math.round(lift.penalty * 100)} %. Los pesos se recalculan sobre ` +
          `ese número: ${formatWeight(currentKg)} kg. Una sesión con todas las ` +
          `series dentro del rango pone el contador de fallos a cero; la RM ` +
          `vuelve a subir con cada ciclo, no de golpe.`
        : `Sin fallos abiertos: cada ciclo cerrado suma ` +
          `${formatWeight(incKg)} kg. Solo el básico del día mueve el motor.`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="Cómo calcula el motor" href="/programa" />

      <LiftPicker
        lifts={lifts.map((l) => ({ key: l.key, name: l.name }))}
        active={liftRow.key}
      />

      <div className="flex-1 overflow-auto pb-6">
        {/* ── where this week's number comes from ──────────────── */}
        <div className="px-5 pt-4">
          <Card>
            <div className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-clay uppercase">
              {liftRow.name} · esta semana
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
              <span className="num flex-none text-[28px] leading-none font-bold tracking-[-0.02em] text-clay">
                {formatWeight(currentKg)}
                <span className="text-[13px] font-semibold uppercase"> kg</span>
              </span>
            </div>

            <p className="mt-3 text-[13px] leading-[1.55] text-mid">
              {stateText}
            </p>
          </Card>
        </div>

        {/* ── the season, projected ────────────────────────────── */}
        <div className="px-5 pt-3.5">
          <Card>
            <div className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
              Toda la temporada
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
                          ? "bg-clay-line"
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
            <p className="mt-2 text-[12px] leading-[1.5] text-mid">
              Lo que pedirá el plan cada semana si no hay fallos · máximo{" "}
              {formatWeight(maxKg)} kg. Verde, esta semana; tenue, descargas
              {failWeeks.size > 0 ? "; rojo, semanas con fallo" : ""}.
            </p>
          </Card>
        </div>

        {/* ── what a miss does ─────────────────────────────────── */}
        <Fold
          className="mt-3.5"
          title="Si fallas el rango"
          summary={`Regla ${RULE_LABEL[config.regressionRule]} · solo el básico del día`}
        >
          <ol className="flex flex-col gap-2.5">
            {ladder.map((cut, i) => {
              const isLast = i === ladder.length - 1;
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    className="num flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[11px] leading-none font-bold"
                    style={rungTone(cut, isLast)}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 text-[13px] leading-[1.45]">
                    {cut === 0
                      ? "Se repite el mismo peso en la próxima sesión. La RM no baja."
                      : `La RM estimada baja un ${Math.round(cut * 100)} % y los pesos se recalculan${
                          isLast ? ", con una descarga forzada: 2 series al 70 %." : "."
                        }`}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3.5 border-t border-line pt-2.5 text-[12px] leading-[1.45] text-mid">
            Fallo = una serie del básico por debajo del mínimo del rango, o
            RIR 0. Una sesión limpia reinicia el contador.
          </p>
        </Fold>

        {/* ── everything it has done ───────────────────────────── */}
        <SectionLabel>Lo que ha hecho el motor</SectionLabel>
        <RowStack className="mt-2.5">
          {(eventRows ?? []).length === 0 ? (
            <Row>
              <p className="text-[13px] leading-[1.55] text-mid">
                Todavía nada. Cada cambio — congelar un peso, recortar una RM,
                subir un accesorio — queda aquí con su semana y su detalle.
              </p>
            </Row>
          ) : (
            (eventRows ?? []).map((e) => {
              const reverted = Boolean(e.reverted_at);
              return (
                <Row key={e.id}>
                  <div
                    className="rounded-r-sm border-l-[4px] py-0.5 pl-3"
                    style={{ borderColor: EVENT_TONE[e.kind] ?? TONE.ink }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="num text-[11px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                        {formatDayShort(e.created_at.slice(0, 10) as IsoDate)}
                        {e.week != null ? ` · semana ${e.week}` : ""}
                      </span>
                      {reverted ? (
                        <span className="font-display text-[11px] leading-none font-semibold tracking-[0.1em] text-faint uppercase">
                          deshecho
                        </span>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        "mt-1.5 text-[13.5px] leading-[1.25] font-semibold",
                        reverted && "text-faint line-through",
                      )}
                    >
                      {e.title}
                    </div>
                    {e.detail ? (
                      <div className="mt-1.5 text-[12.5px] leading-[1.5] text-mid">
                        {e.detail}
                      </div>
                    ) : null}
                  </div>
                </Row>
              );
            })
          )}
        </RowStack>

        <Link
          href="/ajustes#ajustes-motor"
          className="mt-3.5 flex items-center gap-2.5 px-6 py-2"
        >
          <span className="flex-1 text-[13px] leading-[1.4] text-mid">
            Cambiar la regla, el redondeo o los incrementos · Ajustes
          </span>
          <span aria-hidden className="text-[13px] leading-none text-mid">
            ›
          </span>
        </Link>
      </div>
    </div>
  );
}
