import { redirect } from "next/navigation";

import { accentFor, TONE } from "@/components/day-accents";
import {
  Card,
  Framed,
  Row,
  RowStack,
  SectionLabel,
  TopBar,
} from "@/components/ui/kit";
import { requireAthlete } from "@/lib/data/athlete";
import { formatDayLong, placeDate, type IsoDate } from "@/lib/domain/calendar";
import { phaseSpans, resolveDay } from "@/lib/domain/plan";
import {
  hrZones,
  parseStructure,
  type RunBlock,
  type Zone,
  type ZoneKey,
} from "@/lib/engine/run";
import { createClient } from "@/lib/supabase/server";

import { LogRunForm } from "./log-run-form";

/** Block intensity → palette token. Never a literal colour. */
const TONE_COLOUR: Record<RunBlock["tone"], string> = {
  easy: accentFor("run"),
  threshold: TONE.warn,
  hard: TONE.fail,
};

const ZONE_TONE: Record<ZoneKey, RunBlock["tone"]> = {
  Z1: "easy",
  Z2: "easy",
  Z3: "threshold",
  Z4: "threshold",
  Z5: "hard",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Z1 starts at 0 % of LTHR — printing "0–134" would read as a fake floor. */
function bpmRange(z: Zone): string {
  if (z.hiBpm == null) return `≥ ${z.loBpm}`;
  if (z.loBpm <= 0) return `≤ ${z.hiBpm}`;
  return `${z.loBpm}–${z.hiBpm}`;
}

/** Where an LTHR test sits in the season. Read from the plan, never assumed. */
interface TestPoint {
  key: string;
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
  const { ctx, config } = athlete;

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
    if (p) tests.push({ key: p.key, position: p.position, week: row.week });
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

  const testHint = nextTest ? (
    <>
      test {nextTest.key} sem <span className="num">{nextTest.week}</span>
    </>
  ) : (
    "test: 30′ a tope"
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="CARRERA" href="/semana" right={formatDayLong(day.date)} />

      {/* The action bar sticks to the bottom of this scrollport, so the
          form has to live inside it. */}
      <div className="flex-1 overflow-auto">
        <div className="px-5 pt-2">
          <Card>
            <div className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-run uppercase">
              {day.label} · {phase.key} SEM{" "}
              <span className="num">{placement.week}</span>
            </div>
            <h1 className="mt-2 text-[19px] leading-[1.3] font-semibold">
              {day.prescription || day.title}
            </h1>
            {day.estimatedMinutes > 0 ? (
              <div className="mt-2 flex items-baseline gap-2.5">
                <span className="num text-[80px] leading-[0.95] font-bold tracking-[-0.02em] text-run">
                  {day.estimatedMinutes}
                </span>
                <span className="font-display text-[18px] leading-none font-semibold text-mid uppercase">
                  min aprox
                </span>
              </div>
            ) : null}
            <p className="mt-3.5 border-t border-edge pt-3 text-[12.5px] leading-[1.55] text-mid">
              {day.subtitle ? `${day.subtitle}. ` : ""}El detalle queda en el
              reloj: aquí solo se marca si se ha hecho.
            </p>
          </Card>
        </div>

        {/* Even a lone block carries the zone, the duration and the target
            pulse — none of which the headline shows. */}
        {day.runBlocks.length > 0 ? (
          <>
            <SectionLabel
              right={
                <span className="num">
                  {day.runBlocks.length}{" "}
                  {day.runBlocks.length === 1 ? "bloque" : "bloques"}
                </span>
              }
            >
              La sesión
            </SectionLabel>
            <RowStack className="mt-2.5">
              {day.runBlocks.map((block, i) => (
                <Row key={`${block.title}-${i}`}>
                  <div className="flex w-full items-start gap-2.5">
                    <div
                      className="h-9 w-[3px] flex-none rounded-full"
                      style={{ background: TONE_COLOUR[block.tone] }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 text-[13.5px] leading-[1.2] font-semibold">
                          {block.title}
                        </span>
                        <span className="font-display flex-none text-[9.5px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                          {block.zone}
                        </span>
                      </div>
                      <div className="num mt-1 text-[11px] leading-[1.35] text-mid">
                        {block.duration} · {block.hr}
                      </div>
                      {block.note ? (
                        <p className="mt-1.5 text-[11px] leading-[1.45] text-faint">
                          {block.note}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </Row>
              ))}
            </RowStack>
          </>
        ) : day.runBlocks.length === 0 ? (
          <div className="px-5 pt-4">
            <Framed>
              <p className="text-[12px] leading-[1.5] text-mid">
                Esta semana el plan no escribe nada para{" "}
                {day.label.toLowerCase()}. Sal a rodar en Z2 el tiempo que tenías
                previsto y márcalo hecho: el volumen cuenta igual.
              </p>
            </Framed>
          </div>
        ) : null}

        <div className="px-5 pt-4">
          {lthr == null ? (
            <Card className="px-4 py-4">
              <div className="flex items-baseline gap-3">
                <span className="font-display flex-1 text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
                  Zonas · sin LTHR
                </span>
                <span className="flex-none text-[11px] leading-none text-faint uppercase">
                  {testHint}
                </span>
              </div>
              <p className="mt-2.5 text-[12px] leading-[1.55] text-mid">
                Todavía no tienes LTHR, así que no hay zonas reales que
                enseñarte.{" "}
                {nextTest
                  ? `El test cae en ${nextTest.key} semana ${nextTest.week}: `
                  : "El test son "}
                30′ a tope en llano y la FC media de los últimos 20 minutos es tu
                LTHR. Hasta entonces las pulsaciones de los bloques salen de una
                estimación y valen como referencia, no como objetivo.
              </p>
            </Card>
          ) : (
            <Card className="divide-y divide-line px-4 py-1">
              <div className="flex items-baseline gap-3 py-[11px]">
                <span className="font-display flex-1 text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
                  Zonas · LTHR <span className="num">{lthr}</span>
                </span>
                {nextTest ? (
                  <span className="flex-none text-[11px] leading-none text-faint uppercase">
                    {testHint}
                  </span>
                ) : null}
              </div>
              {zones.map((z) => (
                <div key={z.key} className="flex items-center gap-3 py-[11px]">
                  <span className="font-display w-[22px] flex-none text-[11px] leading-none font-semibold">
                    {z.key}
                  </span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-soft">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${widthPct(z)}%`,
                        background: TONE_COLOUR[ZONE_TONE[z.key]],
                      }}
                    />
                  </span>
                  <span className="num w-[74px] flex-none text-right text-[12px] leading-none font-semibold">
                    {bpmRange(z)}
                  </span>
                </div>
              ))}
              <p className="py-[11px] text-[11.5px] leading-[1.45] text-faint">
                Cifras en ppm sobre el LTHR, no sobre la FC máxima. Z1 por debajo
                del <span className="num">{zonesFloorPct}</span> % y Z5 a partir
                del <span className="num">{zonesTopPct}</span> %.
              </p>
            </Card>
          )}
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
