import { redirect } from "next/navigation";

import { Card, SectionLabel, TopBar } from "@/components/ui/kit";
import { SkipDayButton } from "@/components/session/start-session-button";
import { requireAthlete } from "@/lib/data/athlete";
import {
  formatDayFull,
  placeDate,
  sameWeek,
  type IsoDate,
} from "@/lib/domain/calendar";
import { phaseSpans, resolveDay } from "@/lib/domain/plan";
import {
  hrZones,
  parseStructure,
  prescriptionMinutes,
  type RunBlock,
  type Zone,
  type ZoneKey,
} from "@/lib/engine/run";
import { createClient } from "@/lib/supabase/server";

import { LogRunForm } from "./log-run-form";

/** One colour per zone, cool to hot: the ruler and the blocks share it. */
const ZONE_COLOUR: Record<ZoneKey, string> = {
  Z1: "var(--run-mist)",
  Z2: "var(--run)",
  Z3: "#f8c07a",
  Z4: "var(--warn-dot)",
  Z5: "var(--fail)",
};

/** A block without a zone key falls back on its intensity. */
const TONE_ZONE: Record<RunBlock["tone"], ZoneKey> = {
  easy: "Z2",
  threshold: "Z4",
  hard: "Z5",
};

function zoneOf(block: RunBlock): ZoneKey {
  const key = block.zone.match(/Z[1-5]/)?.[0] as ZoneKey | undefined;
  return key ?? TONE_ZONE[block.tone];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Z1 starts at 0 % of LTHR — printing "0–134" would read as a fake floor. */
function bpmRange(z: Zone): string {
  if (z.hiBpm == null) return `≥ ${z.loBpm}`;
  if (z.loBpm <= 0) return `≤ ${z.hiBpm}`;
  return `${z.loBpm}–${z.hiBpm}`;
}

/** Where an LTHR test sits in the season. Read from the plan, never assumed. */
interface TestPoint {
  /** The phase's name, as the athlete knows it. */
  name: string;
  position: number;
  week: number;
}

export default async function CarreraPage({
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
  if (day.group !== "run" || !slot) redirect("/semana");

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("user_id", athlete.userId)
    .eq("scheduled_on", day.date)
    .eq("slot_id", slot.id)
    .maybeSingle();

  const done = session?.status === "done";

  // What the athlete actually logged, if anything — no invented figures.
  const runLog =
    session && done
      ? (
          await supabase
            .from("run_logs")
            .select(
              "duration_seconds, distance_km, avg_hr, decoupling_pct, perceived_effort",
            )
            .eq("session_id", session.id)
            .maybeSingle()
        ).data
      : null;

  /* ── zones ────────────────────────────────────────────────── */

  const lthr = ctx.profile.lthr;
  const zones = lthr == null ? [] : hrZones(lthr);
  const zoneBy = (key: ZoneKey) => zones.find((z) => z.key === key);

  // Z5 has no ceiling: lend it the width of Z4 so the dial has a top edge.
  const z4 = zoneBy("Z4");
  const z4Span = z4?.hiBpm != null ? z4.hiBpm - z4.loBpm : 0;
  const floor = zoneBy("Z1")?.loBpm ?? 0;
  const ceiling = (zoneBy("Z5")?.loBpm ?? 0) + Math.max(z4Span, 1);
  const dial = Math.max(1, ceiling - floor);
  const widthPct = (z: Zone) =>
    Math.min(100, Math.max(2, Math.round((((z.hiBpm ?? ceiling) - z.loBpm) / dial) * 100)));

  // The LTHR test is a prescription in the plan, not a fixed week. The
  // structure says so explicitly; free-text rows fall back to the regex.
  const orderedPhases = [...ctx.phases].sort((a, b) => a.position - b.position);
  const tests: TestPoint[] = [];
  for (const row of ctx.prescriptions) {
    const structure = parseStructure(row.structure);
    const isTest = structure
      ? structure.some((b) => b.kind === "test")
      : /lthr/i.test(row.prescription ?? "");
    if (!isTest) continue;
    const p = orderedPhases.find((x) => x.id === row.phase_id);
    if (p) tests.push({ name: p.name, position: p.position, week: row.week });
  }
  tests.sort((a, b) => a.position - b.position || a.week - b.week);
  const nextTest =
    tests.find(
      (t) =>
        t.position > phase.position ||
        (t.position === phase.position && t.week >= placement.week),
    ) ?? null;

  const zonesFloorPct = Math.round((zoneBy("Z1")?.toPct ?? 0) * 100);
  const zonesTopPct = Math.round((zoneBy("Z5")?.fromPct ?? 1) * 100);

  // The session drawn as a strip: each block as long as its minutes.
  const strip = day.runBlocks.map((b) => ({
    minutes: Math.max(1, prescriptionMinutes(b.duration)),
    zone: zoneOf(b),
  }));
  // Today's zone is where most of the minutes are spent.
  const todayZone = strip.length
    ? [...strip].sort((a, b) => b.minutes - a.minutes)[0].zone
    : null;

  // Inside the current week a run can still be skipped deliberately; a
  // logged one cannot.
  const skippable =
    sameWeek(day.date, today) && (session?.status ?? "planned") === "planned";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title={formatDayFull(day.date)} href="/semana" />

      {/* The action bar sticks to the bottom of this scrollport, so the
          form has to live inside it. */}
      <div className="no-scrollbar flex-1 overflow-auto">
        <div className="px-5 pt-3.5">
          <Card>
            <div className="text-[11px] leading-none font-bold tracking-[0.13em] text-run uppercase">
              {day.title} · semana <span className="num">{placement.week}</span>
            </div>
            <h1 className="mt-2 text-[22px] leading-[1.25] font-extrabold tracking-[-0.01em]">
              {day.prescription || day.title}
            </h1>
            {day.estimatedMinutes > 0 ? (
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="num text-[88px] leading-[0.95] font-extrabold tracking-[-0.04em] text-run">
                  {day.estimatedMinutes}
                </span>
                <span className="text-[18px] leading-none font-bold text-mid">
                  min aprox
                </span>
              </div>
            ) : null}
            {strip.length > 1 ? (
              <div aria-hidden className="mt-4 flex gap-[3px]">
                {strip.map((b, i) => (
                  <span
                    key={i}
                    className="h-3 rounded-md"
                    style={{ flex: b.minutes, background: ZONE_COLOUR[b.zone] }}
                  />
                ))}
              </div>
            ) : null}
            <p className="mt-3.5 text-[13px] leading-[1.5] font-medium text-mid">
              Basta con marcarla hecha. Los datos del reloj son opcionales:
              sirven para seguir el desacople y los kilómetros.
            </p>
          </Card>
        </div>

        {/* Even a lone block carries the zone, the duration and the target
            pulse — none of which the headline shows. */}
        {day.runBlocks.length > 0 ? (
          <>
            <SectionLabel
              className="pb-2.5"
              right={
                <span className="num">
                  {day.runBlocks.length}{" "}
                  {day.runBlocks.length === 1 ? "bloque" : "bloques"}
                </span>
              }
            >
              La sesión
            </SectionLabel>
            <div className="mx-5 flex flex-col rounded-2xl bg-surface p-1.5 shadow-card">
              {day.runBlocks.map((block, i) => {
                const zone = zoneOf(block);
                const main = zone === todayZone;
                return (
                  <div
                    key={`${block.title}-${i}`}
                    className="flex items-start gap-3 rounded-lg p-2.5"
                  >
                    <span
                      className={
                        main
                          ? "flex h-9 w-10 flex-none items-center justify-center rounded-md bg-run text-[13px] leading-none font-extrabold text-on-run"
                          : "flex h-9 w-10 flex-none items-center justify-center rounded-md bg-run-soft text-[13px] leading-none font-extrabold text-run"
                      }
                    >
                      {block.zone.match(/Z[1-5]/)?.[0] ?? zone}
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="text-[15px] leading-[1.25] font-bold">
                        {block.title}
                      </div>
                      <div className="num mt-0.5 text-[12.5px] leading-[1.35] font-medium text-mid">
                        {[block.duration, block.hr].filter(Boolean).join(" · ")}
                      </div>
                      {block.note ? (
                        <p className="mt-1 text-[12.5px] leading-[1.45] font-medium text-mid">
                          {block.note}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="px-5 pt-3">
            <Card className="px-4 py-3.5">
              <p className="text-[13px] leading-[1.5] font-medium text-mid">
                Esta semana el plan no escribe nada para{" "}
                {day.label.toLowerCase()}. Sal a rodar en Z2 el tiempo que tenías
                previsto y márcalo hecho: el volumen cuenta igual.
              </p>
            </Card>
          </div>
        )}

        <div className="px-5 pt-3">
          <Card className="p-4">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 text-[15px] leading-tight font-bold">
                Tus zonas
              </span>
              <span className="num text-[12.5px] leading-none font-semibold text-mid">
                {lthr == null ? "sin test todavía" : `LTHR ${lthr}`}
              </span>
            </div>
            {lthr == null ? (
              <p className="mt-2.5 text-[13px] leading-[1.55] font-medium text-mid">
                Todavía no tienes LTHR, así que no hay zonas reales que
                enseñarte.{" "}
                {nextTest
                  ? `El test cae en ${nextTest.name}, semana ${nextTest.week}: `
                  : "El test son "}
                30′ a tope en llano y la FC media de los últimos 20 minutos es tu
                LTHR. Hasta entonces las pulsaciones de los bloques son una
                referencia, no un objetivo.
              </p>
            ) : (
              <>
                {/* The bar is proportional; the labels are not. Z3 is a
                    sliver of the bar, and its "151–156" has to fit anyway. */}
                <div className="mt-3.5 flex gap-[3px]">
                  {zones.map((z) => (
                    <span
                      key={z.key}
                      className="h-3 min-w-0 rounded-md"
                      style={{
                        flex: widthPct(z),
                        background: ZONE_COLOUR[z.key],
                        boxShadow:
                          z.key === todayZone
                            ? `0 0 0 2px var(--surface), 0 0 0 4px ${ZONE_COLOUR[z.key]}`
                            : undefined,
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2.5 grid grid-cols-5 gap-1">
                  {zones.map((z) => {
                    const lit = z.key === todayZone;
                    return (
                      <div key={z.key} className="flex flex-col gap-1.5">
                        <span
                          className="text-[11px] leading-none font-extrabold"
                          style={lit ? { color: ZONE_COLOUR[z.key] } : undefined}
                        >
                          {z.key}
                          {lit ? " · hoy" : ""}
                        </span>
                        <span className="num text-[11px] leading-none font-semibold whitespace-nowrap text-mid">
                          {bpmRange(z)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3.5 text-[12.5px] leading-[1.5] font-medium text-mid">
                  Pulsaciones sobre tu umbral, no sobre la FC máxima: Z1 por
                  debajo del <span className="num">{zonesFloorPct}</span> % y Z5
                  a partir del <span className="num">{zonesTopPct}</span> %.
                  {nextTest
                    ? ` El próximo test cae en ${nextTest.name}, semana ${nextTest.week}: de él salen tus zonas reales.`
                    : ""}
                </p>
              </>
            )}
          </Card>
        </div>

        <LogRunForm
          day={{
            phaseId: phase.id,
            slotId: slot.id,
            date: day.date,
            week: placement.week,
            dayIndex: day.dayIndex,
            sessionType: day.sessionType,
            title: day.title,
            prescription: day.prescription,
          }}
          targetMinutes={day.estimatedMinutes}
          done={done}
          skip={
            skippable ? (
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
            ) : null
          }
          logged={
            runLog
              ? {
                  durationMinutes:
                    runLog.duration_seconds == null
                      ? null
                      : Math.round(runLog.duration_seconds / 60),
                  distanceKm:
                    runLog.distance_km == null
                      ? null
                      : Number(runLog.distance_km),
                  avgHr: runLog.avg_hr,
                  decouplingPct:
                    runLog.decoupling_pct == null
                      ? null
                      : Number(runLog.decoupling_pct),
                  perceivedEffort: runLog.perceived_effort,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
