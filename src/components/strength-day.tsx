import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { PlateBar, perSideLabel } from "@/components/plate-bar";
import { SectionLabel } from "@/components/ui/kit";
import type { ResolvedDay, ResolvedExercise } from "@/lib/domain/plan";
import { formatWeight } from "@/lib/engine";

/**
 * Why the basic weighs what it weighs, in one sentence a person would say.
 * The term-by-term version lives on /motor; this is the answer, not the maths.
 */
function whyLine(primary: ResolvedExercise): string | null {
  const b = primary.breakdown;
  if (!b) return null;
  const parts = [
    `${Math.round(b.waveFactor * 100)} % de tu RM de ${formatWeight(b.e1rmKg)} kg`,
  ];
  if (b.cycleBumpKg > 0) {
    parts.push(`+${formatWeight(b.cycleBumpKg)} kg de ciclos cerrados`);
  }
  if (b.penalty > 0) {
    parts.push(`RM recortada un ${Math.round(b.penalty * 100)} % por fallos`);
  }
  if (b.isHeld) {
    parts.push(
      `congelado tras un fallo: tocaba ${formatWeight(b.uncappedKg)} kg`,
    );
  }
  if (b.isDeload) parts.push("semana de descarga");
  return parts.join(" · ");
}

function PanelTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-8 items-center rounded-full border border-panel-line bg-panel-well px-3 text-[13px] leading-none font-bold">
      {children}
    </span>
  );
}

/**
 * A strength day, the same wherever it is opened — Hoy for today, and
 * /fuerza/[fecha] for any other date. The basic is the dark panel; the
 * rest of the session sits under it, numbered, with its loads.
 */
export function StrengthDay({
  day,
  eyebrow,
  targetRir,
  showPlates,
  children,
}: {
  day: ResolvedDay;
  eyebrow: string;
  targetRir: string;
  showPlates: boolean;
  /** Notes that belong between the basic and the rest of the session. */
  children?: React.ReactNode;
}) {
  const primary = day.primary;
  const rest = day.exercises.filter((e) => !e.isPrimary);
  const restSets = rest.reduce((n, e) => n + e.sets, 0);

  const plates = primary && showPlates ? primary.plates : null;
  const perSide =
    plates && !plates.barOnly && plates.perSide.length > 0
      ? plates.perSide
      : null;
  const why = primary ? whyLine(primary) : null;

  return (
    <>
      <div className="px-5">
        <div className="rounded-3xl bg-panel p-5 text-on-panel shadow-panel">
          <div className="truncate text-[11px] leading-none font-bold tracking-[0.13em] text-clay-panel uppercase">
            {eyebrow}
          </div>

          {primary ? (
            <>
              <div className="mt-2 text-[20px] leading-[1.25] font-bold">
                {primary.name}
              </div>
              <div className="mt-1.5 flex items-end gap-3">
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="num text-[88px] leading-[0.9] font-extrabold tracking-[-0.04em] sm:text-[96px]">
                    {primary.weightKg == null
                      ? "—"
                      : formatWeight(primary.weightKg)}
                  </span>
                  <span className="text-[22px] leading-none font-bold text-panel-soft">
                    kg
                  </span>
                </div>
                {perSide ? (
                  <div className="flex flex-none flex-col items-end gap-2 pb-1">
                    <PlateBar perSide={perSide} onPanel scale={1.2} />
                    <span className="num text-[12px] leading-none font-semibold text-panel-soft">
                      {perSideLabel(perSide)}
                    </span>
                  </div>
                ) : null}
              </div>
              {plates?.remainderKg ? (
                <div className="num mt-2 text-[12.5px] leading-none font-semibold text-fail-panel">
                  +{formatWeight(plates.remainderKg)} kg sin disco
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <PanelTag>{primary.schemeLabel}</PanelTag>
                <PanelTag>RIR {targetRir}</PanelTag>
                <PanelTag>Descanso {primary.restLabel}</PanelTag>
              </div>
              {primary.notes ? (
                <p className="mt-3 text-[13px] leading-[1.45] font-medium text-panel-soft">
                  {primary.notes}
                </p>
              ) : null}
              {why ? (
                <Link
                  href={
                    primary.liftKey
                      ? `/motor?lift=${encodeURIComponent(primary.liftKey)}`
                      : "/motor"
                  }
                  className="mt-4 flex items-center gap-2.5 border-t border-panel-line pt-3.5"
                >
                  <span className="min-w-0 flex-1 text-[13px] leading-[1.4] font-medium text-panel-soft">
                    {why} · cómo se calcula
                  </span>
                  <ChevronRight
                    aria-hidden
                    size={16}
                    className="flex-none text-panel-soft"
                  />
                </Link>
              ) : null}
            </>
          ) : (
            <div className="mt-2 text-[20px] leading-[1.25] font-bold">
              {day.title}
            </div>
          )}
        </div>
      </div>

      {children}

      {rest.length > 0 ? (
        <>
          <SectionLabel right={`${restSets} series`} className="pb-2.5">
            {primary ? "Después" : "La sesión"}
          </SectionLabel>
          <div className="mx-5 flex flex-col rounded-2xl bg-surface p-1.5 shadow-card">
            {rest.map((e, i) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg p-2.5">
                <span className="num flex h-7 w-7 flex-none items-center justify-center rounded-[9px] bg-soft text-[12px] leading-none font-extrabold text-mid">
                  {i + (primary ? 2 : 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] leading-[1.25] font-semibold">
                    {e.name}
                  </div>
                  <div className="num mt-0.5 text-[12.5px] leading-[1.35] font-medium text-mid">
                    {e.schemeLabel}
                  </div>
                  {e.notes ? (
                    <div className="mt-0.5 text-[12.5px] leading-[1.4] font-medium text-mid">
                      {e.notes}
                    </div>
                  ) : null}
                </div>
                <span
                  className={
                    e.weightKg == null
                      ? "flex-none text-[15px] leading-none font-bold text-mid"
                      : "num flex-none text-[15px] leading-none font-bold"
                  }
                >
                  {e.weightLabel}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
