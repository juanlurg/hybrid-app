"use client";

import { useState, useTransition } from "react";

import { TONE } from "@/components/day-accents";
import { Row, RowStack, RuleNote, Stepper } from "@/components/ui/kit";
import { adjustLiftRm } from "@/lib/actions/program";
import { formatWeight } from "@/lib/engine";
import { cn } from "@/lib/cn";

/** Serialisable projection of a `lifts` row — the RSC hands these down. */
export interface RmRow {
  id: string;
  name: string;
  e1rmKg: number;
  penalty: number;
  hold: boolean;
  holdAtKg: number | null;
  /** RM after an open cut, as the engine computed it. Null when there is none. */
  effectiveRmKg: number | null;
}

/**
 * The manual override on top of the engine. Every nudge is a rounding step,
 * so the athlete can never land on a weight the plates cannot make.
 */
export function RmRows({ lifts, stepKg }: { lifts: RmRow[]; stepKg: number }) {
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function nudge(lift: RmRow, direction: -1 | 1) {
    setBusyId(lift.id);
    setError(null);
    startTransition(async () => {
      const res = await adjustLiftRm(lift.id, direction * stepKg);
      if (!res.ok) setError(res.error ?? "El cambio no se ha guardado.");
      setBusyId(null);
    });
  }

  return (
    <>
      <RowStack className="mt-3">
        {lifts.map((lift) => {
          const heldAtKg =
            lift.hold && lift.holdAtKg != null && lift.holdAtKg > 0
              ? lift.holdAtKg
              : null;
          const held = heldAtKg != null;
          const status = held
            ? `tope ${formatWeight(heldAtKg)} kg tras fallo · se repite cuando la ola lo alcance`
            : lift.effectiveRmKg != null
              ? `RM −${Math.round(lift.penalty * 100)} % · efectiva ${formatWeight(lift.effectiveRmKg)} kg`
              : "sin fallos";

          return (
            <Row key={lift.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] leading-[1.2] font-bold">
                  {lift.name}
                </div>
                <div
                  className={cn(
                    "mt-1.5 truncate text-[10.5px] leading-none font-semibold tracking-[0.06em]",
                    held ? "text-warn" : lift.penalty > 0 ? "text-fail" : "text-mid",
                  )}
                >
                  {status}
                </div>
              </div>

              {/* The stepper's well holds the RM itself: ± moves it one
                  rounding step, so the number never leaves the plates. */}
              <div
                className={cn(
                  "flex-none",
                  busyId === lift.id && "opacity-40",
                )}
              >
                <Stepper
                  label={`RM de ${lift.name}`}
                  value={formatWeight(lift.e1rmKg)}
                  onDecrement={() => nudge(lift, -1)}
                  onIncrement={() => nudge(lift, 1)}
                />
                <div className="mt-1.5 text-right text-[9px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
                  kg RM
                </div>
              </div>
            </Row>
          );
        })}
      </RowStack>

      {error ? (
        <div className="px-4 pt-3">
          <RuleNote tone={TONE.fail} title="No se ha podido ajustar la RM">
            {error}
          </RuleNote>
        </div>
      ) : null}
    </>
  );
}
