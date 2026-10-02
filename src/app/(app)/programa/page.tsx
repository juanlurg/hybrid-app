import {
  CalendarRange,
  ChevronRight,
  Flag,
  Settings,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { Fold, Footnote } from "@/components/ui/kit";
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
  icon: Icon,
  title,
  sub,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  sub: string;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg p-2.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-clay-soft text-clay">
        <Icon aria-hidden size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-[1.25] font-bold">
          {title}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-[1.35] font-medium text-mid">
          {sub}
        </span>
      </span>
      <ChevronRight aria-hidden size={16} className="flex-none text-faint" />
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none px-5 pt-6">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[11px] leading-none font-bold tracking-[0.13em] text-clay uppercase">
            {formatSeasonRange(startsOn, endsOn)}
          </span>
          <Link
            href="/ajustes"
            aria-label="Ajustes"
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-surface text-ink shadow-raised"
          >
            <Settings aria-hidden size={18} />
          </Link>
        </div>
        <h1 className="mt-1.5 text-[28px] leading-[1.15] font-extrabold tracking-[-0.02em] text-pretty">
          {program.name}
        </h1>
        {program.goal ? (
          <p className="mt-1.5 text-[14px] leading-[1.45] font-medium text-body">
            {program.goal}
          </p>
        ) : null}
      </header>

      <div className="no-scrollbar flex-1 overflow-auto pb-6">
        {/* The season as a line: where you have been, where you are, what
            is left, and the race at the end of it. */}
        <div className="mx-5 mt-4.5 rounded-2xl bg-surface px-4 py-1.5 shadow-card">
          {phaseRows.map(({ phase, firstAbsoluteWeek, range, current, past }, i) => (
            <Link
              key={phase.id}
              href={`/semana?semana=${current ? placement.absoluteWeek : firstAbsoluteWeek}`}
              className="flex gap-3.5"
            >
              <span aria-hidden className="flex w-3.5 flex-none flex-col items-center">
                <span
                  className={cn(
                    "w-0.5 flex-none bg-line",
                    i === 0 ? "h-[17px] bg-transparent" : current ? "h-[15px]" : "h-[17px]",
                  )}
                />
                <span
                  className={cn(
                    "flex-none rounded-full",
                    current
                      ? "h-3.5 w-3.5 bg-strength shadow-[0_0_0_4px_var(--clay-soft)]"
                      : past
                        ? "h-3 w-3 bg-ghost"
                        : "h-3 w-3 bg-surface shadow-[inset_0_0_0_2px_var(--hairline)]",
                  )}
                />
                <span className="w-0.5 flex-1 bg-line" />
              </span>
              <span className="min-w-0 flex-1 py-3">
                <span className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[15px] leading-[1.25]",
                      current ? "font-extrabold" : "font-bold",
                      past && "text-mid",
                    )}
                  >
                    {phase.name}
                  </span>
                  <span
                    className={cn(
                      "num flex-none text-[12.5px] leading-none",
                      current ? "font-bold text-clay" : "font-semibold text-mid",
                    )}
                  >
                    {current
                      ? `semana ${placement.week} de ${phase.weeks}`
                      : `${phase.weeks} sem`}
                  </span>
                </span>
                {range ? (
                  <span className="num mt-0.5 block text-[12.5px] leading-[1.35] font-medium text-mid">
                    {range}
                  </span>
                ) : null}
                {phase.emphasis && current ? (
                  <span className="mt-2 block text-[13px] leading-[1.45] font-medium text-body">
                    {phase.emphasis}
                  </span>
                ) : null}
                {current ? (
                  <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-quiet">
                    <span
                      className="block h-full rounded-full bg-strength"
                      style={{
                        width: `${Math.round((placement.week / Math.max(1, phase.weeks)) * 100)}%`,
                      }}
                    />
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
          {program.race_on ? (
            <div className="flex gap-3.5">
              <span aria-hidden className="flex w-3.5 flex-none flex-col items-center">
                <span className="h-3 w-0.5 flex-none bg-line" />
                <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[8px] bg-run-soft text-run">
                  <Flag size={12} />
                </span>
              </span>
              <span className="flex min-w-0 flex-1 items-baseline gap-2 pt-3 pb-3.5">
                <span className="min-w-0 flex-1 truncate text-[15px] leading-[1.25] font-bold">
                  {program.race_name ?? "Objetivo"}
                </span>
                <span className="num flex-none text-[12.5px] leading-none font-bold text-run">
                  {formatDayShort(program.race_on as IsoDate)}
                </span>
              </span>
            </div>
          ) : null}
        </div>

        {lifts.length > 0 ? (
          <RmRows
            lifts={lifts}
            stepKg={config.roundingKg}
            label="Tus RM"
            note={
              lastRetest
                ? `re-test ${formatDayShort(lastRetest.taken_on as IsoDate)}`
                : undefined
            }
          />
        ) : (
          <Footnote>
            Todavía no hay básicos con RM estimada. Se crean al clonar un
            programa.
          </Footnote>
        )}

        <p className="mt-2.5 px-6 text-[12.5px] leading-[1.5] font-medium text-mid">
          Todos los pesos de los básicos salen de estas RM. Cambiar una
          recalcula los pesos que vienen; lo ya registrado no cambia.
        </p>

        <div className="mx-5 mt-5 flex flex-col rounded-2xl bg-surface p-1.5 shadow-card">
          <PlanLink
            href="/editor"
            icon={CalendarRange}
            title="Semana tipo"
            sub="Qué toca cada día y con qué ejercicios"
          />
          <PlanLink
            href="/motor"
            icon={SlidersHorizontal}
            title="Cómo calcula el motor"
            sub="De dónde sale cada peso y qué pasa si fallas"
          />
          <PlanLink
            href="/generar"
            icon={Sparkles}
            title="Generar con IA"
            sub="Empezar otra temporada desde un brief"
          />
        </div>

        {calcLifts.length > 0 ? (
          <Fold
            className="mt-3"
            title="Calculadora de RM"
            summary="Peso × reps de una serie → tu RM · no guarda nada"
          >
            <RmCalculator lifts={calcLifts} stepKg={config.roundingKg} />
          </Fold>
        ) : null}
      </div>
    </div>
  );
}
