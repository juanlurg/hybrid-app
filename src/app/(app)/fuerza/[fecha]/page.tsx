import { redirect } from "next/navigation";

import {
  Callout,
  Card,
  Footnote,
  HeroNumber,
  LinkBar,
  Row,
  RowStack,
  SectionLabel,
  Tag,
  TopBar,
} from "@/components/ui/kit";
import { requireAthlete } from "@/lib/data/athlete";
import { formatDayLong, placeDate, type IsoDate } from "@/lib/domain/calendar";
import { phaseSpans, resolveDay } from "@/lib/domain/plan";
import { formatWeight } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A strength day, addressed by date. Future and past days alike: the plan
 * is resolvable for any week, so any day can be read — only today (and,
 * within its week, a missed day) can be trained.
 */
export default async function FuerzaPage({
  params,
}: {
  params: Promise<{ fecha: string }>;
}) {
  const { fecha } = await params;
  const athlete = await requireAthlete();
  const { ctx, config, today } = athlete;

  if (!ISO_DATE.test(fecha)) redirect("/semana");

  // placeDate clamps out-of-season dates, so an exact match is the only
  // way to know the URL really points at a day of this program.
  const placement = placeDate(phaseSpans(ctx.phases), fecha as IsoDate);
  if (!placement || placement.date !== fecha) redirect("/semana");

  const phase = ctx.phases.find((p) => p.id === placement.phase.id);
  if (!phase) redirect("/semana");

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

  const slot = day.slot;
  if (day.group !== "strength" || !slot) redirect("/semana");

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("user_id", athlete.userId)
    .eq("scheduled_on", day.date)
    .eq("slot_id", slot.id)
    .maybeSingle();

  const primary = day.primary;
  const future = day.date > today;

  const plates =
    primary && ctx.profile.show_plate_breakdown ? primary.plates : null;
  const perSide =
    plates && !plates.barOnly && plates.perSide.length > 0
      ? plates.perSide.map((p) => formatWeight(p)).join("+")
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="FUERZA" href="/semana" right={formatDayLong(day.date)} />

      <div className="flex-1 overflow-auto pb-4">
        <div className="px-5 pt-2">
          <Card>
            <div className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-lime uppercase">
              {day.label} · {phase.key} SEM{" "}
              <span className="num">{placement.week}</span>
            </div>
            {primary ? (
              <>
                <div className="mt-2 text-[17.5px] leading-[1.25] font-semibold">
                  {primary.name}
                </div>
                <HeroNumber
                  size="md"
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
              </>
            ) : (
              <div className="mt-2 text-[17.5px] leading-[1.25] font-semibold">
                {day.title}
              </div>
            )}
          </Card>
        </div>

        <SectionLabel
          right={
            <span className="num">
              {day.totalSets} {day.totalSets === 1 ? "serie" : "series"}
            </span>
          }
        >
          La sesión
        </SectionLabel>
        <RowStack className="mt-2.5">
          {day.exercises.map((e) => (
            <Row key={e.id}>
              <div className="flex w-full items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[14.5px] leading-[1.25] font-medium">
                  {e.name}
                </span>
                {e.isPrimary ? (
                  <span className="font-display flex-none text-[9.5px] leading-none font-semibold tracking-[0.1em] text-lime uppercase">
                    básico
                  </span>
                ) : null}
                <span className="flex-none text-[12.5px] leading-none text-mid">
                  {e.schemeLabel}
                </span>
                <span className="num min-w-[62px] flex-none text-right text-[14px] leading-none font-semibold">
                  {e.weightLabel}
                </span>
              </div>
              <div className="mt-1 text-[11.5px] leading-[1.4] text-faint">
                desc. {e.restLabel}
                {e.notes ? ` · ${e.notes}` : ""}
              </div>
            </Row>
          ))}
        </RowStack>

        {day.isDeload ? (
          <div className="mt-3.5 px-5">
            <Callout eyebrow="Semana de descarga">
              Mitad de series, mismos pesos. Llegar fresco a la semana
              siguiente es el objetivo de esta.
            </Callout>
          </div>
        ) : null}

        {future ? (
          <Footnote>
            Pesos calculados con la RM de hoy: si el motor reacciona antes de
            esta fecha, cambiarán.
          </Footnote>
        ) : null}

        {session?.status === "skipped" ? (
          <Footnote>
            Este día se cerró como saltado. El plan sigue donde tocaba.
          </Footnote>
        ) : null}
      </div>

      {session?.status === "in_progress" ? (
        <LinkBar href={`/sesion/${session.id}`}>Seguir sesión</LinkBar>
      ) : session?.status === "done" || session?.status === "partial" ? (
        <LinkBar href={`/sesion/${session.id}/resumen`} tone="ink">
          Ver resumen
        </LinkBar>
      ) : null}
    </div>
  );
}
