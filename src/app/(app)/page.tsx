import Link from "next/link";

import { requireAthlete } from "@/lib/data/athlete";
import {
  formatDayLong,
  formatDayShort,
  type IsoDate,
} from "@/lib/domain/calendar";
import { resolveDay, type ResolvedExercise } from "@/lib/domain/plan";
import { createClient } from "@/lib/supabase/server";
import { formatWeight } from "@/lib/engine";
import { cn } from "@/lib/cn";
import {
  Callout,
  Card,
  HeroNumber,
  Row,
  RowStack,
  ScreenHeader,
  SectionLabel,
  Tag,
} from "@/components/ui/kit";
import { StartSessionButton } from "@/components/session/start-session-button";
import { SyncStatus } from "@/components/sync-status";
import { accentFor, GROUP_LABEL } from "@/components/day-accents";

/** The accessory column: short enough to line up, never a computed load. */
function shortLoad(e: ResolvedExercise): { label: string; muted: boolean } {
  if (e.loadMode === "bodyweight") return { label: "corp.", muted: true };
  if (e.loadMode === "rpe") return { label: "progr.", muted: true };
  if (e.weightKg == null) return { label: "—", muted: true };
  if (e.loadMode === "weighted_bodyweight") {
    return e.weightKg > 0
      ? { label: `+${formatWeight(e.weightKg)}`, muted: false }
      : { label: "corp.", muted: true };
  }
  return { label: formatWeight(e.weightKg), muted: false };
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

  const day = resolveDay(
    {
      ctx,
      config,
      phase,
      week: placement.week,
      absoluteWeek: placement.absoluteWeek,
    },
    placement.dayIndex,
  );

  // The date a session started today files under — and is looked up by.
  const effectiveOn = clamped ? today : day.date;

  const supabase = await createClient();
  const [{ data: sessions }, { data: heldLifts }] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, slot_id, status")
      .eq("user_id", athlete.userId)
      .eq("scheduled_on", effectiveOn),
    supabase
      .from("lifts")
      .select("id, key, name, hold, hold_at_kg, fail_count, penalty")
      .eq("user_id", athlete.userId)
      .or("hold.eq.true,fail_count.gt.0"),
  ]);

  const todaySession = (sessions ?? []).find((s) => s.slot_id === day.slot?.id);
  const accent = accentFor(day.group);
  const held = (heldLifts ?? []).filter((l) => l.hold && l.hold_at_kg);

  const primary = day.group === "strength" ? day.primary : null;
  const accessories = day.exercises.filter((e) => !e.isPrimary);
  const accessorySets = accessories.reduce((n, e) => n + e.sets, 0);
  const primaryIndex = day.exercises.findIndex((e) => e.isPrimary) + 1;

  const plates =
    primary && ctx.profile.show_plate_breakdown ? primary.plates : null;
  const perSide =
    plates && !plates.barOnly && plates.perSide.length > 0
      ? plates.perSide.map((p) => formatWeight(p)).join("+")
      : null;

  const heading =
    day.group === "mobility"
      ? {
          title: "Movilidad y correctivos",
          subtitle: "20′ · diaria · innegociable",
        }
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
        eyebrow={clamped ? formatDayLong(today) : day.dateLabel}
        right={
          <span className="font-display text-[12px] leading-none font-semibold tracking-[0.12em] text-faint uppercase">
            {phase.key} · sem {placement.week}/{phase.weeks}
          </span>
        }
        title={heading.title}
        subtitle={heading.subtitle}
      />

      <div className="flex-1 overflow-auto pt-4 pb-6">
        <SyncStatus />

        {preSeason ? (
          <div className="mb-3.5 px-5">
            <Callout eyebrow="El plan aún no ha empezado">
              Empieza el lunes{" "}
              {formatDayShort(ctx.program.starts_on as IsoDate)}. Esto es un
              adelanto de ese día: lo que entrenes antes se guarda en el
              historial con su fecha real y no marca ningún día del plan.
            </Callout>
          </div>
        ) : null}

        {primary ? (
          <div className="px-5">
            <Card>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-lime uppercase">
                  Básico del día
                </span>
                <span className="num ml-auto text-[11px] leading-none text-faint">
                  {primaryIndex}/{day.exercises.length}
                </span>
              </div>

              <div className="mt-2 text-[17.5px] leading-[1.25] font-semibold">
                {primary.name}
              </div>

              <HeroNumber
                value={
                  primary.weightKg == null
                    ? "—"
                    : formatWeight(primary.weightKg)
                }
                unit="kg"
              />

              <div className="mt-3.5 flex flex-wrap gap-2">
                <Tag>{primary.schemeLabel}</Tag>
                <Tag>RIR {ctx.profile.target_rir}</Tag>
                <Tag>{primary.restLabel}</Tag>
                {perSide ? <Tag>por lado {perSide}</Tag> : null}
                {plates?.remainderKg ? (
                  <Tag className="text-fail">
                    +{formatWeight(plates.remainderKg)} sin disco
                  </Tag>
                ) : null}
              </div>

              {primary.breakdown ? (
                <details className="group mt-4 border-t border-edge pt-3">
                  <summary className="flex list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                    <span className="text-[13px] leading-[1.4] font-medium text-mid">
                      Motor · RM {formatWeight(primary.breakdown.e1rmKg)} × ola{" "}
                      {Math.round(primary.breakdown.waveFactor * 100)} %
                      {primary.breakdown.isHeld ? " · en espera" : ""}
                    </span>
                    <span
                      aria-hidden
                      className="font-display flex-none text-[13px] leading-none text-faint transition-transform group-open:rotate-45"
                    >
                      ＋
                    </span>
                  </summary>
                  <div className="mt-2.5 text-[12.5px] leading-[1.5] text-mid">
                    ciclo {primary.breakdown.cycle} ·{" "}
                    {primary.breakdown.cycleBumpKg > 0
                      ? `+${formatWeight(primary.breakdown.cycleBumpKg)} kg acumulados`
                      : "sin acumulado"}
                    {primary.breakdown.penalty > 0
                      ? ` · penalización ${Math.round(primary.breakdown.penalty * 100)} %`
                      : ""}
                    {primary.breakdown.isDeload ? " · paso de descarga" : ""}
                  </div>
                </details>
              ) : null}
            </Card>
          </div>
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
                    <span className="num ml-auto text-[11px] leading-none text-faint">
                      {day.estimatedMinutes}′ aprox
                    </span>
                  ) : null}
                </div>
                {quiet ? null : (
                  <div className="mt-2 text-[17.5px] leading-[1.25] font-semibold">
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

        {accessories.length > 0 ? (
          <>
            <SectionLabel right={`${accessorySets} series`}>
              Después
            </SectionLabel>
            <RowStack className="mt-2.5">
              {accessories.map((e) => {
                const load = shortLoad(e);
                return (
                  <Row key={e.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-[14.5px] leading-[1.25] font-medium">
                      {e.name}
                    </span>
                    <span className="flex-none text-[12.5px] leading-none text-mid">
                      {e.schemeLabel}
                    </span>
                    <span
                      className={cn(
                        "num min-w-[62px] flex-none text-right leading-none",
                        load.muted
                          ? "text-[13px] font-medium text-mid"
                          : "text-[14px] font-semibold",
                      )}
                    >
                      {load.label}
                    </span>
                  </Row>
                );
              })}
            </RowStack>
          </>
        ) : null}

        {day.isDeload ? (
          <div className="mt-3.5 px-5">
            <Callout eyebrow="Semana de descarga">
              Mitad de series, mismos pesos. La carrera baja un 40 %. Llegar
              fresco a la semana que viene es el objetivo de esta.
            </Callout>
          </div>
        ) : null}

        {held.map((lift) => (
          <div key={lift.id} className="mt-3.5 px-5">
            <Callout
              eyebrow={`${lift.name} en espera · ${formatWeight(Number(lift.hold_at_kg))} kg`}
            >
              Fallaste el mínimo del rango la última vez: la ola no pasa de ese
              peso hasta una sesión limpia. Si toca descarga, manda la descarga.
              Otro fallo y la RM baja.
            </Callout>
          </div>
        ))}

        <Link
          href="/movilidad"
          className="mt-3.5 flex items-center gap-2.5 px-6 py-1"
        >
          <span aria-hidden className="h-2 w-2 flex-none rounded-full bg-run" />
          <span className="flex-1 text-[13px] leading-[1.4] text-mid">
            Movilidad 20′ · diaria · innegociable
          </span>
          <span aria-hidden className="text-[13px] leading-none text-faint">
            ›
          </span>
        </Link>
      </div>

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
