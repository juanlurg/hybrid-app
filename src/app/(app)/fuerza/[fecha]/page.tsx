import { BatteryLow } from "lucide-react";
import { redirect } from "next/navigation";

import { Footnote, LinkBar, Note, TopBar } from "@/components/ui/kit";
import { GROUP_LABEL } from "@/components/day-accents";
import {
  SkipDayButton,
  StartSessionButton,
} from "@/components/session/start-session-button";
import { StrengthDay } from "@/components/strength-day";
import { requireAthlete } from "@/lib/data/athlete";
import {
  formatDayFull,
  placeDate,
  sameWeek,
  type IsoDate,
} from "@/lib/domain/calendar";
import { phaseSpans, resolveDay } from "@/lib/domain/plan";
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

  const future = day.date > today;

  // The week is the athlete's to reorganise (decision D2, extended): any
  // day of the CURRENT week can be trained early or late — the session
  // fulfils its plan day either way; after Sunday a missed one is lost,
  // as the calendar rules say.
  const startable =
    sameWeek(day.date, today) &&
    (session?.status ?? "planned") === "planned";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title={formatDayFull(day.date)} href="/semana" />

      <div className="no-scrollbar flex-1 overflow-auto pt-2 pb-4">
        <div className="px-5 pb-4">
          <h1 className="text-[30px] leading-[1.1] font-extrabold tracking-[-0.02em]">
            {day.title}
          </h1>
          {day.subtitle ? (
            <p className="mt-1.5 text-[14px] leading-[1.45] font-medium text-body">
              {day.subtitle}
            </p>
          ) : null}
        </div>
        <StrengthDay
          day={day}
          eyebrow={`Básico del día · semana ${placement.week}`}
          targetRir={ctx.profile.target_rir}
          showPlates={ctx.profile.show_plate_breakdown}
        >
          {day.isDeload ? (
            <Note
              className="mx-5 mt-3"
              tone="quiet"
              icon={<BatteryLow size={18} />}
              title="Semana de descarga"
            >
              Mitad de series y pesos más bajos, a propósito. El objetivo es
              llegar fresco a la semana siguiente.
            </Note>
          ) : null}
        </StrengthDay>

        {future ? (
          <Footnote>
            Pesos calculados con tus RM de hoy: si cambian antes de esta
            fecha, estos pesos cambian con ellas.
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
      ) : startable ? (
        <div className="flex flex-none gap-2.5 px-4 pt-3 pb-3">
          <SkipDayButton
            pill
            label="Saltar"
            day={{
                phaseId: phase.id,
                slotId: slot.id,
                scheduledOn: day.date,
                week: placement.week,
                dayIndex: day.dayIndex,
                sessionType: day.sessionType,
                title: day.title,
                group: day.group,
              }}
          />
          <StartSessionButton
            className="min-w-0 flex-1 p-0"
            day={{
              phaseId: phase.id,
              slotId: slot.id,
              scheduledOn: day.date,
              week: placement.week,
              dayIndex: day.dayIndex,
              sessionType: day.sessionType,
              title: day.title,
              group: day.group,
            }}
            existingSessionId={session?.id ?? null}
            existingStatus={session?.status ?? null}
            groupLabel={
              day.date === today ? GROUP_LABEL[day.group] : "Entrenar esta hoy"
            }
          />
        </div>
      ) : null}
    </div>
  );
}
