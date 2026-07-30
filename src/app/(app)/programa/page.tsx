import { SecondaryNav } from "@/components/app-shell";
import { accentFor, TONE } from "@/components/day-accents";
import { Footnote, Framed, ScreenHeader, SectionLabel } from "@/components/ui/kit";
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
 * that only freezes the weight twice stays amber twice.
 */
function rungTone(cut: number, isLast: boolean) {
  if (cut === 0) return { background: TONE.warn, color: TONE.ink };
  if (isLast) return { background: TONE.fail, color: TONE.paper };
  return { background: accentFor("strength"), color: TONE.ink };
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
    { label: "RIR objetivo", value: profile.target_rir },
    { label: "Redondeo", value: `${formatWeight(config.roundingKg)} kg` },
    { label: "Incr. pierna", value: `+${formatWeight(config.incLowerKg)} kg` },
    { label: "Incr. torso", value: `+${formatWeight(config.incUpperKg)} kg` },
    { label: "Barra", value: `${formatWeight(config.barKg)} kg` },
    { label: "LTHR", value: profile.lthr ? `${profile.lthr} ppm` : "sin test" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        eyebrow="PROGRAMA"
        title={program.name}
        subtitle={program.goal}
        right={
          <span className="num text-[10px] leading-none font-medium opacity-55">
            {season}
          </span>
        }
      />

      <SecondaryNav />

      <div className="flex-1 overflow-auto pb-6">
        <div className="flex items-baseline gap-3 border-y-2 border-ink bg-paper px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-[13.5px] leading-[1.2] font-bold">
            {phase.name}
          </span>
          <span className="num flex-none text-[10px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
            Semana {placement.week} de {phase.weeks} · Ciclo {cycle}
          </span>
        </div>

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

        <Footnote>
          Ajustar una RM a mano recalcula los pesos futuros de ese básico; las
          series ya registradas no cambian. Queda anotado en el historial del
          motor.
        </Footnote>

        {calcLifts.length > 0 ? (
          <>
            <SectionLabel right="NO GUARDA NADA">
              Calculadora de RM
            </SectionLabel>
            <RmCalculator lifts={calcLifts} stepKg={config.roundingKg} />
          </>
        ) : null}

        <Framed className="mx-4 mt-5">
          <div className="text-[10px] leading-none font-extrabold tracking-[0.12em] uppercase">
            Regla de regresión · {RULE_LABEL[config.regressionRule]}
          </div>
          <ol className="mt-3.5 flex flex-col gap-2.5">
            {ladder.map((cut, i) => {
              const isLast = i === ladder.length - 1;
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    className="num flex h-5 w-5 flex-none items-center justify-center text-[11px] leading-none font-black"
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
        </Framed>

        <SectionLabel right="SE CAMBIAN EN AJUSTES">
          Parámetros del motor
        </SectionLabel>

        <div className="mt-3 flex flex-wrap gap-px bg-line">
          {params.map((p) => (
            <div
              key={p.label}
              className="min-w-[86px] flex-1 bg-ink px-3 py-2.5 text-paper"
            >
              <div className="text-[9.5px] leading-none font-semibold tracking-[0.1em] uppercase opacity-55">
                {p.label}
              </div>
              <div className="num mt-2 text-[14px] leading-none font-extrabold">
                {p.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
