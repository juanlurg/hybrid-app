import Link from "next/link";
import type { ReactNode } from "react";

import { SecondaryNav } from "@/components/app-shell";
import { accentFor, TONE } from "@/components/day-accents";
import { Footnote, Row, SectionLabel } from "@/components/ui/kit";
import { cn } from "@/lib/cn";
import { requireAthlete } from "@/lib/data/athlete";
import {
  addDays,
  formatDayShort,
  formatSeasonRange,
  type IsoDate,
} from "@/lib/domain/calendar";
import {
  cycleOf,
  formatWeight,
  regressionLadder,
  roundToStep,
} from "@/lib/engine";
import type { RegressionRule } from "@/lib/engine";
import { phaseEngineConfig, type LiftRow } from "@/lib/domain/plan";
import { createClient } from "@/lib/supabase/server";

import { RmCalculator, type RmCalcLift } from "./rm-calculator";
import { RmRows, type RmRow } from "./rm-rows";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The most recent logged set of each basic, to seed the calculator. One query
 * per lift, one row each: a single ordered query would need a cap, and the cap
 * would silently drop whatever was not trained lately.
 */
async function lastSetPerLift(
  supabase: Supabase,
  userId: string,
  lifts: LiftRow[],
): Promise<Map<string, { weightKg: number; reps: number; on: string }>> {
  const rows = await Promise.all(
    lifts.map(async (lift) => {
      const { data } = await supabase
        .from("set_logs")
        .select("weight_kg, reps, logged_at")
        .eq("user_id", userId)
        .eq("lift_key", lift.key)
        .not("weight_kg", "is", null)
        .not("reps", "is", null)
        .order("logged_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data || data.weight_kg == null || data.reps == null) return null;
      return [
        lift.key,
        {
          weightKg: Number(data.weight_kg),
          reps: data.reps,
          on: formatDayShort(data.logged_at.slice(0, 10) as IsoDate),
        },
      ] as const;
    }),
  );
  return new Map(rows.filter((row): row is NonNullable<typeof row> => row !== null));
}

const RULE_LABEL: Record<RegressionRule, string> = {
  conservative: "CONSERVADORA",
  standard: "ESTÁNDAR",
  aggressive: "AGRESIVA",
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
 * A reference block folded behind its own summary. `details` keeps the body
 * mounted, so the calculator holds its state across an open/close.
 */
function Fold({
  title,
  summary,
  children,
  className,
}: {
  title: string;
  summary: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      className={cn(
        "group mx-5 rounded-xl border border-edge bg-surface",
        className,
      )}
    >
      <summary className="flex list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="font-display block text-[12px] leading-none font-semibold tracking-[0.1em] uppercase">
            {title}
          </span>
          <span className="mt-[3px] block text-[12px] leading-[1.35] text-faint">
            {summary}
          </span>
        </span>
        <span
          aria-hidden
          className="font-display flex-none text-[14px] leading-none text-faint transition-transform group-open:rotate-45"
        >
          ＋
        </span>
      </summary>
      <div className="rounded-b-xl border-t border-line bg-sunk px-4 pt-3.5 pb-4">
        {children}
      </div>
    </details>
  );
}

export default async function ProgramaPage() {
  const athlete = await requireAthlete();
  const { ctx, config, placement, seasonWeeks } = athlete;
  const { profile, program } = ctx;
  const phase = ctx.phases.find((p) => p.id === placement.phase.id)!;

  const startsOn = program.starts_on as IsoDate;
  const endsOn = (program.ends_on ??
    addDays(startsOn, seasonWeeks * 7 - 1)) as IsoDate;
  const season = formatSeasonRange(startsOn, endsOn).toUpperCase();

  const phaseConfig = phaseEngineConfig(config, phase);
  const cycle = cycleOf(placement.week, phaseConfig.cycleWeeks);
  const ladder = regressionLadder(config.regressionRule);
  // The folded summary is the ladder itself, so it cannot drift from it.
  const ladderSummary = ladder
    .map((cut, i) => {
      const rung = cut === 0 ? "congela" : `−${Math.round(cut * 100)} %`;
      return `${i + 1} ${rung}${i === ladder.length - 1 ? " + descarga" : ""}`;
    })
    .join(" · ");

  // When the last RM re-test was, if there has ever been one.
  const supabase = await createClient();
  const [{ data: lastRetest }, lastSetByLift] = await Promise.all([
    supabase
      .from("measurements")
      .select("taken_on")
      .eq("user_id", athlete.userId)
      .eq("kind", "rm_estimate")
      .order("taken_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
    lastSetPerLift(supabase, athlete.userId, ctx.lifts),
  ]);

  const lifts: RmRow[] = ctx.lifts.map((l) => {
    const e1rmKg = Number(l.e1rm_kg);
    const penalty = Number(l.penalty ?? 0);
    return {
      id: l.id,
      name: l.name,
      e1rmKg,
      penalty,
      hold: l.hold ?? false,
      holdAtKg: l.hold_at_kg == null ? null : Number(l.hold_at_kg),
      // What the wave is actually multiplying while a cut is open.
      effectiveRmKg:
        penalty > 0
          ? roundToStep(e1rmKg * (1 - penalty), config.roundingKg)
          : null,
    };
  });

  const calcLifts: RmCalcLift[] = ctx.lifts.map((l) => ({
    key: l.key,
    name: l.name,
    e1rmKg: Number(l.e1rm_kg),
    lastSet: lastSetByLift.get(l.key) ?? null,
  }));

  const params: Array<{ label: string; value: string }> = [
    { label: "RIR", value: profile.target_rir },
    { label: "Redondeo", value: `${formatWeight(config.roundingKg)} kg` },
    { label: "Barra", value: `${formatWeight(config.barKg)} kg` },
    { label: "Incr. pierna", value: `+${formatWeight(config.incLowerKg)} kg` },
    { label: "Incr. torso", value: `+${formatWeight(config.incUpperKg)} kg` },
    { label: "LTHR", value: profile.lthr ? `${profile.lthr} ppm` : "sin test" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none px-5 pt-6">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display min-w-0 flex-1 text-[21px] leading-[1.15] font-bold">
            {program.name}
          </h1>
          <span className="font-display flex-none text-[11px] leading-none whitespace-nowrap text-faint">
            {season}
          </span>
        </div>
        {program.goal ? (
          <p className="mt-1.5 text-[12.5px] leading-[1.45] text-mid">
            {program.goal}
          </p>
        ) : null}
      </header>

      <SecondaryNav />

      <div className="flex-1 overflow-auto pb-6">
        <Row className="mx-5 mt-3.5 flex items-baseline gap-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[13.5px] leading-[1.2] font-semibold">
            {phase.name}
          </span>
          <span className="font-display flex-none text-[11px] leading-none whitespace-nowrap text-faint uppercase">
            Semana {placement.week} de {phase.weeks} · Ciclo {cycle}
          </span>
        </Row>

        <SectionLabel
          right={
            lastRetest
              ? `ÚLTIMO RE-TEST · ${formatDayShort(lastRetest.taken_on).toUpperCase()}`
              : "SIN RE-TEST"
          }
        >
          RM estimadas · Epley
        </SectionLabel>

        {lifts.length > 0 ? (
          <RmRows lifts={lifts} stepKg={config.roundingKg} />
        ) : (
          <Footnote>
            Todavía no hay básicos con RM estimada. Se crean al clonar un
            programa.
          </Footnote>
        )}

        <p className="mt-2.5 px-5 text-[11.5px] leading-[1.5] text-faint">
          Ajustar una RM a mano recalcula los pesos futuros de ese básico; las
          series ya registradas no cambian. Queda anotado en el historial del
          motor.
        </p>

        {calcLifts.length > 0 ? (
          <Fold
            className="mt-3.5"
            title="Calculadora de RM"
            summary="Peso × reps → RM · no guarda nada"
          >
            <RmCalculator lifts={calcLifts} stepKg={config.roundingKg} />
          </Fold>
        ) : null}

        <Fold
          className="mt-2"
          title={`Regla de regresión · ${RULE_LABEL[config.regressionRule]}`}
          summary={ladderSummary}
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
                  <span className="flex-1 text-[11.5px] leading-[1.45]">
                    {cut === 0
                      ? "Se repite el mismo peso en la próxima sesión. La RM no baja."
                      : `RM estimada −${Math.round(cut * 100)} %, la ola se recalcula${
                          isLast ? " y descarga forzada: 2 series @ 70 %." : "."
                        }`}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3.5 border-t border-line pt-2.5 text-[10.5px] leading-[1.45] text-faint">
            Fallo = serie por debajo del mínimo del rango, o RIR 0. Una sesión
            limpia reinicia el contador.
          </p>
        </Fold>

        <div className="mt-3.5 grid grid-cols-3 gap-1.5 px-5">
          {params.map((p) => (
            <div
              key={p.label}
              className="rounded-md border border-line bg-surface px-3 py-2.5"
            >
              <div className="text-[10px] leading-none tracking-[0.08em] text-faint uppercase">
                {p.label}
              </div>
              <div className="num mt-1 text-[14px] leading-none font-bold">
                {p.value}
              </div>
            </div>
          ))}
        </div>

        <Link
          href="/ajustes"
          className="flex min-h-11 items-center justify-end px-5 text-[11px] leading-none text-faint"
        >
          se cambian en Ajustes ›
        </Link>
      </div>
    </div>
  );
}
