import Link from "next/link";
import type { ReactNode } from "react";

import { Card, Fold, Footnote, SectionLabel } from "@/components/ui/kit";
import { cn } from "@/lib/cn";
import { requireAthlete } from "@/lib/data/athlete";
import {
  addDays,
  formatDayShort,
  formatSeasonRange,
  phaseEnd,
  type IsoDate,
} from "@/lib/domain/calendar";
import { roundToStep } from "@/lib/engine";
import type { LiftRow } from "@/lib/domain/plan";
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

/** A row that goes somewhere else in Plan. */
function PlanLink({
  href,
  title,
  sub,
}: {
  href: string;
  title: string;
  sub: string;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 py-[11px]">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-[1.2] font-semibold">
          {title}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-[1.35] text-mid">
          {sub}
        </span>
      </span>
      <span aria-hidden className="flex-none text-[15px] leading-none text-mid">
        ›
      </span>
    </Link>
  );
}

/**
 * Plan: how the season is built. The phases and what each is for, the
 * weekly template, the RMs every weight hangs from, and the doors to the
 * engine's reasoning and to Ajustes. Today's work lives in Hoy.
 */
export default async function PlanPage() {
  const athlete = await requireAthlete();
  const { ctx, config, placement, seasonWeeks } = athlete;
  const { program } = ctx;

  const startsOn = program.starts_on as IsoDate;
  const endsOn = (program.ends_on ??
    addDays(startsOn, seasonWeeks * 7 - 1)) as IsoDate;

  const phases = [...ctx.phases].sort((a, b) => a.position - b.position);
  const phaseRows = phases.map((p, i) => {
    const first = 1 + phases.slice(0, i).reduce((n, q) => n + q.weeks, 0);
    const phaseStart = p.starts_on as IsoDate | null;
    return {
      phase: p,
      firstAbsoluteWeek: first,
      range: phaseStart
        ? formatSeasonRange(
            phaseStart,
            phaseEnd({
              id: p.id,
              key: p.key,
              name: p.name,
              position: p.position,
              weeks: p.weeks,
              startsOn: phaseStart,
            }),
          )
        : null,
      current: p.id === placement.phase.id,
      past: first + p.weeks - 1 < placement.absoluteWeek,
    };
  });

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
      // What the engine is actually multiplying while a cut is open.
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

  const race: ReactNode = program.race_on ? (
    <div className="flex items-baseline gap-3 py-[11px]">
      <span className="min-w-0 flex-1 truncate text-[15px] leading-[1.2] font-semibold">
        {program.race_name ?? "Objetivo"}
      </span>
      <span className="num flex-none text-[13px] leading-none text-mid">
        {formatDayShort(program.race_on as IsoDate)}
      </span>
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none px-5 pt-6">
        <div className="flex items-center gap-3">
          <span className="font-display min-w-0 flex-1 truncate text-[12px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
            {formatSeasonRange(startsOn, endsOn)}
          </span>
          <Link
            href="/ajustes"
            className="font-display flex h-10 flex-none items-center rounded-md border border-edge bg-surface px-3.5 text-[12px] leading-none font-semibold tracking-[0.08em] text-mid uppercase"
          >
            Ajustes
          </Link>
        </div>
        <h1 className="font-display mt-2.5 text-[24px] leading-[1.15] font-bold">
          {program.name}
        </h1>
        {program.goal ? (
          <p className="mt-1 text-[13px] leading-[1.45] text-mid">
            {program.goal}
          </p>
        ) : null}
      </header>

      <div className="flex-1 overflow-auto pb-6">
        <SectionLabel>La temporada</SectionLabel>
        <div className="px-5 pt-2.5">
          <Card className="divide-y divide-line px-4 py-1">
            {phaseRows.map(({ phase, firstAbsoluteWeek, range, current, past }) => (
              <Link
                key={phase.id}
                href={`/semana?semana=${current ? placement.absoluteWeek : firstAbsoluteWeek}`}
                className="flex gap-3 py-[11px]"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 w-[3px] flex-none self-stretch rounded-full",
                    current ? "bg-lime-line" : "bg-hairline",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[15px] leading-[1.2] font-semibold",
                        past && "text-mid",
                      )}
                    >
                      {phase.name}
                    </span>
                    <span
                      className={cn(
                        "num flex-none text-[12.5px] leading-none",
                        current ? "font-semibold text-lime" : "text-mid",
                      )}
                    >
                      {current
                        ? `semana ${placement.week} de ${phase.weeks}`
                        : `${phase.weeks} semanas`}
                    </span>
                  </span>
                  {range ? (
                    <span className="num mt-1 block text-[12.5px] leading-none text-mid">
                      {range}
                    </span>
                  ) : null}
                  {phase.emphasis && !past ? (
                    <span className="mt-1.5 block text-[13px] leading-[1.45] text-mid">
                      {phase.emphasis}
                    </span>
                  ) : null}
                </span>
              </Link>
            ))}
            {race}
          </Card>
        </div>

        <SectionLabel>Cómo está montado</SectionLabel>
        <div className="px-5 pt-2.5">
          <Card className="divide-y divide-line px-4 py-1">
            <PlanLink
              href="/editor"
              title="Semana tipo"
              sub="Qué toca cada día y con qué ejercicios · se edita aquí"
            />
            <PlanLink
              href="/motor"
              title="Cómo calcula el motor"
              sub="De dónde sale cada peso y qué pasa si fallas"
            />
          </Card>
        </div>

        {lifts.length > 0 ? (
          <RmRows
            lifts={lifts}
            stepKg={config.roundingKg}
            label={
              lastRetest
                ? `Tus RM · re-test ${formatDayShort(lastRetest.taken_on as IsoDate)}`
                : "Tus RM"
            }
          />
        ) : (
          <Footnote>
            Todavía no hay básicos con RM estimada. Se crean al clonar un
            programa.
          </Footnote>
        )}

        <p className="mt-2.5 px-5 text-[12.5px] leading-[1.5] text-mid">
          Todos los pesos de los básicos salen de estas RM. Cambiar una
          recalcula los pesos que vienen; lo ya registrado no cambia.
        </p>

        {calcLifts.length > 0 ? (
          <Fold
            className="mt-3.5"
            title="Calculadora de RM"
            summary="Peso × reps de una serie → tu RM · no guarda nada"
          >
            <RmCalculator lifts={calcLifts} stepKg={config.roundingKg} />
          </Fold>
        ) : null}

        <Link
          href="/generar"
          className="mt-6 flex items-center gap-2.5 px-6 py-2"
        >
          <span className="flex-1 text-[13px] leading-[1.4] text-mid">
            Empezar otra temporada · generar un programa con IA
          </span>
          <span aria-hidden className="text-[13px] leading-none text-mid">
            ›
          </span>
        </Link>
      </div>
    </div>
  );
}
