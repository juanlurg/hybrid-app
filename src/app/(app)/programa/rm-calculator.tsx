"use client";

import { useState } from "react";

import { RetestButton } from "@/components/retest-button";
import { Card, HeroNumber, Stepper } from "@/components/ui/kit";
import {
  EPLEY_MAX_REPS,
  epley1RM,
  epleyLoad,
  formatWeight,
  round2,
  roundToStep,
} from "@/lib/engine";
import { cn } from "@/lib/cn";

/** Serialisable projection of a lift plus the last set logged for it. */
export interface RmCalcLift {
  id: string;
  key: string;
  name: string;
  e1rmKg: number;
  /** Weight × reps of the most recent logged set, with its day ("12 jul"). */
  lastSet: { weightKg: number; reps: number; on: string } | null;
}

/**
 * Peso × repeticiones, más las que quedaban → RM estimada. Reads the
 * engine's own Epley, so the number here is the same one the wave would
 * multiply. Taking it is a re-test: one event, one measurement.
 */
export function RmCalculator({
  lifts,
  stepKg,
  today,
  syncs,
}: {
  lifts: RmCalcLift[];
  stepKg: number;
  today: string;
  /** profiles.sync_rm_after_retest */
  syncs: boolean;
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
      <Estimate
        key={lift.key}
        lift={lift}
        stepKg={stepKg}
        today={today}
        syncs={syncs}
      />
    </>
  );
}

function Estimate({
  lift,
  stepKg,
  today,
  syncs,
}: {
  lift: RmCalcLift;
  stepKg: number;
  today: string;
  syncs: boolean;
}) {
  // With no history the form opens on what the engine already believes: the
  // load it would prescribe for 5 reps, which reads back as today's RM.
  const [reps, setReps] = useState(lift.lastSet?.reps ?? 5);
  const [weightKg, setWeightKg] = useState(
    lift.lastSet?.weightKg ?? roundToStep(epleyLoad(lift.e1rmKg, 5), stepKg),
  );

  /** Reps left in the tank: they count as reps done. */
  const [rir, setRir] = useState(0);

  const estimateKg = epley1RM(weightKg, reps + rir);
  const roundedKg = roundToStep(estimateKg, stepKg);
  const deltaKg = round2(estimateKg - lift.e1rmKg);

  return (
    <>
      <div className="mt-4 flex items-baseline gap-3 text-[11px] leading-none">
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
          <div className="font-display text-[11px] leading-none font-semibold tracking-[0.12em] text-faint uppercase">
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
          <div className="font-display text-[11px] leading-none font-semibold tracking-[0.12em] text-faint uppercase">
            Repeticiones
          </div>
          <div className="mt-2.5">
            <Stepper
              compact
              label={`las repeticiones de la serie de ${lift.name}`}
              value={reps}
              onDecrement={() => setReps((r) => Math.max(1, r - 1))}
              onIncrement={() =>
                setReps((r) => Math.min(EPLEY_MAX_REPS - rir, r + 1))
              }
            />
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2.5">
        <span className="flex-1 text-[12px] leading-none font-semibold text-mid">
          Te quedaban
        </span>
        {[0, 1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={rir === n}
            aria-label={`${n} en reserva`}
            onClick={() => {
              setRir(n);
              setReps((r) => Math.min(r, EPLEY_MAX_REPS - n));
            }}
            className={cn(
              "num h-10 w-11 rounded-md text-[15px] leading-none font-bold",
              rir === n ? "bg-strength text-on-strength" : "bg-soft text-ink",
            )}
          >
            {n}
          </button>
        ))}
      </div>

      <Card className="mt-1.5 px-4 py-4">
        <div className="font-display text-[11px] leading-none font-semibold tracking-[0.12em] text-warn uppercase">
          RM estimada · {formatWeight(weightKg)} kg × {reps}
          {rir > 0 ? ` + ${rir}` : ""}
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

      {roundedKg === lift.e1rmKg ? null : (
        <RetestButton
          key={roundedKg}
          liftId={lift.id}
          liftName={lift.name}
          rmKg={roundedKg}
          takenOn={today}
          syncs={syncs}
        />
      )}

      <p className="mt-3 text-[11px] leading-[1.5] text-faint">
        Epley cuenta la serie como llevada al límite, así que las reps que te
        quedaban se suman a las hechas. Por encima de diez la fórmula infla la
        RM: el test bueno es una serie de 3 a 6.
      </p>
    </>
  );
}
