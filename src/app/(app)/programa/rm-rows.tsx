"use client";

import { useState, useTransition } from "react";

import { TONE } from "@/components/day-accents";
import { Row, RowStack, RuleNote } from "@/components/ui/kit";
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

// Mirrors the kit's Stepper, minus the well: here the RM is the bare figure.
const NUDGE =
  "flex h-11 w-11 flex-none items-center justify-center rounded-md border border-edge bg-soft text-[15px] leading-none text-mid";

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
      <RowStack className="mt-2.5">
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
            <Row key={lift.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] leading-[1.2] font-medium">
                  {lift.name}
                </div>
                <div
                  className={cn(
                    "mt-0.5 text-[11.5px] leading-[1.35]",
                    held
                      ? "text-warn"
                      : lift.penalty > 0
                        ? "text-fail"
                        : "text-faint",
                  )}
                >
                  {status}
                </div>
              </div>

              {/* ± moves the RM one rounding step, so the number never leaves
                  the plates. */}
              <div
                className={cn(
                  "flex flex-none items-center gap-1",
                  busyId === lift.id && "opacity-40",
                )}
              >
                <button
                  type="button"
                  aria-label={`Bajar RM de ${lift.name}`}
                  onClick={() => nudge(lift, -1)}
                  className={NUDGE}
                >
                  −
                </button>
                <span className="num min-w-[56px] text-center text-[15px] leading-none font-bold">
                  {formatWeight(lift.e1rmKg)}
                </span>
                <button
                  type="button"
                  aria-label={`Subir RM de ${lift.name}`}
                  onClick={() => nudge(lift, 1)}
                  className={NUDGE}
                >
                  +
                </button>
              </div>
            </Row>
          );
        })}
      </RowStack>

      {error ? (
        <div className="px-5 pt-3">
          <RuleNote tone={TONE.fail} title="No se ha podido ajustar la RM">
            {error}
          </RuleNote>
        </div>
      ) : null}
    </>
  );
}
