"use client";

import { useState } from "react";

import { HeroNumber, Stepper } from "@/components/ui/kit";
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

  return (
    <div className="mt-3 border-y-2 border-ink">
      {/* Wraps rather than scrolls, like the Progreso picker. */}
      <div className="flex flex-wrap gap-px bg-line">
        {lifts.map((l) => {
          const isActive = l.key === lift.key;
          return (
            <button
              key={l.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActiveKey(l.key)}
              className={cn(
                "min-w-[74px] flex-1 px-3 py-3.5 text-center text-[10px] leading-none font-bold tracking-[0.06em] whitespace-nowrap uppercase",
                isActive ? "bg-ink text-paper" : "bg-paper text-mid",
              )}
            >
              {l.name}
            </button>
          );
        })}
      </div>

      {/* Keyed: changing the basic reloads the form with that basic's set. */}
      <Estimate key={lift.key} lift={lift} stepKg={stepKg} />
    </div>
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
      <div className="flex items-baseline gap-3 bg-paper px-4 pt-3 text-[10px] leading-none">
        <span className="flex-1 font-extrabold tracking-[0.12em] text-mid uppercase">
          Serie de referencia
        </span>
        <span className="font-medium text-ghost uppercase">
          {lift.lastSet
            ? `última · ${lift.lastSet.on}`
            : "sin series registradas"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px bg-line">
        <div className="bg-paper px-4 py-3">
          <div className="text-[9.5px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
            Peso
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <Stepper
              label={`el peso de la serie de ${lift.name}`}
              value={formatWeight(weightKg)}
              onDecrement={() =>
                setWeightKg((w) => Math.max(stepKg, round2(w - stepKg)))
              }
              onIncrement={() => setWeightKg((w) => round2(w + stepKg))}
            />
            <span className="flex-none text-[11px] leading-none font-bold text-mid">
              kg
            </span>
          </div>
        </div>

        <div className="bg-paper px-4 py-3">
          <div className="text-[9.5px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
            Repeticiones
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <Stepper
              compact
              label={`las repeticiones de la serie de ${lift.name}`}
              value={reps}
              onDecrement={() => setReps((r) => Math.max(1, r - 1))}
              onIncrement={() => setReps((r) => Math.min(MAX_REPS, r + 1))}
            />
            <span className="flex-none text-[11px] leading-none font-bold text-mid">
              reps
            </span>
          </div>
        </div>
      </div>

      <div className="bg-ink px-4 pt-3.5 pb-4 text-paper">
        <div className="text-[10px] leading-none font-extrabold tracking-[0.12em] text-warn uppercase">
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
                <span className="block opacity-70">
                  al paso de redondeo, {formatWeight(roundedKg)} kg
                </span>
              )}
            </>
          }
        />
      </div>

      <p className="bg-paper px-4 py-4 text-[11px] leading-[1.5] text-faint">
        Epley cuenta la serie como llevada al límite: con dos o tres
        repeticiones de margen la RM real es más alta que esto, y por encima de
        diez la fórmula la infla. Aquí no se guarda nada — para mover la RM,
        los ± de arriba.
      </p>
    </>
  );
}
