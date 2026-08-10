"use client";

import { useState } from "react";

import { Card, HeroNumber, Stepper } from "@/components/ui/kit";
import { epley1RM, epleyLoad, formatWeight, round2, roundToStep } from "@/lib/engine";
import { cn } from "@/lib/cn";

/** Serialisable projection of a lift plus the last set logged for it. */
export interface RmCalcLift {
  key: string;
  name: string;
  e1rmKg: number;
  /** Weight × reps of the most recent logged set, with its day ("12 jul"). */
  lastSet: { weightKg: number; reps: number; on: string } | null;
}

/** Past this, Epley stops being an estimate and starts being a guess. */
const MAX_REPS = 12;

/**
 * Peso × repeticiones → RM estimada. Reads the engine's own Epley, so the
 * number here is the same one the wave would multiply; it writes nothing —
 * the RM only moves through the steppers above.
 */
export function RmCalculator({
  lifts,
  stepKg,
}: {
  lifts: RmCalcLift[];
  stepKg: number;
}) {
  const [activeKey, setActiveKey] = useState(lifts[0].key);
  const lift = lifts.find((l) => l.key === activeKey) ?? lifts[0];

  // No inset of its own: the folded row on Programa supplies it.
  return (
    <>
      {/* Wraps rather than scrolls, like the Progreso picker. */}
      <div className="flex flex-wrap gap-1 rounded-md border border-edge bg-soft p-1">
        {lifts.map((l) => {
          const isActive = l.key === lift.key;
          return (
            <button
              key={l.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActiveKey(l.key)}
              className={cn(
                "font-display min-w-[74px] flex-1 rounded-sm px-3 py-2.5 text-center text-[11px] leading-none font-semibold tracking-[0.08em] whitespace-nowrap uppercase",
                isActive ? "bg-strength text-on-strength" : "text-mid",
              )}
            >
              {l.name}
            </button>
          );
        })}
      </div>

      {/* Keyed: changing the basic reloads the form with that basic's set. */}
      <Estimate key={lift.key} lift={lift} stepKg={stepKg} />
    </>
  );
}

function Estimate({ lift, stepKg }: { lift: RmCalcLift; stepKg: number }) {
  // With no history the form opens on what the engine already believes: the
  // load it would prescribe for 5 reps, which reads back as today's RM.
  const [reps, setReps] = useState(lift.lastSet?.reps ?? 5);
  const [weightKg, setWeightKg] = useState(
    lift.lastSet?.weightKg ?? roundToStep(epleyLoad(lift.e1rmKg, 5), stepKg),
  );

  const estimateKg = epley1RM(weightKg, reps);
  const roundedKg = roundToStep(estimateKg, stepKg);
  const deltaKg = round2(estimateKg - lift.e1rmKg);

  return (
    <>
      <div className="mt-4 flex items-baseline gap-3 text-[10px] leading-none">
        <span className="font-display flex-1 font-semibold tracking-[0.12em] text-mid uppercase">
          Serie de referencia
        </span>
        <span className="font-display font-medium text-ghost uppercase">
          {lift.lastSet
            ? `última · ${lift.lastSet.on}`
            : "sin series registradas"}
        </span>
      </div>

      {/* The unit rides in the label: two steppers side by side already fill
          the inset width on a phone. */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <div className="min-w-0 rounded-lg border border-line bg-surface px-3 py-3">
          <div className="font-display text-[9.5px] leading-none font-semibold tracking-[0.12em] text-faint uppercase">
            Peso · kg
          </div>
          <div className="mt-2.5">
            <Stepper
              label={`el peso de la serie de ${lift.name}`}
              value={formatWeight(weightKg)}
              onDecrement={() =>
                setWeightKg((w) => Math.max(stepKg, round2(w - stepKg)))
              }
              onIncrement={() => setWeightKg((w) => round2(w + stepKg))}
            />
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-line bg-surface px-3 py-3">
          <div className="font-display text-[9.5px] leading-none font-semibold tracking-[0.12em] text-faint uppercase">
            Repeticiones
          </div>
          <div className="mt-2.5">
            <Stepper
              compact
              label={`las repeticiones de la serie de ${lift.name}`}
              value={reps}
              onDecrement={() => setReps((r) => Math.max(1, r - 1))}
              onIncrement={() => setReps((r) => Math.min(MAX_REPS, r + 1))}
            />
          </div>
        </div>
      </div>

      <Card className="mt-1.5 px-4 py-4">
        <div className="font-display text-[10px] leading-none font-semibold tracking-[0.12em] text-warn uppercase">
          RM estimada · {formatWeight(weightKg)} kg × {reps}
        </div>
        <HeroNumber
          size="md"
          value={formatWeight(estimateKg)}
          unit="kg"
          lines={
            <>
              {deltaKg === 0
                ? `clavada con la RM en uso, ${formatWeight(lift.e1rmKg)} kg`
                : `${deltaKg > 0 ? "+" : "−"}${formatWeight(Math.abs(deltaKg))} kg sobre la RM en uso, ${formatWeight(lift.e1rmKg)} kg`}
              {roundedKg === estimateKg ? null : (
                <span className="block text-faint">
                  al paso de redondeo, {formatWeight(roundedKg)} kg
                </span>
              )}
            </>
          }
        />
      </Card>

      <p className="mt-3 text-[11px] leading-[1.5] text-faint">
        Epley cuenta la serie como llevada al límite: con dos o tres
        repeticiones de margen la RM real es más alta que esto, y por encima de
        diez la fórmula la infla. Aquí no se guarda nada — para mover la RM,
        los ± de arriba.
      </p>
    </>
  );
}
