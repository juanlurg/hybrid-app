import { redirect } from "next/navigation";

import { accentFor, TONE } from "@/components/day-accents";
import {
  Footnote,
  Framed,
  RowStack,
  SectionLabel,
  StatGrid,
  TopBar,
} from "@/components/ui/kit";
import { requireAthlete } from "@/lib/data/athlete";
import { formatDayLong, placeDate, type IsoDate } from "@/lib/domain/calendar";
import { phaseSpans, resolveDay } from "@/lib/domain/plan";
import { formatWeight } from "@/lib/engine";
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

/** The plan's own feel description per zone (CARRERA §1) — what a block
 *  runs on when there is no LTHR to hang bpm numbers off. */
const ZONE_FEEL: Record<string, string> = {
  Z1: "muy fácil, respiración nasal posible",
  Z2: "conversación en frases completas",
  Z3: "frases cortas",
  Z4: "palabras sueltas",
  Z5: "insostenible más de 5-6′",
};

/** Without LTHR the engine leaves the bpm label null: run by feel. */
function hrLabel(block: RunBlock): string {
  const hr = block.hr ?? null;
  if (hr != null) return hr;
  const feel = ZONE_FEEL[block.zone];
  return feel ? `por sensación — ${feel}` : "por sensación";
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
              "duration_seconds, distance_km, avg_hr, decoupling_pct, perceived_effort, notes",
            )
            .eq("session_id", session.id)
            .maybeSingle()
        ).data
      : null;

  const logged: Array<{ value: string; unit: string; label: string }> = [];
  if (runLog) {
    if (runLog.duration_seconds != null)
      logged.push({
        value: String(Math.round(runLog.duration_seconds / 60)),
        unit: "min",
        label: "Duración",
      });
    if (runLog.distance_km != null)
      logged.push({
        value: formatWeight(Number(runLog.distance_km)),
        unit: "km",
        label: "Distancia",
      });
    if (runLog.avg_hr != null)
      logged.push({
        value: String(runLog.avg_hr),
        unit: "ppm",
        label: "FC media",
      });
    if (runLog.decoupling_pct != null)
      logged.push({
        value: formatWeight(Number(runLog.decoupling_pct)),
        unit: "%",
        label: "Desacople",
      });
  }

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="CARRERA" href="/semana" right={formatDayLong(day.date)} />

      <div className="flex-1 overflow-auto">
        <section className="bg-run px-4 pt-5 pb-4 text-paper">
          <div className="text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase opacity-80">
            {day.label} · {phase.key} SEM{" "}
            <span className="num">{placement.week}</span>
          </div>
          <h1 className="mt-2.5 text-[31px] leading-[1.02] font-black tracking-[-0.03em]">
            {day.prescription || day.title}
          </h1>
          <div className="mt-3.5 flex items-baseline gap-3 border-t-2 border-paper/30 pt-2.5">
            <span className="flex-1 text-[12.5px] leading-[1.2] font-bold">
              {day.title}
            </span>
            {day.estimatedMinutes > 0 ? (
              <span className="num flex-none text-[11px] leading-none font-extrabold tracking-[0.08em] uppercase opacity-80">
                {day.estimatedMinutes}′ aprox
              </span>
            ) : null}
          </div>
          {day.subtitle ? (
            <p className="mt-2.5 text-[11.5px] leading-[1.45] opacity-70">
              {day.subtitle}
            </p>
          ) : null}
        </section>

        {logged.length > 0 ? (
          <>
            <SectionLabel>Lo que registraste</SectionLabel>
            <div className="mt-2.5 border-y-2 border-ink">
              <StatGrid items={logged} columns={2} />
            </div>
          </>
        ) : null}

        {day.runBlocks.length > 0 ? (
          <>
            <SectionLabel
              right={<span className="num">{day.runBlocks.length} bloques</span>}
            >
              La sesión
            </SectionLabel>
            <RowStack className="mt-2.5">
              {day.runBlocks.map((block, i) => (
                <div key={`${block.title}-${i}`} className="bg-paper px-4 py-3">
                  <div className="flex w-full items-start gap-2.5">
                    <div
                      className="h-9 w-1.5 flex-none"
                      style={{ background: TONE_COLOUR[block.tone] }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 text-[13.5px] leading-[1.2] font-bold">
                          {block.title}
                        </span>
                        <span className="flex-none text-[9.5px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                          {block.zone}
                        </span>
                      </div>
                      <div className="num mt-1 text-[11px] leading-[1.35] text-mid">
                        {block.duration} · {hrLabel(block)}
                      </div>
                      {block.note ? (
                        <p className="mt-1.5 text-[11px] leading-[1.45] text-faint">
                          {block.note}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </RowStack>
          </>
        ) : (
          <>
            <SectionLabel>La sesión</SectionLabel>
            <div className="px-4 pt-2.5">
              <Framed>
                <p className="text-[11.5px] leading-[1.5] text-mid">
                  Esta semana el plan no escribe nada para{" "}
                  {day.label.toLowerCase()}. Sal a rodar en Z2 el tiempo que
                  tenías previsto y márcalo hecho: el volumen cuenta igual.
                </p>
              </Framed>
            </div>
          </>
        )}

        <div className="px-4 pt-4">
          <Framed>
            <div className="flex items-baseline gap-3">
              <span className="flex-1 text-[10px] leading-none font-extrabold tracking-[0.12em] uppercase">
                {lthr == null ? (
                  "Zonas · sin LTHR"
                ) : (
                  <>
                    Zonas · LTHR <span className="num">{lthr}</span>
                  </>
                )}
              </span>
              {nextTest ? (
                <span className="num flex-none text-[10px] leading-none font-medium text-ghost">
                  TEST {nextTest.key} SEM {nextTest.week}
                </span>
              ) : null}
            </div>

            {lthr == null ? (
              <p className="mt-2.5 text-[11.5px] leading-[1.5] text-mid">
                Todavía no tienes LTHR, así que no hay zonas reales que
                enseñarte.{" "}
                {nextTest
                  ? `El test cae en ${nextTest.key} semana ${nextTest.week}: `
                  : "El test son "}
                30′ a tope en llano y la FC media de los últimos 20 minutos es
                tu LTHR. Hasta entonces las pulsaciones de los bloques salen de
                una estimación y valen como referencia, no como objetivo.
              </p>
            ) : (
              <>
                <div className="mt-3.5 flex flex-col gap-2.5">
                  {zones.map((z) => (
                    <div key={z.key} className="flex items-center gap-3">
                      <span className="w-[22px] flex-none text-[11px] leading-none font-extrabold">
                        {z.key}
                      </span>
                      <span className="h-2.5 flex-1 bg-soft">
                        <span
                          className="block h-full"
                          style={{
                            width: `${widthPct(z)}%`,
                            background: TONE_COLOUR[ZONE_TONE[z.key]],
                          }}
                        />
                      </span>
                      <span className="num w-[74px] flex-none text-right text-[11.5px] leading-none font-extrabold">
                        {bpmRange(z)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-3.5 text-[11px] leading-[1.45] text-faint">
                  Cifras en ppm sobre el LTHR, no sobre la FC máxima. Z1 por
                  debajo del <span className="num">{zonesFloorPct}</span> % y Z5
                  a partir del <span className="num">{zonesTopPct}</span> %.
                </p>
              </>
            )}
          </Framed>
        </div>

        <Footnote>
          El detalle queda en el reloj. Aquí solo se marca si se ha hecho —
          cuenta para el volumen de la semana y para el desacople Pa:HR.
        </Footnote>
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
                notes: runLog.notes ?? null,
              }
            : null
        }
      />
    </div>
  );
}
