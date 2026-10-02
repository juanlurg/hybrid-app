"use client";

import { Minus, Plus, Snowflake } from "lucide-react";
import { useState, useTransition } from "react";

import { TONE } from "@/components/day-accents";
import { Row, RowStack, RuleNote, SectionLabel } from "@/components/ui/kit";
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
  "flex h-10 w-10 flex-none items-center justify-center rounded-full bg-soft text-ink";

/**
 * The manual override on top of the engine. Every nudge is a rounding step,
 * so the athlete can never land on a weight the plates cannot make. The
 * steppers hide behind "ajustar": an RM moves every future load, so it is
 * never one stray tap away while scrolling.
 */
export function RmRows({
  lifts,
  stepKg,
  label,
  note,
}: {
  lifts: RmRow[];
  stepKg: number;
  label: string;
  note?: string;
}) {
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

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
      <SectionLabel
        className="pb-0"
        right={
          <span className="flex items-baseline gap-3">
            {note ? <span>{note}</span> : null}
            <button
            type="button"
            aria-pressed={editing}
            onClick={() => setEditing((v) => !v)}
            className="-my-3 px-1 py-3 text-[13px] leading-none font-bold text-clay"
          >
            {editing ? "Listo" : "Ajustar"}
            </button>
          </span>
        }
      >
        {label}
      </SectionLabel>
      <RowStack className="mt-2.5">
        {lifts.map((lift) => {
          const heldAtKg =
            lift.hold && lift.holdAtKg != null && lift.holdAtKg > 0
              ? lift.holdAtKg
              : null;
          const held = heldAtKg != null;
          const status = held
            ? null
            : lift.effectiveRmKg != null
              ? `recortada un ${Math.round(lift.penalty * 100)} % · el motor usa ${formatWeight(lift.effectiveRmKg)} kg`
              : null;

          return (
            <Row key={lift.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] leading-[1.25] font-bold">
                  {lift.name}
                </div>
                {held ? (
                  <div className="mt-1 flex">
                    <span className="flex h-[22px] items-center gap-1 rounded-full bg-warn-soft px-2 text-[11px] leading-none font-bold text-ink">
                      <Snowflake aria-hidden size={11} className="text-clay-dim" />
                      congelado en {formatWeight(heldAtKg)} kg
                    </span>
                  </div>
                ) : status ? (
                  <div className="mt-0.5 text-[12.5px] leading-[1.35] font-semibold text-fail">
                    {status}
                  </div>
                ) : null}
              </div>

              {/* ± moves the RM one rounding step, so the number never leaves
                  the plates. */}
              {editing ? (
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
                    <Minus aria-hidden size={16} strokeWidth={2.5} />
                  </button>
                  <span className="num min-w-[56px] text-center text-[16px] leading-none font-extrabold">
                    {formatWeight(lift.e1rmKg)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Subir RM de ${lift.name}`}
                    onClick={() => nudge(lift, 1)}
                    className={NUDGE}
                  >
                    <Plus aria-hidden size={16} strokeWidth={2.5} />
                  </button>
                </div>
              ) : (
                <span className="num flex-none text-[17px] leading-none font-extrabold">
                  {formatWeight(lift.e1rmKg)} kg
                </span>
              )}
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
