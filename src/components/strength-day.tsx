import Link from "next/link";

import {
  Card,
  HeroNumber,
  Row,
  RowStack,
  SectionLabel,
  Tag,
} from "@/components/ui/kit";
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

/**
 * A strength day, the same wherever it is opened — Hoy for today, and
 * /fuerza/[fecha] for any other date. The basic is the lit card; the rest
 * of the session sits under it with its loads and its coaching notes.
 */
export function StrengthDay({
  day,
  eyebrow,
  targetRir,
  showPlates,
}: {
  day: ResolvedDay;
  eyebrow: string;
  targetRir: string;
  showPlates: boolean;
}) {
  const primary = day.primary;
  const rest = day.exercises.filter((e) => !e.isPrimary);
  const restSets = rest.reduce((n, e) => n + e.sets, 0);

  const plates = primary && showPlates ? primary.plates : null;
  const perSide =
    plates && !plates.barOnly && plates.perSide.length > 0
      ? plates.perSide.map((p) => formatWeight(p)).join(" + ")
      : null;
  const why = primary ? whyLine(primary) : null;

  return (
    <>
      <div className="px-5">
        <Card>
          <div className="flex items-baseline gap-2">
            <span className="font-display min-w-0 flex-1 truncate text-[11px] leading-none font-semibold tracking-[0.14em] text-lime uppercase">
              {eyebrow}
            </span>
          </div>

          {primary ? (
            <>
              <div className="mt-2 text-[18px] leading-[1.25] font-semibold">
                {primary.name}
              </div>
              <HeroNumber
                value={
                  primary.weightKg == null ? "—" : formatWeight(primary.weightKg)
                }
                unit="kg"
              />
              <div className="mt-3.5 flex flex-wrap gap-2">
                <Tag>{primary.schemeLabel}</Tag>
                <Tag>RIR {targetRir}</Tag>
                <Tag>descanso {primary.restLabel}</Tag>
              </div>
              {perSide ? (
                <div className="mt-3 flex items-baseline gap-2.5">
                  <span className="font-display flex-none text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
                    Por lado
                  </span>
                  <span className="num text-[16px] leading-[1.2] font-semibold">
                    {perSide}
                    {plates?.remainderKg ? (
                      <span className="text-[13px] text-fail">
                        {" "}
                        +{formatWeight(plates.remainderKg)} sin disco
                      </span>
                    ) : null}
                  </span>
                </div>
              ) : null}
              {primary.notes ? (
                <p className="mt-3 text-[13px] leading-[1.45] text-mid">
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
                  className="mt-4 flex items-center gap-3 border-t border-edge pt-3"
                >
                  <span className="min-w-0 flex-1 text-[13px] leading-[1.4] text-mid">
                    {why}
                  </span>
                  <span
                    aria-hidden
                    className="flex-none text-[14px] leading-none text-mid"
                  >
                    ›
                  </span>
                </Link>
              ) : null}
            </>
          ) : (
            <div className="mt-2 text-[18px] leading-[1.25] font-semibold">
              {day.title}
            </div>
          )}
        </Card>
      </div>

      {rest.length > 0 ? (
        <>
          <SectionLabel right={`${restSets} series`}>
            {primary ? "Después" : "La sesión"}
          </SectionLabel>
          <RowStack className="mt-2.5">
            {rest.map((e) => (
              <Row key={e.id}>
                <div className="flex w-full items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-[15px] leading-[1.25] font-medium">
                    {e.name}
                  </span>
                  <span className="num flex-none text-[13px] leading-none text-mid">
                    {e.schemeLabel}
                  </span>
                  <span className="num min-w-[64px] flex-none text-right text-[14px] leading-none font-semibold">
                    {e.weightLabel}
                  </span>
                </div>
                {e.notes ? (
                  <div className="mt-1 text-[12.5px] leading-[1.4] text-mid">
                    {e.notes}
                  </div>
                ) : null}
              </Row>
            ))}
          </RowStack>
        </>
      ) : null}
    </>
  );
}
